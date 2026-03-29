<?php

declare(strict_types=1);

namespace EdgeBase;

use EdgeBase\Core\EdgeBaseException;
use EdgeBase\Core\Generated\ApiPaths;
use EdgeBase\Core\Generated\GeneratedDbApi;
use EdgeBase\Core\HttpClient;

/**
 * RoomClient v2 — Client-side room connection for real-time multiplayer state.
 *
 * PHP stays synchronous: send-like control-plane methods poll receive() until the
 * matching ack/error frame arrives. The additive unified surface mirrors the
 * `rooms` runtime without removing legacy Room APIs.
 */
class RoomClient
{
    private const ROOM_EXPLICIT_LEAVE_CLOSE_DELAY_US = 40_000;

    public readonly string $namespace;
    public readonly string $roomId;

    public readonly RoomStateNamespace $state;
    public readonly RoomMetaNamespace $meta;
    public readonly RoomSignalsNamespace $signals;
    public readonly RoomMembersNamespace $members;
    public readonly RoomAdminNamespace $admin;
    public readonly RoomSessionNamespace $session;

    private array $sharedState = [];
    private int $sharedVersion = 0;
    private array $playerState = [];
    private int $playerVersion = 0;
    /** @var list<array<string, mixed>> */
    private array $roomMembers = [];

    private string $baseUrl;
    private \Closure $tokenFn;
    private int $maxReconnectAttempts;
    private int $reconnectBaseDelayMs;
    private bool $autoReconnect;
    private int $sendTimeoutMs;

    /** @var \WebSocket\Client|object|null */
    private mixed $ws = null;
    private bool $connected = false;
    private bool $authenticated = false;
    private bool $joined = false;
    private bool $intentionallyLeft = false;
    private int $reconnectAttempts = 0;
    private bool $waitingForAuth = false;
    private bool $joinRequested = false;
    private ?string $currentUserId = null;
    private ?string $currentConnectionId = null;
    private string $connectionState = 'idle';
    /** @var array<string, mixed>|null */
    private ?array $reconnectInfo = null;

    /** @var array<string, array{done: bool, result: mixed, error: ?string}> */
    private array $pendingRequests = [];
    /** @var array<string, array{done: bool, error: ?string}> */
    private array $pendingSignalRequests = [];
    /** @var array<string, array{done: bool, error: ?string}> */
    private array $pendingAdminRequests = [];
    /** @var array<string, array{done: bool, error: ?string}> */
    private array $pendingMemberStateRequests = [];

    /** @var list<callable(array<string, mixed>, array<string, mixed>): void> */
    private array $sharedStateHandlers = [];
    /** @var list<callable(array<string, mixed>, array<string, mixed>): void> */
    private array $playerStateHandlers = [];
    /** @var array<string, list<callable(mixed): void>> */
    private array $messageHandlers = [];
    /** @var list<callable(string, mixed): void> */
    private array $allMessageHandlers = [];
    /** @var list<callable(array{code: string, message: string}): void> */
    private array $errorHandlers = [];
    /** @var list<callable(): void> */
    private array $kickedHandlers = [];
    /** @var list<callable(list<array<string, mixed>>): void> */
    private array $membersSyncHandlers = [];
    /** @var list<callable(array<string, mixed>): void> */
    private array $memberJoinHandlers = [];
    /** @var list<callable(array<string, mixed>, string): void> */
    private array $memberLeaveHandlers = [];
    /** @var list<callable(array<string, mixed>, array<string, mixed>): void> */
    private array $memberStateHandlers = [];
    /** @var array<string, list<callable(mixed, array<string, mixed>): void>> */
    private array $signalHandlers = [];
    /** @var list<callable(string, mixed, array<string, mixed>): void> */
    private array $anySignalHandlers = [];
    /** @var list<callable(array<string, mixed>): void> */
    private array $reconnectHandlers = [];
    /** @var list<callable(string): void> */
    private array $connectionStateHandlers = [];

    public function __construct(
        string $baseUrl,
        string $namespace,
        string $roomId,
        callable $tokenFn,
        bool $autoReconnect = true,
        int $maxReconnectAttempts = 10,
        int $reconnectBaseDelayMs = 1000,
        int $sendTimeoutMs = 10000,
    ) {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->namespace = $namespace;
        $this->roomId = $roomId;
        $this->tokenFn = \Closure::fromCallable($tokenFn);
        $this->autoReconnect = $autoReconnect;
        $this->maxReconnectAttempts = $maxReconnectAttempts;
        $this->reconnectBaseDelayMs = $reconnectBaseDelayMs;
        $this->sendTimeoutMs = $sendTimeoutMs;

        $this->state = new RoomStateNamespace($this);
        $this->meta = new RoomMetaNamespace($this);
        $this->signals = new RoomSignalsNamespace($this);
        $this->members = new RoomMembersNamespace($this);
        $this->admin = new RoomAdminNamespace($this);
        $this->session = new RoomSessionNamespace($this);
    }

