import { createSubscription } from './room.js';
import type {
  RoomMediaKind,
  RoomMediaTrack,
  Subscription,
  RoomRealtimeCloseTracksRequest,
  RoomRealtimeCreateSessionRequest,
  RoomRealtimeCreateSessionResponse,
  RoomRealtimeIceServersRequest,
  RoomRealtimeIceServersResponse,
  RoomRealtimeRenegotiateRequest,
  RoomRealtimeSessionDescription,
  RoomRealtimeTrackObject,
  RoomRealtimeTracksRequest,
  RoomRealtimeTracksResponse,
} from './room.js';

interface RoomRealtimeAudioVideoControls {
  disable(): Promise<void>;
  setMuted?(muted: boolean): Promise<void>;
}

interface RoomRealtimeScreenControls {
  stop(): Promise<void>;
}

interface RoomRealtimeMediaAdapter {
  media: {
    list(): Array<{
      tracks: RoomMediaTrack[];
    }>;
    audio: RoomRealtimeAudioVideoControls;
    video: RoomRealtimeAudioVideoControls;
    screen: RoomRealtimeScreenControls;
    devices: {
      switch(payload: {
        audioInputId?: string;
        videoInputId?: string;
        screenInputId?: string;
      }): Promise<void>;
    };
    onTrack(handler: (track: RoomMediaTrack) => void): Subscription;
    onTrackRemoved(handler: (track: RoomMediaTrack) => void): Subscription;
    realtime: {
      createSession(payload?: RoomRealtimeCreateSessionRequest): Promise<RoomRealtimeCreateSessionResponse>;
      getIceServers(payload?: RoomRealtimeIceServersRequest): Promise<RoomRealtimeIceServersResponse>;
      addTracks(payload: RoomRealtimeTracksRequest): Promise<RoomRealtimeTracksResponse>;
      renegotiate(payload: RoomRealtimeRenegotiateRequest): Promise<RoomRealtimeTracksResponse>;
      closeTracks(payload: RoomRealtimeCloseTracksRequest): Promise<RoomRealtimeTracksResponse>;
    };
  };
}

interface LocalTrackState {
  kind: RoomMediaKind;
  track: MediaStreamTrack;
  transceiver: RTCRtpTransceiver;
  stream: MediaStream;
  trackName: string;
  deviceId?: string;
}

interface RemoteTrackSubscription {
  key: string;
  kind: RoomMediaKind;
  providerSessionId: string;
  trackName: string;
  mid?: string;
}

type DisplayCaptureConstraints =
  NonNullable<MediaDevices['getDisplayMedia']> extends (constraints?: infer T) => Promise<MediaStream>
    ? T
    : MediaStreamConstraints;

export interface RoomRealtimeMediaTransportOptions {
  autoSubscribe?: boolean;
  turn?: boolean | {
    ttl?: number;
    filterBrowserIncompatibleUrls?: boolean;
  };
  rtcConfiguration?: RTCConfiguration;
  peerConnectionFactory?: (configuration: RTCConfiguration) => RTCPeerConnection;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia' | 'getDisplayMedia'>;
}

export interface RoomRealtimeRemoteTrackEvent {
  kind: RoomMediaKind;
  track: MediaStreamTrack;
  stream: MediaStream;
  trackName?: string;
  providerSessionId?: string;
}

