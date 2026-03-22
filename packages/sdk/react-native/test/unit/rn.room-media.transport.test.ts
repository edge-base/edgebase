import { describe, expect, it, vi } from 'vitest';
import {
  RoomCloudflareMediaTransport,
  type RoomCloudflareKitClient,
  type RoomCloudflareKitClientFactory,
} from '../../src/room-cloudflare-media';
import { RoomP2PMediaTransport } from '../../src/room-p2p-media';
import type {
  RoomCloudflareRealtimeKitCreateSessionRequest,
  RoomCloudflareRealtimeKitCreateSessionResponse,
  RoomMediaMember,
  RoomMember,
  RoomMemberLeaveReason,
  RoomSignalMeta,
  Subscription,
} from '../../src/room';

vi.mock('@cloudflare/react-native-webrtc', () => ({
  registerGlobals: vi.fn(() => {}),
  mediaDevices: {
    getUserMedia: vi.fn(),
    getDisplayMedia: vi.fn(),
  },
}), { virtual: true });

class FakeMediaStream {
  constructor(public readonly tracks: MediaStreamTrack[]) {}
  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter((track) => track.kind === 'video');
  }
}

class FakeTrack {
  enabled = true;
  onended: (() => void) | null = null;

  constructor(
    public readonly id: string,
    public readonly kind: 'audio' | 'video',
    private readonly settings: MediaTrackSettings = {},
  ) {}

  getSettings(): MediaTrackSettings {
    return this.settings;
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'ended') {
      this.onended = listener;
    }
  }

  stop(): void {}

  end(): void {
    this.onended?.();
  }
}

type ParticipantMapEventHandlers = {
  participantJoined: Array<(participant: FakeParticipant) => void>;
  participantLeft: Array<(participant: FakeParticipant) => void>;
  participantsCleared: Array<() => void>;
  participantsUpdate: Array<() => void>;
};

type ParticipantEventHandlers = {
  audioUpdate: Array<(payload: { audioEnabled: boolean; audioTrack: MediaStreamTrack }) => void>;
  videoUpdate: Array<(payload: { videoEnabled: boolean; videoTrack: MediaStreamTrack }) => void>;
  screenShareUpdate: Array<(payload: {
    screenShareEnabled: boolean;
    screenShareTracks: { audio?: MediaStreamTrack; video?: MediaStreamTrack };
  }) => void>;
};

class FakeParticipant {
  audioTrack?: MediaStreamTrack;
  audioEnabled = false;
  videoTrack?: MediaStreamTrack;
  videoEnabled = false;
  screenShareTracks: { audio?: MediaStreamTrack; video?: MediaStreamTrack } = {};
  screenShareEnabled = false;
  private readonly handlers: ParticipantEventHandlers = {
    audioUpdate: [],
    videoUpdate: [],
    screenShareUpdate: [],
  };

  constructor(
    public readonly id: string,
    public readonly customParticipantId?: string,
    public readonly userId?: string,
  ) {}

  on(event: keyof ParticipantEventHandlers, handler: ParticipantEventHandlers[typeof event][number]): void {
    this.handlers[event].push(handler as never);
  }

  off(event: keyof ParticipantEventHandlers, handler: ParticipantEventHandlers[typeof event][number]): void {
    this.handlers[event] = this.handlers[event].filter((entry) => entry !== handler) as never;
  }

  emitAudio(track: MediaStreamTrack, enabled = true): void {
    this.audioTrack = track;
    this.audioEnabled = enabled;
    for (const handler of this.handlers.audioUpdate) {
      handler({ audioEnabled: enabled, audioTrack: track });
    }
  }
}

class FakeParticipantMap extends Map<string, FakeParticipant> {
  private readonly handlers: ParticipantMapEventHandlers = {
    participantJoined: [],
    participantLeft: [],
    participantsCleared: [],
    participantsUpdate: [],
  };

  on(event: keyof ParticipantMapEventHandlers, handler: ParticipantMapEventHandlers[typeof event][number]): void {
    this.handlers[event].push(handler as never);
  }

  off(event: keyof ParticipantMapEventHandlers, handler: ParticipantMapEventHandlers[typeof event][number]): void {
    this.handlers[event] = this.handlers[event].filter((entry) => entry !== handler) as never;
  }

  emit(event: keyof ParticipantMapEventHandlers, payload?: FakeParticipant): void {
    for (const handler of this.handlers[event]) {
      if (payload) {
        (handler as (participant: FakeParticipant) => void)(payload);
      } else {
        (handler as () => void)();
      }
    }
  }
}