    public function getSharedState(): array
    {
        return self::deepCopy($this->sharedState);
    }

    public function getPlayerState(): array
    {
        return self::deepCopy($this->playerState);
    }

    /** @return list<array<string, mixed>> */
    public function listMembers(): array
    {
        /** @var list<array<string, mixed>> $members */
        $members = self::deepCopy($this->roomMembers);
        return $members;
    }

    public function connectionState(): string
    {
        return $this->connectionState;
    }

    public function userId(): ?string
    {
        return $this->currentUserId;
    }

    public function connectionId(): ?string
    {
        return $this->currentConnectionId;
    }

    public function attachSocketForTesting(object $socket, bool $connected = true, bool $authenticated = true, bool $joined = true): void
    {
        $this->ws = $socket;
        $this->connected = $connected;
        $this->authenticated = $authenticated;
        $this->joined = $joined;
    }

    public function handleMessageForTesting(string $raw): void
    {
        $this->handleMessage($raw);
    }

    /**
     * @return array<string, mixed>
     */
    public function getMetadata(): array
    {
        $http = new HttpClient($this->baseUrl);
        $core = new GeneratedDbApi($http);
        /** @var array<string, mixed> $result */
        $result = $core->get_room_metadata([
            'namespace' => $this->namespace,
            'id' => $this->roomId,
        ]);
        if (!is_array($result)) {
            throw new EdgeBaseException('Failed to parse room metadata response', 500);
        }
        return $result;
    }

    /**
     * @return array<string, mixed>
     */
    public static function getMetadataStatic(string $baseUrl, string $namespace, string $roomId): array
    {
        $http = new HttpClient($baseUrl);
        $core = new GeneratedDbApi($http);
        /** @var array<string, mixed> $result */
        $result = $core->get_room_metadata([
            'namespace' => $namespace,
            'id' => $roomId,
        ]);
        if (!is_array($result)) {
            throw new EdgeBaseException('Failed to parse room metadata response', 500);
        }
        return $result;
    }

    public function join(): void
    {
        $this->intentionallyLeft = false;
        $this->joinRequested = true;
        $this->setConnectionState($this->reconnectInfo !== null ? 'reconnecting' : 'connecting');
        if ($this->connected) {
            return;
        }
        $this->establish();
    }

    public function leave(): void
    {
        $this->intentionallyLeft = true;
        $this->joinRequested = false;
        $this->waitingForAuth = false;

        foreach ($this->pendingRequests as &$pending) {
            $pending['done'] = true;
            $pending['error'] = 'Room left';
        }
        unset($pending);
        $this->pendingRequests = [];
        $this->rejectPendingVoidRequests('pendingSignalRequests', 'Room left');
        $this->rejectPendingVoidRequests('pendingAdminRequests', 'Room left');
        $this->rejectPendingVoidRequests('pendingMemberStateRequests', 'Room left');
        $this->sendLeaveAndClose();
        $this->connected = false;
        $this->authenticated = false;
        $this->joined = false;
        $this->reconnectAttempts = 0;
        $this->reconnectInfo = null;
        $this->currentUserId = null;
        $this->currentConnectionId = null;
        $this->sharedState = [];
        $this->sharedVersion = 0;
        $this->playerState = [];
        $this->playerVersion = 0;
        $this->roomMembers = [];
        $this->setConnectionState('idle');
    }

    public function send(string $actionType, mixed $payload = null): mixed
    {
        if (!$this->connected || !$this->authenticated) {
            throw new EdgeBaseException('Not connected to room. Call join() and wait for the room to connect before sending actions or signals.', 400);
        }

        $requestId = $this->generateRequestId();
        $this->pendingRequests[$requestId] = [
            'done' => false,
            'result' => null,
            'error' => null,
        ];

        $this->sendRaw([
            'type' => 'send',
            'actionType' => $actionType,
            'payload' => $payload ?? new \stdClass(),
            'requestId' => $requestId,
        ]);

        $this->awaitPendingRequest($requestId, 'pendingRequests', "Action '{$actionType}' timed out");
        $pending = $this->pendingRequests[$requestId] ?? null;
        unset($this->pendingRequests[$requestId]);

        if ($pending === null) {
            throw new EdgeBaseException('Request cancelled', 499);
        }
        if (!$pending['done']) {
            throw new EdgeBaseException("Action '{$actionType}' timed out", 408);
        }
        if ($pending['error'] !== null) {
            throw new EdgeBaseException($pending['error'], 400);
        }

        return $pending['result'];
    }

