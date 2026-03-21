import { describe, expect, it, vi } from 'vitest';
import {
  RoomCloudflareMediaTransport,
  type RoomCloudflareKitClient,
  type RoomCloudflareKitClientFactory,
} from '../../src/room-cloudflare-media.js';
import type {
  RoomCloudflareRealtimeKitCreateSessionRequest,
  RoomCloudflareRealtimeKitCreateSessionResponse,
  RoomMediaTransportConnectPayload,
  Subscription,
} from '../../src/room.js';

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

class FakeMediaStream {
  constructor(public readonly tracks: MediaStreamTrack[]) {}
}

class FakeTrack {
  enabled = true;
  onended: (() => void) | null = null;

  constructor(
    public readonly id: string,
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
}

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

  emitVideo(track: MediaStreamTrack, enabled = true): void {
    this.videoTrack = track;
    this.videoEnabled = enabled;
    for (const handler of this.handlers.videoUpdate) {
      handler({ videoEnabled: enabled, videoTrack: track });
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
    this.audioTrack = customTrack ?? new FakeTrack('self-audio') as unknown as MediaStreamTrack;
  }

  async enableVideo(customTrack?: MediaStreamTrack): Promise<void> {
    this.videoTrack = customTrack ?? new FakeTrack('self-video') as unknown as MediaStreamTrack;
  }

  async enableScreenShare(): Promise<void> {
    this.screenShareTracks = {
      video: new FakeTrack('self-screen') as unknown as MediaStreamTrack,
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
  readonly participants = { joined: new FakeParticipantMap() } as unknown as RoomCloudflareKitClient['participants'];
  readonly self = new FakeSelf('self-1') as unknown as RoomCloudflareKitClient['self'];
  join = vi.fn(async () => {});
  leave = vi.fn(async () => {});
}

function createTransport(options?: {
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
  const noopSubscription: Subscription = { unsubscribe: () => {} };
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
    onTrack: () => noopSubscription,
    onTrackRemoved: () => noopSubscription,
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

describe('RoomCloudflareMediaTransport', () => {
  it('creates a RealtimeKit session and joins the meeting', async () => {
    const { transport, createSession, factory, meeting } = createTransport();

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
    expect(transport.getPeerConnection()).toBeNull();
  });

  it('rejects caller-provided session descriptions because the transport owns provider signaling', async () => {
    const { transport, createSession } = createTransport();
    const payload = {
      connectionId: 'conn-1',
      sessionDescription: {
        type: 'offer',
        sdp: 'caller-offer',
      },
    } as RoomMediaTransportConnectPayload & RoomCloudflareRealtimeKitCreateSessionRequest;

    await expect(transport.connect(payload)).rejects.toThrow(
      'RoomCloudflareMediaTransport.connect() does not accept sessionDescription; provider signaling is managed internally.',
    );

    expect(createSession).not.toHaveBeenCalled();
  });

  it('syncs local publish state and emits remote tracks from participant updates', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);

    const localAudioTrack = new FakeTrack('local-audio', { deviceId: 'mic-1' }) as unknown as MediaStreamTrack;
    const remoteAudioTrack = new FakeTrack('remote-audio') as unknown as MediaStreamTrack;
    const { transport, room, meeting } = createTransport({
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({
          getAudioTracks: () => [localAudioTrack],
          getVideoTracks: () => [],
        })),
      },
    });
    const remoteTrackHandler = vi.fn();
    transport.onRemoteTrack(remoteTrackHandler);

    await transport.connect({ connectionId: 'conn-1' });
    await expect(transport.enableAudio({ deviceId: 'mic-1' })).resolves.toBe(localAudioTrack);

    expect(room.media.audio.enable).toHaveBeenCalledWith({
      trackId: 'local-audio',
      deviceId: 'mic-1',
      providerSessionId: 'self-1',
    });

    const remoteParticipant = new FakeParticipant('participant-2', 'member-2', 'user-2');
    (meeting.participants.joined as unknown as FakeParticipantMap).set(remoteParticipant.id, remoteParticipant);
    (meeting.participants.joined as unknown as FakeParticipantMap).emit('participantJoined', remoteParticipant);
    remoteParticipant.emitAudio(remoteAudioTrack);

    expect(remoteTrackHandler).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'audio',
      track: remoteAudioTrack,
      providerSessionId: 'participant-2',
      participantId: 'participant-2',
      customParticipantId: 'member-2',
      userId: 'user-2',
      trackName: 'remote-audio',
    }));
  });
});
