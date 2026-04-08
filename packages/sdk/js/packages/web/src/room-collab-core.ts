import { EdgeBaseError, createSubscription, type Subscription } from '@edge-base/core';
import type {
  RoomConnectionState,
  RoomMember,
  RoomReconnectInfo,
  RoomRecoveryFailureInfo,
  RoomSignalMeta,
} from './room.js';

export type RoomCollabStatus =
  | 'idle'
  | 'connecting'
  | 'syncing'
  | 'ready'
  | 'reconnecting'
  | 'degraded';

export type RoomCollabMode = 'editable' | 'read_only';

export interface RoomCollabOptions {
  format: string;
  key: string;
  initialMode?: RoomCollabMode;
  /** @deprecated Prefer initialMode. This remains as a compatibility fallback. */
  mode?: RoomCollabMode;
  syncTimeoutMs?: number;
}

export interface RoomCollabPeer {
  memberId: string;
  userId: string;
  connectionId?: string;
  role?: string;
  state: Record<string, unknown>;
  isSelf: boolean;
}

export interface RoomCollabYDocLike {
  on(event: 'update', handler: (update: Uint8Array, origin: unknown) => void): void;
  off(event: 'update', handler: (update: Uint8Array, origin: unknown) => void): void;
}

interface RoomCollabRoomLike {
  join(): Promise<void>;
  leave(): void;
  getConnectionState(): RoomConnectionState;
  members: {
    list(): RoomMember[];
    current(): RoomMember | null;
    awaitCurrent(timeoutMs?: number): Promise<RoomMember | null>;
    setState(state: Record<string, unknown>): Promise<void>;
    clearState(): Promise<void>;
    onSync(handler: (members: RoomMember[]) => void): Subscription;
    onJoin(handler: (member: RoomMember) => void): Subscription;
    onLeave(handler: (member: RoomMember, reason: string) => void): Subscription;
    onStateChange(
      handler: (member: RoomMember, state: Record<string, unknown>) => void,
    ): Subscription;
  };
  signals: {
    send(event: string, payload?: unknown, options?: { includeSelf?: boolean }): Promise<void>;
    sendTo(memberId: string, event: string, payload?: unknown): Promise<void>;
    on(event: string, handler: (payload: unknown, meta: RoomSignalMeta) => void): Subscription;
  };
  session: {
    onReconnect(handler: (info: RoomReconnectInfo) => void): Subscription;
    onConnectionStateChange(handler: (state: RoomConnectionState) => void): Subscription;
    onRecoveryFailure(handler: (info: RoomRecoveryFailureInfo) => void): Subscription;
  };
}

interface YjsRuntime {
  applyUpdate(doc: RoomCollabYDocLike, update: Uint8Array, origin?: unknown): void;
  encodeStateAsUpdate(doc: RoomCollabYDocLike): Uint8Array;
}

interface CollabSignalPayload {
  format?: unknown;
  key?: unknown;
  requestId?: unknown;
  update?: unknown;
  mode?: unknown;
  capabilityFingerprint?: unknown;
  serverSync?: unknown;
  syncSource?: unknown;
}

const ROOM_COLLAB_MEMBER_STATE_KEY = '__collab';
const ROOM_COLLAB_MEMBER_META_KEY = '__collab_meta';
const ROOM_COLLAB_CONTROL_EVENT = 'collab.control';
const ROOM_COLLAB_UPDATE_EVENT = 'collab.update';
const ROOM_COLLAB_SYNC_REQUEST_EVENT = 'collab.sync_request';
const ROOM_COLLAB_SYNC_RESPONSE_EVENT = 'collab.sync_response';
const DEFAULT_SYNC_TIMEOUT_MS = 1500;
const ROOM_COLLAB_SYNC_SOURCE_SERVER = 'server_durable';
const ROOM_COLLAB_SYNC_SOURCE_PEER = 'peer_live';

let yjsRuntimePromise: Promise<YjsRuntime> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneRecord<T extends Record<string, unknown>>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value ?? {})) as T;
}