    public function sendSignal(string $event, mixed $payload = null, array $options = []): void
    {
        $requestId = $this->generateRequestId();
        $message = [
            'type' => 'signal',
            'event' => $event,
            'payload' => $payload ?? new \stdClass(),
            'requestId' => $requestId,
        ];
        if (isset($options['includeSelf'])) {
            $message['includeSelf'] = (bool) $options['includeSelf'];
        }
        if (is_string($options['memberId'] ?? null)) {
            $message['memberId'] = $options['memberId'];
        }
        $this->sendVoidRequest('pendingSignalRequests', $requestId, $message, "Signal '{$event}' timed out");
    }

    public function sendMemberState(array $state): void
    {
        $requestId = $this->generateRequestId();
        $this->sendVoidRequest(
            'pendingMemberStateRequests',
            $requestId,
            [
                'type' => 'member_state',
                'state' => $state,
                'requestId' => $requestId,
            ],
            'Member state update timed out',
        );
    }

    public function clearMemberState(): void
    {
        $requestId = $this->generateRequestId();
        $this->sendVoidRequest(
            'pendingMemberStateRequests',
            $requestId,
            [
                'type' => 'member_state_clear',
                'requestId' => $requestId,
            ],
            'Member state clear timed out',
        );
    }

    public function sendAdmin(string $operation, string $memberId, ?array $payload = null): void
    {
        $requestId = $this->generateRequestId();
        $this->sendVoidRequest(
            'pendingAdminRequests',
            $requestId,
            [
                'type' => 'admin',
                'operation' => $operation,
                'memberId' => $memberId,
                'payload' => $payload ?? new \stdClass(),
                'requestId' => $requestId,
            ],
            "Admin operation '{$operation}' timed out",
        );
    }

    public function onSharedState(callable $handler): Subscription
    {
        $this->sharedStateHandlers[] = $handler;
        return new Subscription(function () use ($handler): void {
            $this->removeHandler($this->sharedStateHandlers, $handler);
        });
    }

    public function onPlayerState(callable $handler): Subscription
    {
        $this->playerStateHandlers[] = $handler;
        return new Subscription(function () use ($handler): void {
            $this->removeHandler($this->playerStateHandlers, $handler);
        });
    }

    public function onMessage(string $messageType, callable $handler): Subscription
    {
        $this->messageHandlers[$messageType] ??= [];
        $this->messageHandlers[$messageType][] = $handler;
        return new Subscription(function () use ($messageType, $handler): void {
            if (!isset($this->messageHandlers[$messageType])) {
                return;
            }
            $this->removeHandler($this->messageHandlers[$messageType], $handler);
        });
    }

    public function onAnyMessage(callable $handler): Subscription
    {
        $this->allMessageHandlers[] = $handler;
        return new Subscription(function () use ($handler): void {
            $this->removeHandler($this->allMessageHandlers, $handler);
        });
    }

    public function onError(callable $handler): Subscription
    {
        $this->errorHandlers[] = $handler;
        return new Subscription(function () use ($handler): void {
            $this->removeHandler($this->errorHandlers, $handler);
        });
    }

    public function onKicked(callable $handler): Subscription
    {
        $this->kickedHandlers[] = $handler;
        return new Subscription(function () use ($handler): void {
            $this->removeHandler($this->kickedHandlers, $handler);
        });
    }

    public function onMembersSync(callable $handler): Subscription
    {
        $this->membersSyncHandlers[] = $handler;
        return new Subscription(function () use ($handler): void {
            $this->removeHandler($this->membersSyncHandlers, $handler);
        });
    }

    public function onMemberJoin(callable $handler): Subscription
    {
        $this->memberJoinHandlers[] = $handler;
        return new Subscription(function () use ($handler): void {
            $this->removeHandler($this->memberJoinHandlers, $handler);
        });
    }

    public function onMemberLeave(callable $handler): Subscription
    {
        $this->memberLeaveHandlers[] = $handler;
        return new Subscription(function () use ($handler): void {
            $this->removeHandler($this->memberLeaveHandlers, $handler);
        });
    }

    public function onMemberStateChange(callable $handler): Subscription
    {
        $this->memberStateHandlers[] = $handler;
        return new Subscription(function () use ($handler): void {
            $this->removeHandler($this->memberStateHandlers, $handler);
        });
    }

    public function onSignal(string $event, callable $handler): Subscription
    {
        $this->signalHandlers[$event] ??= [];
        $this->signalHandlers[$event][] = $handler;
        return new Subscription(function () use ($event, $handler): void {
            if (!isset($this->signalHandlers[$event])) {
                return;
            }
            $this->removeHandler($this->signalHandlers[$event], $handler);
        });
    }

    public function onAnySignal(callable $handler): Subscription
    {
        $this->anySignalHandlers[] = $handler;
        return new Subscription(function () use ($handler): void {
            $this->removeHandler($this->anySignalHandlers, $handler);
        });
    }

    public function onReconnect(callable $handler): Subscription
    {
        $this->reconnectHandlers[] = $handler;
        return new Subscription(function () use ($handler): void {
            $this->removeHandler($this->reconnectHandlers, $handler);
        });
    }

