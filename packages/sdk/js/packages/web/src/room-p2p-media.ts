import type {
  RoomMediaKind,
  RoomMediaMember,
  RoomMediaRemoteTrackEvent,
  RoomMediaTrack,
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
    onTrack(handler: (track: RoomMediaTrack, member: RoomMember) => void): Subscription;
    onTrackRemoved(handler: (track: RoomMediaTrack, member: RoomMember) => void): Subscription;
  };
  members: {
    list(): RoomMember[];
    current(): RoomMember | null;
    onSync(handler: (members: RoomMember[]) => void): Subscription;
    onJoin(handler: (member: RoomMember) => void): Subscription;
    onLeave(handler: (member: RoomMember, reason: RoomMemberLeaveReason) => void): Subscription;
  };
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
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  senders: Map<RoomMediaKind, RTCRtpSender>;
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

function buildTrackKey(memberId: string, trackId: string): string {
  return `${memberId}:${trackId}`;
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

export interface RoomP2PMediaTransportOptions {
  rtcConfiguration?: RTCConfiguration;
  peerConnectionFactory?: (configuration: RTCConfiguration) => RTCPeerConnection;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia' | 'getDisplayMedia'>;
  signalPrefix?: string;
}

export class RoomP2PMediaTransport implements RoomMediaTransport {
  private readonly room: RoomP2PMediaAdapter;
  private readonly options: Required<Omit<RoomP2PMediaTransportOptions, 'mediaDevices'>> & {
    mediaDevices?: Pick<MediaDevices, 'getUserMedia' | 'getDisplayMedia'>;
  };
  private readonly localTracks = new Map<RoomMediaKind, LocalTrackState>();
  private readonly peers = new Map<string, P2PPeerState>();
  private readonly remoteTrackHandlers: Array<(event: RoomMediaRemoteTrackEvent) => void> = [];
  private readonly remoteTrackKinds = new Map<string, RoomMediaKind>();
  private readonly emittedRemoteTracks = new Set<string>();
  private readonly pendingRemoteTracks = new Map<string, {
    memberId: string;
    track: MediaStreamTrack;
    stream: MediaStream;
  }>();
  private readonly subscriptions: Subscription[] = [];
  private localMemberId: string | null = null;
  private connected = false;

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

    if (payload && typeof payload === 'object' && 'sessionDescription' in payload) {
      throw new Error(
        'RoomP2PMediaTransport.connect() does not accept sessionDescription; use room.signals through the built-in transport instead.',
      );
    }

    const currentMember = await this.waitForCurrentMember();
    if (!currentMember) {
      throw new Error('Join the room before connecting a P2P media transport.');
    }

    this.localMemberId = currentMember.memberId;
    this.connected = true;
    this.hydrateRemoteTrackKinds();
    this.attachRoomSubscriptions();

    try {
      for (const member of this.room.members.list()) {
        if (member.memberId !== this.localMemberId) {
          this.ensurePeer(member.memberId);
        }
      }
    } catch (error) {
      this.rollbackConnectedState();
      throw error;
    }

    return this.localMemberId;
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

  async enableAudio(constraints: MediaTrackConstraints | boolean = true): Promise<MediaStreamTrack> {
    const track = await this.createUserMediaTrack('audio', constraints);
    if (!track) {
      throw new Error('P2P transport could not create a local audio track.');
    }

    const providerSessionId = await this.ensureConnectedMemberId();
    this.rememberLocalTrack('audio', track, track.getSettings().deviceId, true);
    await this.room.media.audio.enable?.({
      trackId: track.id,
      deviceId: track.getSettings().deviceId,
      providerSessionId,
    });
    this.syncAllPeerSenders();
    return track;
  }

  async enableVideo(constraints: MediaTrackConstraints | boolean = true): Promise<MediaStreamTrack> {
    const track = await this.createUserMediaTrack('video', constraints);
    if (!track) {
      throw new Error('P2P transport could not create a local video track.');
    }

    const providerSessionId = await this.ensureConnectedMemberId();
    this.rememberLocalTrack('video', track, track.getSettings().deviceId, true);
    await this.room.media.video.enable?.({
      trackId: track.id,
      deviceId: track.getSettings().deviceId,
      providerSessionId,
    });
    this.syncAllPeerSenders();
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
    await this.room.media.screen.start?.({
      trackId: track.id,
      deviceId: track.getSettings().deviceId,
      providerSessionId,
    });
    this.syncAllPeerSenders();
    return track;
  }

  async disableAudio(): Promise<void> {
    this.releaseLocalTrack('audio');
    this.syncAllPeerSenders();
    await this.room.media.audio.disable();
  }

  async disableVideo(): Promise<void> {
    this.releaseLocalTrack('video');
    this.syncAllPeerSenders();
    await this.room.media.video.disable();
  }

  async stopScreenShare(): Promise<void> {
    this.releaseLocalTrack('screen');
    this.syncAllPeerSenders();
    await this.room.media.screen.stop();
  }

  async setMuted(kind: Extract<RoomMediaKind, 'audio' | 'video'>, muted: boolean): Promise<void> {
    const localTrack = this.localTracks.get(kind)?.track;
    if (localTrack) {
      localTrack.enabled = !muted;
    }

    if (kind === 'audio') {
      await this.room.media.audio.setMuted?.(muted);
    } else {
      await this.room.media.video.setMuted?.(muted);
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
    return {
      unsubscribe: () => {
        const index = this.remoteTrackHandlers.indexOf(handler);
        if (index >= 0) {
          this.remoteTrackHandlers.splice(index, 1);
        }
      },
    };
  }

  destroy(): void {
    this.connected = false;
    this.localMemberId = null;
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
    this.remoteTrackKinds.clear();
    this.emittedRemoteTracks.clear();
    this.pendingRemoteTracks.clear();
  }

  private attachRoomSubscriptions(): void {
    if (this.subscriptions.length > 0) {
      return;
    }

    this.subscriptions.push(
      this.room.members.onJoin((member) => {
        if (member.memberId !== this.localMemberId) {
          this.ensurePeer(member.memberId);
        }
      }),
      this.room.members.onSync((members) => {
        const activeMemberIds = new Set<string>();
        for (const member of members) {
          if (member.memberId !== this.localMemberId) {
            activeMemberIds.add(member.memberId);
            this.ensurePeer(member.memberId);
          }
        }
        for (const memberId of Array.from(this.peers.keys())) {
          if (!activeMemberIds.has(memberId)) {
            this.removeRemoteMember(memberId);
          }
        }
      }),
      this.room.members.onLeave((member) => {
        this.removeRemoteMember(member.memberId);
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
          this.ensurePeer(member.memberId);
        }
        this.rememberRemoteTrackKind(track, member);
      }),
      this.room.media.onTrackRemoved((track, member) => {
        if (!track.trackId) return;
        const key = buildTrackKey(member.memberId, track.trackId);
        this.remoteTrackKinds.delete(key);
        this.emittedRemoteTracks.delete(key);
        this.pendingRemoteTracks.delete(key);
      }),
    );
  }

  private hydrateRemoteTrackKinds(): void {
    this.remoteTrackKinds.clear();
    this.emittedRemoteTracks.clear();
    this.pendingRemoteTracks.clear();

    for (const mediaMember of this.room.media.list()) {
      for (const track of mediaMember.tracks) {
        this.rememberRemoteTrackKind(track, mediaMember.member);
      }
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
      this.emitRemoteTrack(member.memberId, pending.track, pending.stream, track.kind);
      return;
    }
    this.flushPendingRemoteTracks(member.memberId, track.kind);
  }

  private ensurePeer(memberId: string): P2PPeerState {
    const existing = this.peers.get(memberId);
    if (existing) {
      this.syncPeerSenders(existing);
      return existing;
    }

    const pc = this.options.peerConnectionFactory(this.options.rtcConfiguration);
    const peer: P2PPeerState = {
      memberId,
      pc,
      polite: !!this.localMemberId && this.localMemberId.localeCompare(memberId) > 0,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      pendingCandidates: [],
      senders: new Map<RoomMediaKind, RTCRtpSender>(),
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void this.room.signals.sendTo(memberId, this.iceEvent, {
        candidate: serializeCandidate(event.candidate),
      });
    };

    pc.onnegotiationneeded = () => {
      void this.negotiatePeer(peer);
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      const key = buildTrackKey(memberId, event.track.id);
      const exactKind = this.remoteTrackKinds.get(key);
      const fallbackKind = exactKind ? null : this.resolveFallbackRemoteTrackKind(memberId, event.track);
      const kind = exactKind ?? fallbackKind ?? normalizeTrackKind(event.track);

      if (!kind || (!exactKind && !fallbackKind && kind === 'video' && event.track.kind === 'video')) {
        this.pendingRemoteTracks.set(key, { memberId, track: event.track, stream });
        return;
      }

      this.emitRemoteTrack(memberId, event.track, stream, kind);
    };

    this.peers.set(memberId, peer);
    this.syncPeerSenders(peer);
    return peer;
  }

  private async negotiatePeer(peer: P2PPeerState): Promise<void> {
    if (
      !this.connected
      || peer.pc.connectionState === 'closed'
      || peer.makingOffer
      || peer.isSettingRemoteAnswerPending
      || peer.pc.signalingState !== 'stable'
    ) {
      return;
    }

    try {
      peer.makingOffer = true;
      await peer.pc.setLocalDescription();
      if (!peer.pc.localDescription) {
        return;
      }
      await this.room.signals.sendTo(peer.memberId, this.offerEvent, {
        description: serializeDescription(peer.pc.localDescription),
      });
    } catch (error) {
      console.warn('[RoomP2PMediaTransport] Failed to negotiate peer offer.', {
        memberId: peer.memberId,
        signalingState: peer.pc.signalingState,
        error,
      });
    } finally {
      peer.makingOffer = false;
    }
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
      peer.isSettingRemoteAnswerPending = description.type === 'answer';
      await peer.pc.setRemoteDescription(description);
      peer.isSettingRemoteAnswerPending = false;
      await this.flushPendingCandidates(peer);

      if (description.type === 'offer') {
        this.syncPeerSenders(peer);
        await peer.pc.setLocalDescription();
        if (!peer.pc.localDescription) {
          return;
        }
        await this.room.signals.sendTo(senderId, this.answerEvent, {
          description: serializeDescription(peer.pc.localDescription),
        });
      }
    } catch (error) {
      console.warn('[RoomP2PMediaTransport] Failed to apply remote session description.', {
        memberId: senderId,
        expectedType,
        signalingState: peer.pc.signalingState,
        error,
      });
      peer.isSettingRemoteAnswerPending = false;
    }
  }

  private async handleIceSignal(payload: unknown, meta: RoomSignalMeta): Promise<void> {
    const senderId = typeof meta.memberId === 'string' && meta.memberId.trim() ? meta.memberId.trim() : '';
    if (!senderId || senderId === this.localMemberId) {
      return;
    }

    const candidate = this.normalizeCandidate(payload);
    if (!candidate) {
      return;
    }

    const peer = this.ensurePeer(senderId);
    if (!peer.pc.remoteDescription) {
      peer.pendingCandidates.push(candidate);
      return;
    }

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
    const participant = this.findMember(memberId);
    const payload: RoomMediaRemoteTrackEvent = {
      kind,
      track,
      stream,
      trackName: track.id,
      providerSessionId: memberId,
      participantId: memberId,
      userId: participant?.userId,
    };

    for (const handler of this.remoteTrackHandlers) {
      handler(payload);
    }
  }

  private resolveFallbackRemoteTrackKind(memberId: string, track: MediaStreamTrack): RoomMediaKind | null {
    const normalizedKind = normalizeTrackKind(track);
    if (!normalizedKind) {
      return null;
    }

    if (normalizedKind === 'audio') {
      return 'audio';
    }

    const videoLikeTracks = this.getPublishedVideoLikeKinds(memberId);
    if (videoLikeTracks.length !== 1) {
      return null;
    }

    return videoLikeTracks[0] ?? null;
  }

  private flushPendingRemoteTracks(memberId: string, roomKind: RoomMediaKind): void {
    const expectedTrackKind = roomKind === 'audio' ? 'audio' : 'video';
    for (const [key, pending] of this.pendingRemoteTracks.entries()) {
      if (pending.memberId !== memberId || pending.track.kind !== expectedTrackKind) {
        continue;
      }
      this.pendingRemoteTracks.delete(key);
      this.emitRemoteTrack(memberId, pending.track, pending.stream, roomKind);
      return;
    }
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

    return Array.from(publishedKinds);
  }

  private closePeer(memberId: string): void {
    const peer = this.peers.get(memberId);
    if (!peer) return;
    this.destroyPeer(peer);
    this.peers.delete(memberId);
  }

  private removeRemoteMember(memberId: string): void {
    this.remoteTrackKinds.forEach((_kind, key) => {
      if (key.startsWith(`${memberId}:`)) {
        this.remoteTrackKinds.delete(key);
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
      }
    });
    this.closePeer(memberId);
  }

  private findMember(memberId: string): RoomMember | undefined {
    return this.room.members.list().find((member) => member.memberId === memberId);
  }

  private rollbackConnectedState(): void {
    this.connected = false;
    this.localMemberId = null;
    for (const subscription of this.subscriptions.splice(0)) {
      subscription.unsubscribe();
    }
    for (const peer of this.peers.values()) {
      this.destroyPeer(peer);
    }
    this.peers.clear();
    this.remoteTrackKinds.clear();
    this.emittedRemoteTracks.clear();
    this.pendingRemoteTracks.clear();
  }

  private destroyPeer(peer: P2PPeerState): void {
    peer.pc.onicecandidate = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.ontrack = null;
    try {
      peer.pc.close();
    } catch {
      // Ignore duplicate closes.
    }
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

  private normalizeCandidate(payload: unknown): RTCIceCandidateInit | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const raw = (payload as { candidate?: RTCIceCandidateInit }).candidate;
    if (!raw || typeof raw.candidate !== 'string') {
      return null;
    }
    return raw;
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
}
