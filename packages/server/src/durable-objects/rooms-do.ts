import {
  type AuthContext as SharedAuthContext,
  type RoomMemberInfo,
  type RoomNamespaceConfig,
  type RoomSender,
  type RoomServerAPI,
} from '@edge-base/shared';
import { RoomRuntimeBaseDO, type RoomWSMeta } from './room-runtime-base.js';

/**
 * Parallel `rooms` runtime entrypoint.
 *
 * It currently preserves legacy Room behavior while giving rollout routing a
 * separate Durable Object class to target. New room-runtime capabilities can
 * evolve here without mutating the legacy RoomDO class in place.
 */

interface SignalMessage {
  type: 'signal';
  event: string;
  payload?: unknown;
  memberId?: string | null;
  includeSelf?: boolean;
  requestId?: string;
}

interface MemberStateMessage {
  type: 'member_state';
  state?: Record<string, unknown>;
  requestId?: string;
}

interface MemberStateClearMessage {
  type: 'member_state_clear';
  requestId?: string;
}

interface AdminMessage {
  type: 'admin';
  operation: string;
  memberId?: string | null;
  payload?: Record<string, unknown>;
  requestId?: string;
}

interface SignalFrameMeta {
  memberId: string | null;
  userId: string | null;
  connectionId: string | null;
  sentAt: number;
  serverSent: boolean;
}

interface RoomMemberPresence {
  memberId: string;
  userId: string;
  joinedAt: number;
  connectionIds: Set<string>;
  reconnectUntil?: number;
  state: Record<string, unknown>;
}

interface RoomSummaryResponse {
  namespace: string;
  roomId: string;
  metadata: Record<string, unknown>;
  occupancy: {
    activeMembers: number;
    activeConnections: number;
  };
  updatedAt: string;
}

interface RoomsWSAttachmentExtra {
  joined?: boolean;
  joinedAt?: number;
  role?: string;
  state?: Record<string, unknown>;
}

type RoomMemberSnapshot = RoomMemberInfo & { state: Record<string, unknown> };
type RoomMemberLeaveReason = 'leave' | 'timeout' | 'kicked';

const SYSTEM_SIGNAL_SENDER: RoomSender = {
  userId: 'system',
  connectionId: 'server',
};

const DEFAULT_MEMBER_RECONNECT_TIMEOUT_MS = 30000;
const SIGNAL_DENIED = Symbol('rooms.signal.denied');
const WEBSOCKET_OPEN = 1;

function getRoomHooks(namespaceConfig?: RoomNamespaceConfig | null) {
  return namespaceConfig?.hooks;
}

