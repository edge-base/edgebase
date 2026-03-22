import type {
  RTKClientOptions,
  RTKParticipant,
  RTKParticipants,
  RTKSelf,
} from '@cloudflare/realtimekit';
import type {
  RoomCloudflareRealtimeKitCreateSessionRequest,
  RoomCloudflareRealtimeKitCreateSessionResponse,
  RoomMediaKind,
  RoomMediaRemoteTrackEvent,
  RoomMediaTransport,
  RoomMediaTransportConnectPayload,
  Subscription,
} from './room.js';

interface RoomCloudflareAudioVideoControls {
  disable(): Promise<void>;
  setMuted?(muted: boolean): Promise<void>;
  enable?(payload?: { trackId?: string; deviceId?: string; providerSessionId?: string }): Promise<void>;
}

interface RoomCloudflareScreenControls {
  stop(): Promise<void>;
  start?(payload?: { trackId?: string; deviceId?: string; providerSessionId?: string }): Promise<void>;
}

interface RoomCloudflareMediaAdapter {
  media: {
    audio: RoomCloudflareAudioVideoControls;
    video: RoomCloudflareAudioVideoControls;
    screen: RoomCloudflareScreenControls;
    devices: {
      switch(payload: {
        audioInputId?: string;
        videoInputId?: string;
        screenInputId?: string;
      }): Promise<void>;
    };
    cloudflareRealtimeKit: {
      createSession(payload?: RoomCloudflareRealtimeKitCreateSessionRequest): Promise<RoomCloudflareRealtimeKitCreateSessionResponse>;
    };
  };
}

interface LocalTrackState {
  kind: RoomMediaKind;
  track: MediaStreamTrack;
  deviceId?: string;
  stopOnCleanup: boolean;
}

type DisplayCaptureConstraints =
  NonNullable<MediaDevices['getDisplayMedia']> extends (constraints?: infer T) => Promise<MediaStream>
    ? T
    : MediaStreamConstraints;

export interface RoomCloudflareKitClient {
  join(): Promise<void>;
  leave(state?: unknown): Promise<void>;
  readonly participants: RTKParticipants;
  readonly self: RTKSelf;
}

export interface RoomCloudflareKitClientFactory {
  init(options: RTKClientOptions): Promise<RoomCloudflareKitClient>;
}

export interface RoomCloudflareMediaTransportOptions {
  autoSubscribe?: boolean;
  turn?: boolean | {
    ttl?: number;
    filterBrowserIncompatibleUrls?: boolean;
  };
  rtcConfiguration?: RTCConfiguration;
  peerConnectionFactory?: (configuration: RTCConfiguration) => RTCPeerConnection;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia' | 'getDisplayMedia' | 'enumerateDevices'>;
  clientFactory?: RoomCloudflareKitClientFactory;
}

/**
 * `connect()` now provisions a Cloudflare RealtimeKit participant token on the backend and
 * joins the meeting through the RealtimeKit browser SDK.
 */
interface ParticipantListenerSet {
  participant: RTKParticipant;
  onAudioUpdate: (payload: { audioEnabled: boolean; audioTrack: MediaStreamTrack }) => void;
  onVideoUpdate: (payload: { videoEnabled: boolean; videoTrack: MediaStreamTrack }) => void;
  onScreenShareUpdate: (payload: {
    screenShareEnabled: boolean;
    screenShareTracks: { audio?: MediaStreamTrack; video?: MediaStreamTrack };
  }) => void;
}

function buildRemoteTrackKey(participantId: string, kind: RoomMediaKind): string {
  return `${participantId}:${kind}`;
}

export class RoomCloudflareMediaTransport implements RoomMediaTransport {
  private readonly room: RoomCloudflareMediaAdapter;
  private readonly options: Required<Omit<RoomCloudflareMediaTransportOptions, 'clientFactory'>> & {
    clientFactory?: RoomCloudflareKitClientFactory;
  };
  private readonly localTracks = new Map<RoomMediaKind, LocalTrackState>();
  private readonly remoteTrackHandlers: Array<(event: RoomMediaRemoteTrackEvent) => void> = [];
  private readonly participantListeners = new Map<string, ParticipantListenerSet>();
  private readonly remoteTrackIds = new Map<string, string>();
  private clientFactoryPromise: Promise<RoomCloudflareKitClientFactory> | null = null;
  private connectPromise: Promise<string> | null = null;
  private lifecycleVersion = 0;
  private meeting: RoomCloudflareKitClient | null = null;
  private sessionId: string | null = null;
  private joinedMapSubscriptionsAttached = false;
  private onParticipantJoined = (participant: RTKParticipant) => {
    this.attachParticipant(participant);
  };
  private onParticipantLeft = (participant: RTKParticipant) => {
    this.detachParticipant(participant.id);
  };
  private onParticipantsCleared = () => {
    this.clearParticipantListeners();
  };
  private onParticipantsUpdate = () => {
    this.syncAllParticipants();
  };