    public function onConnectionStateChange(callable $handler): Subscription
    {
        $this->connectionStateHandlers[] = $handler;
        return new Subscription(function () use ($handler): void {
            $this->removeHandler($this->connectionStateHandlers, $handler);
        });
    }

    public function listen(): bool
    {
        if ($this->ws === null || !$this->connected) {
            return false;
        }

        try {
            $raw = $this->ws->receive();
            if ($raw === null) {
                return false;
            }
            $this->handleMessage((string) $raw);
            return true;
        } catch (\Throwable $e) {
            if ($this->isTimeoutException($e)) {
                return false;
            }

            $this->connected = false;
            $this->authenticated = false;
            $this->joined = false;

            if (
                !$this->intentionallyLeft &&
                !$this->waitingForAuth &&
                $this->autoReconnect &&
                $this->reconnectAttempts < $this->maxReconnectAttempts &&
                $this->connectionState !== 'kicked' &&
                $this->connectionState !== 'auth_lost'
            ) {
                $attempt = $this->reconnectAttempts + 1;
                $delay = (int) min($this->reconnectBaseDelayMs * (2 ** $this->reconnectAttempts), 30000);
                $this->reconnectAttempts++;
                $this->beginReconnectAttempt($attempt);
                usleep($delay * 1000);
                if ($this->joinRequested && !$this->waitingForAuth) {
                    $this->establish();
                }
            } elseif (!$this->intentionallyLeft && $this->connectionState !== 'kicked' && $this->connectionState !== 'auth_lost') {
                $this->setConnectionState('disconnected');
            }

            return false;
        }
    }

    private function wsUrl(): string
    {
        $url = str_replace(['https://', 'http://'], ['wss://', 'ws://'], $this->baseUrl);
        return $url . ApiPaths::CONNECT_ROOM . '?namespace=' . urlencode($this->namespace) . '&id=' . urlencode($this->roomId);
    }

    private function establish(): void
    {
        $this->setConnectionState($this->reconnectInfo !== null ? 'reconnecting' : 'connecting');

        try {
            $token = ($this->tokenFn)();
            if (!is_string($token) || $token === '') {
                throw new EdgeBaseException('No access token available. Sign in first.', 401);
            }

            $this->ws = new \WebSocket\Client($this->wsUrl());
            $this->connected = true;
            $this->reconnectAttempts = 0;
            $this->sendRawUnauthenticated([
                'type' => 'auth',
                'token' => $token,
            ]);

            $deadline = microtime(true) + 10;
            while (!$this->authenticated && microtime(true) < $deadline) {
                $raw = $this->ws->receive();
                if ($raw === null) {
                    break;
                }
                $this->handleMessage((string) $raw);
            }

            if (!$this->authenticated) {
                throw new EdgeBaseException('Room auth timeout', 401);
            }

            try {
                $this->ws->setTimeout(1);
            } catch (\Throwable) {
            }
        } catch (EdgeBaseException $e) {
            $this->handleAuthenticationFailure($e);
            throw $e;
        } catch (\Throwable $e) {
            $this->handleAuthenticationFailure($e);
        }
    }

    private function handleMessage(string $raw): void
    {
        $msg = json_decode($raw, true);
        if (!is_array($msg)) {
            return;
        }

        $type = (string) ($msg['type'] ?? '');
        if ($type === 'auth_success' || $type === 'auth_refreshed') {
            $this->handleAuthSuccess($msg);
            if (!$this->authenticated) {
                $this->authenticated = true;
                $this->waitingForAuth = false;
                $this->sendRaw([
                    'type' => 'join',
                    'lastSharedState' => $this->sharedState,
                    'lastSharedVersion' => $this->sharedVersion,
                    'lastPlayerState' => $this->playerState,
                    'lastPlayerVersion' => $this->playerVersion,
                ]);
                $this->joined = true;
            }
            return;
        }

        switch ($type) {
            case 'sync':
                $this->handleSync($msg);
                break;
            case 'shared_delta':
                $this->handleSharedDelta($msg);
                break;
            case 'player_delta':
                $this->handlePlayerDelta($msg);
                break;
            case 'action_result':
                $this->handleActionResult($msg);
                break;
            case 'action_error':
                $this->handleActionError($msg);
                break;
            case 'message':
                $this->handleServerMessage($msg);
                break;
            case 'signal':
                $this->handleSignalFrame($msg);
                break;
            case 'signal_sent':
                $this->resolvePendingVoidRequest('pendingSignalRequests', (string) ($msg['requestId'] ?? ''));
                break;
            case 'signal_error':
                $this->rejectPendingVoidRequest('pendingSignalRequests', (string) ($msg['requestId'] ?? ''), (string) ($msg['message'] ?? 'Signal send failed'));
                break;
            case 'members_sync':
                $this->handleMembersSync($msg);
                break;
            case 'member_join':
                $this->handleMemberJoinFrame($msg);
                break;
            case 'member_leave':
                $this->handleMemberLeaveFrame($msg);
                break;
            case 'member_state':
                $this->handleMemberStateFrame($msg);
                break;
            case 'member_state_error':
                $this->rejectPendingVoidRequest('pendingMemberStateRequests', (string) ($msg['requestId'] ?? ''), (string) ($msg['message'] ?? 'Member state update failed'));
                break;
            case 'admin_result':
                $this->resolvePendingVoidRequest('pendingAdminRequests', (string) ($msg['requestId'] ?? ''));
                break;
            case 'admin_error':
                $this->rejectPendingVoidRequest('pendingAdminRequests', (string) ($msg['requestId'] ?? ''), (string) ($msg['message'] ?? 'Admin operation failed'));
                break;
            case 'kicked':
                $this->handleKicked();
                break;
            case 'error':
                $this->handleError($msg);
                break;
            case 'pong':
                break;
        }
    }