class FakeSelf {
  audioTrack?: MediaStreamTrack;
  videoTrack?: MediaStreamTrack;
  screenShareTracks: { audio?: MediaStreamTrack; video?: MediaStreamTrack } = {};

  constructor(public readonly id: string) {}

  async enableAudio(customTrack?: MediaStreamTrack): Promise<void> {
    this.audioTrack = customTrack ?? new FakeTrack('self-audio', 'audio') as unknown as MediaStreamTrack;
  }

  async enableVideo(customTrack?: MediaStreamTrack): Promise<void> {
    this.videoTrack = customTrack ?? new FakeTrack('self-video', 'video') as unknown as MediaStreamTrack;
  }

  async enableScreenShare(): Promise<void> {
    this.screenShareTracks = {
      video: new FakeTrack('self-screen', 'video') as unknown as MediaStreamTrack,
    };
  }

  async disableAudio(): Promise<void> {
    this.audioTrack = undefined;
  }

  async disableVideo(): Promise<void> {
    this.videoTrack = undefined;
  }

  async disableScreenShare(): Promise<void> {
    this.screenShareTracks = {};
  }

  async getDeviceById(deviceId: string, kind: string): Promise<{ deviceId: string; kind: string }> {
    return { deviceId, kind };
  }

  async setDevice(_device: unknown): Promise<void> {}
}

class FakeMeeting implements RoomCloudflareKitClient {
  readonly participants = { joined: new FakeParticipantMap() };
  readonly self = new FakeSelf('self-1');
  join = vi.fn(async () => {});
  leave = vi.fn(async () => {});
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeSender {
  constructor(public track: MediaStreamTrack | null) {}

  async replaceTrack(track: MediaStreamTrack | null): Promise<void> {
    this.track = track;
  }
}

let descriptionCounter = 0;

class FakeRTCPeerConnection {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  private readonly senders: FakeSender[] = [];

  addTrack(track: MediaStreamTrack, _stream: MediaStream): RTCRtpSender {
    const sender = new FakeSender(track);
    this.senders.push(sender);
    queueMicrotask(() => {
      this.onnegotiationneeded?.();
    });
    return sender as unknown as RTCRtpSender;
  }

  removeTrack(sender: RTCRtpSender): void {
    const index = this.senders.indexOf(sender as unknown as FakeSender);
    if (index >= 0) {
      this.senders.splice(index, 1);
    }
    queueMicrotask(() => {
      this.onnegotiationneeded?.();
    });
  }

  async setLocalDescription(description?: RTCSessionDescriptionInit): Promise<void> {
    if (description) {
      this.localDescription = description;
      return;
    }

    if (this.remoteDescription?.type === 'offer' && this.signalingState === 'have-remote-offer') {
      this.localDescription = {
        type: 'answer',
        sdp: `answer-${++descriptionCounter}`,
      };
      this.signalingState = 'stable';
      return;
    }

    this.localDescription = {
      type: 'offer',
      sdp: `offer-${++descriptionCounter}`,
    };
    this.signalingState = 'have-local-offer';
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }

  async addIceCandidate(_candidate: RTCIceCandidateInit): Promise<void> {}

  close(): void {
    this.connectionState = 'closed';
  }

