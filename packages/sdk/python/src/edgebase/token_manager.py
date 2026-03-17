"""EdgeBase Python SDK — Token storage and management utilities.

Provides in-memory and extensible token storage for client-side auth session
management.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Optional, Any


@dataclass
class TokenPair:
    """A pair of access and refresh tokens."""

    access_token: str
    refresh_token: str

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, TokenPair):
            return NotImplemented
        return self.access_token == other.access_token and self.refresh_token == other.refresh_token


class TokenStorage:
    """Abstract base for token storage implementations."""

    def get_tokens(self) -> Optional[TokenPair]:
        raise NotImplementedError

    def save_tokens(self, pair: TokenPair) -> None:
        raise NotImplementedError

    def clear_tokens(self) -> None:
        raise NotImplementedError


class MemoryTokenStorage(TokenStorage):
    """In-memory token storage (not persisted across restarts)."""

    def __init__(self) -> None:
        self._tokens: Optional[TokenPair] = None

    def get_tokens(self) -> Optional[TokenPair]:
        return self._tokens

    def save_tokens(self, pair: TokenPair) -> None:
        self._tokens = pair

    def clear_tokens(self) -> None:
        self._tokens = None


class TokenManager:
    """Manages tokens via a TokenStorage backend.

    Provides save/load/retrieve/clear operations and session restore.
    """

    def __init__(self, storage: TokenStorage) -> None:
        self._storage = storage

    def try_restore_session(self) -> bool:
        """Returns True if a valid session was restored from storage."""
        pair = self._storage.get_tokens()
        return pair is not None and bool(pair.access_token)

    def get_access_token(self) -> Optional[str]:
        pair = self._storage.get_tokens()
        return pair.access_token if pair else None

    def get_refresh_token(self) -> Optional[str]:
        pair = self._storage.get_tokens()
        return pair.refresh_token if pair else None

    def save_tokens(self, access: str, refresh: str) -> None:
        self._storage.save_tokens(TokenPair(access, refresh))

    def clear_tokens(self) -> None:
        self._storage.clear_tokens()


def decode_jwt_payload(token: str) -> Optional[dict[str, Any]]:
    """Decode the payload of a JWT without verifying the signature.

    Returns None if the token is malformed.
    """
    if not token:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        # Add padding if needed
        padded = parts[1] + "=" * (4 - len(parts[1]) % 4)
        decoded = base64.urlsafe_b64decode(padded)
        return json.loads(decoded)
    except Exception:
        return None