function computeStateDelta(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> | null {
  const delta: Record<string, unknown> = {};
  let hasChanges = false;

  for (const key of Object.keys(next)) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(next[key])) {
      delta[key] = next[key];
      hasChanges = true;
    }
  }
  for (const key of Object.keys(previous)) {
    if (!(key in next)) {
      delta[key] = null;
      hasChanges = true;
    }
  }

  return hasChanges ? delta : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class RoomsDO extends RoomRuntimeBaseDO {
  private readonly joinedConnectionIds = new Set<string>();
  private readonly members = new Map<string, RoomMemberPresence>();
  private readonly blockedMembers = new Set<string>();
  private readonly memberRoles = new Map<string, string>();

  protected override buildWSAttachmentExtra(_ws: WebSocket, meta: RoomWSMeta): unknown {
    if (!meta.userId) {
      return undefined;
    }

    const member = this.members.get(meta.userId);

    return {
      joined: this.joinedConnectionIds.has(meta.connectionId),
      joinedAt: member?.joinedAt,
      role: this.memberRoles.get(meta.userId) ?? meta.role,
      state: member ? { ...member.state } : undefined,
    } satisfies RoomsWSAttachmentExtra;
  }

  protected override async recoverRuntimeStateFromSockets(): Promise<void> {
    await super.recoverRuntimeStateFromSockets();

    this.joinedConnectionIds.clear();
    this.members.clear();
    this.blockedMembers.clear();
    this.memberRoles.clear();

    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (!meta?.authenticated || !meta.userId) {
        continue;
      }

      const extra = this.getWSAttachmentExtra<RoomsWSAttachmentExtra>(ws);
      if (!extra?.joined) {
        continue;
      }

      this.joinedConnectionIds.add(meta.connectionId);
      const member = this.ensureMember(meta.userId);
      member.connectionIds.add(meta.connectionId);
      if (typeof extra.joinedAt === 'number' && Number.isFinite(extra.joinedAt)) {
        member.joinedAt = Math.min(member.joinedAt, extra.joinedAt);
      }
      if (isRecord(extra.state)) {
        member.state = {
          ...member.state,
          ...extra.state,
        };
      }

      const role = typeof extra.role === 'string' && extra.role.trim()
        ? extra.role.trim()
        : meta.role;
      if (role) {
        this.memberRoles.set(meta.userId, role);
      }
    }
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/summary' && request.method === 'GET') {
      return this.handleSummaryGet(url);
    }

    return super.fetch(request);
  }

  private async handleSummaryGet(url: URL): Promise<Response> {
    this.hydrateRoomIdentityFromUrl(url);
    const metadata = await this.getRoomMetadataSnapshot();
    const activeMembers = Array.from(this.members.values()).filter(
      (member) => this.getVisibleMemberConnectionIds(member).length > 0
    ).length;

    return this.jsonResponse<RoomSummaryResponse>(200, {
      namespace: this.namespace ?? '',
      roomId: this.roomId ?? '',
      metadata,
      occupancy: {
        activeMembers,
        activeConnections: Array.from(this.members.values()).reduce(
          (count, member) => count + this.getVisibleMemberConnectionIds(member).length,
          0,
        ),
      },
      updatedAt: new Date().toISOString(),
    });
  }

  private jsonResponse<T>(status: number, body: T): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ensureRuntimeReady();
    await this.recoverStateIfNeeded();

    const activityMeta = this.getWSMeta(ws);
    if (activityMeta) {
      activityMeta.lastSeenAt = Date.now();
    }

    if (typeof message !== 'string') return;

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(message);
    } catch {
      this.safeSend(ws, { type: 'error', code: 'INVALID_JSON', message: 'Invalid JSON' });
      return;
    }

    if (msg.type === 'signal') {
      const meta = this.requireAuthenticatedMeta(ws);
      if (!meta) return;

      const event = typeof msg.event === 'string' ? msg.event : '';
      const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;
      if (!this.checkRateLimit(meta.connectionId, 'signals')) {
        this.safeSend(ws, {
          type: 'signal_error',
          event,
          message: 'Rate limited',
          requestId,
        });
        return;
      }

      await this.handleSignal(ws, meta, {
        type: 'signal',
        event,
        payload: msg.payload,
        memberId: typeof msg.memberId === 'string' ? msg.memberId : null,
        includeSelf: msg.includeSelf === true,
        requestId,
      });
      return;
    }

    if (msg.type === 'member_state') {
      const meta = this.requireAuthenticatedMeta(ws);
      if (!meta) return;
      await this.handleMemberState(ws, meta, {
        type: 'member_state',
        state: this.asRecord(msg.state),
        requestId: typeof msg.requestId === 'string' ? msg.requestId : undefined,
      });
      return;
    }

    if (msg.type === 'member_state_clear') {
      const meta = this.requireAuthenticatedMeta(ws);
      if (!meta) return;
      await this.handleMemberState(ws, meta, {
        type: 'member_state_clear',
        requestId: typeof msg.requestId === 'string' ? msg.requestId : undefined,
      });
      return;
    }

    if (msg.type === 'admin') {
      const meta = this.requireAuthenticatedMeta(ws);
      if (!meta) return;

      const operation = typeof msg.operation === 'string' ? msg.operation : '';
      const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;
      if (!this.checkRateLimit(meta.connectionId, 'admin')) {
        this.safeSend(ws, {
          type: 'admin_error',
          operation,
          message: 'Rate limited',
          requestId,
        });
        return;
      }

      await this.handleAdmin(ws, meta, {
        type: 'admin',
        operation,
        memberId: typeof msg.memberId === 'string' ? msg.memberId : null,
        payload: this.asRecord(msg.payload),
        requestId,
      });
      return;
    }

    await super.webSocketMessage(ws, message);
  }

  protected override async handleJoin(
    ws: WebSocket,
    meta: RoomWSMeta,
    msg: Record<string, unknown>,
  ): Promise<void> {
    const userId = meta.userId;
    if (userId && this.blockedMembers.has(userId)) {
      this.safeSend(ws, {
        type: 'error',
        code: 'JOIN_DENIED',
        message: 'Blocked from this room',
      });
      ws.close(4003, 'Join denied');
      return;
    }

    const existingMember = userId ? this.members.get(userId) : undefined;
    const hadMember = !!existingMember;
    const wasReconnecting = !!existingMember && existingMember.connectionIds.size === 0;

    await super.handleJoin(ws, meta, msg);

    if (!userId || !meta.authenticated || !this.isSocketOpen(ws)) {
      return;
    }

    const member = this.ensureMember(userId);
    const restoredMemberState = wasReconnecting
      ? this.normalizeRecoveredMemberState(msg.lastMemberState)
      : null;
    if (restoredMemberState) {
      member.state = {
        ...member.state,
        ...restoredMemberState,
      };
    }
    this.joinedConnectionIds.add(meta.connectionId);
    member.connectionIds.add(meta.connectionId);
    member.reconnectUntil = undefined;

    if (!hadMember) {
      const snapshot = this.buildMemberSnapshot(member);
      await this.runMemberJoinHook(snapshot);
      this.broadcastToJoined({ type: 'member_join', member: snapshot }, meta.connectionId);
    }

    this.broadcastMembersSync();
    this.sendMembersSyncToConnection(ws);

    if (wasReconnecting) {
      await this.runSessionReconnectHook(this.buildSender(meta));
    }

    this.refreshMemberSocketAttachments(userId);
  }

  protected override async handleExplicitLeave(ws: WebSocket, meta: RoomWSMeta): Promise<void> {
    const userId = meta.userId;
    const wasJoined = this.isJoinedConnection(meta.connectionId);

    await super.handleExplicitLeave(ws, meta);

    if (!userId || !wasJoined) {
      return;
    }

    const member = this.removeMemberConnection(userId, meta.connectionId);
    if (member) {
      this.refreshMemberSocketAttachments(userId);
      this.broadcastMembersSync();
    }
  }

  protected override async handleDisconnect(
    meta: RoomWSMeta,
    kicked = false,
    explicitLeave = false,
  ): Promise<void> {
    const userId = meta.userId;
    const wasJoined = this.isJoinedConnection(meta.connectionId);

    await super.handleDisconnect(meta, kicked, explicitLeave);

    if (!userId || !wasJoined || explicitLeave) {
      return;
    }

    const member = this.removeMemberConnection(userId, meta.connectionId);
    if (!member) {
      return;
    }

    if (member.connectionIds.size > 0) {
      member.reconnectUntil = undefined;
      this.refreshMemberSocketAttachments(userId);
      this.broadcastMembersSync();
      return;
    }

    const reconnectTimeout = this.namespaceConfig?.reconnectTimeout ?? DEFAULT_MEMBER_RECONNECT_TIMEOUT_MS;
    if (!kicked && reconnectTimeout > 0) {
      member.reconnectUntil = Date.now() + reconnectTimeout;
      this.refreshMemberSocketAttachments(userId);
      this.broadcastMembersSync();
      return;
    }
  }

  protected override async finalizePlayerLeave(
    userId: string,
    connectionId: string,
    reason: 'leave' | 'disconnect' | 'kicked',
  ): Promise<void> {
    const member = this.members.get(userId);
    const snapshot = member ? this.buildMemberSnapshot(member, connectionId) : null;

    await super.finalizePlayerLeave(userId, connectionId, reason);

    if (!snapshot) {
      return;
    }

    if (reason === 'disconnect') {
      await this.runSessionDisconnectTimeoutHook({
        userId,
        connectionId,
        role: this.memberRoles.get(userId),
      });
    }

    this.deleteMember(userId);

    const leaveReason: RoomMemberLeaveReason = reason === 'disconnect' ? 'timeout' : reason;
    await this.runMemberLeaveHook(snapshot, leaveReason);
    this.broadcastToJoined({
      type: 'member_leave',
      member: snapshot,
      reason: leaveReason,
    });
    this.broadcastMembersSync();
  }

  protected override buildRoomServerAPI(): RoomServerAPI {
    const roomApi = super.buildRoomServerAPI();
    return {
      ...roomApi,
      setSharedState: (updater: (state: Record<string, unknown>) => Record<string, unknown>): void => {
        const previous = roomApi.getSharedState();
        roomApi.setSharedState(updater);
        const next = roomApi.getSharedState();
        const delta = computeStateDelta(previous, next);
        if (delta) {
          void this.runSharedStateHook(delta, roomApi);
        }
      },
      sendMessage: (event: string, payload?: unknown, options?: { exclude?: string[] }): void => {
        roomApi.sendMessage(event, payload, options);
        void this.sendServerSignal({
          event,
          payload: payload ?? {},
          excludeUserIds: options?.exclude,
        });
      },
      sendMessageTo: (memberId: string, event: string, payload?: unknown): void => {
        roomApi.sendMessageTo(memberId, event, payload);
        void this.sendServerSignal({
          event,
          payload: payload ?? {},
          memberId,
        });
      },
    };
  }

  protected override buildSender(meta: RoomWSMeta): RoomSender {
    const sender = super.buildSender(meta);
    const role = meta.userId ? this.memberRoles.get(meta.userId) : undefined;
    return role ? { ...sender, role } : sender;
  }

  protected override buildAuthFromMeta(meta: RoomWSMeta): SharedAuthContext {
    const auth = super.buildAuthFromMeta(meta);
    const role = meta.userId ? this.memberRoles.get(meta.userId) ?? auth.role : auth.role;
    return role === auth.role ? auth : { ...auth, role };
  }

  private async handleAdmin(
    ws: WebSocket,
    meta: RoomWSMeta,
    msg: AdminMessage,
  ): Promise<void> {
    const operation = msg.operation.trim();
    const requestId = msg.requestId;
    if (!operation) {
      this.safeSend(ws, {
        type: 'admin_error',
        operation: '',
        message: 'operation is required',
        requestId,
      });
      return;
    }

    if (!meta.userId || !this.roomId) {
      this.safeSend(ws, {
        type: 'admin_error',
        operation,
        message: 'User not authenticated',
        requestId,
      });
      return;
    }

    if (!this.isJoinedConnection(meta.connectionId)) {
      this.safeSend(ws, {
        type: 'admin_error',
        operation,
        message: 'Join the room before issuing admin commands',
        requestId,
      });
      return;
    }

    const memberId = this.normalizeMemberId(msg.memberId);
    if (!memberId) {
      this.safeSend(ws, {
        type: 'admin_error',
        operation,
        message: 'memberId is required',
        requestId,
      });
      return;
    }

    const payload = msg.payload ?? {};
    if (!(await this.canRunAdmin(meta, operation, { memberId, ...payload }))) {
      this.safeSend(ws, {
        type: 'admin_error',
        operation,
        message: 'Denied by room admin access rule',
        requestId,
      });
      return;
    }

    try {
      switch (operation) {
        case 'kick':
          await this.kickPlayer(memberId);
          break;
        case 'block':
          this.blockedMembers.add(memberId);
          await this.kickPlayer(memberId);
          break;
        case 'setRole': {
          const role = typeof payload.role === 'string' ? payload.role.trim() : '';
          if (!role) {
            throw new Error('role is required');
          }
          this.syncMemberRole(memberId, role);
          this.broadcastMembersSync();
          break;
        }
        default:
          throw new Error(`Unsupported admin operation '${operation}'`);
      }

      this.safeSend(ws, {
        type: 'admin_result',
        operation,
        memberId,
        requestId,
        result: { ok: true },
      });
    } catch (err) {
      this.safeSend(ws, {
        type: 'admin_error',
        operation,
        memberId,
        requestId,
        message: err instanceof Error ? err.message : 'Admin operation failed',
      });
    }
  }

  private async handleSignal(
    ws: WebSocket,
    meta: RoomWSMeta,
    msg: SignalMessage,
  ): Promise<void> {
    const event = typeof msg.event === 'string' ? msg.event.trim() : '';
    const requestId = typeof msg.requestId === 'string' ? msg.requestId : undefined;

    if (!event) {
      this.safeSend(ws, {
        type: 'signal_error',
        event: '',
        message: 'event is required',
        requestId,
      });
      return;
    }

    if (!meta.userId || !this.roomId) {
      this.safeSend(ws, {
        type: 'signal_error',
        event,
        message: 'User not authenticated',
        requestId,
      });
      return;
    }

    if (!this.isJoinedConnection(meta.connectionId)) {
      this.safeSend(ws, {
        type: 'signal_error',
        event,
        message: 'Join the room before sending signals',
        requestId,
      });
      return;
    }

    if (!(await this.canSendSignal(meta, event, msg.payload))) {
      this.safeSend(ws, {
        type: 'signal_error',
        event,
        message: 'Denied by room signal access rule',
        requestId,
      });
      return;
    }

    const sender = this.buildSender(meta);
    const roomApi = this.buildRoomServerAPI();
    const signalCtx = {
      event,
      payload: msg.payload,
      sender,
      roomApi,
      memberId: this.normalizeMemberId(msg.memberId),
      includeSelf: msg.includeSelf === true,
      meta: this.buildSignalFrameMeta(sender, false),
    };
    const transformedPayload = await this.applySignalBeforeSend(signalCtx);
    if (transformedPayload === SIGNAL_DENIED) {
      this.safeSend(ws, {
        type: 'signal_error',
        event,
        message: 'Rejected by room signal hook',
        requestId,
      });
      return;
    }

    this.deliverSignal(
      {
        type: 'signal',
        event,
        payload: transformedPayload,
        meta: signalCtx.meta,
      },
      {
        memberId: signalCtx.memberId,
        includeSelf: signalCtx.includeSelf,
        senderConnectionId: meta.connectionId,
      },
    );

    this.safeSend(ws, {
      type: 'signal_sent',
      event,
      memberId: signalCtx.memberId,
      requestId,
    });

    await this.runSignalOnSend(event, transformedPayload, sender, roomApi);
  }

  private async handleMemberState(
    ws: WebSocket,
    meta: RoomWSMeta,
    msg: MemberStateMessage | MemberStateClearMessage,
  ): Promise<void> {
    if (!meta.userId) {
      this.safeSend(ws, {
        type: 'member_state_error',
        message: 'User not authenticated',
        requestId: msg.requestId,
      });
      return;
    }

    if (!this.isJoinedConnection(meta.connectionId)) {
      this.safeSend(ws, {
        type: 'member_state_error',
        message: 'Join the room before updating member state',
        requestId: msg.requestId,
      });
      return;
    }

    const member = this.ensureMember(meta.userId);
    if (msg.type === 'member_state') {
      if (!msg.state) {
        this.safeSend(ws, {
          type: 'member_state_error',
          message: 'state must be an object',
          requestId: msg.requestId,
        });
        return;
      }

      member.state = {
        ...member.state,
        ...msg.state,
      };
    } else {
      member.state = {};
    }

    const snapshot = this.buildMemberSnapshot(member);
    const state = { ...member.state };
    this.refreshMemberSocketAttachments(meta.userId);
    this.broadcastToJoined({
      type: 'member_state',
      member: snapshot,
      state,
      requestId: msg.requestId,
    });
    this.broadcastMembersSync();
    await this.runMemberStateHook(snapshot, state);
  }

  private async sendServerSignal(input: {
    event: string;
    payload: unknown;
    memberId?: string;
    excludeUserIds?: string[];
  }): Promise<void> {
    const event = input.event.trim();
    if (!event) return;

    const roomApi = this.buildRoomServerAPI();
    const signalCtx = {
      event,
      payload: input.payload,
      sender: SYSTEM_SIGNAL_SENDER,
      roomApi,
      memberId: this.normalizeMemberId(input.memberId),
      includeSelf: true,
      meta: this.buildSignalFrameMeta(SYSTEM_SIGNAL_SENDER, true),
    };
    const transformedPayload = await this.applySignalBeforeSend(signalCtx);
    if (transformedPayload === SIGNAL_DENIED) return;

    this.deliverSignal(
      {
        type: 'signal',
        event,
        payload: transformedPayload,
        meta: signalCtx.meta,
      },
      {
        memberId: signalCtx.memberId,
        includeSelf: true,
        excludeUserIds: input.excludeUserIds,
      },
    );

    await this.runSignalOnSend(event, transformedPayload, SYSTEM_SIGNAL_SENDER, roomApi);
  }

  private async canSendSignal(
    meta: RoomWSMeta,
    event: string,
    payload: unknown,
  ): Promise<boolean> {
    if (!this.namespaceConfig?.access?.signal || !this.roomId) {
      return !this.config.release;
    }

    try {
      return await Promise.resolve(
        this.namespaceConfig.access.signal(
          this.buildAuthFromMeta(meta),
          this.roomId,
          event,
          payload,
        ),
      );
    } catch {
      return false;
    }
  }

  private async applySignalBeforeSend(signal: {
    event: string;
    payload: unknown;
    sender: RoomSender;
    roomApi: RoomServerAPI;
    memberId?: string;
    includeSelf: boolean;
    meta: SignalFrameMeta;
  }): Promise<unknown | typeof SIGNAL_DENIED> {
    const beforeSend = getRoomHooks(this.namespaceConfig ?? undefined)?.signals?.beforeSend;
    if (!beforeSend) return signal.payload;

    const ctx = await this.buildHandlerContext();
    const result = await Promise.resolve(
      beforeSend(signal.event, signal.payload, signal.sender, signal.roomApi, ctx),
    );
    if (result === false) return SIGNAL_DENIED;
    return result === undefined ? signal.payload : result;
  }

  private async runSignalOnSend(
    event: string,
    payload: unknown,
    sender: RoomSender,
    roomApi: RoomServerAPI,
  ): Promise<void> {
    const onSend = getRoomHooks(this.namespaceConfig ?? undefined)?.signals?.onSend;
    if (!onSend) return;

    try {
      const ctx = await this.buildHandlerContext();
      await Promise.resolve(onSend(event, payload, sender, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] signal.onSend error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runMemberJoinHook(member: RoomMemberSnapshot): Promise<void> {
    const onJoin = getRoomHooks(this.namespaceConfig ?? undefined)?.members?.onJoin;
    if (!onJoin) return;

    try {
      const roomApi = this.buildRoomServerAPI();
      const ctx = await this.buildHandlerContext();
      await Promise.resolve(onJoin(member, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] members.onJoin error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runMemberLeaveHook(
    member: RoomMemberSnapshot,
    reason: RoomMemberLeaveReason,
  ): Promise<void> {
    const onLeave = getRoomHooks(this.namespaceConfig ?? undefined)?.members?.onLeave;
    if (!onLeave) return;

    try {
      const roomApi = this.buildRoomServerAPI();
      const ctx = await this.buildHandlerContext();
      await Promise.resolve(onLeave(member, roomApi, ctx, reason));
    } catch (err) {
      console.error(`[Rooms] members.onLeave error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runMemberStateHook(
    member: RoomMemberSnapshot,
    state: Record<string, unknown>,
  ): Promise<void> {
    const onStateChange = getRoomHooks(this.namespaceConfig ?? undefined)?.members?.onStateChange;
    if (!onStateChange) return;

    try {
      const roomApi = this.buildRoomServerAPI();
      const ctx = await this.buildHandlerContext();
      await Promise.resolve(onStateChange(member, state, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] members.onStateChange error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runSharedStateHook(
    delta: Record<string, unknown>,
    roomApi: RoomServerAPI,
  ): Promise<void> {
    const onStateChange = getRoomHooks(this.namespaceConfig ?? undefined)?.state?.onStateChange;
    if (!onStateChange) return;

    try {
      const ctx = await this.buildHandlerContext();
      await Promise.resolve(onStateChange(delta, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] state.onStateChange error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runSessionReconnectHook(sender: RoomSender): Promise<void> {
    const onReconnect = getRoomHooks(this.namespaceConfig ?? undefined)?.session?.onReconnect;
    if (!onReconnect) return;

    try {
      const roomApi = this.buildRoomServerAPI();
      const ctx = await this.buildHandlerContext();
      await Promise.resolve(onReconnect(sender, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] session.onReconnect error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async runSessionDisconnectTimeoutHook(sender: RoomSender): Promise<void> {
    const onDisconnectTimeout = getRoomHooks(this.namespaceConfig ?? undefined)?.session?.onDisconnectTimeout;
    if (!onDisconnectTimeout) return;

    try {
      const roomApi = this.buildRoomServerAPI();
      const ctx = await this.buildHandlerContext();
      await Promise.resolve(onDisconnectTimeout(sender, roomApi, ctx));
    } catch (err) {
      console.error(`[Rooms] session.onDisconnectTimeout error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async canRunAdmin(
    meta: RoomWSMeta,
    operation: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const adminAccess = this.namespaceConfig?.access?.admin;
    if (!adminAccess || !this.roomId) {
      return !this.config.release;
    }

    try {
      return await Promise.resolve(
        adminAccess(this.buildAuthFromMeta(meta), this.roomId, operation, payload),
      );
    } catch {
      return false;
    }
  }

  private sendMembersSyncToConnection(ws: WebSocket): void {
    if (!this.isSocketOpen(ws)) {
      return;
    }

    this.safeSend(ws, {
      type: 'members_sync',
      occupancy: this.buildAuthoritativeOccupancy(),
      members: this.listMembers(),
    });
  }

  private deliverSignal(
    frame: {
      type: 'signal';
      event: string;
      payload: unknown;
      meta: SignalFrameMeta;
    },
    options: {
      memberId?: string;
      includeSelf: boolean;
      senderConnectionId?: string;
      excludeUserIds?: string[];
    },
  ): void {
    if (options.memberId) {
      this.sendSignalToMember(options.memberId, frame);
      return;
    }

    this.broadcastToJoined(
      frame,
      options.includeSelf ? undefined : options.senderConnectionId,
      options.excludeUserIds,
    );
  }

  private sendSignalToMember(
    memberId: string,
    frame: {
      type: 'signal';
      event: string;
      payload: unknown;
      meta: SignalFrameMeta;
    },
  ): void {
    const member = this.members.get(memberId);
    if (!member || member.connectionIds.size === 0) {
      return;
    }

    const json = JSON.stringify(frame);
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (meta?.authenticated && member.connectionIds.has(meta.connectionId)) {
        this.safeSendRaw(ws, json);
      }
    }
  }

  private broadcastMembersSync(): void {
    this.broadcastToJoined({
      type: 'members_sync',
      occupancy: this.buildAuthoritativeOccupancy(),
      members: this.listMembers(),
    });
  }

  private broadcastToJoined(
    msg: Record<string, unknown>,
    excludeConnectionId?: string,
    excludeUserIds?: string[],
  ): void {
    if (this.joinedConnectionIds.size === 0) {
      return;
    }

    const json = JSON.stringify(msg);
    const excludeSet = excludeUserIds?.length ? new Set(excludeUserIds) : null;
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (!meta?.authenticated || !this.joinedConnectionIds.has(meta.connectionId)) {
        continue;
      }
      if (excludeConnectionId && meta.connectionId === excludeConnectionId) {
        continue;
      }
      if (excludeSet && meta.userId && excludeSet.has(meta.userId)) {
        continue;
      }
      this.safeSendRaw(ws, json);
    }
  }

  private ensureMember(userId: string): RoomMemberPresence {
    let member = this.members.get(userId);
    if (!member) {
      member = {
        memberId: userId,
        userId,
        joinedAt: Date.now(),
        connectionIds: new Set<string>(),
        state: {},
      };
      this.members.set(userId, member);
    }
    return member;
  }

  private normalizeRecoveredMemberState(value: unknown): Record<string, unknown> | null {
    if (!isRecord(value)) {
      return null;
    }

    return { ...value };
  }

  private removeMemberConnection(userId: string, connectionId: string): RoomMemberPresence | null {
    this.joinedConnectionIds.delete(connectionId);
    const member = this.members.get(userId);
    if (!member) {
      return null;
    }

    member.connectionIds.delete(connectionId);
    return member;
  }

  private deleteMember(userId: string): void {
    const member = this.members.get(userId);
    if (!member) {
      return;
    }

    for (const connectionId of member.connectionIds) {
      this.joinedConnectionIds.delete(connectionId);
    }
    this.members.delete(userId);
  }

  private getEffectiveSocketStaleTimeoutMs(): number {
    const configured = (this.namespaceConfig as { socketStaleTimeout?: unknown } | null)?.socketStaleTimeout;
    if (typeof configured !== 'number' || !Number.isFinite(configured)) {
      return 20000;
    }
    const normalized = Math.floor(configured);
    return normalized >= 3000 ? normalized : 20000;
  }

  private getVisibleMemberConnectionIds(member: RoomMemberPresence): string[] {
    if (member.connectionIds.size === 0) {
      return [];
    }

    const staleBefore = Date.now() - this.getEffectiveSocketStaleTimeoutMs();
    const visibleConnectionIds: string[] = [];

    for (const connectionId of member.connectionIds) {
      const meta = this.findConnectionMeta(connectionId);
      if (!meta?.authenticated) {
        continue;
      }
      if ((meta.lastSeenAt ?? 0) <= staleBefore) {
        continue;
      }
      visibleConnectionIds.push(connectionId);
    }

    return visibleConnectionIds;
  }

  private listMembers(): RoomMemberSnapshot[] {
    const now = Date.now();
    return Array.from(this.members.values())
      .filter((member) => {
        const visibleConnectionIds = this.getVisibleMemberConnectionIds(member);
        if (visibleConnectionIds.length > 0) {
          return true;
        }
        return typeof member.reconnectUntil === 'number' && member.reconnectUntil > now;
      })
      .sort((left, right) => left.joinedAt - right.joinedAt || left.memberId.localeCompare(right.memberId))
      .map((member) => this.buildMemberSnapshot(member));
  }

  private buildAuthoritativeOccupancy(): { activeMembers: number; activeConnections: number } {
    let activeMembers = 0;
    let activeConnections = 0;

    for (const member of this.members.values()) {
      const connectionCount = this.getVisibleMemberConnectionIds(member).length;
      if (connectionCount <= 0) {
        continue;
      }
      activeMembers += 1;
      activeConnections += connectionCount;
    }

    return {
      activeMembers,
      activeConnections,
    };
  }

  private buildMemberSnapshot(
    member: RoomMemberPresence,
    fallbackConnectionId?: string,
  ): RoomMemberSnapshot {
    return {
      ...this.buildMemberInfo(member, fallbackConnectionId),
      state: { ...member.state },
    };
  }

  private buildMemberInfo(
    member: RoomMemberPresence,
    fallbackConnectionId?: string,
  ): RoomMemberInfo {
    const visibleConnectionIds = this.getVisibleMemberConnectionIds(member);
    const activeConnectionId = visibleConnectionIds[0]
      ?? member.connectionIds.values().next().value as string | undefined;
    const connectionId = activeConnectionId ?? fallbackConnectionId;
    const meta = connectionId ? this.findConnectionMeta(connectionId) : null;
    const role = this.memberRoles.get(member.memberId) ?? meta?.role;

    return {
      memberId: member.memberId,
      userId: member.userId,
      connectionId,
      connectionCount: visibleConnectionIds.length,
      role,
    };
  }

  private findConnectionMeta(connectionId: string): RoomWSMeta | null {
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (meta?.connectionId === connectionId) {
        return meta;
      }
    }
    return null;
  }

  private buildSignalFrameMeta(sender: RoomSender, serverSent: boolean): SignalFrameMeta {
    return {
      memberId: serverSent ? null : sender.userId,
      userId: serverSent ? null : sender.userId,
      connectionId: serverSent ? null : sender.connectionId,
      sentAt: Date.now(),
      serverSent,
    };
  }

  private normalizeMemberId(memberId: string | null | undefined): string | undefined {
    if (typeof memberId !== 'string') return undefined;
    const trimmed = memberId.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private requireAuthenticatedMeta(ws: WebSocket): RoomWSMeta | null {
    const meta = this.getWSMeta(ws);
    if (!meta) {
      ws.close(4000, 'No metadata');
      return null;
    }

    if (!meta.authenticated) {
      this.handleUnauthenticatedSocket(ws, meta);
      return null;
    }

    return meta;
  }

  private isJoinedConnection(connectionId: string): boolean {
    return this.joinedConnectionIds.has(connectionId);
  }

  private isSocketOpen(ws: WebSocket): boolean {
    return ws.readyState === WEBSOCKET_OPEN;
  }

  private syncMemberRole(memberId: string, role: string): void {
    this.memberRoles.set(memberId, role);

    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (!meta || meta.userId !== memberId) {
        continue;
      }

      meta.role = role;
      if (meta.auth) {
        meta.auth = { ...meta.auth, role };
      }
      this.setWSMeta(ws, meta);
    }
  }

  private refreshMemberSocketAttachments(memberId: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      const meta = this.getWSMeta(ws);
      if (!meta || meta.userId !== memberId) {
        continue;
      }
      this.setWSMeta(ws, meta);
    }
  }
}