  emitRemoteTrack(track: MediaStreamTrack): void {
    this.ontrack?.({
      track,
      streams: [new FakeMediaStream([track]) as unknown as MediaStream],
    } as RTCTrackEvent);
  }
}

function createSubscriptions<T extends (...args: any[]) => void>() {
  const handlers: T[] = [];
  return {
    handlers,
    subscribe(handler: T): Subscription {
      handlers.push(handler);
      return {
        unsubscribe: () => {
          const index = handlers.indexOf(handler);
          if (index >= 0) {
            handlers.splice(index, 1);
          }
        },
      };
    },
  };
}

function createCloudflareTransport(options?: {
  createSession?: (payload?: RoomCloudflareRealtimeKitCreateSessionRequest) => Promise<RoomCloudflareRealtimeKitCreateSessionResponse>;
  meeting?: FakeMeeting;
  clientFactory?: RoomCloudflareKitClientFactory;
  mediaDevices?: {
    getUserMedia?: (constraints?: MediaStreamConstraints) => Promise<{
      getAudioTracks(): MediaStreamTrack[];
      getVideoTracks(): MediaStreamTrack[];
    }>;
  };
}) {
  const meeting = options?.meeting ?? new FakeMeeting();
  const createSession = options?.createSession ?? vi.fn(async () => ({
    sessionId: 'sess-1',
    participantId: 'participant-self',
    meetingId: 'meeting-1',
    authToken: 'participant-token',
    presetName: 'group_call_participant',
  }));
  const factory = options?.clientFactory ?? {
    init: vi.fn(async () => meeting),
  };
  const room = {
    media: {
      audio: {
        enable: vi.fn(async () => {}),
        disable: vi.fn(async () => {}),
        setMuted: vi.fn(async () => {}),
      },
      video: {
        enable: vi.fn(async () => {}),
        disable: vi.fn(async () => {}),
        setMuted: vi.fn(async () => {}),
      },
      screen: {
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
      },
      devices: {
        switch: vi.fn(async () => {}),
      },
      cloudflareRealtimeKit: {
        createSession,
      },
    },
  };

  return {
    room,
    meeting,
    createSession,
    factory,
    transport: new RoomCloudflareMediaTransport(room as any, {
      clientFactory: factory,
      mediaDevices: options?.mediaDevices as any,
    }),
  };
}

function createP2PTransport(options?: {
  currentMember?: RoomMember | null;
  members?: RoomMember[];
  mediaMembers?: RoomMediaMember[];
  mediaDevices?: {
    getUserMedia?: (constraints?: MediaStreamConstraints) => Promise<{
      getAudioTracks(): MediaStreamTrack[];
      getVideoTracks(): MediaStreamTrack[];
    }>;
    getDisplayMedia?: (constraints?: unknown) => Promise<{
      getVideoTracks(): MediaStreamTrack[];
    }>;
  };
}) {
  const memberSync = createSubscriptions<(members: RoomMember[]) => void>();
  const memberJoin = createSubscriptions<(member: RoomMember) => void>();
  const memberLeave = createSubscriptions<(member: RoomMember, reason: RoomMemberLeaveReason) => void>();
  const mediaTrack = createSubscriptions<(track: any, member: RoomMember) => void>();
  const mediaTrackRemoved = createSubscriptions<(track: any, member: RoomMember) => void>();
  const signalHandlers = new Map<string, ReturnType<typeof createSubscriptions<(payload: unknown, meta: RoomSignalMeta) => void>>>();
  const peerConnections: FakeRTCPeerConnection[] = [];
  const getSignal = (event: string) => {
    let entry = signalHandlers.get(event);
    if (!entry) {
      entry = createSubscriptions<(payload: unknown, meta: RoomSignalMeta) => void>();
      signalHandlers.set(event, entry);
    }
    return entry;
  };

  const room = {
    media: {
      list: vi.fn(() => options?.mediaMembers ?? []),
      audio: {
        enable: vi.fn(async () => {}),
        disable: vi.fn(async () => {}),
        setMuted: vi.fn(async () => {}),
      },
      video: {
        enable: vi.fn(async () => {}),
        disable: vi.fn(async () => {}),
        setMuted: vi.fn(async () => {}),
      },
      screen: {
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
      },
      devices: {
        switch: vi.fn(async () => {}),
      },
      onTrack: (handler: (track: any, member: RoomMember) => void) => mediaTrack.subscribe(handler),
      onTrackRemoved: (handler: (track: any, member: RoomMember) => void) => mediaTrackRemoved.subscribe(handler),
    },
    members: {
      list: vi.fn(() => options?.members ?? []),
      current: vi.fn(() => options?.currentMember ?? null),
      onSync: (handler: (members: RoomMember[]) => void) => memberSync.subscribe(handler),
      onJoin: (handler: (member: RoomMember) => void) => memberJoin.subscribe(handler),
      onLeave: (handler: (member: RoomMember, reason: RoomMemberLeaveReason) => void) => memberLeave.subscribe(handler),
    },
    signals: {
      sendTo: vi.fn(async () => {}),
      on: (event: string, handler: (payload: unknown, meta: RoomSignalMeta) => void) =>
        getSignal(event).subscribe(handler),
    },
  };

  const transport = new RoomP2PMediaTransport(room as any, {
    mediaDevices: options?.mediaDevices as any,
    peerConnectionFactory: () => {
      const pc = new FakeRTCPeerConnection();
      peerConnections.push(pc);
      return pc as unknown as RTCPeerConnection;
    },
  });

  return {
    room,
    transport,
    peerConnections,
    emitSignal: (event: string, payload: unknown, meta: RoomSignalMeta) => {
      for (const handler of getSignal(event).handlers) {
        handler(payload, meta);
      }
    },
  };
}

describe('RN RoomCloudflareMediaTransport', () => {
  it('creates a RealtimeKit session and joins the meeting', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);
    const { transport, createSession, factory, meeting } = createCloudflareTransport();

    await expect(transport.connect({ connectionId: 'conn-1' })).resolves.toBe('sess-1');

    expect(createSession).toHaveBeenCalledWith({ connectionId: 'conn-1' });
    expect(factory.init).toHaveBeenCalledWith({
      authToken: 'participant-token',
      defaults: {
        audio: false,
        video: false,
      },
    });
    expect(meeting.join).toHaveBeenCalledTimes(1);
    expect(transport.getSessionId()).toBe('sess-1');
  });