  constructor(room: RoomCloudflareMediaAdapter, options?: RoomCloudflareMediaTransportOptions) {
    this.room = room;
    this.options = {
      autoSubscribe: options?.autoSubscribe ?? true,
      turn: options?.turn ?? true,
      rtcConfiguration: options?.rtcConfiguration ?? {},
      peerConnectionFactory:
        options?.peerConnectionFactory
        ?? ((configuration) => new RTCPeerConnection(configuration)),
      mediaDevices:
        options?.mediaDevices
        ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined as never),
      clientFactory: options?.clientFactory,
    };
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getPeerConnection(): RTCPeerConnection | null {
    return null;
  }

  async connect(payload?: RoomMediaTransportConnectPayload): Promise<string> {
    if (this.meeting && this.sessionId) {
      return this.sessionId;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    if (payload && typeof payload === 'object' && 'sessionDescription' in payload) {
      throw new Error(
        'RoomCloudflareMediaTransport.connect() does not accept sessionDescription; provider signaling is managed internally.',
      );
    }

    const connectPromise = (async () => {
      const lifecycleVersion = this.lifecycleVersion;
      const session = await this.room.media.cloudflareRealtimeKit.createSession(payload);
      this.assertConnectStillActive(lifecycleVersion);
      const factory = await this.resolveClientFactory();
      this.assertConnectStillActive(lifecycleVersion);
      const meeting = await factory.init({
        authToken: session.authToken,
        defaults: {
          audio: false,
          video: false,
        },
      });
      this.assertConnectStillActive(lifecycleVersion, meeting);

      this.meeting = meeting;
      this.sessionId = session.sessionId;
      this.attachParticipantMapListeners();

      try {
        await meeting.join();
        this.assertConnectStillActive(lifecycleVersion, meeting);
        this.syncAllParticipants();
        return session.sessionId;
      } catch (error) {
        if (this.meeting === meeting) {
          this.cleanupMeeting();
        } else {
          this.leaveMeetingSilently(meeting);
        }
        throw error;
      }
    })();

    this.connectPromise = connectPromise;
    try {
      return await connectPromise;
    } finally {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = null;
      }
    }
  }

  async enableAudio(constraints: MediaTrackConstraints | boolean = true): Promise<MediaStreamTrack> {
    const meeting = await this.ensureMeeting();
    const customTrack = await this.createUserMediaTrack('audio', constraints);

    await meeting.self.enableAudio(customTrack ?? undefined);
    const track = meeting.self.audioTrack ?? customTrack;
    if (!track) {
      throw new Error('RealtimeKit did not expose a local audio track after enabling audio.');
    }

    this.rememberLocalTrack('audio', track, track.getSettings().deviceId ?? customTrack?.getSettings().deviceId, !!customTrack);
    await this.room.media.audio.enable?.({
      trackId: track.id,
      deviceId: this.localTracks.get('audio')?.deviceId,
      providerSessionId: meeting.self.id,
    });
    return track;
  }

  async enableVideo(constraints: MediaTrackConstraints | boolean = true): Promise<MediaStreamTrack> {
    const meeting = await this.ensureMeeting();
    const customTrack = await this.createUserMediaTrack('video', constraints);

    await meeting.self.enableVideo(customTrack ?? undefined);
    const track = meeting.self.videoTrack ?? customTrack;
    if (!track) {
      throw new Error('RealtimeKit did not expose a local video track after enabling video.');
    }

    this.rememberLocalTrack('video', track, track.getSettings().deviceId ?? customTrack?.getSettings().deviceId, !!customTrack);
    await this.room.media.video.enable?.({
      trackId: track.id,
      deviceId: this.localTracks.get('video')?.deviceId,
      providerSessionId: meeting.self.id,
    });
    return track;
  }

