/**
 * EdgeBase Test Configuration — SDK E2E Tests
 *
 * Used by `wrangler dev --config wrangler.test.toml` for all SDK E2E tests.
 * The worker imports this file directly as the bundled runtime config,
 * enabling real JS function-based rules.
 *
 * Tables:
 *   posts             — all-public CRUD + FTS + expand refs
 *   categories        — public CRUD + migrations (slug, sortOrder)
 *   articles          — shared table (blog content)
 *   secure_posts      — owner-only rules (owner = authorId)
 *   denied_notes      — read: false (expand deny-all target)
 *   auth_required_notes — auth required for read/update/delete
 *   bad_migration     — intentionally broken migration (migration error test)
 *   workspace_tasks   — workspace-scoped tasks
 *   workspaceIdMembers — membership tracking table
 *   private_notes     — per-user private notes
 *
 * Storage buckets:
 *   avatars    — public read, auth write, owner-only delete
 *   documents  — auth read/write/delete
 *   files      — public read, auth write/delete
 */
import { defineConfig } from '@edge-base/shared';
import { definePlugin } from '../plugins/core/src/index.ts';

const mockFcmBaseUrl =
    (typeof process !== 'undefined' && process.env.MOCK_FCM_BASE_URL?.trim())
        ?.replace(/\/$/, '') || 'http://localhost:9099';

function createGameRoomConfig() {
    return {
        maxPlayers: 10,
        public: true,
        runtime: {
            target: 'rooms',
        },
        handlers: {
            lifecycle: {
                onCreate(room) {
                    room.setSharedState(() => ({ turn: 0, score: 0 }));
                },
                onJoin(sender, room) {
                    // Initialize player state
                    room.setPlayerState(sender.userId, () => ({ hp: 100 }));
                },
            },
            actions: {
                TEST_MUTATION: async (payload, room, sender, ctx) => {
                    room.setSharedState(s => ({
                        ...s,
                        lastMessage: payload.message,
                        senderId: sender.userId,
                    }));
                    // Fire-and-forget DB write (cross-DO latency can be > 5s)
                    void ctx.admin.db('shared').table('posts').insert({
                        title: `Room action by ${sender.userId}`,
                        authorId: sender.userId,
                    }).catch(err => console.error(`[TEST_MUTATION] DB error: ${err.message}`));
                    return { ok: true };
                },
                SET_SCORE: (payload, room) => {
                    room.setSharedState(s => ({ ...s, score: payload.score }));
                    return { score: payload.score };
                },
                SLOW_SCORE: async (payload, room) => {
                    await new Promise((resolve) => setTimeout(resolve, 25));
                    room.setSharedState(s => ({ ...s, score: payload.score }));
                    return { score: payload.score };
                },
            },
        },
    };
}

const MB = 1024 * 1024;

function allowWriteUpTo(
    limitMb: number,
    predicate: (auth: { id?: string } | null) => boolean = () => true,
) {
    const maxBytes = limitMb * MB;
    return (auth: { id?: string } | null, file: { size: number }) =>
        predicate(auth) && file.size <= maxBytes;
}

function allowAvatarWrite(
    auth: { id?: string } | null,
    file: { size: number; contentType: string },
) {
    return (
        auth !== null &&
        file.size <= 5 * MB &&
        ['image/jpeg', 'image/png', 'image/webp'].includes(file.contentType)
    );
}

const refreshClaimPluginA = definePlugin<Record<string, never>>({
    name: 'test-refresh-claims-a',
    hooks: {
        async onTokenRefresh() {
            return {
                refreshPluginA: 'alpha',
            };
        },
    },
});

const refreshClaimPluginB = definePlugin<Record<string, never>>({
    name: 'test-refresh-claims-b',
    hooks: {
        async onTokenRefresh() {
            return {
                refreshPluginB: 'bravo',
            };
        },
    },
});