    private function handleAuthSuccess(array $msg): void
    {
        $userId = $msg['userId'] ?? null;
        $connectionId = $msg['connectionId'] ?? null;
        if (is_string($userId) && $userId !== '') {
            $this->currentUserId = $userId;
        }
        if (is_string($connectionId) && $connectionId !== '') {
            $this->currentConnectionId = $connectionId;
        }
    }

    private function handleSync(array $msg): void
    {
        $this->sharedState = self::safeAssoc($msg['sharedState'] ?? []);
        $this->sharedVersion = (int) ($msg['sharedVersion'] ?? 0);
        $this->playerState = self::safeAssoc($msg['playerState'] ?? []);
        $this->playerVersion = (int) ($msg['playerVersion'] ?? 0);

        $this->setConnectionState('connected');

        if ($this->reconnectInfo !== null) {
            $snapshot = self::deepCopy($this->reconnectInfo);
            $this->reconnectInfo = null;
            foreach ($this->reconnectHandlers as $handler) {
                $handler($snapshot);
            }
        }

        foreach ($this->sharedStateHandlers as $handler) {
            $handler(self::deepCopy($this->sharedState), self::deepCopy($this->sharedState));
        }
        foreach ($this->playerStateHandlers as $handler) {
            $handler(self::deepCopy($this->playerState), self::deepCopy($this->playerState));
        }
    }

    private function handleSharedDelta(array $msg): void
    {
        $delta = self::safeAssoc($msg['delta'] ?? []);
        $this->sharedVersion = (int) ($msg['version'] ?? $this->sharedVersion);
        foreach ($delta as $path => $value) {
            self::deepSet($this->sharedState, (string) $path, $value);
        }
        foreach ($this->sharedStateHandlers as $handler) {
            $handler(self::deepCopy($this->sharedState), self::deepCopy($delta));
        }
    }

    private function handlePlayerDelta(array $msg): void
    {
        $delta = self::safeAssoc($msg['delta'] ?? []);
        $this->playerVersion = (int) ($msg['version'] ?? $this->playerVersion);
        foreach ($delta as $path => $value) {
            self::deepSet($this->playerState, (string) $path, $value);
        }
        foreach ($this->playerStateHandlers as $handler) {
            $handler(self::deepCopy($this->playerState), self::deepCopy($delta));
        }
    }

    private function handleActionResult(array $msg): void
    {
        $requestId = (string) ($msg['requestId'] ?? '');
        if (!isset($this->pendingRequests[$requestId])) {
            return;
        }
        $this->pendingRequests[$requestId]['done'] = true;
        $this->pendingRequests[$requestId]['result'] = $msg['result'] ?? null;
    }

    private function handleActionError(array $msg): void
    {
        $requestId = (string) ($msg['requestId'] ?? '');
        if (!isset($this->pendingRequests[$requestId])) {
            return;
        }
        $this->pendingRequests[$requestId]['done'] = true;
        $this->pendingRequests[$requestId]['error'] = (string) ($msg['message'] ?? 'Unknown action error');
    }

    private function handleServerMessage(array $msg): void
    {
        $messageType = (string) ($msg['messageType'] ?? '');
        $data = $msg['data'] ?? null;
        foreach ($this->messageHandlers[$messageType] ?? [] as $handler) {
            $handler(self::deepCopy($data));
        }
        foreach ($this->allMessageHandlers as $handler) {
            $handler($messageType, self::deepCopy($data));
        }
    }

    private function handleSignalFrame(array $msg): void
    {
        $event = (string) ($msg['event'] ?? '');
        if ($event === '') {
            return;
        }
        $payload = $msg['payload'] ?? null;
        $meta = $this->normalizeSignalMeta($msg['meta'] ?? []);

        foreach ($this->signalHandlers[$event] ?? [] as $handler) {
            $handler(self::deepCopy($payload), self::deepCopy($meta));
        }
        foreach ($this->anySignalHandlers as $handler) {
            $handler($event, self::deepCopy($payload), self::deepCopy($meta));
        }
    }