  async startScreenShare(
    _constraints: DisplayCaptureConstraints = { video: true, audio: false },
  ): Promise<MediaStreamTrack> {
    const meeting = await this.ensureMeeting();
    await meeting.self.enableScreenShare();
    const track = meeting.self.screenShareTracks?.video;
    if (!track) {
      throw new Error('RealtimeKit did not expose a screen-share video track.');
    }

    track.addEventListener('ended', () => {
      void this.stopScreenShare();
    }, { once: true });

    this.rememberLocalTrack('screen', track, track.getSettings().deviceId, false);
    await this.room.media.screen.start?.({
      trackId: track.id,
      deviceId: track.getSettings().deviceId,
      providerSessionId: meeting.self.id,
    });
    return track;
  }

  async disableAudio(): Promise<void> {
    if (!this.meeting) return;
    await this.meeting.self.disableAudio();
    this.releaseLocalTrack('audio');
    await this.room.media.audio.disable();
  }

  async disableVideo(): Promise<void> {
    if (!this.meeting) return;
    await this.meeting.self.disableVideo();
    this.releaseLocalTrack('video');
    await this.room.media.video.disable();
  }

  async stopScreenShare(): Promise<void> {
    if (!this.meeting) return;
    await this.meeting.self.disableScreenShare();
    this.releaseLocalTrack('screen');
    await this.room.media.screen.stop();
  }

