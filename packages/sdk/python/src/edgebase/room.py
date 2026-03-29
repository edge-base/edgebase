"""EdgeBase Room Client v2 -- real-time multiplayer state.

Complete redesign from v1:
  - 3 state areas: sharedState (all clients), playerState (per-player),
    serverState (server-only, not sent to clients)
  - Client can only read + subscribe + send(). All writes are server-only.
  - send() returns the result via requestId matching (asyncio.Future)
  - Subscription returns object with unsubscribe()
  - namespace + roomId identification (replaces single roomId)

Usage::

    from edgebase.room import RoomClient

    room = RoomClient(
        'https://your-project.edgebase.fun',
        'game',
        'room-123',
        token_getter=lambda: access_token,
    )
    await room.join()

    sub = room.on_shared_state(lambda state, changes: print(state))
    result = await room.send('SET_SCORE', {'score': 42})
    await room.leave()
"""

from __future__ import annotations

import asyncio
import json
import logging
import urllib.parse
import uuid
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

_ROOM_EXPLICIT_LEAVE_CLOSE_DELAY = 0.04


# ---- Types ----------------------------------------------------------------


class Subscription:
    """Handle returned by on_* subscription methods. Call unsubscribe() to remove."""

    def __init__(self, unsub_fn: Callable[[], None]) -> None:
        self._unsub_fn = unsub_fn

    def unsubscribe(self) -> None:
        self._unsub_fn()


# ---- Helpers ---------------------------------------------------------------


def _deep_set(obj: dict, path: str, value: Any) -> None:
    """Apply a dot-path assignment to *obj* in-place."""
    parts = path.split(".")
    current = obj
    for key in parts[:-1]:
        if key not in current or not isinstance(current[key], dict):
            current[key] = {}
        current = current[key]
    last = parts[-1]
    if value is None:
        current.pop(last, None)
    else:
        current[last] = value


def _extract_server_message(raw_body: str) -> Optional[str]:
    if not raw_body:
        return None
    try:
        decoded = json.loads(raw_body)
    except ValueError:
        return None
    if not isinstance(decoded, dict):
        return None
    for key in ("message", "error", "detail"):
        value = decoded.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


# ---- RoomClient v2 --------------------------------------------------------