  it('emits remote audio tracks from participant updates', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);
    const remoteEvents: string[] = [];
    const remoteParticipant = new FakeParticipant('participant-2', 'member-2', 'user-2');
    const meeting = new FakeMeeting();
    meeting.participants.joined.set(remoteParticipant.id, remoteParticipant);
    const { transport } = createCloudflareTransport({ meeting });

    transport.onRemoteTrack((event) => {
      remoteEvents.push(`${event.kind}:${event.track.id}:${event.participantId}`);
    });

    await transport.connect();
    remoteParticipant.emitAudio(new FakeTrack('remote-audio', 'audio') as unknown as MediaStreamTrack);

    expect(remoteEvents).toEqual(['audio:remote-audio:participant-2']);
  });

  it('cancels an in-flight connect when the transport is destroyed', async () => {
    const meeting = new FakeMeeting();
    const initDeferred = createDeferred<RoomCloudflareKitClient>();
    const { transport } = createCloudflareTransport({
      clientFactory: {
        init: vi.fn(() => initDeferred.promise),
      },
    });

    const connectPromise = transport.connect();
    transport.destroy();
    initDeferred.resolve(meeting);

    await expect(connectPromise).rejects.toThrow('Cloudflare media transport was destroyed during connect.');
    expect(meeting.join).not.toHaveBeenCalled();
    expect(transport.getSessionId()).toBeNull();
  });
});

describe('RN RoomP2PMediaTransport', () => {
  it('publishes local audio and negotiates with peers', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);

    const localTrack = new FakeTrack('local-audio', 'audio', { deviceId: 'mic-1' }) as unknown as MediaStreamTrack;
    const { transport, room } = createP2PTransport({
      currentMember: {
        memberId: 'member-1',
        userId: 'member-1',
        state: {},
      },
      members: [
        { memberId: 'member-1', userId: 'member-1', state: {} },
        { memberId: 'member-2', userId: 'member-2', state: {} },
      ],
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({
          getAudioTracks: () => [localTrack],
          getVideoTracks: () => [],
        })),
      },
    });

    await transport.connect();
    await transport.enableAudio();

    expect(room.media.audio.enable).toHaveBeenCalledWith({
      trackId: 'local-audio',
      deviceId: 'mic-1',
      providerSessionId: 'member-1',
    });
    expect(room.signals.sendTo).toHaveBeenCalledWith(
      'member-2',
      'edgebase.media.p2p.offer',
      expect.objectContaining({
        description: expect.objectContaining({ type: 'offer' }),
      }),
    );
  });

  it('emits a remote audio track when the peer connection receives one', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);
    const remoteEvents: string[] = [];
    const { transport, peerConnections, emitSignal } = createP2PTransport({
      currentMember: {
        memberId: 'member-1',
        userId: 'member-1',
        state: {},
      },
      members: [
        { memberId: 'member-1', userId: 'member-1', state: {} },
        { memberId: 'member-2', userId: 'member-2', state: {} },
      ],
      mediaMembers: [
        {
          member: { memberId: 'member-2', userId: 'member-2', state: {} },
          state: {},
          tracks: [{ kind: 'audio', trackId: 'remote-audio', muted: false }],
        },
      ],
    });

    transport.onRemoteTrack((event) => {
      remoteEvents.push(`${event.kind}:${event.track.id}:${event.participantId}`);
    });

    await transport.connect();
    emitSignal(
      'edgebase.media.p2p.offer',
      { description: { type: 'offer', sdp: 'remote-offer' } },
      { memberId: 'member-2' },
    );
    peerConnections[0]?.emitRemoteTrack(new FakeTrack('remote-audio', 'audio') as unknown as MediaStreamTrack);

    expect(remoteEvents).toEqual(['audio:remote-audio:member-2']);
  });
});