    private function handleMembersSync(array $msg): void
    {
        $this->roomMembers = $this->normalizeMembers($msg['members'] ?? []);
        foreach ($this->membersSyncHandlers as $handler) {
            $handler($this->listMembers());
        }
    }

    private function handleMemberJoinFrame(array $msg): void
    {
        $member = $this->normalizeMember($msg['member'] ?? null);
        if ($member === null) {
            return;
        }
        $this->upsertMember($member);
        foreach ($this->memberJoinHandlers as $handler) {
            $handler(self::deepCopy($member));
        }
    }

    private function handleMemberLeaveFrame(array $msg): void
    {
        $member = $this->normalizeMember($msg['member'] ?? null);
        if ($member === null) {
            return;
        }
        $memberId = (string) ($member['memberId'] ?? '');
        $this->removeMember($memberId);
        $reason = $this->normalizeLeaveReason($msg['reason'] ?? null);
        foreach ($this->memberLeaveHandlers as $handler) {
            $handler(self::deepCopy($member), $reason);
        }
    }

    private function handleMemberStateFrame(array $msg): void
    {
        $member = $this->normalizeMember($msg['member'] ?? null);
        if ($member === null) {
            return;
        }
        $state = self::safeAssoc($msg['state'] ?? []);
        $member['state'] = self::deepCopy($state);
        $this->upsertMember($member);

        $requestId = (string) ($msg['requestId'] ?? '');
        if ($requestId !== '' && ($member['memberId'] ?? null) === $this->currentUserId) {
            $this->resolvePendingVoidRequest('pendingMemberStateRequests', $requestId);
        }

        foreach ($this->memberStateHandlers as $handler) {
            $handler(self::deepCopy($member), self::deepCopy($state));
        }
    }

    private function handleKicked(): void
    {
        foreach ($this->kickedHandlers as $handler) {
            $handler();
        }
        $this->intentionallyLeft = true;
        $this->joinRequested = false;
        $this->reconnectInfo = null;
        $this->setConnectionState('kicked');
    }

    private function handleError(array $msg): void
    {
        $err = [
            'code' => (string) ($msg['code'] ?? ''),
            'message' => (string) ($msg['message'] ?? ''),
        ];
        foreach ($this->errorHandlers as $handler) {
            $handler($err);
        }
    }

    private function sendRaw(array $msg): void
    {
        if (!$this->connected || $this->ws === null) {
            return;
        }
        try {
            $this->ws->send(json_encode($msg, JSON_THROW_ON_ERROR));
        } catch (\Throwable) {
        }
    }

    private function sendRawUnauthenticated(array $msg): void
    {
        if ($this->ws === null) {
            return;
        }
        try {
            $this->ws->send(json_encode($msg, JSON_THROW_ON_ERROR));
        } catch (\Throwable) {
        }
    }

    private function sendLeaveAndClose(): void
    {
        if ($this->ws === null) {
            return;
        }

        try {
            $this->ws->send(json_encode(['type' => 'leave'], JSON_THROW_ON_ERROR));
            usleep(self::ROOM_EXPLICIT_LEAVE_CLOSE_DELAY_US);
            $this->ws->close();
        } catch (\Throwable) {
        }

        $this->ws = null;
    }

    private function sendVoidRequest(string $bucket, string $requestId, array $message, string $timeoutMessage): void
    {
        if (!$this->connected || !$this->authenticated) {
            throw new EdgeBaseException('Not connected to room. Call join() and wait for the room to connect before sending actions, signals, or member state.', 400);
        }

        $this->{$bucket}[$requestId] = [
            'done' => false,
            'error' => null,
        ];
        $this->sendRaw($message);
        $this->awaitPendingRequest($requestId, $bucket, $timeoutMessage);
        $pending = $this->{$bucket}[$requestId] ?? null;
        unset($this->{$bucket}[$requestId]);
        if ($pending === null) {
            throw new EdgeBaseException('Request cancelled', 499);
        }
        if (!$pending['done']) {
            throw new EdgeBaseException($timeoutMessage, 408);
        }
        if ($pending['error'] !== null) {
            throw new EdgeBaseException($pending['error'], 400);
        }
    }