class RoomClient:
    """WebSocket client for a single EdgeBase Room (v2 protocol).

    Create via ``RoomClient(base_url, namespace, room_id, token_getter)``.
    Call :meth:`join` to connect (async), :meth:`leave` to disconnect.
    """

    def __init__(
        self,
        base_url: str,
        namespace: str,
        room_id: str,
        token_getter: Callable[[], Optional[str]],
        *,
        auto_reconnect: bool = True,
        max_reconnect_attempts: int = 10,
        reconnect_base_delay: float = 1.0,
        send_timeout: float = 10.0,
        connection_timeout: float = 15.0,
    ) -> None:
        self.namespace: str = namespace
        self.room_id: str = room_id

        self._base_url = base_url
        self._token_getter = token_getter
        self._auto_reconnect = auto_reconnect
        self._max_reconnect_attempts = max_reconnect_attempts
        self._reconnect_base_delay = reconnect_base_delay
        self._send_timeout = send_timeout
        self._connection_timeout = connection_timeout

        # ---- State (v2: shared + player) ----
        self._shared_state: Dict[str, Any] = {}
        self._shared_version: int = 0
        self._player_state: Dict[str, Any] = {}
        self._player_version: int = 0

        # ---- Connection ----
        self._ws: Any = None  # websockets.WebSocketClientProtocol
        self._connected = False
        self._authenticated = False
        self._joined = False
        self._intentionally_left = False
        self._reconnect_attempts = 0

        # ---- Pending send() requests: request_id -> Future ----
        self._pending_requests: Dict[str, asyncio.Future] = {}  # type: ignore[type-arg]

        # ---- Subscription handlers ----
        self._shared_state_handlers: List[Callable[[Dict[str, Any], Dict[str, Any]], None]] = []
        self._player_state_handlers: List[Callable[[Dict[str, Any], Dict[str, Any]], None]] = []
        self._message_handlers: Dict[str, List[Callable[[Any], None]]] = {}
        self._all_message_handlers: List[Callable[[str, Any], None]] = []
        self._error_handlers: List[Callable[[Dict[str, str]], None]] = []
        self._kicked_handlers: List[Callable[[], None]] = []

        # ---- Background tasks ----
        self._heartbeat_task: Optional[asyncio.Task] = None  # type: ignore[type-arg]
        self._recv_task: Optional[asyncio.Task] = None  # type: ignore[type-arg]

    # ---- State Accessors ---------------------------------------------------

    def get_shared_state(self) -> Dict[str, Any]:
        """Get current shared state (shallow copy)."""
        return dict(self._shared_state)

    def get_player_state(self) -> Dict[str, Any]:
        """Get current player state (shallow copy)."""
        return dict(self._player_state)

    # ---- Metadata (HTTP, no WebSocket needed) ------------------------------

    async def get_metadata(self) -> Dict[str, Any]:
        """Get room metadata without joining (HTTP GET).

        Returns developer-defined metadata set by room.setMetadata() on the server.
        """
        return await RoomClient.get_metadata_static(
            self._base_url, self.namespace, self.room_id
        )

    @staticmethod
    async def get_metadata_static(
        base_url: str, namespace: str, room_id: str
    ) -> Dict[str, Any]:
        """Static: Get room metadata without creating a RoomClient instance.

        Useful for lobby screens where you need room info before joining.
        """
        import httpx

        url = (
            f"{base_url.rstrip('/')}/api/room/metadata"
            f"?namespace={urllib.parse.quote(namespace, safe='')}"
            f"&id={urllib.parse.quote(room_id, safe='')}"
        )
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(url)
            except httpx.HTTPError as exc:
                raise RuntimeError(
                    f"Room metadata request could not reach {url}. "
                    "Make sure the EdgeBase server is running and reachable. "
                    f"Cause: {exc}"
                ) from exc
            if resp.status_code != 200:
                message = _extract_server_message(resp.text)
                raise RuntimeError(
                    message
                    or (
                        f"Failed to load room metadata for '{room_id}' in "
                        f"namespace '{namespace}' (HTTP {resp.status_code})."
                    )
                )
            return resp.json()  # type: ignore[no-any-return]

    # ---- Connection Lifecycle ----------------------------------------------

    async def join(self) -> None:
        """Connect to the room, authenticate, and join."""
        self._intentionally_left = False
        if self._ws and self._connected:
            return
        await self._establish_connection()

    async def leave(self) -> None:
        """Leave the room and disconnect. Cancels all pending send() Futures."""
        self._intentionally_left = True

        # Cancel all pending send() requests
        for req_id, future in self._pending_requests.items():
            if not future.done():
                future.set_exception(RuntimeError("Room left"))
        self._pending_requests.clear()

        await self._close_ws(send_leave=True)
        self._shared_state = {}
        self._shared_version = 0
        self._player_state = {}
        self._player_version = 0

    def _reject_all_pending(self, message: str) -> None:
        """Reject all pending send() futures with an error."""
        error = RuntimeError(message)
        for request_id, future in list(self._pending_requests.items()):
            if not future.done():
                future.set_exception(error)
        self._pending_requests.clear()

    async def destroy(self) -> None:
        """Leave the room, clear all handler lists, and release resources.

        After calling destroy(), this RoomClient instance should not be reused.
        """
        await self.leave()
        self._shared_state_handlers.clear()
        self._player_state_handlers.clear()
        self._message_handlers.clear()
        self._all_message_handlers.clear()
        self._error_handlers.clear()
        self._kicked_handlers.clear()

    # ---- Actions -----------------------------------------------------------

    async def send(self, action_type: str, payload: Any = None) -> Any:
        """Send an action to the server and wait for the result.

        Returns the action result from the server (resolved via requestId).

        Raises:
            RuntimeError: If not connected or if the action times out / errors.

        Example::

            result = await room.send('SET_SCORE', {'score': 42})
        """
        if not self._ws or not self._connected or not self._authenticated:
            raise RuntimeError("Not connected to room. Call join() and wait for the room to connect before sending actions or signals.")

        request_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        future: asyncio.Future[Any] = loop.create_future()
        self._pending_requests[request_id] = future

        await self._send_raw(
            {
                "type": "send",
                "actionType": action_type,
                "payload": payload if payload is not None else {},
                "requestId": request_id,
            }
        )

        try:
            return await asyncio.wait_for(future, timeout=self._send_timeout)
        except asyncio.TimeoutError:
            self._pending_requests.pop(request_id, None)
            raise RuntimeError(f"Action '{action_type}' timed out") from None

    # ---- Subscriptions (v2 API) --------------------------------------------

    def on_shared_state(
        self, handler: Callable[[Dict[str, Any], Dict[str, Any]], None]
    ) -> Subscription:
        """Subscribe to shared state changes.

        Handler receives (full_state, changes). Called on full sync and on each
        shared_delta.
        """
        self._shared_state_handlers.append(handler)

        def _remove() -> None:
            if handler in self._shared_state_handlers:
                self._shared_state_handlers.remove(handler)

        return Subscription(_remove)

    def on_player_state(
        self, handler: Callable[[Dict[str, Any], Dict[str, Any]], None]
    ) -> Subscription:
        """Subscribe to player state changes.

        Handler receives (full_state, changes). Called on full sync and on each
        player_delta.
        """
        self._player_state_handlers.append(handler)

        def _remove() -> None:
            if handler in self._player_state_handlers:
                self._player_state_handlers.remove(handler)

        return Subscription(_remove)

    def on_message(self, message_type: str, handler: Callable[[Any], None]) -> Subscription:
        """Subscribe to messages of a specific type sent by room.sendMessage().

        Example::

            sub = room.on_message('game_over', lambda data: print(data['winner']))
        """
        self._message_handlers.setdefault(message_type, []).append(handler)

        def _remove() -> None:
            handlers = self._message_handlers.get(message_type)
            if handlers and handler in handlers:
                handlers.remove(handler)

        return Subscription(_remove)

    def on_any_message(self, handler: Callable[[str, Any], None]) -> Subscription:
        """Subscribe to ALL messages regardless of type.

        Handler receives (message_type, data).
        """
        self._all_message_handlers.append(handler)

        def _remove() -> None:
            if handler in self._all_message_handlers:
                self._all_message_handlers.remove(handler)

        return Subscription(_remove)

    def on_error(self, handler: Callable[[Dict[str, str]], None]) -> Subscription:
        """Subscribe to error events."""
        self._error_handlers.append(handler)

        def _remove() -> None:
            if handler in self._error_handlers:
                self._error_handlers.remove(handler)

        return Subscription(_remove)

    def on_kicked(self, handler: Callable[[], None]) -> Subscription:
        """Subscribe to kick events. After being kicked, auto-reconnect is disabled."""
        self._kicked_handlers.append(handler)

        def _remove() -> None:
            if handler in self._kicked_handlers:
                self._kicked_handlers.remove(handler)

        return Subscription(_remove)

    # ---- Private: Connection -----------------------------------------------

    async def _establish_connection(self) -> None:
        try:
            import websockets  # type: ignore[import]
        except ImportError as exc:
            raise ImportError("Install 'websockets>=12.0' for Room support.") from exc

        ws_url = self._build_ws_url()
        try:
            self._ws = await asyncio.wait_for(
                websockets.connect(ws_url),
                timeout=self._connection_timeout,
            )
        except asyncio.TimeoutError:
            raise RuntimeError(
                f"Room WebSocket connection timed out after {self._connection_timeout}s. "
                "Is the server running?"
            )
        self._connected = True
        self._reconnect_attempts = 0

        await self._authenticate()

        # Start background tasks
        self._recv_task = asyncio.create_task(self._receive_loop())
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def _authenticate(self) -> None:
        token = self._token_getter()
        if not token:
            raise RuntimeError("No access token available. Sign in first.")

        await self._send_raw({"type": "auth", "token": token})

        ws = self._ws

        async def _wait_for_auth() -> None:
            while True:
                raw = await ws.recv()
                msg = json.loads(raw)
                msg_type = msg.get("type")
                if msg_type in ("auth_success", "auth_refreshed"):
                    self._authenticated = True

                    # Send join with last known state for eviction recovery (v2)
                    await self._send_raw(
                        {
                            "type": "join",
                            "lastSharedState": self._shared_state,
                            "lastSharedVersion": self._shared_version,
                            "lastPlayerState": self._player_state,
                            "lastPlayerVersion": self._player_version,
                        }
                    )
                    self._joined = True
                    return
                if msg_type == "error":
                    raise RuntimeError(f"Room auth failed: {msg.get('message')}")

        await asyncio.wait_for(_wait_for_auth(), timeout=10.0)

    # ---- Private: Message Handling -----------------------------------------

    async def _receive_loop(self) -> None:
        try:
            async for raw in self._ws:
                self._handle_message(raw)
        except Exception:
            pass
        finally:
            self._connected = False
            self._authenticated = False
            self._joined = False
            if not self._intentionally_left:
                self._reject_all_pending("WebSocket disconnected")
                if self._auto_reconnect:
                    await self._schedule_reconnect()

    def _handle_message(self, raw: str) -> None:
        try:
            msg = json.loads(raw)
        except Exception:
            return

        msg_type = msg.get("type")

        if msg_type == "sync":
            self._handle_sync(msg)
        elif msg_type == "shared_delta":
            self._handle_shared_delta(msg)
        elif msg_type == "player_delta":
            self._handle_player_delta(msg)
        elif msg_type == "action_result":
            self._handle_action_result(msg)
        elif msg_type == "action_error":
            self._handle_action_error(msg)
        elif msg_type == "message":
            self._handle_server_message(msg)
        elif msg_type == "kicked":
            self._handle_kicked()
        elif msg_type == "error":
            self._handle_error(msg)
        elif msg_type == "pong":
            pass  # Heartbeat response

    def _handle_sync(self, msg: Dict[str, Any]) -> None:
        self._shared_state = msg.get("sharedState", {})
        self._shared_version = msg.get("sharedVersion", 0)
        self._player_state = msg.get("playerState", {})
        self._player_version = msg.get("playerVersion", 0)

        # Notify handlers with full state as changes
        for h in self._shared_state_handlers:
            h(self._shared_state, self._shared_state)
        for h in self._player_state_handlers:
            h(self._player_state, self._player_state)

    def _handle_shared_delta(self, msg: Dict[str, Any]) -> None:
        delta = msg.get("delta", {})
        self._shared_version = msg.get("version", self._shared_version)

        for path, value in delta.items():
            _deep_set(self._shared_state, path, value)

        for h in self._shared_state_handlers:
            h(self._shared_state, delta)

    def _handle_player_delta(self, msg: Dict[str, Any]) -> None:
        delta = msg.get("delta", {})
        self._player_version = msg.get("version", self._player_version)

        for path, value in delta.items():
            _deep_set(self._player_state, path, value)

        for h in self._player_state_handlers:
            h(self._player_state, delta)

    def _handle_action_result(self, msg: Dict[str, Any]) -> None:
        request_id = msg.get("requestId")
        if request_id and request_id in self._pending_requests:
            future = self._pending_requests.pop(request_id)
            if not future.done():
                future.set_result(msg.get("result"))

    def _handle_action_error(self, msg: Dict[str, Any]) -> None:
        request_id = msg.get("requestId")
        if request_id and request_id in self._pending_requests:
            future = self._pending_requests.pop(request_id)
            if not future.done():
                future.set_exception(RuntimeError(msg.get("message", "Action error")))

    def _handle_server_message(self, msg: Dict[str, Any]) -> None:
        message_type = msg.get("messageType", "")
        data = msg.get("data")

        # Type-specific handlers
        handlers = self._message_handlers.get(message_type)
        if handlers:
            for h in handlers:
                h(data)

        # All-message handlers
        for h in self._all_message_handlers:
            h(message_type, data)

    def _handle_kicked(self) -> None:
        for h in self._kicked_handlers:
            h()
        # Don't auto-reconnect after being kicked
        self._intentionally_left = True

    def _handle_error(self, msg: Dict[str, Any]) -> None:
        err = {"code": str(msg.get("code", "")), "message": str(msg.get("message", ""))}
        for h in self._error_handlers:
            h(err)

    # ---- Private: Helpers --------------------------------------------------

    async def _send_raw(self, data: Dict[str, Any]) -> None:
        if self._ws:
            await self._send_raw_on(self._ws, data)

    async def _send_raw_on(self, ws: Any, data: Dict[str, Any]) -> None:
        await ws.send(json.dumps(data))

    def _build_ws_url(self) -> str:
        http_url = self._base_url.rstrip("/")
        ws_url = http_url.replace("http://", "ws://").replace("https://", "wss://")
        return (
            f"{ws_url}/api/room"
            f"?namespace={self.namespace}"
            f"&id={self.room_id}"
        )

    async def _heartbeat_loop(self) -> None:
        while self._connected:
            await asyncio.sleep(30)
            if self._ws and self._connected:
                try:
                    await self._send_raw({"type": "ping"})
                except Exception:
                    break

    async def _schedule_reconnect(self) -> None:
        if self._reconnect_attempts >= self._max_reconnect_attempts:
            return
        delay = min(self._reconnect_base_delay * (2 ** self._reconnect_attempts), 30.0)
        self._reconnect_attempts += 1
        await asyncio.sleep(delay)
        try:
            await self._establish_connection()
        except Exception as exc:
            logger.debug("Room reconnect failed: %s", exc)

    async def _close_ws(self, *, send_leave: bool = False) -> None:
        recv_task = self._recv_task
        heartbeat_task = self._heartbeat_task
        self._recv_task = None
        self._heartbeat_task = None

        if recv_task:
            recv_task.cancel()
        if heartbeat_task:
            heartbeat_task.cancel()

        ws = self._ws
        if ws:
            try:
                if send_leave:
                    await self._send_raw_on(ws, {"type": "leave"})
                    await asyncio.sleep(_ROOM_EXPLICIT_LEAVE_CLOSE_DELAY)
                await ws.close()
            except Exception:
                pass
            self._ws = None
        self._connected = False
        self._authenticated = False
        self._joined = False
