import { EdgeBaseError } from '@edge-base/core';
import { createSubscription } from './room.js';
import type {
  RoomConnectDiagnostic,
  RoomMediaKind,
  RoomMediaMember,
  RoomMediaRemoteTrackEvent,
  RoomMediaTrack,
  RoomMediaTransportCapabilities,
  RoomMediaTransportCapabilityIssue,
  RoomMemberMediaState,
  RoomRealtimeIceServer,
  RoomRealtimeIceServersRequest,
  RoomRealtimeIceServersResponse,
  RoomMediaTransport,
  RoomMediaTransportConnectPayload,
  RoomMember,
  RoomMemberLeaveReason,
  RoomSignalMeta,
  Subscription,
} from './room.js';

interface RoomP2PAudioVideoControls {
  disable(): Promise<void>;
  setMuted?(muted: boolean): Promise<void>;
  enable?(payload?: { trackId?: string; deviceId?: string; providerSessionId?: string }): Promise<void>;
}

interface RoomP2PScreenControls {
  stop(): Promise<void>;
  start?(payload?: { trackId?: string; deviceId?: string; providerSessionId?: string }): Promise<void>;
}

interface RoomP2PMediaAdapter {
  media: {
    list(): RoomMediaMember[];
    audio: RoomP2PAudioVideoControls;
    video: RoomP2PAudioVideoControls;
    screen: RoomP2PScreenControls;
    devices: {
      switch(payload: {
        audioInputId?: string;
        videoInputId?: string;
        screenInputId?: string;
      }): Promise<void>;
    };
    realtime?: {
      iceServers?(payload?: RoomRealtimeIceServersRequest): Promise<RoomRealtimeIceServersResponse>;
    };
    onTrack(handler: (track: RoomMediaTrack, member: RoomMember) => void): Subscription;
    onTrackRemoved(handler: (track: RoomMediaTrack, member: RoomMember) => void): Subscription;
    onStateChange?(handler: (member: RoomMember, state: RoomMemberMediaState) => void): Subscription;
  };
  members: {
    list(): RoomMember[];
    current(): RoomMember | null;
    onSync(handler: (members: RoomMember[]) => void): Subscription;
    onJoin(handler: (member: RoomMember) => void): Subscription;
    onLeave(handler: (member: RoomMember, reason: RoomMemberLeaveReason) => void): Subscription;
  };
  checkConnection?(): Promise<RoomConnectDiagnostic>;
  signals: {
    sendTo(memberId: string, event: string, payload?: unknown): Promise<void>;
    on(event: string, handler: (payload: unknown, meta: RoomSignalMeta) => void): Subscription;
  };
}

interface LocalTrackState {
  kind: RoomMediaKind;
  track: MediaStreamTrack;
  deviceId?: string;
  stopOnCleanup: boolean;
}

interface P2PPeerState {
  memberId: string;
  pc: RTCPeerConnection;
  polite: boolean;
  bootstrapPassive: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  senders: Map<RoomMediaKind, RTCRtpSender>;
  pendingNegotiation: boolean;
  recoveryAttempts: number;
  recoveryTimer: ReturnType<typeof globalThis.setTimeout> | null;
  healthCheckInFlight: boolean;
  createdAt: number;
  signalingStateChangedAt: number;
  hasRemoteDescription: boolean;
  answeringOffer?: boolean;
  remoteVideoFlows: Map<string, {
    track: MediaStreamTrack;
    receivedAt: number;
    lastHealthyAt: number;
    lastBytesReceived: number | null;
    lastFramesDecoded: number | null;
    cleanup: () => void;
  }>;
}

type DisplayCaptureConstraints =
  NonNullable<MediaDevices['getDisplayMedia']> extends (constraints?: infer T) => Promise<MediaStream>
    ? T
    : MediaStreamConstraints;

const DEFAULT_SIGNAL_PREFIX = 'edgebase.media.p2p';
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];
const DEFAULT_MEMBER_READY_TIMEOUT_MS = 10_000;
const DEFAULT_MISSING_MEDIA_GRACE_MS = 1_200;
const DEFAULT_DISCONNECTED_RECOVERY_DELAY_MS = 1_800;
const DEFAULT_MAX_RECOVERY_ATTEMPTS = 2;
const DEFAULT_ICE_BATCH_DELAY_MS = 40;
const DEFAULT_RATE_LIMIT_RETRY_DELAYS_MS = [160, 320, 640] as const;
const DEFAULT_MEDIA_HEALTH_CHECK_INTERVAL_MS = 4_000;
const DEFAULT_VIDEO_FLOW_GRACE_MS = 8_000;
const DEFAULT_VIDEO_FLOW_STALL_GRACE_MS = 12_000;
const DEFAULT_INITIAL_NEGOTIATION_GRACE_MS = 5_000;
const DEFAULT_STUCK_SIGNALING_GRACE_MS = 2_500;
const DEFAULT_NEGOTIATION_QUEUE_SPACING_MS = 180;
const DEFAULT_SYNC_REMOVAL_GRACE_MS = 9_000;
const DEFAULT_TRACK_REMOVAL_GRACE_MS = 2_600;
const DEFAULT_PENDING_VIDEO_PROMOTION_GRACE_MS = 900;

function buildTrackKey(memberId: string, trackId: string): string {
  return `${memberId}:${trackId}`;
}

function isMediaStreamTrackLike(value: unknown): value is MediaStreamTrack {
  return Boolean(
    value
    && typeof value === 'object'
    && 'id' in value
    && 'kind' in value
    && 'readyState' in value,
  );
}

function buildExactDeviceConstraint(deviceId: string): MediaTrackConstraints {
  return { deviceId: { exact: deviceId } };
}

function normalizeTrackKind(track: MediaStreamTrack): RoomMediaKind | null {
  if (track.kind === 'audio') return 'audio';
  if (track.kind === 'video') return 'video';
  return null;
}

function serializeDescription(description: RTCSessionDescriptionInit | RTCSessionDescription): RTCSessionDescriptionInit {
  return {
    type: description.type,
    sdp: description.sdp ?? undefined,
  };
}

function serializeCandidate(candidate: RTCIceCandidate | RTCIceCandidateInit): RTCIceCandidateInit {
  if ('toJSON' in candidate && typeof candidate.toJSON === 'function') {
    return candidate.toJSON();
  }
  return candidate;
}

function normalizeIceServerUrls(urls: RTCIceServer['urls'] | string[] | string | undefined): string[] {
  if (Array.isArray(urls)) {
    return urls.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  }
  if (typeof urls === 'string' && urls.trim().length > 0) {
    return [urls];
  }
  return [];
}

function normalizeIceServers(iceServers: Array<RoomRealtimeIceServer | RTCIceServer> | undefined): RTCIceServer[] {
  if (!Array.isArray(iceServers)) {
    return [];
  }

  const normalized: RTCIceServer[] = [];
  for (const server of iceServers) {
    const urls = normalizeIceServerUrls(server?.urls);
    if (urls.length === 0) {
      continue;
    }
    normalized.push({
      urls: urls.length === 1 ? urls[0] : urls,
      username: typeof server.username === 'string' ? server.username : undefined,
      credential: typeof server.credential === 'string' ? server.credential : undefined,
    });
  }
  return normalized;
}

function getPublishedKindsFromState(state: RoomMemberMediaState | undefined): RoomMediaKind[] {
  if (!state) {
    return [];
  }

  const publishedKinds: RoomMediaKind[] = [];
  if (state.audio?.published) publishedKinds.push('audio');
  if (state.video?.published) publishedKinds.push('video');
  if (state.screen?.published) publishedKinds.push('screen');
  return publishedKinds;
}

function isStableAnswerError(error: unknown): boolean {
  const message =
    typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : '';

  return (
    message.includes('Called in wrong state: stable')
    || message.includes('Failed to set remote answer sdp')
    || (message.includes('setRemoteDescription') && message.includes('stable'))
  );
}

function isRateLimitError(error: unknown): boolean {
  const message =
    typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '');

  return message.toLowerCase().includes('rate limited');
}

function sameIceServer(candidate: RTCIceServer, urls: string[]): boolean {
  const candidateUrls = normalizeIceServerUrls(candidate.urls);
  return candidateUrls.length === urls.length && candidateUrls.every((url, index) => url === urls[index]);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }
  return 'Unknown room media error.';
}

export interface RoomP2PMediaTransportOptions {
  rtcConfiguration?: RTCConfiguration;
  peerConnectionFactory?: (configuration: RTCConfiguration) => RTCPeerConnection;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia' | 'getDisplayMedia'>;
  signalPrefix?: string;
  turnCredentialTtlSeconds?: number;
  missingMediaGraceMs?: number;
  disconnectedRecoveryDelayMs?: number;
  maxRecoveryAttempts?: number;
  mediaHealthCheckIntervalMs?: number;
  videoFlowGraceMs?: number;
  videoFlowStallGraceMs?: number;
  initialNegotiationGraceMs?: number;
  stuckSignalingGraceMs?: number;
  negotiationQueueSpacingMs?: number;
  syncRemovalGraceMs?: number;
  trackRemovalGraceMs?: number;
  pendingVideoPromotionGraceMs?: number;
}

export class RoomP2PMediaTransport implements RoomMediaTransport {
  private readonly room: RoomP2PMediaAdapter;
  private readonly options: Required<Omit<RoomP2PMediaTransportOptions, 'mediaDevices'>> & {
    mediaDevices?: Pick<MediaDevices, 'getUserMedia' | 'getDisplayMedia'>;
  };
  private readonly localTracks = new Map<RoomMediaKind, LocalTrackState>();
  private readonly peers = new Map<string, P2PPeerState>();
  private readonly remoteTrackHandlers: Array<(event: RoomMediaRemoteTrackEvent) => void> = [];
  private readonly remoteVideoStateHandlers: Array<(entries: Array<{
    participantId: string;
    memberId: string;
    userId?: string;
    displayName?: string;
    stream: MediaStream | null;
    trackId: string | null;
    published: boolean;
    isCameraOff: boolean;
    updatedAt: number;
  }>) => void> = [];
  private readonly remoteTrackKinds = new Map<string, RoomMediaKind>();
  private readonly emittedRemoteTracks = new Set<string>();
  private readonly pendingRemoteTracks = new Map<string, {
    memberId: string;
    track: MediaStreamTrack;
    stream: MediaStream;
  }>();
  private readonly pendingTrackRemovalTimers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();
  private readonly pendingSyncRemovalTimers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();
  private readonly pendingVideoPromotionTimers = new Map<string, ReturnType<typeof globalThis.setTimeout>>();
  private readonly pendingIceCandidates = new Map<string, {
    candidates: RTCIceCandidateInit[];
    timer: ReturnType<typeof globalThis.setTimeout> | null;
    flushing: boolean;
  }>();
  private readonly remoteVideoStreamCache = new Map<string, {
    trackId: string | null;
    stream: MediaStream;
    lastUsableAt: number;
  }>();
  private readonly subscriptions: Subscription[] = [];
  private localMemberId: string | null = null;
  private connected = false;
  private iceServersResolved = false;
  private localUpdateBatchDepth = 0;
  private syncAllPeerSendersScheduled = false;
  private syncAllPeerSendersPending = false;
  private healthCheckTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  private negotiationTail: Promise<void> = Promise.resolve();
  private remoteVideoStateSignature = '';
  private readonly debugEvents: Array<{
    id: number;
    at: number;
    type: string;
    details: Record<string, unknown>;
  }> = [];
  private debugEventCounter = 0;