    private function awaitPendingRequest(string $requestId, string $bucket, string $timeoutMessage): void
    {
        $deadline = microtime(true) + ($this->sendTimeoutMs / 1000.0);
        while (!($this->{$bucket}[$requestId]['done'] ?? false) && microtime(true) < $deadline) {
            if ($this->ws === null) {
                break;
            }
            try {
                $raw = $this->ws->receive();
                if ($raw !== null) {
                    $this->handleMessage((string) $raw);
                }
            } catch (\Throwable $e) {
                if (!$this->isTimeoutException($e)) {
                    unset($this->{$bucket}[$requestId]);
                    throw new EdgeBaseException("Connection error while waiting for response: {$e->getMessage()}", 500);
                }
            }
        }

        if (!isset($this->{$bucket}[$requestId])) {
            throw new EdgeBaseException('Request cancelled', 499);
        }
        if (!($this->{$bucket}[$requestId]['done'] ?? false)) {
            throw new EdgeBaseException($timeoutMessage, 408);
        }
    }

    private function resolvePendingVoidRequest(string $bucket, string $requestId): void
    {
        if ($requestId === '' || !isset($this->{$bucket}[$requestId])) {
            return;
        }
        $this->{$bucket}[$requestId]['done'] = true;
        $this->{$bucket}[$requestId]['error'] = null;
    }

    private function rejectPendingVoidRequest(string $bucket, string $requestId, string $message): void
    {
        if ($requestId === '' || !isset($this->{$bucket}[$requestId])) {
            return;
        }
        $this->{$bucket}[$requestId]['done'] = true;
        $this->{$bucket}[$requestId]['error'] = $message;
    }

    private function rejectPendingVoidRequests(string $bucket, string $message): void
    {
        foreach ($this->{$bucket} as $requestId => $pending) {
            $this->{$bucket}[$requestId]['done'] = true;
            $this->{$bucket}[$requestId]['error'] = $message;
        }
        $this->{$bucket} = [];
    }

    private function setConnectionState(string $next): void
    {
        if ($this->connectionState === $next) {
            return;
        }
        $this->connectionState = $next;
        foreach ($this->connectionStateHandlers as $handler) {
            $handler($next);
        }
    }

    private function beginReconnectAttempt(int $attempt): void
    {
        $this->reconnectInfo = ['attempt' => $attempt];
        $this->setConnectionState('reconnecting');
    }

    private function handleAuthenticationFailure(\Throwable $error): void
    {
        $this->waitingForAuth = $error instanceof EdgeBaseException
            && $error->getCode() === 401
            && $this->joinRequested;

        if ($this->waitingForAuth) {
            $this->reconnectInfo = null;
            $this->setConnectionState('auth_lost');
        }

        $this->connected = false;
        $this->authenticated = false;
        $this->joined = false;
        if ($this->ws !== null) {
            try {
                $this->ws->close();
            } catch (\Throwable) {
            }
            $this->ws = null;
        }
    }

    private function removeHandler(array &$handlers, callable $handler): void
    {
        $idx = array_search($handler, $handlers, true);
        if ($idx === false) {
            return;
        }
        array_splice($handlers, (int) $idx, 1);
    }

    private function isTimeoutException(\Throwable $e): bool
    {
        $cls = get_class($e);
        $msg = $e->getMessage();
        return str_contains($cls, 'Timeout')
            || str_contains($msg, 'timed out')
            || str_contains($msg, 'timeout');
    }

    private function normalizeMembers(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }
        $members = [];
        foreach ($value as $member) {
            $normalized = $this->normalizeMember($member);
            if ($normalized !== null) {
                $members[] = $normalized;
            }
        }
        return $members;
    }

    private function normalizeMember(mixed $value): ?array
    {
        if (!is_array($value)) {
            return null;
        }
        if (!is_string($value['memberId'] ?? null) || !is_string($value['userId'] ?? null)) {
            return null;
        }
        $member = [
            'memberId' => $value['memberId'],
            'userId' => $value['userId'],
            'state' => self::safeAssoc($value['state'] ?? []),
        ];
        if (is_string($value['connectionId'] ?? null)) {
            $member['connectionId'] = $value['connectionId'];
        }
        if (is_numeric($value['connectionCount'] ?? null)) {
            $member['connectionCount'] = (int) $value['connectionCount'];
        }
        if (is_string($value['role'] ?? null)) {
            $member['role'] = $value['role'];
        }
        return $member;
    }

    private function normalizeSignalMeta(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }
        $meta = [];
        foreach (['memberId', 'userId', 'connectionId'] as $key) {
            if (is_string($value[$key] ?? null)) {
                $meta[$key] = $value[$key];
            }
        }
        if (isset($value['sentAt'])) {
            $meta['sentAt'] = $value['sentAt'];
        }
        if (array_key_exists('serverSent', $value)) {
            $meta['serverSent'] = ($value['serverSent'] ?? false) === true;
        }
        return $meta;
    }

    private function normalizeLeaveReason(mixed $value): string
    {
        return match ($value) {
            'leave', 'timeout', 'kicked' => $value,
            default => 'leave',
        };
    }

    private function upsertMember(array $member): void
    {
        $memberId = (string) $member['memberId'];
        foreach ($this->roomMembers as $index => $existing) {
            if (($existing['memberId'] ?? null) === $memberId) {
                $this->roomMembers[$index] = self::deepCopy($member);
                return;
            }
        }
        $this->roomMembers[] = self::deepCopy($member);
    }

    private function removeMember(string $memberId): void
    {
        $this->roomMembers = array_values(array_filter(
            $this->roomMembers,
            static fn (array $member): bool => ($member['memberId'] ?? null) !== $memberId,
        ));
    }

    private function generateRequestId(): string
    {
        return 'req-' . bin2hex(random_bytes(8));
    }

    private static function deepCopy(mixed $value): mixed
    {
        if (is_array($value)) {
            $copy = [];
            foreach ($value as $key => $entry) {
                $copy[$key] = self::deepCopy($entry);
            }
            return $copy;
        }
        return $value;
    }

    private static function safeAssoc(mixed $value): array
    {
        if (!is_array($value)) {
            return [];
        }
        if (array_is_list($value)) {
            return [];
        }
        return self::deepCopy($value);
    }

    private static function deepSet(array &$obj, string $path, mixed $value): void
    {
        $parts = explode('.', $path, 2);
        if (count($parts) === 1) {
            if ($value === null) {
                unset($obj[$path]);
            } else {
                $obj[$path] = $value;
            }
            return;
        }
        [$head, $tail] = $parts;
        if (!isset($obj[$head]) || !is_array($obj[$head])) {
            $obj[$head] = [];
        }
        self::deepSet($obj[$head], $tail, $value);
    }
}