  async setMuted(kind: Extract<RoomMediaKind, 'audio' | 'video'>, muted: boolean): Promise<void> {
    const localTrack = this.localTracks.get(kind)?.track
      ?? (kind === 'audio' ? this.meeting?.self.audioTrack : this.meeting?.self.videoTrack);
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
  }): Promise<void> {
    const meeting = await this.ensureMeeting();

    if (payload.audioInputId) {
      const audioDevice = await meeting.self.getDeviceById(payload.audioInputId, 'audio');
      await meeting.self.setDevice(audioDevice);
      const audioTrack = meeting.self.audioTrack;
      if (audioTrack) {
        this.rememberLocalTrack('audio', audioTrack, payload.audioInputId, false);
      }
    }

    if (payload.videoInputId) {
      const videoDevice = await meeting.self.getDeviceById(payload.videoInputId, 'video');
      await meeting.self.setDevice(videoDevice);
      const videoTrack = meeting.self.videoTrack;
      if (videoTrack) {
        this.rememberLocalTrack('video', videoTrack, payload.videoInputId, false);
      }
    }

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
    this.lifecycleVersion += 1;
    this.connectPromise = null;
    for (const kind of this.localTracks.keys()) {
      this.releaseLocalTrack(kind);
    }
    this.clearParticipantListeners();
    this.detachParticipantMapListeners();
    this.cleanupMeeting();
  }

  private async ensureMeeting(): Promise<RoomCloudflareKitClient> {
    if (!this.meeting) {
      await this.connect();
    }
    if (!this.meeting) {
      throw new Error('Cloudflare media transport is not connected');
    }
    return this.meeting;
  }

  private async resolveClientFactory(): Promise<RoomCloudflareKitClientFactory> {
    if (this.options.clientFactory) {
      return this.options.clientFactory;
    }

    this.clientFactoryPromise ??= import('@cloudflare/realtimekit')
      .then((mod) => mod.default as RoomCloudflareKitClientFactory);
    return this.clientFactoryPromise;
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

  private attachParticipantMapListeners(): void {
    const participantMap = this.getParticipantMap();
    if (!participantMap || !this.meeting || this.joinedMapSubscriptionsAttached) {
      return;
    }

    participantMap.on('participantJoined', this.onParticipantJoined);
    participantMap.on('participantLeft', this.onParticipantLeft);
    participantMap.on('participantsCleared', this.onParticipantsCleared);
    participantMap.on('participantsUpdate', this.onParticipantsUpdate);
    this.joinedMapSubscriptionsAttached = true;
  }

  private detachParticipantMapListeners(): void {
    const participantMap = this.getParticipantMap();
    if (!participantMap || !this.meeting || !this.joinedMapSubscriptionsAttached) {
      return;
    }

    participantMap.off('participantJoined', this.onParticipantJoined);
    participantMap.off('participantLeft', this.onParticipantLeft);
    participantMap.off('participantsCleared', this.onParticipantsCleared);
    participantMap.off('participantsUpdate', this.onParticipantsUpdate);
    this.joinedMapSubscriptionsAttached = false;
  }

  private syncAllParticipants(): void {
    const participantMap = this.getParticipantMap();
    if (!participantMap || !this.meeting || !this.options.autoSubscribe) {
      return;
    }

    for (const participant of participantMap.values()) {
      this.attachParticipant(participant);
    }
  }

  private getParticipantMap(): RTKParticipants['active'] | RTKParticipants['joined'] | null {
    if (!this.meeting) {
      return null;
    }
    return this.meeting.participants.active ?? this.meeting.participants.joined ?? null;
  }

  private attachParticipant(participant: RTKParticipant): void {
    if (!this.options.autoSubscribe || !this.meeting) {
      return;
    }
    if (participant.id === this.meeting.self.id || this.participantListeners.has(participant.id)) {
      this.syncParticipantTracks(participant);
      return;
    }

    const listenerSet: ParticipantListenerSet = {
      participant,
      onAudioUpdate: ({ audioEnabled, audioTrack }) => {
        this.handleRemoteTrackUpdate('audio', participant, audioTrack, audioEnabled);
      },
      onVideoUpdate: ({ videoEnabled, videoTrack }) => {
        this.handleRemoteTrackUpdate('video', participant, videoTrack, videoEnabled);
      },
      onScreenShareUpdate: ({ screenShareEnabled, screenShareTracks }) => {
        this.handleRemoteTrackUpdate('screen', participant, screenShareTracks.video, screenShareEnabled);
      },
    };

    participant.on('audioUpdate', listenerSet.onAudioUpdate);
    participant.on('videoUpdate', listenerSet.onVideoUpdate);
    participant.on('screenShareUpdate', listenerSet.onScreenShareUpdate);
    this.participantListeners.set(participant.id, listenerSet);
    this.syncParticipantTracks(participant);
  }

  private detachParticipant(participantId: string): void {
    const listenerSet = this.participantListeners.get(participantId);
    if (!listenerSet) return;

    listenerSet.participant.off('audioUpdate', listenerSet.onAudioUpdate);
    listenerSet.participant.off('videoUpdate', listenerSet.onVideoUpdate);
    listenerSet.participant.off('screenShareUpdate', listenerSet.onScreenShareUpdate);
    this.participantListeners.delete(participantId);

    for (const kind of ['audio', 'video', 'screen'] as const) {
      this.remoteTrackIds.delete(buildRemoteTrackKey(participantId, kind));
    }
  }

  private clearParticipantListeners(): void {
    for (const participantId of Array.from(this.participantListeners.keys())) {
      this.detachParticipant(participantId);
    }
    this.remoteTrackIds.clear();
  }

  private syncParticipantTracks(participant: RTKParticipant): void {
    this.handleRemoteTrackUpdate('audio', participant, participant.audioTrack, participant.audioEnabled);
    this.handleRemoteTrackUpdate('video', participant, participant.videoTrack, participant.videoEnabled);
    this.handleRemoteTrackUpdate('screen', participant, participant.screenShareTracks?.video, participant.screenShareEnabled);
  }

  private handleRemoteTrackUpdate(
    kind: RoomMediaKind,
    participant: RTKParticipant,
    track: MediaStreamTrack | undefined,
    enabled: boolean,
  ): void {
    const key = buildRemoteTrackKey(participant.id, kind);
    if (!enabled || !track) {
      this.remoteTrackIds.delete(key);
      return;
    }

    const previousTrackId = this.remoteTrackIds.get(key);
    if (previousTrackId === track.id) {
      return;
    }

    this.remoteTrackIds.set(key, track.id);
    const payload: RoomMediaRemoteTrackEvent = {
      kind,
      track,
      stream: new MediaStream([track]),
      trackName: track.id,
      providerSessionId: participant.id,
      participantId: participant.id,
      customParticipantId: participant.customParticipantId,
      userId: participant.userId,
    };

    for (const handler of this.remoteTrackHandlers) {
      handler(payload);
    }
  }

  private cleanupMeeting(): void {
    const meeting = this.meeting;
    this.detachParticipantMapListeners();
    this.clearParticipantListeners();
    this.meeting = null;
    this.sessionId = null;

    this.leaveMeetingSilently(meeting);
  }

  private assertConnectStillActive(lifecycleVersion: number, meeting?: RoomCloudflareKitClient): void {
    if (lifecycleVersion === this.lifecycleVersion) {
      return;
    }
    if (meeting) {
      this.leaveMeetingSilently(meeting);
    }
    throw new Error('Cloudflare media transport was destroyed during connect.');
  }

  private leaveMeetingSilently(meeting: RoomCloudflareKitClient | null): void {
    if (!meeting) {
      return;
    }
    void meeting.leave().catch(() => {});
  }
}