  constructor(room: RoomP2PMediaAdapter, options?: RoomP2PMediaTransportOptions) {
    this.room = room;
    this.options = {
      rtcConfiguration: {
        ...options?.rtcConfiguration,
        iceServers:
          options?.rtcConfiguration?.iceServers && options.rtcConfiguration.iceServers.length > 0
            ? options.rtcConfiguration.iceServers
            : DEFAULT_ICE_SERVERS,
      },
      peerConnectionFactory:
        options?.peerConnectionFactory
        ?? ((configuration) => new RTCPeerConnection(configuration)),
      mediaDevices:
        options?.mediaDevices
        ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined),
      signalPrefix: options?.signalPrefix ?? DEFAULT_SIGNAL_PREFIX,
      turnCredentialTtlSeconds: options?.turnCredentialTtlSeconds ?? 3600,
      missingMediaGraceMs: options?.missingMediaGraceMs ?? DEFAULT_MISSING_MEDIA_GRACE_MS,
      disconnectedRecoveryDelayMs: options?.disconnectedRecoveryDelayMs ?? DEFAULT_DISCONNECTED_RECOVERY_DELAY_MS,
      maxRecoveryAttempts: options?.maxRecoveryAttempts ?? DEFAULT_MAX_RECOVERY_ATTEMPTS,
      mediaHealthCheckIntervalMs: options?.mediaHealthCheckIntervalMs ?? DEFAULT_MEDIA_HEALTH_CHECK_INTERVAL_MS,
      videoFlowGraceMs: options?.videoFlowGraceMs ?? DEFAULT_VIDEO_FLOW_GRACE_MS,
      videoFlowStallGraceMs: options?.videoFlowStallGraceMs ?? DEFAULT_VIDEO_FLOW_STALL_GRACE_MS,
      initialNegotiationGraceMs: options?.initialNegotiationGraceMs ?? DEFAULT_INITIAL_NEGOTIATION_GRACE_MS,
      stuckSignalingGraceMs: options?.stuckSignalingGraceMs ?? DEFAULT_STUCK_SIGNALING_GRACE_MS,
      negotiationQueueSpacingMs: options?.negotiationQueueSpacingMs ?? DEFAULT_NEGOTIATION_QUEUE_SPACING_MS,
      syncRemovalGraceMs: options?.syncRemovalGraceMs ?? DEFAULT_SYNC_REMOVAL_GRACE_MS,
      trackRemovalGraceMs: options?.trackRemovalGraceMs ?? DEFAULT_TRACK_REMOVAL_GRACE_MS,
      pendingVideoPromotionGraceMs:
        options?.pendingVideoPromotionGraceMs ?? DEFAULT_PENDING_VIDEO_PROMOTION_GRACE_MS,
    };
  }

  getSessionId(): string | null {
    return this.localMemberId;
  }

  getPeerConnection(): RTCPeerConnection | null {
    if (this.peers.size !== 1) {
      return null;
    }
    return this.peers.values().next().value?.pc ?? null;
  }

  async connect(payload?: RoomMediaTransportConnectPayload): Promise<string> {
    if (this.connected && this.localMemberId) {
      return this.localMemberId;
    }

    this.recordDebugEvent('transport:connect');
    if (payload && typeof payload === 'object' && 'sessionDescription' in payload) {
      throw new Error(
        'RoomP2PMediaTransport.connect() does not accept sessionDescription; use room.signals through the built-in transport instead.',
      );
    }

    const capabilities = await this.collectCapabilities({ includeProviderChecks: false });
    const fatalIssue = capabilities.issues.find((issue) => issue.fatal);
    if (fatalIssue) {
      const error = new EdgeBaseError(
        400,
        fatalIssue.message,
        { preflight: { code: fatalIssue.code, message: fatalIssue.message } },
        'room-media-preflight-failed',
      );
      Object.assign(error, {
        provider: capabilities.provider,
        issue: fatalIssue,
        capabilities,
      });
      throw error;
    }

    const currentMember = await this.waitForCurrentMember();
    if (!currentMember) {
      throw new Error('Join the room before connecting a P2P media transport.');
    }

    this.localMemberId = currentMember.memberId;
    await this.resolveRtcConfiguration();
    this.connected = true;
    this.hydrateRemoteTrackKinds();
    this.attachRoomSubscriptions();
    this.startHealthChecks();

    try {
      for (const member of this.room.members.list()) {
        if (member.memberId !== this.localMemberId) {
          this.ensurePeer(member.memberId);
        }
      }
      this.emitRemoteVideoStateChange(true);
    } catch (error) {
      this.rollbackConnectedState();
      throw error;
    }

    return this.localMemberId;
  }

  async getCapabilities(): Promise<RoomMediaTransportCapabilities> {
    return this.collectCapabilities({ includeProviderChecks: true });
  }

  getUsableRemoteVideoStream(memberId: string): MediaStream | null {
    const now = Date.now();
    const peer = this.peers.get(memberId);
    const connectedish = peer
      ? peer.pc.connectionState === 'connected'
        || peer.pc.iceConnectionState === 'connected'
        || peer.pc.iceConnectionState === 'completed'
      : false;
    const mediaMembers = this.room.media.list?.() ?? [];
    const mediaMember = mediaMembers.find((entry) => entry.member.memberId === memberId);
    const publishedKinds = this.getPublishedVideoLikeKinds(memberId);
    const stillPublished = publishedKinds.length > 0
      || Boolean(mediaMember?.state?.video?.published || mediaMember?.state?.screen?.published)
      || Boolean(mediaMember?.tracks.some((track) =>
        (track.kind === 'video' || track.kind === 'screen') && track.trackId,
      ));

    const flow = peer
      ? Array.from(peer.remoteVideoFlows.values())
          .filter((entry) => isMediaStreamTrackLike(entry.track) && entry.track.readyState === 'live')
          .sort((a, b) =>
            Number((b.lastHealthyAt ?? 0) > 0) - Number((a.lastHealthyAt ?? 0) > 0)
            || (b.lastHealthyAt ?? 0) - (a.lastHealthyAt ?? 0)
            || (b.receivedAt ?? 0) - (a.receivedAt ?? 0),
          )[0] ?? null
      : null;

    const track = flow?.track;
    const graceMs = Math.max(this.options.videoFlowGraceMs, this.options.videoFlowStallGraceMs);
    const connectedTrackGraceMs = Math.max(
      graceMs,
      this.options.videoFlowStallGraceMs + 6_000,
    );
    const lastObservedAt = Math.max(flow?.receivedAt ?? 0, flow?.lastHealthyAt ?? 0);
    const isRecentLiveFlow = isMediaStreamTrackLike(track)
      && track.readyState === 'live'
      && now - (flow?.receivedAt ?? 0) <= graceMs;
    const isLiveConnectedFlow = isMediaStreamTrackLike(track)
      && track.readyState === 'live'
      && connectedish
      && stillPublished
      && lastObservedAt > 0
      && now - lastObservedAt <= connectedTrackGraceMs;
    const isHealthyFlow = isMediaStreamTrackLike(track)
      && track.readyState === 'live'
      && (((flow?.lastHealthyAt ?? 0) > 0) || track.muted === false || isRecentLiveFlow || isLiveConnectedFlow);

    const cached = this.remoteVideoStreamCache.get(memberId);
    if (!isHealthyFlow || !isMediaStreamTrackLike(track)) {
      const pending = this.getPendingRemoteVideoTrack(memberId);
      if (pending) {
        this.remoteVideoStreamCache.set(memberId, {
          trackId: pending.track.id,
          stream: pending.stream,
          lastUsableAt: now,
        });
        return pending.stream;
      }

      if (cached) {
        const cachedTrack = cached.stream.getVideoTracks?.()[0]
          ?? cached.stream.getTracks?.()[0]
          ?? null;
        const cachedTrackStillLive = isMediaStreamTrackLike(cachedTrack)
          ? cachedTrack.readyState === 'live'
          : true;
        if (cachedTrackStillLive && now - cached.lastUsableAt <= graceMs) {
          return cached.stream;
        }
        if (cachedTrackStillLive && connectedish && stillPublished && now - cached.lastUsableAt <= connectedTrackGraceMs) {
          return cached.stream;
        }
      }

      this.remoteVideoStreamCache.delete(memberId);
      return null;
    }

    if (cached?.trackId === track.id) {
      cached.lastUsableAt = now;
      return cached.stream;
    }

    const stream = new MediaStream([track]);
    this.remoteVideoStreamCache.set(memberId, {
      trackId: track.id,
      stream,
      lastUsableAt: now,
    });
    return stream;
  }

  getUsableRemoteVideoEntries(): Array<{
    memberId: string;
    userId?: string;
    displayName?: string;
    stream: MediaStream | null;
    trackId: string | null;
    published: boolean;
    isCameraOff: boolean;
  }> {
    const candidateIds = new Set<string>();
    for (const memberId of this.peers.keys()) candidateIds.add(memberId);
    for (const pending of this.pendingRemoteTracks.values()) {
      if (pending?.memberId) candidateIds.add(pending.memberId);
    }
    for (const memberId of this.remoteVideoStreamCache.keys()) candidateIds.add(memberId);
    for (const mediaMember of this.room.media.list?.() ?? []) {
      if (mediaMember?.member?.memberId) candidateIds.add(mediaMember.member.memberId);
    }

    const mediaMembers = this.room.media.list?.() ?? [];
    return Array.from(candidateIds).map((memberId) => {
      const stream = this.getUsableRemoteVideoStream(memberId);
      const trackId = stream?.getVideoTracks?.()[0]?.id
        ?? stream?.getTracks?.()[0]?.id
        ?? null;
      const participant = this.findMember(memberId);
      const displayName = typeof participant?.state?.displayName === 'string'
        ? participant.state.displayName
        : undefined;
      const published = this.getPublishedVideoLikeKinds(memberId).length > 0
        || mediaMembers.some((entry) => {
          if (entry?.member?.memberId !== memberId) return false;
          return Boolean(
            entry?.state?.video?.published
            || entry?.state?.screen?.published
            || entry?.tracks?.some((track) =>
              (track.kind === 'video' || track.kind === 'screen') && track.trackId,
            ),
          );
        });

      return {
        memberId,
        userId: participant?.userId,
        displayName,
        stream,
        trackId,
        published,
        isCameraOff: !(published || stream instanceof MediaStream),
      };
    });
  }

  getRemoteVideoStates(): Array<{
    participantId: string;
    memberId: string;
    userId?: string;
    displayName?: string;
    stream: MediaStream | null;
    trackId: string | null;
    published: boolean;
    isCameraOff: boolean;
    updatedAt: number;
  }> {
    const now = Date.now();
    return this.getUsableRemoteVideoEntries().map((entry) => ({
      participantId: entry.memberId,
      updatedAt: now,
      ...entry,
    }));
  }

  getActiveRemoteMemberIds(): string[] {
    return this.getRemoteVideoStates()
      .filter((entry) => entry.stream instanceof MediaStream || entry.published)
      .map((entry) => entry.memberId);
  }

  private async collectCapabilities(
    options: { includeProviderChecks: boolean },
  ): Promise<RoomMediaTransportCapabilities> {
    const issues: RoomMediaTransportCapabilityIssue[] = [];
    const currentMember = this.room.members.current();
    const roomIssueFatal = !currentMember;
    let room: RoomConnectDiagnostic = {
      ok: true,
      type: 'room_connect_ready',
      category: 'ready',
      message: 'Room WebSocket preflight passed',
    };

    if (typeof this.room.checkConnection === 'function') {
      try {
        room = await this.room.checkConnection();
      } catch (error) {
        issues.push({
          code: 'room_connect_check_failed',
          category: 'room',
          message: `Room connect-check failed: ${getErrorMessage(error)}`,
          fatal: roomIssueFatal,
        });
      }
    }

    if (!room.ok) {
      issues.push({
        code: room.type,
        category: 'room',
        message: room.message,
        fatal: roomIssueFatal,
      });
    }

    if (!currentMember) {
      issues.push({
        code: 'room_member_not_joined',
        category: 'room',
        message: 'Join the room before connecting a P2P media transport.',
        fatal: true,
      });
    }

    const browser = {
      mediaDevices: !!this.options.mediaDevices,
      getUserMedia: typeof this.options.mediaDevices?.getUserMedia === 'function',
      getDisplayMedia: typeof this.options.mediaDevices?.getDisplayMedia === 'function',
      enumerateDevices: typeof (this.options.mediaDevices as MediaDevices | undefined)?.enumerateDevices === 'function',
      rtcPeerConnection:
        typeof this.options.peerConnectionFactory === 'function'
        || typeof RTCPeerConnection !== 'undefined',
    };

    if (!browser.rtcPeerConnection) {
      issues.push({
        code: 'webrtc_unavailable',
        category: 'browser',
        message: 'RTCPeerConnection is not available in this environment.',
        fatal: true,
      });
    }
    if (!browser.getUserMedia) {
      issues.push({
        code: 'media_devices_get_user_media_unavailable',
        category: 'browser',
        message: 'getUserMedia() is not available; local audio/video capture will be unavailable.',
        fatal: false,
      });
    }
    if (!browser.getDisplayMedia) {
      issues.push({
        code: 'media_devices_get_display_media_unavailable',
        category: 'browser',
        message: 'getDisplayMedia() is not available; screen sharing will be unavailable.',
        fatal: false,
      });
    }

    let turn: RoomMediaTransportCapabilities['turn'] | undefined;
    const loadIceServers = this.room.media.realtime?.iceServers;
    if (options.includeProviderChecks && typeof loadIceServers === 'function') {
      turn = {
        requested: true,
        available: false,
        iceServerCount: 0,
      };
      try {
        const response = await loadIceServers({ ttl: this.options.turnCredentialTtlSeconds });
        const servers = normalizeIceServers(response?.iceServers);
        turn.available = servers.length > 0;
        turn.iceServerCount = servers.length;
        if (!turn.available) {
          issues.push({
            code: 'turn_credentials_unavailable',
            category: 'provider',
            message: 'No TURN credentials were returned; the transport will fall back to its configured ICE servers.',
            fatal: false,
          });
        }
      } catch (error) {
        turn.error = getErrorMessage(error);
        issues.push({
          code: 'turn_credentials_failed',
          category: 'provider',
          message: `Failed to resolve TURN credentials: ${turn.error}`,
          fatal: false,
        });
      }
    }

    return {
      provider: 'p2p',
      canConnect: !issues.some((issue) => issue.fatal),
      issues,
      room,
      joined: !!currentMember,
      currentMemberId: currentMember?.memberId ?? null,
      sessionId: this.getSessionId(),
      browser,
      turn,
    };
  }

  private async waitForCurrentMember(timeoutMs = DEFAULT_MEMBER_READY_TIMEOUT_MS): Promise<RoomMember | null> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const member = this.room.members.current();
      if (member) {
        return member;
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 50));
    }

    return this.room.members.current();
  }

  private async resolveRtcConfiguration(): Promise<void> {
    if (this.iceServersResolved) {
      return;
    }

    const loadIceServers = this.room.media.realtime?.iceServers;
    if (typeof loadIceServers !== 'function') {
      this.iceServersResolved = true;
      return;
    }

    try {
      const response = await loadIceServers({ ttl: this.options.turnCredentialTtlSeconds });
      const realtimeIceServers = normalizeIceServers(response?.iceServers);
      if (realtimeIceServers.length === 0) {
        return;
      }

      const fallbackIceServers = normalizeIceServers(DEFAULT_ICE_SERVERS as RoomRealtimeIceServer[]);
      const mergedIceServers = [
        ...realtimeIceServers,
        ...fallbackIceServers.filter((server) => {
          const urls = normalizeIceServerUrls(server.urls);
          return !realtimeIceServers.some((candidate) => sameIceServer(candidate, urls));
        }),
      ];

      this.options.rtcConfiguration = {
        ...this.options.rtcConfiguration,
        iceServers: mergedIceServers,
      };
      this.iceServersResolved = true;
    } catch (error) {
      console.warn(
        '[RoomP2PMediaTransport] Failed to load TURN / ICE credentials. Falling back to default STUN.',
        error,
      );
    }
  }

  async enableAudio(constraints: MediaTrackConstraints | boolean = true): Promise<MediaStreamTrack> {
    const track = await this.createUserMediaTrack('audio', constraints);
    if (!track) {
      throw new Error('P2P transport could not create a local audio track.');
    }

    const providerSessionId = await this.ensureConnectedMemberId();
    this.rememberLocalTrack('audio', track, track.getSettings().deviceId, true);
    await this.withRateLimitRetry('enable audio', () =>
      this.room.media.audio.enable?.({
        trackId: track.id,
        deviceId: track.getSettings().deviceId,
        providerSessionId,
      }) ?? Promise.resolve(),
    );
    this.requestSyncAllPeerSenders();
    return track;
  }

  async enableVideo(constraints: MediaTrackConstraints | boolean = true): Promise<MediaStreamTrack> {
    const track = await this.createUserMediaTrack('video', constraints);
    if (!track) {
      throw new Error('P2P transport could not create a local video track.');
    }

    const providerSessionId = await this.ensureConnectedMemberId();
    this.rememberLocalTrack('video', track, track.getSettings().deviceId, true);
    await this.withRateLimitRetry('enable video', () =>
      this.room.media.video.enable?.({
        trackId: track.id,
        deviceId: track.getSettings().deviceId,
        providerSessionId,
      }) ?? Promise.resolve(),
    );
    this.requestSyncAllPeerSenders();
    return track;
  }

  async startScreenShare(
    constraints: DisplayCaptureConstraints = { video: true, audio: false },
  ): Promise<MediaStreamTrack> {
    const devices = this.options.mediaDevices;
    if (!devices?.getDisplayMedia) {
      throw new Error('Screen sharing is not available in this environment.');
    }

    const stream = await devices.getDisplayMedia(constraints);
    const track = stream.getVideoTracks()[0] ?? null;
    if (!track) {
      throw new Error('P2P transport could not create a screen-share track.');
    }

    track.addEventListener('ended', () => {
      void this.stopScreenShare();
    }, { once: true });

    const providerSessionId = await this.ensureConnectedMemberId();
    this.rememberLocalTrack('screen', track, track.getSettings().deviceId, true);
    await this.withRateLimitRetry('start screen share', () =>
      this.room.media.screen.start?.({
        trackId: track.id,
        deviceId: track.getSettings().deviceId,
        providerSessionId,
      }) ?? Promise.resolve(),
    );
    this.requestSyncAllPeerSenders();
    return track;
  }

  async disableAudio(): Promise<void> {
    this.releaseLocalTrack('audio');
    this.requestSyncAllPeerSenders();
    await this.withRateLimitRetry('disable audio', () => this.room.media.audio.disable());
  }

  async disableVideo(): Promise<void> {
    this.releaseLocalTrack('video');
    this.requestSyncAllPeerSenders();
    await this.withRateLimitRetry('disable video', () => this.room.media.video.disable());
  }

  async stopScreenShare(): Promise<void> {
    this.releaseLocalTrack('screen');
    this.requestSyncAllPeerSenders();
    await this.withRateLimitRetry('stop screen share', () => this.room.media.screen.stop());
  }

  async setMuted(kind: Extract<RoomMediaKind, 'audio' | 'video'>, muted: boolean): Promise<void> {
    const localTrack = this.localTracks.get(kind)?.track;
    if (localTrack) {
      localTrack.enabled = !muted;
    }

    if (kind === 'audio') {
      await this.withRateLimitRetry('set audio muted', () =>
        this.room.media.audio.setMuted?.(muted) ?? Promise.resolve(),
      );
    } else {
      await this.withRateLimitRetry('set video muted', () =>
        this.room.media.video.setMuted?.(muted) ?? Promise.resolve(),
      );
    }
  }

  async batchLocalUpdates<T>(callback: () => Promise<T>): Promise<T> {
    this.localUpdateBatchDepth += 1;
    try {
      return await callback();
    } finally {
      this.localUpdateBatchDepth = Math.max(0, this.localUpdateBatchDepth - 1);
      if (this.localUpdateBatchDepth === 0 && this.syncAllPeerSendersPending) {
        this.syncAllPeerSendersPending = false;
        this.requestSyncAllPeerSenders();
      }
    }
  }

  async switchDevices(payload: {
    audioInputId?: string;
    videoInputId?: string;
    screenInputId?: string;
  }): Promise<void> {
    if (payload.audioInputId && this.localTracks.has('audio')) {
      const nextAudioTrack = await this.createUserMediaTrack('audio', buildExactDeviceConstraint(payload.audioInputId));
      if (nextAudioTrack) {
        this.rememberLocalTrack('audio', nextAudioTrack, payload.audioInputId, true);
      }
    }

    if (payload.videoInputId && this.localTracks.has('video')) {
      const nextVideoTrack = await this.createUserMediaTrack('video', buildExactDeviceConstraint(payload.videoInputId));
      if (nextVideoTrack) {
        this.rememberLocalTrack('video', nextVideoTrack, payload.videoInputId, true);
      }
    }

    this.syncAllPeerSenders();
    await this.room.media.devices.switch(payload);
  }

  onRemoteTrack(handler: (event: RoomMediaRemoteTrackEvent) => void): Subscription {
    this.remoteTrackHandlers.push(handler);
    return createSubscription(() => {
      const index = this.remoteTrackHandlers.indexOf(handler);
      if (index >= 0) {
        this.remoteTrackHandlers.splice(index, 1);
      }
    });
  }

  onRemoteVideoStateChange(
    handler: (entries: Array<{
      participantId: string;
      memberId: string;
      userId?: string;
      displayName?: string;
      stream: MediaStream | null;
      trackId: string | null;
      published: boolean;
      isCameraOff: boolean;
      updatedAt: number;
    }>) => void,
  ): Subscription {
    this.remoteVideoStateHandlers.push(handler);
    try {
      handler(this.getRemoteVideoStates());
    } catch {
      // Ignore eager remote video state handler failures.
    }
    return createSubscription(() => {
      const index = this.remoteVideoStateHandlers.indexOf(handler);
      if (index >= 0) {
        this.remoteVideoStateHandlers.splice(index, 1);
      }
    });
  }

  getDebugSnapshot(): unknown {
    return {
      localMemberId: this.localMemberId ?? null,
      connected: Boolean(this.connected),
      iceServersResolved: Boolean(this.iceServersResolved),
      localTracks: Array.from(this.localTracks.entries()).map(([kind, localTrack]) => ({
        kind,
        trackId: localTrack.track?.id ?? null,
        readyState: localTrack.track?.readyState ?? null,
        enabled: localTrack.track?.enabled ?? null,
      })),
      peers: Array.from(this.peers.values()).map((peer) => ({
        memberId: peer.memberId,
        polite: peer.polite,
        makingOffer: peer.makingOffer,
        ignoreOffer: peer.ignoreOffer,
        pendingNegotiation: peer.pendingNegotiation,
        recoveryAttempts: peer.recoveryAttempts,
        signalingState: peer.pc?.signalingState ?? null,
        connectionState: peer.pc?.connectionState ?? null,
        iceConnectionState: peer.pc?.iceConnectionState ?? null,
        senderKinds: Array.from(peer.senders.keys()),
        senderTrackIds: Array.from(peer.senders.values()).map((sender) => sender.track?.id ?? null),
        receiverTrackIds: peer.pc?.getReceivers?.().map((receiver) => receiver.track?.id ?? null) ?? [],
        receiverTrackKinds: peer.pc?.getReceivers?.().map((receiver) => receiver.track?.kind ?? null) ?? [],
        pendingCandidates: peer.pendingCandidates?.length ?? 0,
        remoteVideoFlows: Array.from(peer.remoteVideoFlows.values()).map((flow) => ({
          trackId: flow.track?.id ?? null,
          readyState: flow.track?.readyState ?? null,
          muted: flow.track?.muted ?? null,
          receivedAt: flow.receivedAt ?? null,
          lastHealthyAt: flow.lastHealthyAt ?? null,
        })),
      })),
      pendingRemoteTracks: Array.from(this.pendingRemoteTracks.values()).map((pending) => ({
        memberId: pending.memberId,
        trackId: pending.track?.id ?? null,
        trackKind: pending.track?.kind ?? null,
        readyState: pending.track?.readyState ?? null,
        muted: pending.track?.muted ?? null,
      })),
      remoteTrackKinds: Array.from(this.remoteTrackKinds.entries()),
      emittedRemoteTracks: Array.from(this.emittedRemoteTracks.values()),
      recentEvents: this.debugEvents.slice(-120),
    };
  }

  destroy(): void {
    this.connected = false;
    this.localMemberId = null;
    if (this.healthCheckTimer != null) {
      globalThis.clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    for (const subscription of this.subscriptions.splice(0)) {
      subscription.unsubscribe();
    }
    for (const peer of this.peers.values()) {
      this.destroyPeer(peer);
    }
    this.peers.clear();
    for (const kind of Array.from(this.localTracks.keys())) {
      this.releaseLocalTrack(kind);
    }
    for (const pending of this.pendingIceCandidates.values()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
    }
    for (const timer of this.pendingTrackRemovalTimers.values()) {
      globalThis.clearTimeout(timer);
    }
    for (const timer of this.pendingSyncRemovalTimers.values()) {
      globalThis.clearTimeout(timer);
    }
    for (const timer of this.pendingVideoPromotionTimers.values()) {
      globalThis.clearTimeout(timer);
    }
    this.pendingTrackRemovalTimers.clear();
    this.pendingSyncRemovalTimers.clear();
    this.pendingVideoPromotionTimers.clear();
    this.pendingIceCandidates.clear();
    this.remoteTrackKinds.clear();
    this.emittedRemoteTracks.clear();
    this.pendingRemoteTracks.clear();
    this.remoteVideoStreamCache.clear();
    this.emitRemoteVideoStateChange(true);
  }

  private attachRoomSubscriptions(): void {
    if (this.subscriptions.length > 0) {
      return;
    }

    this.subscriptions.push(
      this.room.members.onJoin((member) => {
        if (member.memberId !== this.localMemberId) {
          this.cancelPendingSyncRemoval(member.memberId);
          this.ensurePeer(member.memberId, { passive: true });
          this.emitRemoteVideoStateChange();
        }
      }),
      this.room.members.onSync((members) => {
        const activeMemberIds = new Set<string>();
        for (const member of members) {
          if (member.memberId !== this.localMemberId) {
            activeMemberIds.add(member.memberId);
            this.cancelPendingSyncRemoval(member.memberId);
            this.ensurePeer(member.memberId, { passive: true });
          }
        }
        for (const memberId of Array.from(this.peers.keys())) {
          if (!activeMemberIds.has(memberId)) {
            this.scheduleSyncRemoval(memberId);
          }
        }
        this.emitRemoteVideoStateChange();
      }),
      this.room.members.onLeave((member) => {
        this.cancelPendingSyncRemoval(member.memberId);
        this.removeRemoteMember(member.memberId);
        this.emitRemoteVideoStateChange();
      }),
      this.room.signals.on(this.offerEvent, (payload, meta) => {
        void this.handleDescriptionSignal('offer', payload, meta);
      }),
      this.room.signals.on(this.answerEvent, (payload, meta) => {
        void this.handleDescriptionSignal('answer', payload, meta);
      }),
      this.room.signals.on(this.iceEvent, (payload, meta) => {
        void this.handleIceSignal(payload, meta);
      }),
      this.room.media.onTrack((track, member) => {
        if (member.memberId !== this.localMemberId) {
          this.ensurePeer(member.memberId, { passive: true });
          this.schedulePeerRecoveryCheck(member.memberId, 'media-track');
        }
        this.rememberRemoteTrackKind(track, member);
        this.emitRemoteVideoStateChange();
      }),
      this.room.media.onTrackRemoved((track, member) => {
        if (!track.trackId) return;
        this.scheduleTrackRemoval(track, member);
        this.emitRemoteVideoStateChange();
      }),
    );

    if (typeof this.room.media.onStateChange === 'function') {
      this.subscriptions.push(
        this.room.media.onStateChange((member, state) => {
          if (member.memberId === this.localMemberId) {
            return;
          }
          this.ensurePeer(member.memberId, { passive: true });
          this.rememberRemoteTrackKindsFromState(member, state);
          this.schedulePeerRecoveryCheck(member.memberId, 'media-state');
          this.emitRemoteVideoStateChange();
        }),
      );
    }
  }

  private hydrateRemoteTrackKinds(): void {
    this.remoteTrackKinds.clear();
    this.emittedRemoteTracks.clear();
    this.pendingRemoteTracks.clear();

    for (const mediaMember of this.room.media.list()) {
      for (const track of mediaMember.tracks) {
        this.rememberRemoteTrackKind(track, mediaMember.member);
      }
      this.rememberRemoteTrackKindsFromState(mediaMember.member, mediaMember.state);
    }
  }

  private rememberRemoteTrackKindsFromState(member: RoomMember, state: RoomMemberMediaState | undefined): void {
    if (member.memberId === this.localMemberId || !state) {
      return;
    }

    const mediaKinds: RoomMediaKind[] = ['audio', 'video', 'screen'];
    for (const kind of mediaKinds) {
      const kindState = state[kind];
      if (!kindState?.published) {
        continue;
      }

      if (typeof kindState.trackId === 'string' && kindState.trackId) {
        this.rememberRemoteTrackKind(
          {
            kind,
            trackId: kindState.trackId,
            muted: kindState.muted === true,
            deviceId: kindState.deviceId,
            publishedAt: kindState.publishedAt,
            adminDisabled: kindState.adminDisabled,
            providerSessionId: kindState.providerSessionId,
          },
          member,
        );
        continue;
      }

      this.flushPendingRemoteTracks(member.memberId, kind);
    }
  }

  private rememberRemoteTrackKind(track: RoomMediaTrack, member: RoomMember): void {
    if (!track.trackId || member.memberId === this.localMemberId) {
      return;
    }

    const key = buildTrackKey(member.memberId, track.trackId);
    this.remoteTrackKinds.set(key, track.kind);
    const pending = this.pendingRemoteTracks.get(key);
    if (pending) {
      this.pendingRemoteTracks.delete(key);
      this.clearPendingVideoPromotionTimer(key);
      this.emitRemoteTrack(member.memberId, pending.track, pending.stream, track.kind);
      return;
    }
    this.flushPendingRemoteTracks(member.memberId, track.kind);
  }

  private ensurePeer(memberId: string, options?: { passive?: boolean }): P2PPeerState {
    const passive = options?.passive === true;
    const existing = this.peers.get(memberId);
    if (existing) {
      if (!passive) {
        existing.bootstrapPassive = false;
        this.syncPeerSenders(existing);
      }
      return existing;
    }

    const pc = this.options.peerConnectionFactory(this.options.rtcConfiguration);
    const peer: P2PPeerState = {
      memberId,
      pc,
      polite: !!this.localMemberId && this.localMemberId.localeCompare(memberId) > 0,
      bootstrapPassive: passive,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      pendingCandidates: [],
      senders: new Map<RoomMediaKind, RTCRtpSender>(),
      pendingNegotiation: false,
      recoveryAttempts: 0,
      recoveryTimer: null,
      healthCheckInFlight: false,
      createdAt: Date.now(),
      signalingStateChangedAt: Date.now(),
      hasRemoteDescription: false,
      remoteVideoFlows: new Map(),
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        void this.flushPendingIceCandidates(memberId);
        return;
      }
      this.queueIceCandidate(memberId, serializeCandidate(event.candidate));
    };

    pc.onnegotiationneeded = () => {
      if (peer.bootstrapPassive && !peer.hasRemoteDescription && peer.pc.signalingState === 'stable') {
        return;
      }
      void this.negotiatePeer(peer);
    };

    pc.onsignalingstatechange = () => {
      peer.signalingStateChangedAt = Date.now();
      this.maybeRetryPendingNegotiation(peer);
    };

    pc.oniceconnectionstatechange = () => {
      this.handlePeerConnectivityChange(peer, 'ice');
    };

    pc.onconnectionstatechange = () => {
      this.handlePeerConnectivityChange(peer, 'connection');
      this.maybeRetryPendingNegotiation(peer);
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      const key = buildTrackKey(memberId, event.track.id);
      const exactKind = this.remoteTrackKinds.get(key);
      const fallbackKind = exactKind ? null : this.resolveFallbackRemoteTrackKind(memberId, event.track);
      const kind = exactKind ?? fallbackKind ?? normalizeTrackKind(event.track);

      if (!kind || (!exactKind && !fallbackKind && kind === 'video' && event.track.kind === 'video')) {
        this.pendingRemoteTracks.set(key, { memberId, track: event.track, stream });
        this.schedulePendingVideoPromotion(memberId, event.track, stream);
        return;
      }

      this.clearPendingVideoPromotionTimer(key);
      this.emitRemoteTrack(memberId, event.track, stream, kind);
      this.registerPeerRemoteTrack(peer, event.track, kind);
      this.resetPeerRecovery(peer);
    };

    this.peers.set(memberId, peer);
    if (!peer.bootstrapPassive) {
      this.syncPeerSenders(peer);
      this.schedulePeerRecoveryCheck(memberId, 'peer-created');
    }
    return peer;
  }

  private async negotiatePeer(peer: P2PPeerState): Promise<void> {
    if (peer.answeringOffer) {
      peer.pendingNegotiation = false;
      return;
    }

    const runNegotiation = async (): Promise<void> => {
      if (!this.connected || peer.pc.connectionState === 'closed') {
        return;
      }

      if (
        peer.makingOffer
        || peer.isSettingRemoteAnswerPending
        || peer.pc.signalingState !== 'stable'
      ) {
        peer.pendingNegotiation = true;
        return;
      }

      try {
        peer.pendingNegotiation = false;
        peer.makingOffer = true;
        await peer.pc.setLocalDescription();
        const localDescription = peer.pc.localDescription;
        const signalingState = peer.pc.signalingState as RTCSignalingState;
        if (!localDescription) {
          return;
        }
        if (
          localDescription.type !== 'offer'
          || signalingState !== 'have-local-offer'
        ) {
          return;
        }
        await this.sendSignalWithRetry(peer.memberId, this.offerEvent, {
          description: serializeDescription(localDescription),
        });
      } catch (error) {
        console.warn('[RoomP2PMediaTransport] Failed to negotiate peer offer.', {
          memberId: peer.memberId,
          signalingState: peer.pc.signalingState,
          error,
        });
      } finally {
        peer.makingOffer = false;
        this.maybeRetryPendingNegotiation(peer);
      }
    };

    const shouldSerializeBootstrap =
      !peer.hasRemoteDescription
      && (peer.pc.connectionState === 'new' || peer.pc.connectionState === 'connecting');

    if (!shouldSerializeBootstrap) {
      await runNegotiation();
      return;
    }

    const bootstrapQueue = peer as P2PPeerState & { bootstrapNegotiationQueued?: boolean };
    if (bootstrapQueue.bootstrapNegotiationQueued) {
      peer.pendingNegotiation = true;
      return;
    }

    bootstrapQueue.bootstrapNegotiationQueued = true;
    const queuedRun = this.negotiationTail
      .catch(() => {})
      .then(async () => {
        await runNegotiation();
        await new Promise((resolve) => globalThis.setTimeout(resolve, this.options.negotiationQueueSpacingMs));
      })
      .finally(() => {
        bootstrapQueue.bootstrapNegotiationQueued = false;
      });

    this.negotiationTail = queuedRun;
    await queuedRun;
  }

  private async handleDescriptionSignal(
    expectedType: 'offer' | 'answer',
    payload: unknown,
    meta: RoomSignalMeta,
  ): Promise<void> {
    const senderId = typeof meta.memberId === 'string' && meta.memberId.trim() ? meta.memberId.trim() : '';
    if (!senderId || senderId === this.localMemberId) {
      return;
    }

    const description = this.normalizeDescription(payload);
    if (!description || description.type !== expectedType) {
      return;
    }

    const peer = this.ensurePeer(senderId);
    const readyForOffer =
      !peer.makingOffer && (peer.pc.signalingState === 'stable' || peer.isSettingRemoteAnswerPending);
    const offerCollision = description.type === 'offer' && !readyForOffer;
    peer.ignoreOffer = !peer.polite && offerCollision;
    if (peer.ignoreOffer) {
      return;
    }

    try {
      if (
        description.type === 'answer'
        && peer.pc.signalingState === 'stable'
        && !peer.isSettingRemoteAnswerPending
      ) {
        return;
      }

      if (
        description.type === 'offer'
        && offerCollision
        && peer.polite
        && peer.pc.signalingState !== 'stable'
      ) {
        await peer.pc.setLocalDescription({ type: 'rollback' });
      }

      peer.isSettingRemoteAnswerPending = description.type === 'answer';
      await peer.pc.setRemoteDescription(description);
      peer.hasRemoteDescription = true;
      peer.bootstrapPassive = false;
      peer.isSettingRemoteAnswerPending = false;
      await this.flushPendingCandidates(peer);

      if (description.type === 'offer') {
        peer.answeringOffer = true;
        try {
          this.syncPeerSenders(peer);
          await peer.pc.setLocalDescription();
          const localDescription = peer.pc.localDescription;
          if (!localDescription) {
            return;
          }
          if (localDescription.type !== 'answer') {
            return;
          }
          await this.sendSignalWithRetry(senderId, this.answerEvent, {
            description: serializeDescription(localDescription),
          });
        } finally {
          peer.answeringOffer = false;
          peer.pendingNegotiation = false;
        }
      }
    } catch (error) {
      if (description.type === 'answer' && peer.pc.signalingState === 'stable' && isStableAnswerError(error)) {
        return;
      }
      console.warn('[RoomP2PMediaTransport] Failed to apply remote session description.', {
        memberId: senderId,
        expectedType,
        signalingState: peer.pc.signalingState,
        error,
      });
      peer.isSettingRemoteAnswerPending = false;
    } finally {
      this.maybeRetryPendingNegotiation(peer);
    }
  }

  private async handleIceSignal(payload: unknown, meta: RoomSignalMeta): Promise<void> {
    const senderId = typeof meta.memberId === 'string' && meta.memberId.trim() ? meta.memberId.trim() : '';
    if (!senderId || senderId === this.localMemberId) {
      return;
    }

    const candidates = this.normalizeCandidates(payload);
    if (candidates.length === 0) {
      return;
    }

    const peer = this.ensurePeer(senderId);
    if (!peer.pc.remoteDescription) {
      peer.pendingCandidates.push(...candidates);
      return;
    }

    for (const candidate of candidates) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch (error) {
        console.warn('[RoomP2PMediaTransport] Failed to add ICE candidate.', {
          memberId: senderId,
          error,
        });
        if (!peer.ignoreOffer) {
          peer.pendingCandidates.push(candidate);
        }
      }
    }
  }

  private async flushPendingCandidates(peer: P2PPeerState): Promise<void> {
    if (!peer.pc.remoteDescription || peer.pendingCandidates.length === 0) {
      return;
    }

    const pending = [...peer.pendingCandidates];
    peer.pendingCandidates.length = 0;
    for (const candidate of pending) {
      try {
        await peer.pc.addIceCandidate(candidate);
      } catch (error) {
        console.warn('[RoomP2PMediaTransport] Failed to flush pending ICE candidate.', {
          memberId: peer.memberId,
          error,
        });
        if (!peer.ignoreOffer) {
          peer.pendingCandidates.push(candidate);
        }
      }
    }
  }

  private queueIceCandidate(memberId: string, candidate: RTCIceCandidateInit): void {
    let pending = this.pendingIceCandidates.get(memberId);
    if (!pending) {
      pending = {
        candidates: [],
        timer: null,
        flushing: false,
      };
      this.pendingIceCandidates.set(memberId, pending);
    }

    pending.candidates.push(candidate);
    if (pending.timer || pending.flushing) {
      return;
    }

    pending.timer = globalThis.setTimeout(() => {
      pending!.timer = null;
      void this.flushPendingIceCandidates(memberId);
    }, DEFAULT_ICE_BATCH_DELAY_MS);
  }

  private async flushPendingIceCandidates(memberId: string): Promise<void> {
    const pending = this.pendingIceCandidates.get(memberId);
    if (!pending || pending.flushing) {
      return;
    }

    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }

    if (pending.candidates.length === 0) {
      this.pendingIceCandidates.delete(memberId);
      return;
    }

    const batch = pending.candidates.splice(0);
    pending.flushing = true;
    try {
      await this.sendSignalWithRetry(memberId, this.iceEvent, { candidates: batch });
    } finally {
      pending.flushing = false;
      if (pending.candidates.length > 0) {
        pending.timer = globalThis.setTimeout(() => {
          pending!.timer = null;
          void this.flushPendingIceCandidates(memberId);
        }, 0);
      } else {
        this.pendingIceCandidates.delete(memberId);
      }
    }
  }

  private requestSyncAllPeerSenders(): void {
    if (this.localUpdateBatchDepth > 0) {
      this.syncAllPeerSendersPending = true;
      return;
    }

    if (this.syncAllPeerSendersScheduled) {
      this.syncAllPeerSendersPending = true;
      return;
    }

    this.syncAllPeerSendersScheduled = true;
    queueMicrotask(() => {
      this.syncAllPeerSendersScheduled = false;
      this.syncAllPeerSendersPending = false;
      this.syncAllPeerSenders();
    });
  }

  private syncAllPeerSenders(): void {
    for (const peer of this.peers.values()) {
      this.syncPeerSenders(peer);
    }
  }

  private syncPeerSenders(peer: P2PPeerState): void {
    const activeKinds = new Set<RoomMediaKind>();
    let changed = false;

    for (const [kind, localTrack] of this.localTracks.entries()) {
      activeKinds.add(kind);
      const sender = peer.senders.get(kind);
      if (sender) {
        if (sender.track !== localTrack.track) {
          void sender.replaceTrack(localTrack.track);
          changed = true;
        }
        continue;
      }

      const addedSender = peer.pc.addTrack(localTrack.track, new MediaStream([localTrack.track]));
      peer.senders.set(kind, addedSender);
      changed = true;
    }

    for (const [kind, sender] of Array.from(peer.senders.entries())) {
      if (activeKinds.has(kind)) {
        continue;
      }
      try {
        peer.pc.removeTrack(sender);
      } catch {
        // Ignore duplicate removals during shutdown.
      }
      peer.senders.delete(kind);
      changed = true;
    }

    if (changed) {
      void this.negotiatePeer(peer);
    }
  }

  private emitRemoteTrack(
    memberId: string,
    track: MediaStreamTrack,
    stream: MediaStream,
    kind: RoomMediaKind,
  ): void {
    const key = buildTrackKey(memberId, track.id);
    if (this.emittedRemoteTracks.has(key)) {
      return;
    }

    this.emittedRemoteTracks.add(key);
    this.remoteTrackKinds.set(key, kind);
    const participant = this.findMember(memberId);
    const payload: RoomMediaRemoteTrackEvent = {
      kind,
      track,
      stream,
      trackName: track.id,
      providerSessionId: memberId,
      memberId,
      participantId: memberId,
      userId: participant?.userId,
      displayName:
        typeof participant?.state?.displayName === 'string'
          ? participant.state.displayName
          : undefined,
    };

    for (const handler of this.remoteTrackHandlers) {
      handler(payload);
    }

    const peer = this.peers.get(memberId);
    if (peer) {
      if (!this.hasMissingPublishedMedia(memberId)) {
        this.resetPeerRecovery(peer);
      } else {
        this.schedulePeerRecoveryCheck(memberId, 'partial-remote-track');
      }
    }
    this.emitRemoteVideoStateChange();
  }

  private resolveFallbackRemoteTrackKind(memberId: string, track: MediaStreamTrack): RoomMediaKind | null {
    const normalizedKind = normalizeTrackKind(track);
    if (!normalizedKind) {
      return null;
    }

    if (normalizedKind === 'audio') {
      return 'audio';
    }

    return this.getNextUnassignedPublishedVideoLikeKind(memberId);
  }

  private flushPendingRemoteTracks(memberId: string, roomKind: RoomMediaKind): void {
    const expectedTrackKind = roomKind === 'audio' ? 'audio' : 'video';
    for (const [key, pending] of this.pendingRemoteTracks.entries()) {
      if (pending.memberId !== memberId || pending.track.kind !== expectedTrackKind) {
        continue;
      }
      this.pendingRemoteTracks.delete(key);
      this.clearPendingVideoPromotionTimer(key);
      this.emitRemoteTrack(memberId, pending.track, pending.stream, roomKind);
      return;
    }
  }

  private hasReplacementTrack(memberId: string, removedTrackId: string): boolean {
    const peer = this.peers.get(memberId);
    const hasLiveTrackedReplacement = Array.from(peer?.remoteVideoFlows?.values() ?? []).some((flow) => {
      const track = flow?.track;
      return isMediaStreamTrackLike(track) && track.id !== removedTrackId && track.readyState === 'live';
    });
    if (hasLiveTrackedReplacement) {
      return true;
    }

    return Array.from(this.pendingRemoteTracks.values()).some((pending) =>
      pending.memberId === memberId
      && pending.track.kind === 'video'
      && pending.track.id !== removedTrackId
      && pending.track.readyState === 'live');
  }

  private isRoomTrackStillPublished(
    memberId: string,
    removedTrack: Pick<RoomMediaTrack, 'kind' | 'trackId'>,
  ): boolean {
    const mediaMember = this.room.media.list().find((entry) => entry.member.memberId === memberId);
    if (!mediaMember) {
      return false;
    }

    const kind = removedTrack.kind;
    if (kind === 'audio' || kind === 'video' || kind === 'screen') {
      const kindState = mediaMember.state?.[kind];
      if (kindState?.published) {
        if (!removedTrack.trackId || kindState.trackId !== removedTrack.trackId) {
          return true;
        }
      }
    }

    return mediaMember.tracks.some((track) =>
      track.kind === removedTrack.kind
      && Boolean(track.trackId)
      && (!removedTrack.trackId || track.trackId !== removedTrack.trackId));
  }

  private scheduleTrackRemoval(track: RoomMediaTrack, member: RoomMember): void {
    if (!track.trackId || !member.memberId) {
      return;
    }

    const key = buildTrackKey(member.memberId, track.trackId);
    const existingTimer = this.pendingTrackRemovalTimers.get(key);
    if (existingTimer) {
      globalThis.clearTimeout(existingTimer);
    }

    this.pendingTrackRemovalTimers.set(
      key,
      globalThis.setTimeout(() => {
        this.pendingTrackRemovalTimers.delete(key);

        const replacementTrack =
          (track.kind === 'video' || track.kind === 'screen')
          && this.hasReplacementTrack(member.memberId, track.trackId!);
        const stillPublished = this.isRoomTrackStillPublished(member.memberId, track);

        if (replacementTrack || stillPublished) {
          return;
        }

        this.remoteTrackKinds.delete(key);
        this.emittedRemoteTracks.delete(key);
        this.pendingRemoteTracks.delete(key);
        this.clearPendingVideoPromotionTimer(key);
        this.schedulePeerRecoveryCheck(member.memberId, 'media-track-removed');
        this.emitRemoteVideoStateChange();
      }, this.options.trackRemovalGraceMs),
    );
  }

  private getPublishedVideoLikeKinds(memberId: string): Array<Extract<RoomMediaKind, 'video' | 'screen'>> {
    const mediaMember = this.room.media.list().find((entry) => entry.member.memberId === memberId);
    if (!mediaMember) {
      return [];
    }

    const publishedKinds = new Set<Extract<RoomMediaKind, 'video' | 'screen'>>();
    for (const track of mediaMember.tracks) {
      if ((track.kind === 'video' || track.kind === 'screen') && track.trackId) {
        publishedKinds.add(track.kind);
      }
    }

    for (const kind of getPublishedKindsFromState(mediaMember.state)) {
      if (kind === 'video' || kind === 'screen') {
        publishedKinds.add(kind);
      }
    }

    return Array.from(publishedKinds);
  }

  private getNextUnassignedPublishedVideoLikeKind(memberId: string): Extract<RoomMediaKind, 'video' | 'screen'> | null {
    const publishedKinds = this.getPublishedVideoLikeKinds(memberId);
    if (publishedKinds.length === 0) {
      return null;
    }

    const assignedKinds = new Set<Extract<RoomMediaKind, 'video' | 'screen'>>();
    for (const key of this.emittedRemoteTracks) {
      if (!key.startsWith(`${memberId}:`)) {
        continue;
      }
      const kind = this.remoteTrackKinds.get(key);
      if (kind === 'video' || kind === 'screen') {
        assignedKinds.add(kind);
      }
    }

    return publishedKinds.find((kind) => !assignedKinds.has(kind)) ?? null;
  }

  private resolveDeferredVideoKind(memberId: string): Extract<RoomMediaKind, 'video' | 'screen'> | null {
    const publishedKinds = this.getPublishedVideoLikeKinds(memberId);
    const assignedKinds = new Set<Extract<RoomMediaKind, 'video' | 'screen'>>();
    for (const key of this.emittedRemoteTracks) {
      if (!key.startsWith(`${memberId}:`)) {
        continue;
      }
      const kind = this.remoteTrackKinds.get(key);
      if (kind === 'video' || kind === 'screen') {
        assignedKinds.add(kind);
      }
    }

    if (publishedKinds.length === 1) {
      return publishedKinds[0];
    }

    if (publishedKinds.length > 1) {
      if (assignedKinds.size === 1) {
        const [kind] = Array.from(assignedKinds.values());
        if (publishedKinds.includes(kind)) {
          return kind;
        }
      }
      return null;
    }

    if (assignedKinds.size === 1) {
      return Array.from(assignedKinds.values())[0];
    }

    return null;
  }

  private schedulePendingVideoPromotion(
    memberId: string,
    track: MediaStreamTrack,
    stream: MediaStream,
  ): void {
    const key = buildTrackKey(memberId, track.id);
    if (this.pendingVideoPromotionTimers.has(key)) {
      return;
    }

    this.pendingVideoPromotionTimers.set(
      key,
      globalThis.setTimeout(() => {
        this.pendingVideoPromotionTimers.delete(key);
        const pending = this.pendingRemoteTracks.get(key);
        if (!pending) {
          return;
        }
        if (!isMediaStreamTrackLike(pending.track) || pending.track.readyState !== 'live') {
          this.pendingRemoteTracks.delete(key);
          this.emitRemoteVideoStateChange();
          return;
        }

        const promotedKind = this.resolveDeferredVideoKind(memberId);
        if (!promotedKind) {
          return;
        }

        const peer = this.peers.get(memberId);
        this.pendingRemoteTracks.delete(key);
        this.emitRemoteTrack(memberId, pending.track, pending.stream, promotedKind);
        if (peer) {
          this.registerPeerRemoteTrack(peer, pending.track, promotedKind);
          this.resetPeerRecovery(peer);
        }
        this.emitRemoteVideoStateChange();
      }, this.options.pendingVideoPromotionGraceMs),
    );
  }

  private clearPendingVideoPromotionTimer(key: string): void {
    const timer = this.pendingVideoPromotionTimers.get(key);
    if (!timer) {
      return;
    }
    globalThis.clearTimeout(timer);
    this.pendingVideoPromotionTimers.delete(key);
  }

  private closePeer(memberId: string): void {
    const peer = this.peers.get(memberId);
    if (!peer) return;
    this.destroyPeer(peer);
    this.peers.delete(memberId);
  }

  private removeRemoteMember(memberId: string): void {
    this.cancelPendingSyncRemoval(memberId);
    this.remoteTrackKinds.forEach((_kind, key) => {
      if (key.startsWith(`${memberId}:`)) {
        this.remoteTrackKinds.delete(key);
        const timer = this.pendingTrackRemovalTimers.get(key);
        if (timer) {
          globalThis.clearTimeout(timer);
          this.pendingTrackRemovalTimers.delete(key);
        }
      }
    });
    this.emittedRemoteTracks.forEach((key) => {
      if (key.startsWith(`${memberId}:`)) {
        this.emittedRemoteTracks.delete(key);
      }
    });
    this.pendingRemoteTracks.forEach((_pending, key) => {
      if (key.startsWith(`${memberId}:`)) {
        this.pendingRemoteTracks.delete(key);
        this.clearPendingVideoPromotionTimer(key);
      }
    });
    this.remoteVideoStreamCache.delete(memberId);
    this.closePeer(memberId);
    this.emitRemoteVideoStateChange();
  }

  private scheduleSyncRemoval(memberId: string): void {
    if (!memberId || memberId === this.localMemberId || this.pendingSyncRemovalTimers.has(memberId)) {
      return;
    }

    this.pendingSyncRemovalTimers.set(
      memberId,
      globalThis.setTimeout(() => {
        this.pendingSyncRemovalTimers.delete(memberId);

        const stillActive = this.room.members.list().some((member) => member.memberId === memberId);
        const hasMedia = this.room.media.list().some((entry) => entry.member.memberId === memberId);
        if (stillActive || hasMedia) {
          return;
        }

        this.removeRemoteMember(memberId);
        this.emitRemoteVideoStateChange();
      }, this.options.syncRemovalGraceMs),
    );
  }

  private cancelPendingSyncRemoval(memberId: string): void {
    const timer = this.pendingSyncRemovalTimers.get(memberId);
    if (!timer) {
      return;
    }
    globalThis.clearTimeout(timer);
    this.pendingSyncRemovalTimers.delete(memberId);
  }

  private findMember(memberId: string): RoomMember | undefined {
    return this.room.members.list().find((member) => member.memberId === memberId);
  }

  private rollbackConnectedState(): void {
    this.connected = false;
    this.localMemberId = null;
    if (this.healthCheckTimer != null) {
      globalThis.clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    for (const subscription of this.subscriptions.splice(0)) {
      subscription.unsubscribe();
    }
    for (const peer of this.peers.values()) {
      this.destroyPeer(peer);
    }
    this.peers.clear();
    for (const pending of this.pendingIceCandidates.values()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
    }
    for (const timer of this.pendingTrackRemovalTimers.values()) {
      globalThis.clearTimeout(timer);
    }
    for (const timer of this.pendingSyncRemovalTimers.values()) {
      globalThis.clearTimeout(timer);
    }
    for (const timer of this.pendingVideoPromotionTimers.values()) {
      globalThis.clearTimeout(timer);
    }
    this.pendingTrackRemovalTimers.clear();
    this.pendingSyncRemovalTimers.clear();
    this.pendingVideoPromotionTimers.clear();
    this.pendingIceCandidates.clear();
    this.remoteTrackKinds.clear();
    this.emittedRemoteTracks.clear();
    this.pendingRemoteTracks.clear();
    this.remoteVideoStreamCache.clear();
    this.emitRemoteVideoStateChange(true);
  }

  private destroyPeer(peer: P2PPeerState): void {
    this.clearPeerRecoveryTimer(peer);
    for (const flow of peer.remoteVideoFlows.values()) {
      flow.cleanup();
    }
    peer.remoteVideoFlows.clear();
    peer.pc.onicecandidate = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.onsignalingstatechange = null;
    peer.pc.oniceconnectionstatechange = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.ontrack = null;
    try {
      peer.pc.close();
    } catch {
      // Ignore duplicate closes.
    }
  }

  private startHealthChecks(): void {
    if (this.healthCheckTimer != null) {
      return;
    }

    this.healthCheckTimer = globalThis.setInterval(() => {
      void this.runHealthChecks();
    }, this.options.mediaHealthCheckIntervalMs);
  }

  private async runHealthChecks(): Promise<void> {
    if (!this.connected) {
      return;
    }

    for (const peer of this.peers.values()) {
      if (peer.healthCheckInFlight || peer.pc.connectionState === 'closed') {
        continue;
      }

      peer.healthCheckInFlight = true;
      try {
        const issue = await this.inspectPeerVideoHealth(peer);
        if (issue) {
          this.schedulePeerRecoveryCheck(peer.memberId, issue, 0);
        }
      } finally {
        peer.healthCheckInFlight = false;
      }
    }
  }

  private registerPeerRemoteTrack(
    peer: P2PPeerState,
    track: MediaStreamTrack,
    kind: RoomMediaKind,
  ): void {
    if (kind !== 'video' && kind !== 'screen') {
      return;
    }

    if (peer.remoteVideoFlows.has(track.id)) {
      return;
    }

    const flow = {
      track,
      receivedAt: Date.now(),
      lastHealthyAt: track.muted ? 0 : Date.now(),
      lastBytesReceived: null,
      lastFramesDecoded: null,
      cleanup: () => {},
    };

    const markHealthy = () => {
      flow.lastHealthyAt = Date.now();
    };

    const handleEnded = () => {
      flow.cleanup();
      peer.remoteVideoFlows.delete(track.id);
      this.emitRemoteVideoStateChange();
    };

    track.addEventListener('unmute', markHealthy);
    track.addEventListener('ended', handleEnded);
    flow.cleanup = () => {
      track.removeEventListener('unmute', markHealthy);
      track.removeEventListener('ended', handleEnded);
    };

    peer.remoteVideoFlows.set(track.id, flow);
    this.emitRemoteVideoStateChange();
  }

  private async inspectPeerVideoHealth(peer: P2PPeerState): Promise<string | null> {
    if (this.hasMissingPublishedMedia(peer.memberId)) {
      return 'health-missing-published-media';
    }

    const mediaMember = this.room.media.list().find((entry) => entry.member.memberId === peer.memberId);
    const publishedVideoState = mediaMember?.state?.video;
    const publishedScreenState = mediaMember?.state?.screen;
    const publishedAt = Math.max(
      publishedVideoState?.publishedAt ?? 0,
      publishedScreenState?.publishedAt ?? 0,
    );
    const expectsVideoFlow = Boolean(
      publishedVideoState?.published
      || publishedScreenState?.published
      || mediaMember?.tracks.some((track) => (track.kind === 'video' || track.kind === 'screen') && track.trackId),
    );

    if (!expectsVideoFlow) {
      return null;
    }

    const videoReceivers = peer.pc
      .getReceivers()
      .filter((receiver) => receiver.track?.kind === 'video');

    if (videoReceivers.length === 0) {
      const firstObservedAt = Math.max(
        publishedAt,
        ...Array.from(peer.remoteVideoFlows.values()).map((flow) => flow.receivedAt),
      );
      if (firstObservedAt > 0 && Date.now() - firstObservedAt > this.options.videoFlowGraceMs) {
        return 'health-no-video-receiver';
      }
      return null;
    }

    let sawHealthyFlow = false;
    let lastObservedAt = publishedAt;

    for (const receiver of videoReceivers) {
      const track = receiver.track;
      if (!track) {
        continue;
      }

      const flow = peer.remoteVideoFlows.get(track.id);
      if (!flow) {
        continue;
      }

      lastObservedAt = Math.max(lastObservedAt, flow.receivedAt, flow.lastHealthyAt);

      if (!track.muted) {
        flow.lastHealthyAt = Math.max(flow.lastHealthyAt, Date.now());
      }

      try {
        const stats = await receiver.getStats();
        for (const report of stats.values()) {
          if (report.type !== 'inbound-rtp' || report.kind !== 'video') {
            continue;
          }

          const bytesReceived = typeof report.bytesReceived === 'number' ? report.bytesReceived : null;
          const framesDecoded = typeof report.framesDecoded === 'number' ? report.framesDecoded : null;
          const bytesIncreased =
            bytesReceived != null
            && flow.lastBytesReceived != null
            && bytesReceived > flow.lastBytesReceived;
          const framesIncreased =
            framesDecoded != null
            && flow.lastFramesDecoded != null
            && framesDecoded > flow.lastFramesDecoded;

          if ((bytesReceived != null && bytesReceived > 0) || (framesDecoded != null && framesDecoded > 0)) {
            flow.lastHealthyAt = Math.max(flow.lastHealthyAt, Date.now());
          }
          if (bytesIncreased || framesIncreased) {
            flow.lastHealthyAt = Date.now();
          }

          flow.lastBytesReceived = bytesReceived;
          flow.lastFramesDecoded = framesDecoded;
          break;
        }
      } catch {
        // Ignore stats read failures and rely on track state.
      }

      if (flow.lastHealthyAt > 0) {
        sawHealthyFlow = true;
      }
      lastObservedAt = Math.max(lastObservedAt, flow.lastHealthyAt);
    }

    if (sawHealthyFlow) {
      return null;
    }

    if (lastObservedAt > 0 && Date.now() - lastObservedAt > this.options.videoFlowStallGraceMs) {
      return 'health-stalled-video-flow';
    }

    if (publishedAt > 0 && Date.now() - publishedAt > this.options.videoFlowGraceMs) {
      return 'health-video-flow-timeout';
    }

    const signalingState = peer.pc.signalingState;
    if (signalingState !== 'stable' && signalingState !== 'closed') {
      const connectionLooksHealthy =
        peer.pc.connectionState === 'connected'
        || peer.pc.iceConnectionState === 'connected'
        || peer.pc.iceConnectionState === 'completed';
      const signalingAgeMs = Date.now() - (peer.signalingStateChangedAt || peer.createdAt || Date.now());
      if (connectionLooksHealthy && signalingAgeMs > this.options.stuckSignalingGraceMs) {
        return `health-stuck-${signalingState}`;
      }
    }

    return null;
  }

  private async createUserMediaTrack(
    kind: Extract<RoomMediaKind, 'audio' | 'video'>,
    constraints: MediaTrackConstraints | boolean,
  ): Promise<MediaStreamTrack | null> {
    const devices = this.options.mediaDevices;
    if (!devices?.getUserMedia || constraints === false) {
      return null;
    }

    const stream = await devices.getUserMedia(
      kind === 'audio'
        ? { audio: constraints, video: false }
        : { audio: false, video: constraints },
    );

    return kind === 'audio' ? stream.getAudioTracks()[0] ?? null : stream.getVideoTracks()[0] ?? null;
  }

  private rememberLocalTrack(
    kind: RoomMediaKind,
    track: MediaStreamTrack,
    deviceId: string | undefined,
    stopOnCleanup: boolean,
  ): void {
    this.releaseLocalTrack(kind);
    this.localTracks.set(kind, {
      kind,
      track,
      deviceId,
      stopOnCleanup,
    });
  }

  private releaseLocalTrack(kind: RoomMediaKind): void {
    const local = this.localTracks.get(kind);
    if (!local) return;

    if (local.stopOnCleanup) {
      local.track.stop();
    }
    this.localTracks.delete(kind);
  }

  private async ensureConnectedMemberId(): Promise<string> {
    if (this.localMemberId) {
      return this.localMemberId;
    }
    return this.connect();
  }

  private getPendingRemoteVideoTrack(
    memberId: string,
  ): { track: MediaStreamTrack; stream: MediaStream } | null {
    for (const pending of this.pendingRemoteTracks.values()) {
      if (
        pending.memberId === memberId
        && pending.track.kind === 'video'
        && pending.track.readyState === 'live'
      ) {
        return { track: pending.track, stream: pending.stream };
      }
    }
    return null;
  }

  private normalizeDescription(payload: unknown): RTCSessionDescriptionInit | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const raw = (payload as { description?: RTCSessionDescriptionInit }).description;
    if (!raw || typeof raw.type !== 'string') {
      return null;
    }
    return {
      type: raw.type,
      sdp: typeof raw.sdp === 'string' ? raw.sdp : undefined,
    };
  }

  private normalizeCandidates(payload: unknown): RTCIceCandidateInit[] {
    if (!payload || typeof payload !== 'object') {
      return [];
    }
    const batch = (payload as { candidates?: RTCIceCandidateInit[] }).candidates;
    if (Array.isArray(batch)) {
      return batch.filter((candidate): candidate is RTCIceCandidateInit =>
        !!candidate && typeof candidate.candidate === 'string',
      );
    }
    const raw = (payload as { candidate?: RTCIceCandidateInit }).candidate;
    if (!raw || typeof raw.candidate !== 'string') {
      return [];
    }
    return [raw];
  }

  private async sendSignalWithRetry(
    memberId: string,
    event: string,
    payload: unknown,
  ): Promise<void> {
    await this.withRateLimitRetry(`signal ${event}`, () =>
      this.room.signals.sendTo(memberId, event, payload),
    );
  }

  private async withRateLimitRetry<T>(label: string, action: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= DEFAULT_RATE_LIMIT_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await action();
      } catch (error) {
        lastError = error;
        if (!isRateLimitError(error) || attempt === DEFAULT_RATE_LIMIT_RETRY_DELAYS_MS.length) {
          throw error;
        }

        const delayMs = DEFAULT_RATE_LIMIT_RETRY_DELAYS_MS[attempt];
        console.warn('[RoomP2PMediaTransport] Rate limited room operation. Retrying.', {
          label,
          attempt: attempt + 1,
          delayMs,
        });
        await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  }

  private get offerEvent(): string {
    return `${this.options.signalPrefix}.offer`;
  }

  private get answerEvent(): string {
    return `${this.options.signalPrefix}.answer`;
  }

  private get iceEvent(): string {
    return `${this.options.signalPrefix}.ice`;
  }

  private maybeRetryPendingNegotiation(peer: P2PPeerState): void {
    if (
      !peer.pendingNegotiation
      || !this.connected
      || peer.pc.connectionState === 'closed'
      || peer.makingOffer
      || peer.isSettingRemoteAnswerPending
      || peer.pc.signalingState !== 'stable'
    ) {
      return;
    }

    peer.pendingNegotiation = false;
    queueMicrotask(() => {
      void this.negotiatePeer(peer);
    });
  }

  private handlePeerConnectivityChange(peer: P2PPeerState, source: 'ice' | 'connection'): void {
    if (!this.connected || peer.pc.connectionState === 'closed') {
      return;
    }

    const connectionState = peer.pc.connectionState;
    const iceConnectionState = peer.pc.iceConnectionState;
    const connectedish =
      connectionState === 'connected'
      || iceConnectionState === 'connected'
      || iceConnectionState === 'completed';

    if (connectedish) {
      const unstableSignaling = peer.pc.signalingState !== 'stable';
      const missingPublishedMedia = this.hasMissingPublishedMedia(peer.memberId);
      const allRemoteVideoFlowsUnhealthy =
        peer.remoteVideoFlows.size > 0
        && Array.from(peer.remoteVideoFlows.values()).every((flow) => (flow.lastHealthyAt ?? 0) <= 0);

      if (unstableSignaling || missingPublishedMedia || allRemoteVideoFlowsUnhealthy) {
        this.schedulePeerRecoveryCheck(
          peer.memberId,
          `${source}-connected-but-incomplete`,
          Math.max(1_200, this.options.missingMediaGraceMs),
        );
        return;
      }

      this.resetPeerRecovery(peer);
      return;
    }

    if (connectionState === 'failed' || iceConnectionState === 'failed') {
      this.schedulePeerRecoveryCheck(peer.memberId, `${source}-failed`, 0);
      return;
    }

    if (connectionState === 'disconnected' || iceConnectionState === 'disconnected') {
      this.schedulePeerRecoveryCheck(
        peer.memberId,
        `${source}-disconnected`,
        this.options.disconnectedRecoveryDelayMs,
      );
    }
  }

  private schedulePeerRecoveryCheck(
    memberId: string,
    reason: string,
    delayMs = this.options.missingMediaGraceMs,
  ): void {
    const peer = this.peers.get(memberId);
    if (!peer || !this.connected || peer.pc.connectionState === 'closed') {
      return;
    }

    const peerAgeMs = Date.now() - peer.createdAt;
    const inInitialBootstrapWindow =
      !peer.hasRemoteDescription
      && peer.pc.connectionState === 'new'
      && peer.pc.iceConnectionState === 'new'
      && peerAgeMs < this.options.initialNegotiationGraceMs;

    const healthSensitiveReason =
      reason.includes('health')
      || reason.includes('stalled')
      || reason.includes('flow');

    if (
      !this.hasMissingPublishedMedia(memberId)
      && !healthSensitiveReason
      && !reason.includes('failed')
      && !reason.includes('disconnected')
    ) {
      this.resetPeerRecovery(peer);
      return;
    }

    if (
      inInitialBootstrapWindow
      && !healthSensitiveReason
      && !reason.includes('failed')
      && !reason.includes('disconnected')
    ) {
      delayMs = Math.max(delayMs, this.options.initialNegotiationGraceMs - peerAgeMs);
    }

    this.clearPeerRecoveryTimer(peer);
    peer.recoveryTimer = globalThis.setTimeout(() => {
      peer.recoveryTimer = null;
      void this.recoverPeer(peer, reason);
    }, Math.max(0, delayMs));
  }

  private async recoverPeer(peer: P2PPeerState, reason: string): Promise<void> {
    if (!this.connected || peer.pc.connectionState === 'closed') {
      return;
    }

    const stillMissingPublishedMedia = this.hasMissingPublishedMedia(peer.memberId);
    const connectivityIssue =
      peer.pc.connectionState === 'failed'
      || peer.pc.connectionState === 'disconnected'
      || peer.pc.iceConnectionState === 'failed'
      || peer.pc.iceConnectionState === 'disconnected';
    const healthIssue =
      !stillMissingPublishedMedia && !connectivityIssue
        ? await this.inspectPeerVideoHealth(peer)
        : null;

    if (!stillMissingPublishedMedia && !connectivityIssue && !healthIssue) {
      this.resetPeerRecovery(peer);
      return;
    }

    if (
      healthIssue === 'health-stuck-have-local-offer'
      && (
        peer.pc.connectionState === 'connected'
        || peer.pc.iceConnectionState === 'connected'
        || peer.pc.iceConnectionState === 'completed'
      )
    ) {
      try {
        await peer.pc.setLocalDescription({ type: 'rollback' });
        peer.pendingNegotiation = true;
        peer.ignoreOffer = false;
        this.maybeRetryPendingNegotiation(peer);
        this.schedulePeerRecoveryCheck(peer.memberId, `${reason}:post-rollback`, 1_200);
        return;
      } catch (error) {
        console.warn('[RoomP2PMediaTransport] Failed to roll back stale local offer.', {
          memberId: peer.memberId,
          reason,
          error,
        });
      }
    }

    if (
      healthIssue
      && healthIssue.startsWith('health-stuck-')
      && (
        peer.pc.connectionState === 'connected'
        || peer.pc.iceConnectionState === 'connected'
        || peer.pc.iceConnectionState === 'completed'
      )
    ) {
      this.resetPeer(peer.memberId, `${reason}:${healthIssue}`);
      return;
    }

    if (peer.recoveryAttempts >= this.options.maxRecoveryAttempts) {
      this.resetPeer(peer.memberId, reason);
      return;
    }

    peer.recoveryAttempts += 1;
    this.requestIceRestart(peer, reason);
  }

  private requestIceRestart(peer: P2PPeerState, reason: string): void {
    try {
      if (typeof peer.pc.restartIce === 'function') {
        peer.pc.restartIce();
      }
    } catch (error) {
      console.warn('[RoomP2PMediaTransport] Failed to request ICE restart.', {
        memberId: peer.memberId,
        reason,
        error,
      });
    }

    peer.pendingNegotiation = true;
    this.maybeRetryPendingNegotiation(peer);
  }

  private resetPeer(memberId: string, reason: string): void {
    const existing = this.peers.get(memberId);
    if (existing) {
      this.destroyPeer(existing);
      this.peers.delete(memberId);
    }

    const replacement = this.ensurePeer(memberId);
    replacement.recoveryAttempts = 0;
    replacement.pendingNegotiation = true;
    this.maybeRetryPendingNegotiation(replacement);
    this.schedulePeerRecoveryCheck(memberId, `${reason}:after-reset`);
  }

  private resetPeerRecovery(peer: P2PPeerState): void {
    peer.recoveryAttempts = 0;
    peer.pendingNegotiation = false;
    this.clearPeerRecoveryTimer(peer);
  }

  private clearPeerRecoveryTimer(peer: P2PPeerState): void {
    if (peer.recoveryTimer != null) {
      globalThis.clearTimeout(peer.recoveryTimer);
      peer.recoveryTimer = null;
    }
  }

  private hasMissingPublishedMedia(memberId: string): boolean {
    const mediaMember = this.room.media.list().find((entry) => entry.member.memberId === memberId);
    if (!mediaMember) {
      return false;
    }

    const publishedKinds = new Set<RoomMediaKind>();
    for (const track of mediaMember.tracks) {
      if (track.trackId) {
        publishedKinds.add(track.kind);
      }
    }
    for (const kind of getPublishedKindsFromState(mediaMember.state)) {
      publishedKinds.add(kind);
    }

    const emittedKinds = new Set<RoomMediaKind>();
    for (const key of this.emittedRemoteTracks) {
      if (!key.startsWith(`${memberId}:`)) {
        continue;
      }
      const kind = this.remoteTrackKinds.get(key);
      if (kind) {
        emittedKinds.add(kind);
      }
    }

    let pendingAudioCount = 0;
    let pendingVideoLikeCount = 0;
    for (const pending of this.pendingRemoteTracks.values()) {
      if (pending.memberId !== memberId) {
        continue;
      }
      if (pending.track.kind === 'audio') {
        pendingAudioCount += 1;
      } else if (pending.track.kind === 'video') {
        pendingVideoLikeCount += 1;
      }
    }

    if (publishedKinds.has('audio') && !emittedKinds.has('audio') && pendingAudioCount === 0) {
      return true;
    }

    const expectedVideoLikeKinds = Array.from(publishedKinds).filter(
      (kind): kind is Extract<RoomMediaKind, 'video' | 'screen'> => kind === 'video' || kind === 'screen',
    );
    if (expectedVideoLikeKinds.length === 0) {
      return false;
    }

    const emittedVideoLikeCount = Array.from(emittedKinds).filter(
      (kind): kind is Extract<RoomMediaKind, 'video' | 'screen'> => kind === 'video' || kind === 'screen',
    ).length;

    return emittedVideoLikeCount + pendingVideoLikeCount < expectedVideoLikeKinds.length;
  }

  private emitRemoteVideoStateChange(force = false): void {
    if (this.remoteVideoStateHandlers.length === 0 && !force) {
      return;
    }

    const entries = this.getRemoteVideoStates();
    const signature = JSON.stringify(entries.map((entry) => ({
      memberId: entry.memberId,
      userId: entry.userId ?? null,
      displayName: entry.displayName ?? null,
      trackId: entry.trackId ?? null,
      published: entry.published,
      isCameraOff: entry.isCameraOff,
      hasStream: entry.stream instanceof MediaStream,
    })));
    if (!force && signature === this.remoteVideoStateSignature) {
      return;
    }
    this.remoteVideoStateSignature = signature;

    for (const handler of this.remoteVideoStateHandlers) {
      try {
        handler(entries.map((entry) => ({ ...entry })));
      } catch {
        // Ignore remote video state handler failures.
      }
    }
  }

  private recordDebugEvent(type: string, details: Record<string, unknown> = {}): void {
    this.debugEvents.push({
      id: ++this.debugEventCounter,
      at: Date.now(),
      type,
      details,
    });
    if (this.debugEvents.length > 200) {
      this.debugEvents.splice(0, this.debugEvents.length - 200);
    }
  }
}