final class RoomStateNamespace
{
    public function __construct(private RoomClient $client)
    {
    }

    public function getShared(): array
    {
        return $this->client->getSharedState();
    }

    public function getMine(): array
    {
        return $this->client->getPlayerState();
    }

    public function onSharedChange(callable $handler): Subscription
    {
        return $this->client->onSharedState($handler);
    }

    public function onMineChange(callable $handler): Subscription
    {
        return $this->client->onPlayerState($handler);
    }

    public function send(string $actionType, mixed $payload = null): mixed
    {
        return $this->client->send($actionType, $payload);
    }
}

final class RoomMetaNamespace
{
    public function __construct(private RoomClient $client)
    {
    }

    public function get(): array
    {
        return $this->client->getMetadata();
    }
}

final class RoomSignalsNamespace
{
    public function __construct(private RoomClient $client)
    {
    }

    public function send(string $event, mixed $payload = null, array $options = []): void
    {
        $this->client->sendSignal($event, $payload, $options);
    }

    public function sendTo(string $memberId, string $event, mixed $payload = null): void
    {
        $this->client->sendSignal($event, $payload, ['memberId' => $memberId]);
    }

    public function on(string $event, callable $handler): Subscription
    {
        return $this->client->onSignal($event, $handler);
    }

    public function onAny(callable $handler): Subscription
    {
        return $this->client->onAnySignal($handler);
    }
}

final class RoomMembersNamespace
{
    public function __construct(private RoomClient $client)
    {
    }

    public function list(): array
    {
        return $this->client->listMembers();
    }

    public function onSync(callable $handler): Subscription
    {
        return $this->client->onMembersSync($handler);
    }

    public function onJoin(callable $handler): Subscription
    {
        return $this->client->onMemberJoin($handler);
    }

    public function onLeave(callable $handler): Subscription
    {
        return $this->client->onMemberLeave($handler);
    }

    public function setState(array $state): void
    {
        $this->client->sendMemberState($state);
    }

    public function clearState(): void
    {
        $this->client->clearMemberState();
    }

    public function onStateChange(callable $handler): Subscription
    {
        return $this->client->onMemberStateChange($handler);
    }
}

final class RoomAdminNamespace
{
    public function __construct(private RoomClient $client)
    {
    }

    public function kick(string $memberId): void
    {
        $this->client->sendAdmin('kick', $memberId);
    }

    public function block(string $memberId): void
    {
        $this->client->sendAdmin('block', $memberId);
    }

    public function setRole(string $memberId, string $role): void
    {
        $this->client->sendAdmin('setRole', $memberId, ['role' => $role]);
    }

}

final class RoomSessionNamespace
{
    public function __construct(private RoomClient $client)
    {
    }

    public function onError(callable $handler): Subscription
    {
        return $this->client->onError($handler);
    }

    public function onKicked(callable $handler): Subscription
    {
        return $this->client->onKicked($handler);
    }

    public function onReconnect(callable $handler): Subscription
    {
        return $this->client->onReconnect($handler);
    }

    public function onConnectionStateChange(callable $handler): Subscription
    {
        return $this->client->onConnectionStateChange($handler);
    }

    public function getConnectionState(): string
    {
        return $this->client->connectionState();
    }

    public function getUserId(): ?string
    {
        return $this->client->userId();
    }

    public function getConnectionId(): ?string
    {
        return $this->client->connectionId();
    }
}