export default defineConfig({
    release: true,
    api: { schemaEndpoint: 'authenticated' },
    serviceKeys: {
        keys: [
            {
                kid: 'root',
                tier: 'root',
                scopes: ['*'],
                secretSource: 'dashboard',
                secretRef: 'SERVICE_KEY',
            },
        ],
    },
    auth: {
        emailAuth: true,
        anonymousAuth: true,
        cleanupOrphanData: true,
        session: { accessTokenTTL: '15m', refreshTokenTTL: '28d', maxActiveSessions: 3 },
        magicLink: { enabled: true, autoCreate: true, tokenTTL: '15m' },
        mfa: { totp: true },
        phoneAuth: true,
        emailOtp: { enabled: true, autoCreate: true },
        passkeys: { enabled: true, rpName: 'EdgeBase Test', rpID: 'localhost', origin: 'http://localhost' },
    },
    rateLimiting: {
        global: { requests: 10_000_000, window: '60s' },
        auth: { requests: 1000, window: '60s' },
        authSignin: { requests: 1000, window: '60s' },
        authSignup: { requests: 1000, window: '60s' },
        storage: { requests: 10000, window: '60s' },
        functions: { requests: 10000, window: '60s' },
        db: { requests: 10000, window: '60s' },
    },

    // ─── Storage ───────────────────────────────────────────────────────────
    storage: {
        buckets: {
            avatars: {
                access: {
                    read: () => true,
                    write: allowAvatarWrite,
                    delete: (auth, resource) => auth?.id === resource?.uploadedBy,
                },
                handlers: {
                    hooks: {
                        beforeUpload: (_auth, file) => {
                            if (file.key.includes('reject-upload')) {
                                throw new Error('Blocked by test beforeUpload');
                            }
                            return { hookMarker: 'config-hooked' };
                        },
                        beforeDownload: (_auth, file) => {
                            if (file.key.includes('reject-download')) {
                                throw new Error('Blocked by test beforeDownload');
                            }
                        },
                        beforeDelete: (_auth, file) => {
                            if (file.key.includes('reject-delete')) {
                                throw new Error('Blocked by test beforeDelete');
                            }
                        },
                    },
                },
            },
            documents: {
                access: {
                    read: (auth) => auth !== null,
                    write: allowWriteUpTo(50, (auth) => auth !== null),
                    delete: (auth) => auth !== null,
                },
            },
            files: {
                access: {
                    read: () => true,
                    write: allowWriteUpTo(50, (auth) => auth !== null),
                    delete: (auth) => auth !== null,
                },
            },
            // 'test-bucket' used by SDK integration tests.
            'test-bucket': {
                binding: 'STORAGE',
                access: {
                    read: () => true,
                    write: allowWriteUpTo(50),
                    delete: () => true,
                },
            },
            // 'test' bucket alias — some SDKs use 'test' instead of 'test-bucket'.
            test: {
                binding: 'STORAGE',
                access: {
                    read: () => true,
                    write: allowWriteUpTo(50),
                    delete: () => true,
                },
            },
        },
    },

    // ─── KV / D1 / Vectorize ───────────────────────────────────────────────
    kv: {
        cache: { binding: 'TEST_KV' },
        // 'test' namespace used by SDK integration tests (admin.kv('test'))
        test: { binding: 'TEST_KV' },
        // 'default' namespace used by Rust SDK tests
        default: { binding: 'TEST_KV' },
    },
    d1: {
        analytics: { binding: 'TEST_D1' },
        // 'test' database used by C# SDK tests
        test: { binding: 'TEST_D1' },
    },
    vectorize: { embeddings: { dimensions: 1536, metric: 'cosine' } },

    // ─── Push Notifications ──────────────────────────────────────────────
    push: {
        fcm: {
            projectId: 'test-project',
            // Mock endpoints for testing.
            // Server integration tests (fetchMock): intercepts these localhost URLs.
            // SDK E2E tests: mock-fcm-server runs on port 9099.
            endpoints: {
                oauth2TokenUrl: `${mockFcmBaseUrl}/token`,
                fcmSendUrl: `${mockFcmBaseUrl}/v1/projects/test-project/messages:send`,
                iidBaseUrl: mockFcmBaseUrl,
            },
            // Fallback service account for environments where PUSH_FCM_SERVICE_ACCOUNT
            // env var is not directly available (e.g. config-only setups).
            // Mirrors the value from wrangler.test.toml [vars].
            serviceAccount: JSON.stringify({
                client_email: 'test@test-project.iam.gserviceaccount.com',
                private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDJZJ84GgindzG97OM9Wv2OwK/LObZruq48QKklmqnbp0Z1o8jpxXS4mqZAy3bdWSA8uNFQkKHB80Yem9JufzdcBTyC1U2Y0i1AafpzqJIZqlTj/1ZET+/vHnqwQNqvyyW72YDcc6SJOISMfvjRWGzj7EpXvpu7jgyWy+7yzHbf1bjejdLICJ/Ha/rvpHfVgGlheYIOFiOl0FvMBQhlrX6NfvlT1XdaEjSX4ywZ3OXbU3SHO9/qMZzpY9apSXJ1+zFib0iChQMdhqeiNGj/c9nW67kFBuCmu016S3ZHe/ZZ2zOMuvYeL5ZeN7hcJawEJhhncI1MIHUgc+MKygowFXMNAgMBAAECggEAEZPOsb7T8onctY7vZnOCnesDbOFkopJwkqGyIa4WFS3MYIgjCQRK47HbwNwBS+Bzh9k5q6Zz99Gb1SAUhcBkvItYdLLZSvVNLcoSKfYUiljrf9rRVLUFZAFtA+UlMSKx8GtTa+pL+g4Mw5ZxcRQerOX6tx3TydLkFmVGPbrKxU5iL4f5c/T5o+9i7tiWLJRo6PECOy7s3jPs0aP+5Tf0N/fwETyXtdMu4IyDs+ULxRb5e8xh0i+mmzmTSwEKNSqbT45kVuyrGRrE6wIASWNhOi35NGAWZ1+/ZfTqANzAwxnuu/J+83pNRnim4XJJtf+UKsd2br/MDbZvVmxzZANRoQKBgQD8qoo5UQ70NNmIyV80JY1pNwVVlhdTCmBuSszTcWt5zAS8xR+z+nJ32fR+lBSgwL+TzoQ61ywKKup6gvLqUnRINkDnlLO+PwElItIRdDniNtgs/5tr8nO+s0/cZ1fs9OTrVyUimoKd/p6DGppSwwM36kNCMKB86KeDAHDzne52fwKBgQDMDOQMOGNmbgF9U/FCBh8m8/IP/uzpFSLQQRf1hr+ggesEpn2CGgjKid1NMOSR/LzCKfRCrUWglDeL7CQsM8gNmJd39rkwj31dAK+IFfuNCbwIg8Av+/h8QwfGuvXGzhsUB7Np+5BLC+jP1hRWYJYRyxFP140XeqQMZjH6+x3IcwKBgQDniQARdg5WCvgtORtdFex4NktVGq1VE3U6nKEGQjFS83qD4cAjlaW/3qMGO3yLsxXbxKu3n+ZjiuBEVCt2PwkAA3eGv+XWuLW76iTGidNhURDYa4NpcExQvNC6EJmqMuB0KO+GvkBjuChZy88PeFVCsBHiXd0zmZ+nlIftNxSG0QKBgHYhPGEKwBkLtJcO4sw7aQuPDONPzW3/C4GPPcSp9wSAUkQF8wE/+zjuaY0HsjwGGm06BqwXTgjx5dp+ok5ox/d/EKmlz36ag5Q1EmnxeAklypMPW1MsR6YA1F6r3B/1MF3/O1IvDlE0Gts/79Q15It2iZY0jv05xgFbpLHNcWebAoGBAMnP7Swl7dPw4vMftZJXY+8dtafMPLwJFDxXMc1kT3gDJaWz0VRc22Oh6WBI5+QD7LWADX8nyEgqv82SLNIywAHuLCBW+HUA2FaYvGtGb9Wqlcx2EgfoweKred7rtaXmduqXxY4X0zZ8EJtJAp8cpnqEbU+F41qO8fPWR0omcjMa\n-----END PRIVATE KEY-----\n',
            }),
        },
    },

    databaseLive: {
        namespaces: {
            'broadcast:owner-lock:*': {
                access: {
                    subscribe(auth, channelId) {
                        if (!auth?.id) return false;
                        const parts = channelId.split(':');
                        return parts[parts.length - 1] === auth.id;
                    },
                },
            },
        },
    },

    plugins: [
        refreshClaimPluginA({}),
        refreshClaimPluginB({}),
    ],

    // ─── Rooms v2 ────────────────────────────────────────
    rooms: {
        'test-game': createGameRoomConfig(),
        game: createGameRoomConfig(),
        'test-player': {
            public: true,
            runtime: {
                target: 'rooms',
            },
            handlers: {
                actions: {
                    SET_HP: (payload, room, sender) => {
                        room.setPlayerState(sender.userId, s => ({
                            ...s,
                            hp: payload.hp,
                        }));
                        return { hp: payload.hp };
                    },
                    GET_ALL_PLAYERS: (_payload, room) => {
                        return room.players();
                    },
                },
            },
        },
        'test-server-state': {
            public: true,
            runtime: {
                target: 'rooms',
            },
            handlers: {
                lifecycle: {
                    onCreate(room) {
                        room.setServerState(() => ({ secret: 'hidden-value', seed: 42 }));
                    },
                },
                actions: {
                    GET_SECRET: (_payload, room) => {
                        return { secret: room.getServerState().secret };
                    },
                    SET_SECRET: (payload, room) => {
                        room.setServerState(s => ({ ...s, secret: payload.secret }));
                    },
                },
            },
        },
        'test-lifecycle': {
            public: true,
            runtime: {
                target: 'rooms',
            },
            handlers: {
                lifecycle: {
                    onJoin(sender) {
                        // Throw to reject specific users
                        if (sender.userId === 'blocked-user') {
                            throw new Error('You are blocked');
                        }
                    },
                    onLeave(sender, room, _ctx, reason) {
                        // Track leave reason in shared state
                        room.setSharedState(s => ({
                            ...s,
                            lastLeave: { userId: sender.userId, reason },
                        }));
                    },
                },
                actions: {
                    KICK: (payload, room) => {
                        room.kick(payload.userId);
                    },
                    SEND_MSG: (payload, room) => {
                        room.sendMessage(payload.type, payload.data);
                    },
                },
            },
        },

        // ─── Timer Namespace ──────────────────────────────────────────────
        'test-timer': {
            public: true,
            runtime: {
                target: 'rooms',
            },
            handlers: {
                timers: {
                    turnEnd: (room) => {
                        room.setSharedState(s => ({ ...s, timerFired: 'turnEnd', firedAt: Date.now() }));
                    },
                    countdown: (room, _ctx, data) => {
                        room.setSharedState(s => ({ ...s, countdownData: data }));
                    },
                },
                actions: {
                    START_TIMER: (payload, room) => {
                        room.setTimer(payload.name, payload.ms, payload.data);
                        return { started: true };
                    },
                    CANCEL_TIMER: (payload, room) => {
                        room.clearTimer(payload.name);
                        return { cancelled: true };
                    },
                    GET_STATE: (_payload, room) => {
                        return room.getSharedState();
                    },
                },
            },
        },

        // ─── Metadata Namespace ──────────────────────────────────────────
        'test-metadata': {
            public: true,
            runtime: {
                target: 'rooms',
            },
            handlers: {
                lifecycle: {
                    onCreate(room) {
                        room.setMetadata({ mode: 'classic', playerCount: 0 });
                    },
                    onJoin(_sender, room) {
                        const meta = room.getMetadata();
                        room.setMetadata({ ...meta, playerCount: (meta.playerCount || 0) + 1 });
                    },
                    onLeave(_sender, room) {
                        const meta = room.getMetadata();
                        room.setMetadata({ ...meta, playerCount: Math.max(0, (meta.playerCount || 0) - 1) });
                    },
                },
                actions: {
                    SET_MODE: (payload, room) => {
                        room.setMetadata({ ...room.getMetadata(), mode: payload.mode });
                        return { mode: payload.mode };
                    },
                },
            },
        },

        // ─── Broadcast Exclude Namespace ─────────────────────────────────
        'test-broadcast': {
            public: true,
            runtime: {
                target: 'rooms',
            },
            handlers: {
                actions: {
                    SEND_EXCLUDE: (payload, room) => {
                        room.sendMessage(payload.type, payload.data, { exclude: payload.exclude });
                    },
                    SEND_ALL: (payload, room) => {
                        room.sendMessage(payload.type, payload.data);
                    },
                },
            },
        },

        'test-signals': {
            public: true,
            runtime: {
                target: 'rooms',
            },
            access: {
                signal: (_auth, _roomId, event) => event !== 'denied.by.access',
            },
            state: {
                actions: {
                    SERVER_SIGNAL: (payload, room) => {
                        room.sendMessage(payload.event, payload.data, payload.exclude ? {
                            exclude: payload.exclude,
                        } : undefined);
                        return { ok: true };
                    },
                    SERVER_SIGNAL_TO: (payload, room) => {
                        room.sendMessageTo(payload.memberId, payload.event, payload.data);
                        return { ok: true };
                    },
                },
            },
            hooks: {
                signals: {
                    beforeSend: (event, payload) => {
                        if (event === 'blocked.by.hook') {
                            return false;
                        }
                        if (event === 'transform.payload') {
                            return {
                                ...(payload as Record<string, unknown>),
                                transformed: true,
                            };
                        }
                    },
                    onSend: (event, payload, sender, room) => {
                        room.setMetadata({
                            lastSignal: {
                                event,
                                payload,
                                senderUserId: sender.userId,
                                senderConnectionId: sender.connectionId,
                            },
                        });
                    },
                },
            },
        },

        'test-members': {
            public: true,
            runtime: {
                target: 'rooms',
            },
            reconnectTimeout: 250,
            state: {
                actions: {
                    KICK_MEMBER: (payload, room) => {
                        room.kick(payload.memberId);
                        return { ok: true };
                    },
                    SET_TOPIC: (payload, room) => {
                        room.setSharedState((state) => ({
                            ...state,
                            topic: payload.topic,
                        }));
                        return { ok: true, topic: payload.topic };
                    },
                },
            },
            hooks: {
                members: {
                    onJoin: (member, room) => {
                        room.setMetadata({
                            ...room.getMetadata(),
                            lastMemberEvent: {
                                type: 'join',
                                memberId: member.memberId,
                                connectionCount: member.connectionCount,
                            },
                        });
                    },
                    onLeave: (member, room, _ctx, reason) => {
                        room.setMetadata({
                            ...room.getMetadata(),
                            lastMemberEvent: {
                                type: 'leave',
                                memberId: member.memberId,
                                connectionCount: member.connectionCount,
                                reason,
                            },
                        });
                    },
                    onStateChange: (member, state, room) => {
                        room.setMetadata({
                            ...room.getMetadata(),
                            lastMemberEvent: {
                                type: 'state',
                                memberId: member.memberId,
                                state,
                            },
                        });
                    },
                },
                state: {
                    onStateChange: (delta, room) => {
                        room.setMetadata({
                            ...room.getMetadata(),
                            lastStateDelta: delta,
                        });
                    },
                },
                session: {
                    onReconnect: (sender, room) => {
                        room.setMetadata({
                            ...room.getMetadata(),
                            lastSessionEvent: {
                                type: 'reconnect',
                                userId: sender.userId,
                                connectionId: sender.connectionId,
                            },
                        });
                    },
                    onDisconnectTimeout: (sender, room) => {
                        room.setMetadata({
                            ...room.getMetadata(),
                            lastSessionEvent: {
                                type: 'disconnect-timeout',
                                userId: sender.userId,
                                connectionId: sender.connectionId,
                            },
                        });
                    },
                },
            },
        },

        // ─── Full Simulation Namespace (Phase 4) ─────────────────────────
        'test-simulation': {
            maxPlayers: 4,
            reconnectTimeout: 1000,
            rateLimit: { actions: 20 },
            public: true,
            runtime: {
                target: 'rooms',
            },
            handlers: {
                lifecycle: {
                    onCreate(room) {
                        room.setSharedState(() => ({
                            phase: 'waiting', turn: 0, board: {}, players: [],
                        }));
                        room.setServerState(() => ({
                            seed: Math.random(), actionLog: [],
                        }));
                    },
                    onJoin(sender, room) {
                        room.setSharedState(s => ({
                            ...s,
                            players: [...(s.players || []), { id: sender.userId, joinedAt: Date.now() }],
                        }));
                        room.setPlayerState(sender.userId, () => ({
                            hp: 100, score: 0, inventory: [],
                        }));
                    },
                    onLeave(sender, room, _ctx, reason) {
                        room.setSharedState(s => ({
                            ...s,
                            players: (s.players || []).filter(p => p.id !== sender.userId),
                            lastLeave: { userId: sender.userId, reason },
                        }));
                    },
                },
                actions: {
                    START_GAME: (_payload, room) => {
                        room.setSharedState(s => ({ ...s, phase: 'playing', turn: 1 }));
                        return { started: true };
                    },
                    PLACE_PIECE: (payload, room, sender) => {
                        room.setSharedState(s => ({
                            ...s,
                            board: { ...s.board, [`${payload.x},${payload.y}`]: sender.userId },
                            turn: (s.turn) + 1,
                        }));
                        room.setPlayerState(sender.userId, s => ({
                            ...s, score: (s.score) + 10,
                        }));
                        room.setServerState(s => ({
                            ...s, actionLog: [...(s.actionLog || []), { user: sender.userId, x: payload.x, y: payload.y }],
                        }));
                        return { placed: true, position: { x: payload.x, y: payload.y } };
                    },
                    GET_SERVER_INFO: (_payload, room) => {
                        const ss = room.getServerState();
                        return { seed: ss.seed, logCount: (ss.actionLog || []).length };
                    },
                    HEAL: (payload, room, sender) => {
                        room.setPlayerState(sender.userId, s => ({
                            ...s, hp: Math.min(100, (s.hp) + payload.amount),
                        }));
                        return { healed: payload.amount };
                    },
                    BROADCAST_MSG: (payload, room) => {
                        room.sendMessage(payload.type, payload.data);
                    },
                    SEND_MSG_TO: (payload, room) => {
                        room.sendMessageTo(payload.targetUserId, payload.type, payload.data);
                    },
                    KICK_PLAYER: (payload, room) => {
                        room.kick(payload.targetUserId);
                        return { kicked: true };
                    },
                    BAD_ACTION: () => {
                        throw new Error('Intentional error for testing');
                    },
                },
            },
        },
    },

    // ─── Databases ─────────────────────────────────────────────────────────
    databases: {
        shared: {
            tables: {
                // Public CRUD, FTS, expand refs
                posts: {
                    schema: {
                        title: { type: 'string', required: true, max: 200 },
                        content: { type: 'text' },
                        body: { type: 'text' },
                        description: { type: 'text' },
                        views: { type: 'number', default: 0 },
                        viewCount: { type: 'number', default: 0 },
                        score: { type: 'number' },
                        rating: { type: 'number' },
                        extra: { type: 'string' },
                        extra1: { type: 'string' },
                        extra2: { type: 'string' },
                        extraKey: { type: 'string' },
                        status: { type: 'string' },
                        tag: { type: 'string' },
                        category: { type: 'string' },
                        tempData: { type: 'string' },
                        temp: { type: 'string' },
                        tempField: { type: 'string' },
                        extraField: { type: 'string' },
                        attachment: { type: 'string' },
                        count: { type: 'number' },
                        likes: { type: 'number', default: 0 },
                        index: { type: 'number' },
                        tags: { type: 'json' },
                        isPublished: { type: 'boolean', default: false },
                        published: { type: 'boolean' },
                        metadata: { type: 'json' },
                        nested: { type: 'json' },
                        authorId: { type: 'string', references: 'users' },
                        categoryId: { type: 'string', references: 'categories' },
                        secureRef: { type: 'string', references: 'secure_posts' },
                        deniedRef: { type: 'string', references: 'denied_notes' },
                        authRequiredRef: { type: 'string', references: 'auth_required_notes' },
                    },
                    access: {
                        read: () => true,
                        insert: () => true,
                        update: () => true,
                        delete: (auth) => auth !== null,
                    },
                    fts: ['title', 'content'],
                    indexes: [
                        { fields: ['authorId'] },
                        { fields: ['isPublished', 'createdAt'] },
                    ],
                },

                // Public read, auth write/delete (SK bypasses rules —)
                categories: {
                    schema: {
                        name: { type: 'string', required: true, unique: true },
                        description: { type: 'text' },
                        slug: { type: 'string' },
                        sortOrder: { type: 'number', default: 0 },
                    },
                    access: {
                        read: () => true,
                        insert: (auth) => auth !== null,
                        update: (auth) => auth !== null,
                        delete: (auth) => auth !== null,
                    },
                    migrations: [
                        { version: 2, description: 'Add slug column', up: 'ALTER TABLE categories ADD COLUMN slug TEXT;' },
                        { version: 3, description: 'Add sortOrder column', up: 'ALTER TABLE categories ADD COLUMN sortOrder REAL DEFAULT 0;' },
                    ],
                },

                articles: {
                    schema: {
                        title: { type: 'string', required: true },
                        body: { type: 'text' },
                        status: { type: 'string', default: 'draft' },
                    },
                    access: {
                        read: () => true,
                        insert: () => true,
                        update: () => true,
                        delete: () => true,
                    },
                },

                enriched_notes: {
                    schema: {
                        title: { type: 'string', required: true },
                        content: { type: 'text' },
                        status: { type: 'string', default: 'draft' },
                    },
                    access: {
                        read: () => true,
                        insert: () => true,
                        update: () => true,
                        delete: () => true,
                    },
                    handlers: {
                        hooks: {
                            onEnrich: (_auth, record) => ({
                                titleLength: String(record.title ?? '').length,
                                hasContent: Boolean(record.content),
                            }),
                        },
                    },
                },

                // Owner-only rules (access rule tests + expand security target)
                secure_posts: {
                    schema: {
                        title: { type: 'string', required: true },
                        content: { type: 'text' },
                        authorId: { type: 'string' },
                    },
                    access: {
                        // read covers both list and get (TableRules type)
                        read: (auth, row) => auth?.id === row?.authorId,
                        insert: (auth) => auth !== null,
                        update: (auth, row) => auth?.id === row?.authorId,
                        delete: (auth, row) => auth?.id === row?.authorId,
                    },
                },

                // Deny-all
                denied_notes: {
                    schema: {
                        title: { type: 'string', required: true },
                        content: { type: 'text' },
                    },
                    access: {
                        read: () => false,
                        insert: () => true,
                        update: () => false,
                        delete: () => false,
                    },
                },

                // Auth-required
                auth_required_notes: {
                    schema: {
                        title: { type: 'string', required: true },
                        content: { type: 'text' },
                    },
                    access: {
                        read: (auth) => auth !== null,
                        insert: () => true,
                        update: (auth) => auth !== null,
                        delete: (auth) => auth !== null,
                    },
                },

                bad_migration: {
                    schema: {
                        name: { type: 'string', required: true },
                    },
                    access: {
                        read: () => true,
                        insert: () => true,
                    },
                    migrations: [
                        { version: 2, description: 'Intentionally broken migration', up: 'INVALID SQL SYNTAX HERE ;;;' },
                    ],
                },

                workspace_tasks: {
                    schema: {
                        title: { type: 'string', required: true },
                        assignedTo: { type: 'string' },
                    },
                    access: {
                        read: () => true,
                        insert: () => true,
                        update: () => true,
                        delete: () => true,
                    },
                },

                workspaceIdMembers: {
                    schema: {
                        userId: { type: 'string', required: true },
                        workspaceId: { type: 'string', required: true },
                        role: { type: 'string', default: 'member' },
                    },
                    access: {
                        read: () => true,
                        insert: () => true,
                        update: () => true,
                        delete: () => true,
                    },
                },

                private_notes: {
                    schema: {
                        title: { type: 'string', required: true },
                        content: { type: 'text' },
                    },
                    access: {
                        read: (auth) => auth !== null,
                        insert: (auth) => auth !== null,
                        update: (auth) => auth !== null,
                        delete: (auth) => auth !== null,
                    },
                },
            },
        },
    },
});