function scopedCollabKey(format: string, key: string): string {
  return `${format}:${key}`;
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  if (typeof btoa === 'function') {
    return btoa(binary);
  }

  const globalBuffer = (globalThis as { Buffer?: { from(input: string, encoding?: string): { toString(encoding: string): string } } }).Buffer;
  if (globalBuffer) {
    return globalBuffer.from(binary, 'binary').toString('base64');
  }

  throw new EdgeBaseError(0, 'Base64 encoding is unavailable in this runtime.');
}

function decodeBase64ToBytes(value: string): Uint8Array {
  let binary = '';
  if (typeof atob === 'function') {
    binary = atob(value);
  } else {
    const globalBuffer = (globalThis as { Buffer?: { from(input: string, encoding?: string): { toString(encoding: string): string } } }).Buffer;
    if (!globalBuffer) {
      throw new EdgeBaseError(0, 'Base64 decoding is unavailable in this runtime.');
    }
    binary = globalBuffer.from(value, 'base64').toString('binary');
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function extractAwarenessRoot(memberState: Record<string, unknown>): Record<string, unknown> {
  const root = memberState[ROOM_COLLAB_MEMBER_STATE_KEY];
  return isRecord(root) ? root : {};
}

function extractMetaRoot(memberState: Record<string, unknown>): Record<string, unknown> {
  const root = memberState[ROOM_COLLAB_MEMBER_META_KEY];
  return isRecord(root) ? root : {};
}

function extractScopedAwarenessState(
  memberState: Record<string, unknown>,
  collabKey: string,
): Record<string, unknown> | null {
  const awarenessRoot = extractAwarenessRoot(memberState);
  const scopedState = awarenessRoot[collabKey];
  if (!isRecord(scopedState)) {
    return null;
  }
  return cloneRecord(scopedState);
}

function isMode(value: unknown): value is RoomCollabMode {
  return value === 'editable' || value === 'read_only';
}

function extractScopedMeta(
  memberState: Record<string, unknown>,
  collabKey: string,
): { mode?: RoomCollabMode; capabilityFingerprint?: string | null } | null {
  const metaRoot = extractMetaRoot(memberState);
  const scopedMeta = metaRoot[collabKey];
  if (!isRecord(scopedMeta)) {
    return null;
  }

  return {
    mode: isMode(scopedMeta.mode) ? scopedMeta.mode : undefined,
    capabilityFingerprint:
      typeof scopedMeta.capabilityFingerprint === 'string'
      || scopedMeta.capabilityFingerprint === null
        ? scopedMeta.capabilityFingerprint
        : undefined,
  };
}

function mapConnectionStateToCollabStatus(
  state: RoomConnectionState,
  hasSyncPending: boolean,
): RoomCollabStatus {
  switch (state) {
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'connected':
      return hasSyncPending ? 'syncing' : 'ready';
    case 'auth_lost':
    case 'kicked':
      return 'degraded';
    case 'idle':
      return 'idle';
    case 'disconnected':
      return 'degraded';
    default:
      return 'idle';
  }
}

async function loadYjsRuntime(): Promise<YjsRuntime> {
  if (!yjsRuntimePromise) {
    yjsRuntimePromise = import('yjs')
      .then((module) => ({
        applyUpdate: module.applyUpdate as YjsRuntime['applyUpdate'],
        encodeStateAsUpdate: module.encodeStateAsUpdate as YjsRuntime['encodeStateAsUpdate'],
      }))
      .catch((error: unknown) => {
        yjsRuntimePromise = null;
        const message = error instanceof Error ? error.message : 'Unknown Yjs import error';
        throw new EdgeBaseError(
          0,
          `room.collab({ format: 'yjs', ... }) requires the 'yjs' package in the application runtime. ${message}`,
        );
      });
  }

  return yjsRuntimePromise;
}

export class RoomCollabClient {
  private readonly room: RoomCollabRoomLike;
  private readonly options: Required<RoomCollabOptions>;
  private readonly collabKey: string;
  private readonly remoteOriginToken = Symbol('edgebase.room.collab.remote');
  private readonly subscriptions: Subscription[] = [];
  private readonly statusHandlers: Array<(status: RoomCollabStatus) => void> = [];
  private readonly modeHandlers: Array<(mode: RoomCollabMode) => void> = [];
  private readonly capabilityFingerprintHandlers: Array<(fingerprint: string | null) => void> = [];
  private readonly awarenessHandlers: Array<(peers: RoomCollabPeer[]) => void> = [];
  private readonly reconnectHandlers: Array<(info: RoomReconnectInfo) => void> = [];
  private readonly recoveryFailureHandlers: Array<(info: RoomRecoveryFailureInfo) => void> = [];

  private status: RoomCollabStatus = 'idle';
  private mode: RoomCollabMode;
  private capabilityFingerprint: string | null = null;
  private doc: RoomCollabYDocLike | null = null;
  private docUpdateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;
  private pendingSyncRequestId: string | null = null;
  private syncTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingSyncPromise: Promise<void> | null = null;
  private pendingSyncResolve: (() => void) | null = null;
  private pendingSyncReject: ((error: Error) => void) | null = null;
  private localAwarenessOverride: Record<string, unknown> | null = null;
  private serverSyncEnabled = false;

  readonly awareness = {
    setLocalState: (state: Record<string, unknown>) => this.setLocalAwarenessState(state),
    clearLocalState: () => this.clearLocalAwarenessState(),
    onChange: (handler: (peers: RoomCollabPeer[]) => void): Subscription => {
      this.awarenessHandlers.push(handler);
      return createSubscription(() => {
        const index = this.awarenessHandlers.indexOf(handler);
        if (index >= 0) this.awarenessHandlers.splice(index, 1);
      });
    },
    getPeers: (): RoomCollabPeer[] => this.getPeers(),
    getSelf: (): RoomCollabPeer | null => this.getSelf(),
  };

  constructor(room: RoomCollabRoomLike, options: RoomCollabOptions) {
    this.room = room;
    this.options = {
      format: options.format,
      key: options.key,
      initialMode: options.initialMode ?? options.mode ?? 'editable',
      mode: options.mode ?? options.initialMode ?? 'editable',
      syncTimeoutMs: options.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS,
    };
    this.collabKey = scopedCollabKey(this.options.format, this.options.key);
    this.mode = this.options.initialMode;
    this.status = mapConnectionStateToCollabStatus(this.room.getConnectionState(), false);

    this.subscriptions.push(
      this.room.session.onReconnect((info) => {
        for (const handler of this.reconnectHandlers) {
          handler(info);
        }
      }),
    );
    this.subscriptions.push(
      this.room.session.onConnectionStateChange((state) => {
        this.setStatus(mapConnectionStateToCollabStatus(state, this.pendingSyncRequestId !== null));
        this.refreshCapabilityState();
        if ((state === 'auth_lost' || state === 'kicked') && this.pendingSyncReject) {
          this.rejectPendingSync(
            new EdgeBaseError(401, 'Room collab lost authorization while syncing.'),
          );
        }
        if (state === 'connected' && this.doc) {
          void this.sync();
        }
      }),
    );
    this.subscriptions.push(
      this.room.session.onRecoveryFailure((info) => {
        for (const handler of this.recoveryFailureHandlers) {
          handler(info);
        }
      }),
    );
    this.subscriptions.push(this.room.members.onSync(() => {
      this.refreshCapabilityState();
      this.emitAwarenessChange();
    }));
    this.subscriptions.push(this.room.members.onJoin(() => {
      this.refreshCapabilityState();
      this.emitAwarenessChange();
    }));
    this.subscriptions.push(this.room.members.onLeave(() => {
      this.refreshCapabilityState();
      this.emitAwarenessChange();
    }));
    this.subscriptions.push(this.room.members.onStateChange(() => {
      this.refreshCapabilityState();
      this.emitAwarenessChange();
    }));
    this.subscriptions.push(
      this.room.signals.on(ROOM_COLLAB_CONTROL_EVENT, (payload, meta) => {
        this.handleControlSignal(payload, meta);
      }),
    );
    this.subscriptions.push(
      this.room.signals.on(ROOM_COLLAB_UPDATE_EVENT, (payload) => {
        void this.handleIncomingUpdate(payload);
      }),
    );
    this.subscriptions.push(
      this.room.signals.on(ROOM_COLLAB_SYNC_REQUEST_EVENT, (payload, meta) => {
        void this.handleSyncRequest(payload, meta);
      }),
    );
    this.subscriptions.push(
      this.room.signals.on(ROOM_COLLAB_SYNC_RESPONSE_EVENT, (payload) => {
        void this.handleSyncResponse(payload);
      }),
    );
  }

  getStatus(): RoomCollabStatus {
    return this.status;
  }

  getMode(): RoomCollabMode {
    return this.mode;
  }

  getCapabilityFingerprint(): string | null {
    return this.capabilityFingerprint;
  }

  onStatusChange(handler: (status: RoomCollabStatus) => void): Subscription {
    this.statusHandlers.push(handler);
    return createSubscription(() => {
      const index = this.statusHandlers.indexOf(handler);
      if (index >= 0) this.statusHandlers.splice(index, 1);
    });
  }

  onModeChange(handler: (mode: RoomCollabMode) => void): Subscription {
    this.modeHandlers.push(handler);
    return createSubscription(() => {
      const index = this.modeHandlers.indexOf(handler);
      if (index >= 0) this.modeHandlers.splice(index, 1);
    });
  }

  onCapabilityFingerprintChange(handler: (fingerprint: string | null) => void): Subscription {
    this.capabilityFingerprintHandlers.push(handler);
    return createSubscription(() => {
      const index = this.capabilityFingerprintHandlers.indexOf(handler);
      if (index >= 0) this.capabilityFingerprintHandlers.splice(index, 1);
    });
  }

  onReconnect(handler: (info: RoomReconnectInfo) => void): Subscription {
    this.reconnectHandlers.push(handler);
    return createSubscription(() => {
      const index = this.reconnectHandlers.indexOf(handler);
      if (index >= 0) this.reconnectHandlers.splice(index, 1);
    });
  }

  onRecoveryFailure(handler: (info: RoomRecoveryFailureInfo) => void): Subscription {
    this.recoveryFailureHandlers.push(handler);
    return createSubscription(() => {
      const index = this.recoveryFailureHandlers.indexOf(handler);
      if (index >= 0) this.recoveryFailureHandlers.splice(index, 1);
    });
  }

  async join(): Promise<void> {
    this.setStatus('connecting');
    await this.room.join();
    await this.waitForRoomConnection();
    this.refreshCapabilityState();
    if (this.doc) {
      await this.sync();
      return;
    }
    this.setStatus('ready');
  }

  bind(doc: RoomCollabYDocLike): void {
    if (this.doc === doc) {
      if (this.room.getConnectionState() === 'connected') {
        void this.sync();
      }
      return;
    }

    this.unbind();
    this.doc = doc;

    this.docUpdateHandler = (update, origin) => {
      if (origin === this.remoteOriginToken || this.mode === 'read_only') {
        return;
      }
      if (this.room.getConnectionState() !== 'connected') {
        return;
      }
      void this.room.signals
        .send(ROOM_COLLAB_UPDATE_EVENT, {
          format: this.options.format,
          key: this.options.key,
          update: encodeBytesToBase64(update),
        })
        .catch(() => {
          this.setStatus('degraded');
        });
    };

    doc.on('update', this.docUpdateHandler);

    if (this.room.getConnectionState() === 'connected') {
      void this.room.members.awaitCurrent(1000).then((localMember) => {
        if (localMember) {
          this.refreshCapabilityState();
          this.emitAwarenessChange();
        }
      });
      void this.requestSyncIfNeeded();
    }
  }

  unbind(): void {
    this.resolvePendingSync();
    if (this.doc && this.docUpdateHandler) {
      this.doc.off('update', this.docUpdateHandler);
    }
    this.doc = null;
    this.docUpdateHandler = null;
    if (this.room.getConnectionState() === 'connected') {
      this.setStatus('ready');
    } else {
      this.setStatus(mapConnectionStateToCollabStatus(this.room.getConnectionState(), false));
    }
  }

  async sync(): Promise<void> {
    if (!this.doc) {
      if (this.room.getConnectionState() === 'connected') {
        this.setStatus('ready');
      }
      return;
    }

    const connectionState = this.room.getConnectionState();
    if (connectionState !== 'connected') {
      await this.waitForRoomConnection();
    }

    await this.requestSyncIfNeeded();
  }

  async leave(): Promise<void> {
    this.unbind();
    this.unsubscribeAll();
    this.room.leave();
    this.setStatus('idle');
  }

  async destroy(): Promise<void> {
    await this.leave();
  }

  private async waitForRoomConnection(): Promise<void> {
    const currentState = this.room.getConnectionState();
    if (currentState === 'connected') {
      return;
    }
    if (currentState === 'auth_lost' || currentState === 'kicked') {
      throw new EdgeBaseError(401, 'Room collab could not join because the room session is unavailable.');
    }

    await new Promise<void>((resolve, reject) => {
      const subscription = this.room.session.onConnectionStateChange((state) => {
        if (state === 'connected') {
          subscription.unsubscribe();
          resolve();
          return;
        }
        if (state === 'auth_lost' || state === 'kicked') {
          subscription.unsubscribe();
          reject(new EdgeBaseError(401, 'Room collab lost authorization while connecting.'));
        }
      });
    });
  }

  private async setLocalAwarenessState(state: Record<string, unknown>): Promise<void> {
    const nextState = cloneRecord(state);
    const currentMemberState = this.room.members.current()?.state ?? {};
    const awarenessRoot = extractAwarenessRoot(currentMemberState);
    await this.room.members.setState({
      [ROOM_COLLAB_MEMBER_STATE_KEY]: {
        ...awarenessRoot,
        [this.collabKey]: nextState,
      },
    });
    this.localAwarenessOverride = nextState;
    this.emitAwarenessChange();
  }

  private async clearLocalAwarenessState(): Promise<void> {
    const currentMemberState = this.room.members.current()?.state ?? {};
    const awarenessRoot = extractAwarenessRoot(currentMemberState);
    if (!(this.collabKey in awarenessRoot)) {
      this.localAwarenessOverride = null;
      this.emitAwarenessChange();
      return;
    }

    const nextAwarenessRoot = { ...awarenessRoot };
    delete nextAwarenessRoot[this.collabKey];
    await this.room.members.setState({
      [ROOM_COLLAB_MEMBER_STATE_KEY]: nextAwarenessRoot,
    });
    this.localAwarenessOverride = null;
    this.emitAwarenessChange();
  }

  private getSelf(): RoomCollabPeer | null {
    const current = this.room.members.current();
    if (!current) {
      return null;
    }
    return this.toPeer(current, true);
  }

  private getSyncPeerCount(): number {
    const currentMember = this.room.members.current();
    const currentMemberId = currentMember?.memberId ?? null;
    const currentConnectionId = currentMember?.connectionId ?? null;

    return this.room.members
      .list()
      .filter((member) => {
        if (currentConnectionId && member.connectionId === currentConnectionId) {
          return false;
        }
        if (currentMemberId && member.memberId === currentMemberId) {
          return false;
        }
        return true;
      })
      .length;
  }

  private getPeers(): RoomCollabPeer[] {
    const currentMemberId = this.room.members.current()?.memberId ?? null;
    return this.room.members
      .list()
      .filter((member) => member.memberId !== currentMemberId)
      .map((member) => this.toPeer(member, false))
      .filter((peer): peer is RoomCollabPeer => peer !== null);
  }

  private toPeer(member: RoomMember, isSelf: boolean): RoomCollabPeer | null {
    const scopedState = isSelf && this.localAwarenessOverride
      ? cloneRecord(this.localAwarenessOverride)
      : extractScopedAwarenessState(member.state, this.collabKey);
    if (!scopedState) {
      return null;
    }
    return {
      memberId: member.memberId,
      userId: member.userId,
      connectionId: member.connectionId,
      role: member.role,
      state: scopedState,
      isSelf,
    };
  }

  private emitAwarenessChange(): void {
    const peers = this.getPeers();
    for (const handler of this.awarenessHandlers) {
      handler(peers.map((peer) => ({
        ...peer,
        state: cloneRecord(peer.state),
      })));
    }
  }

  private async requestSyncIfNeeded(): Promise<void> {
    if (this.pendingSyncPromise) {
      return this.pendingSyncPromise;
    }

    if (!this.doc) {
      this.setStatus('ready');
      return Promise.resolve();
    }

    const syncPeerCount = this.getSyncPeerCount();
    if (syncPeerCount === 0 && !this.serverSyncEnabled) {
      this.resolvePendingSync();
      this.setStatus('ready');
      return Promise.resolve();
    }

    this.resolvePendingSync();
    const requestId = `collab-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.pendingSyncPromise = new Promise<void>((resolve, reject) => {
      this.pendingSyncResolve = resolve;
      this.pendingSyncReject = reject;
    });
    this.pendingSyncRequestId = requestId;
    this.setStatus('syncing');
    this.syncTimeout = setTimeout(() => {
      if (this.pendingSyncRequestId === requestId) {
        this.resolvePendingSync();
        this.setStatus('ready');
      }
    }, this.options.syncTimeoutMs);

    void this.room.signals
      .send(ROOM_COLLAB_SYNC_REQUEST_EVENT, {
        format: this.options.format,
        key: this.options.key,
        requestId,
      })
      .catch(() => {
        this.rejectPendingSync(new EdgeBaseError(0, 'Room collab sync request failed.'));
        this.setStatus('degraded');
      });

    return this.pendingSyncPromise;
  }

  private async handleIncomingUpdate(payload: unknown): Promise<void> {
    if (!this.doc) {
      return;
    }

    const parsed = this.parsePayload(payload);
    if (!parsed || typeof parsed.update !== 'string') {
      return;
    }

    try {
      const yjs = await loadYjsRuntime();
      yjs.applyUpdate(this.doc, decodeBase64ToBytes(parsed.update), this.remoteOriginToken);
    } catch {
      this.setStatus('degraded');
    }
  }

  private handleControlSignal(payload: unknown, meta: RoomSignalMeta): void {
    if (meta.serverSent !== true || !isRecord(payload)) {
      return;
    }

    const typed = payload as CollabSignalPayload;
    if (typed.format !== this.options.format || typed.key !== this.options.key) {
      return;
    }

    if (isMode(typed.mode)) {
      this.setMode(typed.mode);
    }

    if (typeof typed.capabilityFingerprint === 'string' || typed.capabilityFingerprint === null) {
      this.setCapabilityFingerprint(typed.capabilityFingerprint);
    }

    if (typeof typed.serverSync === 'boolean') {
      const previous = this.serverSyncEnabled;
      this.serverSyncEnabled = typed.serverSync;
      if (
        typed.serverSync &&
        !previous &&
        this.doc &&
        this.room.getConnectionState() === 'connected' &&
        this.pendingSyncRequestId === null
      ) {
        void this.requestSyncIfNeeded();
      }
    }
  }

  private async handleSyncRequest(payload: unknown, meta: RoomSignalMeta): Promise<void> {
    if (!this.doc || !meta.memberId) {
      return;
    }

    const parsed = this.parsePayload(payload);
    if (!parsed || typeof parsed.requestId !== 'string') {
      return;
    }

    try {
      const yjs = await loadYjsRuntime();
      const snapshot = yjs.encodeStateAsUpdate(this.doc);
      await this.room.signals.sendTo(meta.memberId, ROOM_COLLAB_SYNC_RESPONSE_EVENT, {
        format: this.options.format,
        key: this.options.key,
        requestId: parsed.requestId,
        update: encodeBytesToBase64(snapshot),
        syncSource: ROOM_COLLAB_SYNC_SOURCE_PEER,
      });
    } catch {
      this.setStatus('degraded');
    }
  }

  private async handleSyncResponse(payload: unknown): Promise<void> {
    if (!this.doc || !this.pendingSyncRequestId) {
      return;
    }

    const parsed = this.parsePayload(payload);
    if (
      !parsed
      || typeof parsed.requestId !== 'string'
      || parsed.requestId !== this.pendingSyncRequestId
      || typeof parsed.update !== 'string'
    ) {
      return;
    }

    try {
      const yjs = await loadYjsRuntime();
      yjs.applyUpdate(this.doc, decodeBase64ToBytes(parsed.update), this.remoteOriginToken);
      const syncSource = parsed.syncSource ?? ROOM_COLLAB_SYNC_SOURCE_PEER;
      if (syncSource === ROOM_COLLAB_SYNC_SOURCE_SERVER && this.getSyncPeerCount() > 0) {
        return;
      }
      this.resolvePendingSync();
      this.setStatus('ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync apply error';
      this.rejectPendingSync(
        new EdgeBaseError(0, `Room collab sync response failed to apply. ${message}`),
      );
      this.setStatus('degraded');
    }
  }

  private parsePayload(payload: unknown): {
    requestId?: string;
    update?: string;
    syncSource?: typeof ROOM_COLLAB_SYNC_SOURCE_SERVER | typeof ROOM_COLLAB_SYNC_SOURCE_PEER;
  } | null {
    if (!isRecord(payload)) {
      return null;
    }
    const typed = payload as CollabSignalPayload;
    if (typed.format !== this.options.format || typed.key !== this.options.key) {
      return null;
    }

    return {
      requestId: typeof typed.requestId === 'string' ? typed.requestId : undefined,
      update: typeof typed.update === 'string' ? typed.update : undefined,
      syncSource:
        typed.syncSource === ROOM_COLLAB_SYNC_SOURCE_SERVER ||
        typed.syncSource === ROOM_COLLAB_SYNC_SOURCE_PEER
          ? typed.syncSource
          : undefined,
    };
  }

  private clearSyncState(): void {
    this.pendingSyncRequestId = null;
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }
    this.pendingSyncPromise = null;
    this.pendingSyncResolve = null;
    this.pendingSyncReject = null;
  }

  private resolvePendingSync(): void {
    const resolve = this.pendingSyncResolve;
    this.clearSyncState();
    resolve?.();
  }

  private rejectPendingSync(error: Error): void {
    const reject = this.pendingSyncReject;
    this.clearSyncState();
    reject?.(error);
  }

  private unsubscribeAll(): void {
    while (this.subscriptions.length > 0) {
      const subscription = this.subscriptions.pop();
      subscription?.unsubscribe();
    }
  }

  private setStatus(next: RoomCollabStatus): void {
    if (this.status === next) {
      return;
    }
    this.status = next;
    for (const handler of this.statusHandlers) {
      handler(next);
    }
  }

  private setMode(next: RoomCollabMode): void {
    if (this.mode === next) {
      return;
    }
    this.mode = next;
    for (const handler of this.modeHandlers) {
      handler(next);
    }
  }

  private setCapabilityFingerprint(next: string | null): void {
    if (this.capabilityFingerprint === next) {
      return;
    }
    this.capabilityFingerprint = next;
    for (const handler of this.capabilityFingerprintHandlers) {
      handler(next);
    }
  }

  private refreshCapabilityState(): void {
    const currentMember = this.room.members.current();
    const scopedMeta = currentMember ? extractScopedMeta(currentMember.state, this.collabKey) : null;
    this.setMode(scopedMeta?.mode ?? this.options.initialMode);
    this.setCapabilityFingerprint(scopedMeta?.capabilityFingerprint ?? null);
  }
}

export function createRoomCollab(
  room: RoomCollabRoomLike,
  options: RoomCollabOptions,
): RoomCollabClient {
  return new RoomCollabClient(room, options);
}