function generateTrackName(kind: RoomMediaKind): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${kind}-${crypto.randomUUID()}`;
  }
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildRemoteTrackKey(track: Pick<RoomMediaTrack, 'providerSessionId' | 'trackId' | 'kind'>): string | null {
  if (!track.providerSessionId || !track.trackId) return null;
  return `${track.providerSessionId}:${track.trackId}:${track.kind}`;
}

function toSessionDescription(description: RTCSessionDescriptionInit | RTCSessionDescription | null): RoomRealtimeSessionDescription {
  if (!description?.sdp || !description.type) {
    throw new Error('PeerConnection is missing a local session description');
  }
  return {
    sdp: description.sdp,
    type: description.type as 'offer' | 'answer',
  };
}

function normalizeIceServers(
  response: RoomRealtimeIceServersResponse,
  filterBrowserIncompatibleUrls: boolean,
): RTCIceServer[] {
  return (response.iceServers ?? []).map((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return {
      ...server,
      urls: filterBrowserIncompatibleUrls
        ? urls.filter((url) => !url.includes(':53'))
        : urls,
    };
  });
}

export class RoomRealtimeMediaTransport {
  private readonly room: RoomRealtimeMediaAdapter;
  private readonly options: Required<RoomRealtimeMediaTransportOptions>;
  private readonly localTracks = new Map<RoomMediaKind, LocalTrackState>();
  private readonly remoteSubscriptions = new Map<string, RemoteTrackSubscription>();
  private readonly remoteSubscriptionByMid = new Map<string, RemoteTrackSubscription>();
  private readonly remoteTrackHandlers: Array<(event: RoomRealtimeRemoteTrackEvent) => void> = [];
  private readonly unsubscribers: Subscription[] = [];
  private peerConnection: RTCPeerConnection | null = null;
  private sessionId: string | null = null;

  constructor(room: RoomRealtimeMediaAdapter, options?: RoomRealtimeMediaTransportOptions) {
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
    };
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  getPeerConnection(): RTCPeerConnection | null {
    return this.peerConnection;
  }

  async connect(payload?: RoomRealtimeCreateSessionRequest): Promise<string> {
    if (this.peerConnection && this.sessionId) {
      return this.sessionId;
    }

    const configuration = {
      ...this.options.rtcConfiguration,
      iceServers: await this.resolveIceServers(),
    } satisfies RTCConfiguration;

    this.peerConnection = this.options.peerConnectionFactory(configuration);
    this.peerConnection.ontrack = (event) => this.handleRemoteTrack(event);

    const response = await this.room.media.realtime.createSession(payload);
    this.sessionId = response.sessionId;

    this.attachRoomSubscriptions();
    await this.subscribeExistingPublishedTracks();
    return response.sessionId;
  }

  async enableAudio(constraints: MediaTrackConstraints | boolean = true): Promise<MediaStreamTrack> {
    const devices = this.requireMediaDevices();
    const stream = await devices.getUserMedia({ audio: constraints, video: false });
    const track = stream.getAudioTracks()[0];
    if (!track) {
      throw new Error('No audio track was returned by getUserMedia()');
    }
    await this.publishLocalTrack('audio', track, stream, track.getSettings().deviceId);
    return track;
  }

  async enableVideo(constraints: MediaTrackConstraints | boolean = true): Promise<MediaStreamTrack> {
    const devices = this.requireMediaDevices();
    const stream = await devices.getUserMedia({ audio: false, video: constraints });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      throw new Error('No video track was returned by getUserMedia()');
    }
    await this.publishLocalTrack('video', track, stream, track.getSettings().deviceId);
    return track;
  }

  async startScreenShare(
    constraints: DisplayCaptureConstraints = { video: true, audio: false },
  ): Promise<MediaStreamTrack> {
    const devices = this.requireMediaDevices();
    if (!devices.getDisplayMedia) {
      throw new Error('navigator.mediaDevices.getDisplayMedia() is not available in this environment');
    }
    const stream = await devices.getDisplayMedia(constraints);
    const track = stream.getVideoTracks()[0];
    if (!track) {
      throw new Error('No screen-share track was returned by getDisplayMedia()');
    }

    track.addEventListener('ended', () => {
      void this.stopScreenShare();
    }, { once: true });

    await this.publishLocalTrack('screen', track, stream, track.getSettings().deviceId);
    return track;
  }

  async disableAudio(): Promise<void> {
    await this.unpublishLocalTrack('audio');
  }

  async disableVideo(): Promise<void> {
    await this.unpublishLocalTrack('video');
  }

  async stopScreenShare(): Promise<void> {
    await this.unpublishLocalTrack('screen');
  }

  async setMuted(kind: Extract<RoomMediaKind, 'audio' | 'video'>, muted: boolean): Promise<void> {
    const local = this.localTracks.get(kind);
    if (local) {
      local.track.enabled = !muted;
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
    const devices = this.requireMediaDevices();

    if (payload.audioInputId && this.localTracks.has('audio')) {
      const stream = await devices.getUserMedia({
        audio: { deviceId: { exact: payload.audioInputId } },
        video: false,
      });
      const track = stream.getAudioTracks()[0];
      if (track) {
        await this.replaceLocalTrack('audio', track, stream, payload.audioInputId);
      }
    }

    if (payload.videoInputId && this.localTracks.has('video')) {
      const stream = await devices.getUserMedia({
        audio: false,
        video: { deviceId: { exact: payload.videoInputId } },
      });
      const track = stream.getVideoTracks()[0];
      if (track) {
        await this.replaceLocalTrack('video', track, stream, payload.videoInputId);
      }
    }

    await this.room.media.devices.switch(payload);
  }

  onRemoteTrack(handler: (event: RoomRealtimeRemoteTrackEvent) => void): Subscription {
    this.remoteTrackHandlers.push(handler);
    return createSubscription(() => {
      const index = this.remoteTrackHandlers.indexOf(handler);
      if (index >= 0) {
        this.remoteTrackHandlers.splice(index, 1);
      }
    });
  }

  destroy(): void {
    for (const local of this.localTracks.values()) {
      local.track.stop();
    }
    this.localTracks.clear();

    for (const unsubscribe of this.unsubscribers) {
      unsubscribe.unsubscribe();
    }
    this.unsubscribers.length = 0;
    this.remoteSubscriptions.clear();
    this.remoteSubscriptionByMid.clear();

    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.sessionId = null;
  }

  private attachRoomSubscriptions(): void {
    if (this.unsubscribers.length > 0 || !this.options.autoSubscribe) {
      return;
    }

    this.unsubscribers.push(
      this.room.media.onTrack((track) => {
        void this.subscribeRemoteTrack(track);
      }),
      this.room.media.onTrackRemoved((track) => {
        void this.unsubscribeRemoteTrack(track);
      }),
    );
  }

  private async subscribeExistingPublishedTracks(): Promise<void> {
    if (!this.options.autoSubscribe) return;
    for (const member of this.room.media.list()) {
      for (const track of member.tracks) {
        await this.subscribeRemoteTrack(track);
      }
    }
  }

  private async subscribeRemoteTrack(track: RoomMediaTrack): Promise<void> {
    if (!this.sessionId || !this.peerConnection) return;
    if (!track.providerSessionId || !track.trackId || track.providerSessionId === this.sessionId) {
      return;
    }

    const key = buildRemoteTrackKey(track);
    if (!key || this.remoteSubscriptions.has(key)) {
      return;
    }

    const response = await this.room.media.realtime.addTracks({
      sessionId: this.sessionId,
      tracks: [
        {
          location: 'remote',
          sessionId: track.providerSessionId,
          trackName: track.trackId,
        } satisfies RoomRealtimeTrackObject,
      ],
    });

    const subscription: RemoteTrackSubscription = {
      key,
      kind: track.kind,
      providerSessionId: track.providerSessionId,
      trackName: track.trackId,
      mid: response.tracks?.[0]?.mid,
    };

    this.remoteSubscriptions.set(key, subscription);
    if (subscription.mid) {
      this.remoteSubscriptionByMid.set(subscription.mid, subscription);
    }

    await this.applyTracksResponse(response);
  }

  private async unsubscribeRemoteTrack(track: RoomMediaTrack): Promise<void> {
    if (!this.sessionId) return;
    const key = buildRemoteTrackKey(track);
    if (!key) return;

    const subscription = this.remoteSubscriptions.get(key);
    if (!subscription?.mid) {
      this.remoteSubscriptions.delete(key);
      return;
    }

    const response = await this.room.media.realtime.closeTracks({
      sessionId: this.sessionId,
      tracks: [{ mid: subscription.mid }],
    });

    this.remoteSubscriptionByMid.delete(subscription.mid);
    this.remoteSubscriptions.delete(subscription.key);
    await this.applyTracksResponse(response);
  }

  private async publishLocalTrack(
    kind: RoomMediaKind,
    track: MediaStreamTrack,
    stream: MediaStream,
    deviceId?: string,
  ): Promise<void> {
    await this.connect();
    if (!this.peerConnection || !this.sessionId) {
      throw new Error('Realtime media transport is not connected');
    }

    if (this.localTracks.has(kind)) {
      await this.replaceLocalTrack(kind, track, stream, deviceId);
      return;
    }

    const transceiver = this.peerConnection.addTransceiver(track, { direction: 'sendonly' });
    const offer = await this.createLocalOffer();
    const trackName = generateTrackName(kind);
    const mid = transceiver.mid ?? this.findTransceiverMid(transceiver);

    const response = await this.room.media.realtime.addTracks({
      sessionId: this.sessionId,
      sessionDescription: offer,
      tracks: [
        {
          location: 'local',
          mid: mid ?? undefined,
          trackName,
        } satisfies RoomRealtimeTrackObject,
      ],
      publish: {
        kind,
        trackId: trackName,
        deviceId,
        muted: !track.enabled,
      },
    });

    await this.applyTracksResponse(response);
    this.localTracks.set(kind, {
      kind,
      track,
      transceiver,
      stream,
      trackName,
      deviceId,
    });
  }

  private async replaceLocalTrack(
    kind: RoomMediaKind,
    track: MediaStreamTrack,
    stream: MediaStream,
    deviceId?: string,
  ): Promise<void> {
    const existing = this.localTracks.get(kind);
    if (!existing) {
      await this.publishLocalTrack(kind, track, stream, deviceId);
      return;
    }

    await existing.transceiver.sender.replaceTrack(track);
    existing.track.stop();
    existing.track = track;
    existing.stream = stream;
    existing.deviceId = deviceId;
  }

  private async unpublishLocalTrack(kind: RoomMediaKind): Promise<void> {
    const local = this.localTracks.get(kind);
    if (!local || !this.peerConnection || !this.sessionId) {
      return;
    }

    local.transceiver.direction = 'inactive';
    const offer = await this.createLocalOffer();
    const mid = local.transceiver.mid ?? this.findTransceiverMid(local.transceiver);
    if (!mid) {
      throw new Error(`Cannot unpublish ${kind}: missing transceiver mid`);
    }
    const response = await this.room.media.realtime.closeTracks({
      sessionId: this.sessionId,
      sessionDescription: offer,
      tracks: [{ mid }],
      unpublish: { kind },
    });

    await this.applyTracksResponse(response);
    local.track.stop();
    this.localTracks.delete(kind);

  }

  private async applyTracksResponse(response: RoomRealtimeTracksResponse): Promise<void> {
    if (!this.peerConnection) return;

    if (response.errorCode) {
      throw new Error(response.errorDescription || response.errorCode);
    }

    const trackError = response.tracks?.find((track) => track.errorCode);
    if (trackError?.errorCode) {
      throw new Error(trackError.errorDescription || trackError.errorCode);
    }

    const sessionDescription = response.sessionDescription;
    if (!sessionDescription) {
      return;
    }

    if (sessionDescription.type === 'answer') {
      await this.peerConnection.setRemoteDescription(sessionDescription);
      return;
    }

    await this.peerConnection.setRemoteDescription(sessionDescription);
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    await this.waitForIceGatheringComplete();

    const renegotiateResponse = await this.room.media.realtime.renegotiate({
      sessionId: this.sessionId!,
      sessionDescription: toSessionDescription(this.peerConnection.localDescription),
    });

    if (renegotiateResponse.sessionDescription?.type === 'answer') {
      await this.peerConnection.setRemoteDescription(renegotiateResponse.sessionDescription);
    }
  }

  private async createLocalOffer(): Promise<RoomRealtimeSessionDescription> {
    if (!this.peerConnection) {
      throw new Error('Realtime media transport is not connected');
    }
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    await this.waitForIceGatheringComplete();
    return toSessionDescription(this.peerConnection.localDescription);
  }

  private async waitForIceGatheringComplete(): Promise<void> {
    if (!this.peerConnection || this.peerConnection.iceGatheringState === 'complete') {
      return;
    }

    await new Promise<void>((resolve) => {
      const onStateChange = () => {
        if (this.peerConnection?.iceGatheringState === 'complete') {
          this.peerConnection.removeEventListener('icegatheringstatechange', onStateChange);
          resolve();
        }
      };
      this.peerConnection?.addEventListener('icegatheringstatechange', onStateChange);
    });
  }

  private async resolveIceServers(): Promise<RTCIceServer[] | undefined> {
    if (!this.options.turn) {
      return this.options.rtcConfiguration.iceServers;
    }

    const turnOptions = typeof this.options.turn === 'object' ? this.options.turn : {};
    const response = await this.room.media.realtime.getIceServers({
      ttl: turnOptions.ttl,
    });

    return normalizeIceServers(response, turnOptions.filterBrowserIncompatibleUrls !== false);
  }

  private handleRemoteTrack(event: RTCTrackEvent): void {
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    const subscription = event.transceiver.mid
      ? this.remoteSubscriptionByMid.get(event.transceiver.mid)
      : undefined;

    const payload: RoomRealtimeRemoteTrackEvent = {
      kind: subscription?.kind ?? (event.track.kind === 'audio' ? 'audio' : 'video'),
      track: event.track,
      stream,
      trackName: subscription?.trackName,
      providerSessionId: subscription?.providerSessionId,
    };

    for (const handler of this.remoteTrackHandlers) {
      handler(payload);
    }
  }

  private findTransceiverMid(transceiver: RTCRtpTransceiver): string | null {
    return transceiver.mid ?? null;
  }

  private requireMediaDevices(): Pick<MediaDevices, 'getUserMedia' | 'getDisplayMedia'> {
    if (!this.options.mediaDevices?.getUserMedia) {
      throw new Error('navigator.mediaDevices.getUserMedia() is not available in this environment');
    }
    return this.options.mediaDevices;
  }
}
