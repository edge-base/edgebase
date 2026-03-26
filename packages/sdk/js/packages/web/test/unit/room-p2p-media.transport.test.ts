import { describe, expect, it, vi } from 'vitest';
import { RoomP2PMediaTransport } from '../../src/room-p2p-media.js';
import type {
  RoomMediaMember,
  RoomMember,
  RoomMemberLeaveReason,
  RoomSignalMeta,
  Subscription,
} from '../../src/room.js';

class FakeMediaStream {
  constructor(public readonly tracks: MediaStreamTrack[]) {}
}

class FakeTrack {
  enabled = true;
  private endedListener: (() => void) | null = null;

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
      this.endedListener = listener;
    }
  }

  stop(): void {}

  end(): void {
    this.endedListener?.();
  }
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
  iceConnectionState: RTCIceConnectionState = 'new';
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  onnegotiationneeded: (() => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onsignalingstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
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
      if (description.type === 'rollback') {
        this.localDescription = null;
        this.signalingState = 'stable';
        this.onsignalingstatechange?.();
        return;
      }
      this.localDescription = description;
      this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
      this.onsignalingstatechange?.();
      return;
    }

    if (this.remoteDescription?.type === 'offer' && this.signalingState === 'have-remote-offer') {
      this.localDescription = {
        type: 'answer',
        sdp: `answer-${++descriptionCounter}`,
      };
      this.signalingState = 'stable';
      this.onsignalingstatechange?.();
      return;
    }

    this.localDescription = {
      type: 'offer',
      sdp: `offer-${++descriptionCounter}`,
    };
    this.signalingState = 'have-local-offer';
    this.onsignalingstatechange?.();
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
    this.onsignalingstatechange?.();
  }

  async addIceCandidate(_candidate: RTCIceCandidateInit): Promise<void> {}

  restartIce(): void {
    queueMicrotask(() => {
      this.onnegotiationneeded?.();
    });
  }

  close(): void {
    this.connectionState = 'closed';
    this.onconnectionstatechange?.();
  }

  emitRemoteTrack(track: MediaStreamTrack): void {
    this.ontrack?.({
      track,
      streams: [new FakeMediaStream([track]) as unknown as MediaStream],
    } as RTCTrackEvent);
  }

  setIceConnectionState(state: RTCIceConnectionState): void {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.();
  }

  setConnectionState(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
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

function createTransport(options?: {
  currentMember?: RoomMember | null;
  members?: RoomMember[];
  mediaMembers?: RoomMediaMember[];
  mediaDevices?: {
    getUserMedia?: (constraints?: MediaStreamConstraints) => Promise<{
      getAudioTracks(): MediaStreamTrack[];
      getVideoTracks(): MediaStreamTrack[];
    }>;
    getDisplayMedia?: (constraints?: MediaStreamConstraints) => Promise<{
      getVideoTracks(): MediaStreamTrack[];
    }>;
  };
  realtimeIceServers?: () => Promise<{ iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }> }>;
}) {
  const memberSync = createSubscriptions<(members: RoomMember[]) => void>();
  const memberJoin = createSubscriptions<(member: RoomMember) => void>();
  const memberLeave = createSubscriptions<(member: RoomMember, reason: RoomMemberLeaveReason) => void>();
  const mediaTrack = createSubscriptions<(track: any, member: RoomMember) => void>();
  const mediaTrackRemoved = createSubscriptions<(track: any, member: RoomMember) => void>();
  const mediaStateChange = createSubscriptions<(member: RoomMember, state: any) => void>();
  const signalHandlers = new Map<string, createSubscriptions<(payload: unknown, meta: RoomSignalMeta) => void>>();
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
      onStateChange: (handler: (member: RoomMember, state: any) => void) => mediaStateChange.subscribe(handler),
      realtime: options?.realtimeIceServers
        ? {
            iceServers: vi.fn(async () => options.realtimeIceServers?.()),
          }
        : undefined,
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
    emitMemberJoin: (member: RoomMember) => {
      for (const handler of memberJoin.handlers) {
        handler(member);
      }
    },
    emitMemberSync: (members: RoomMember[]) => {
      for (const handler of memberSync.handlers) {
        handler(members);
      }
    },
    emitMemberLeave: (member: RoomMember, reason: RoomMemberLeaveReason) => {
      for (const handler of memberLeave.handlers) {
        handler(member, reason);
      }
    },
    emitMediaTrack: (track: { kind: 'audio' | 'video' | 'screen'; trackId?: string }, member: RoomMember) => {
      for (const handler of mediaTrack.handlers) {
        handler(track, member);
      }
    },
    emitMediaTrackRemoved: (track: { kind: 'audio' | 'video' | 'screen'; trackId?: string }, member: RoomMember) => {
      for (const handler of mediaTrackRemoved.handlers) {
        handler(track, member);
      }
    },
    emitMediaStateChange: (member: RoomMember, state: any) => {
      for (const handler of mediaStateChange.handlers) {
        handler(member, state);
      }
    },
  };
}

describe('RoomP2PMediaTransport', () => {
  it('requires the room to be joined before connecting', async () => {
    vi.useFakeTimers();
    const { transport } = createTransport();

    const pending = transport.connect();
    const rejection = expect(pending).rejects.toThrow(
      'Join the room before connecting a P2P media transport.',
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    vi.useRealTimers();
  });

  it('publishes local audio and negotiates with existing peers', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);

    const localTrack = new FakeTrack('local-audio', 'audio', { deviceId: 'mic-1' }) as unknown as MediaStreamTrack;
    const { transport, room } = createTransport({
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
    await expect(transport.enableAudio({ deviceId: 'mic-1' })).resolves.toBe(localTrack);
    await new Promise((resolve) => setTimeout(resolve, 0));

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

  it('clears the media health-check interval when destroyed', async () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { transport } = createTransport({
      currentMember: {
        memberId: 'member-1',
        userId: 'member-1',
        state: {},
      },
      members: [
        { memberId: 'member-1', userId: 'member-1', state: {} },
        { memberId: 'member-2', userId: 'member-2', state: {} },
      ],
    });

    await transport.connect();
    transport.destroy();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
    vi.useRealTimers();
  });

  it('retries loading TURN / ICE credentials after a transient failure on reconnect', async () => {
    const realtimeIceServers = vi
      .fn<() => Promise<{ iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }> }>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({
        iceServers: [{ urls: 'turn:relay.example.com', username: 'user', credential: 'pass' }],
      });

    const { transport } = createTransport({
      currentMember: {
        memberId: 'member-1',
        userId: 'member-1',
        state: {},
      },
      members: [
        { memberId: 'member-1', userId: 'member-1', state: {} },
      ],
      realtimeIceServers,
    });

    await transport.connect();
    transport.destroy();
    await transport.connect();

    expect(realtimeIceServers).toHaveBeenCalledTimes(2);
  });

  it('coalesces initial audio/video publish into a single negotiation batch', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);

    const localAudioTrack = new FakeTrack('local-audio', 'audio', { deviceId: 'mic-1' }) as unknown as MediaStreamTrack;
    const localVideoTrack = new FakeTrack('local-video', 'video', { deviceId: 'cam-1' }) as unknown as MediaStreamTrack;
    const { transport, room } = createTransport({
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
        getUserMedia: vi.fn(async (constraints?: MediaStreamConstraints) => ({
          getAudioTracks: () => (constraints?.audio ? [localAudioTrack] : []),
          getVideoTracks: () => (constraints?.video ? [localVideoTrack] : []),
        })),
      },
    });

    await transport.connect();
    await transport.batchLocalUpdates!(async () => {
      await transport.enableAudio({ deviceId: 'mic-1' });
      await transport.enableVideo({ deviceId: 'cam-1' });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const offerCalls = (room.signals.sendTo as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([memberId, event]) => memberId === 'member-2' && event === 'edgebase.media.p2p.offer',
    );

    expect(offerCalls).toHaveLength(1);
  });

  it('creates a peer when remote members arrive through members sync after connect', async () => {
    const currentMember = { memberId: 'me', userId: 'me' } as RoomMember;
    const remoteMember = { memberId: 'them', userId: 'them' } as RoomMember;
    const { transport, peerConnections, emitMemberSync } = createTransport({
      currentMember,
      members: [],
    });

    await transport.connect();
    expect(peerConnections).toHaveLength(0);

    emitMemberSync([currentMember, remoteMember]);

    expect(peerConnections).toHaveLength(1);
  });

  it('emits remote tracks using room media state to preserve kind metadata', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);

    const remoteTrack = new FakeTrack('remote-screen', 'video') as unknown as MediaStreamTrack;
    const { transport, peerConnections } = createTransport({
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
          state: {
            screen: {
              published: true,
              muted: false,
              trackId: 'remote-screen',
            },
          },
          tracks: [
            {
              kind: 'screen',
              trackId: 'remote-screen',
              muted: false,
            },
          ],
        },
      ],
    });

    const remoteTrackHandler = vi.fn();
    transport.onRemoteTrack(remoteTrackHandler);
    await transport.connect();

    peerConnections[0]?.emitRemoteTrack(remoteTrack);

    expect(remoteTrackHandler).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'screen',
      track: remoteTrack,
      participantId: 'member-2',
      providerSessionId: 'member-2',
    }));
  });

  it('falls back to member media kind when remote video track ids differ from room state', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);

    const remoteTrack = new FakeTrack('webrtc-video-track', 'video') as unknown as MediaStreamTrack;
    const remoteMember = { memberId: 'member-2', userId: 'member-2', state: {} };
    const mediaMembers: RoomMediaMember[] = [
      {
        member: remoteMember,
        state: {},
        tracks: [],
      },
    ];
    const { transport, peerConnections, emitMediaTrack } = createTransport({
      currentMember: {
        memberId: 'member-1',
        userId: 'member-1',
        state: {},
      },
      members: [
        { memberId: 'member-1', userId: 'member-1', state: {} },
        remoteMember,
      ],
      mediaMembers,
    });

    const remoteTrackHandler = vi.fn();
    transport.onRemoteTrack(remoteTrackHandler);
    await transport.connect();

    peerConnections[0]?.emitRemoteTrack(remoteTrack);
    mediaMembers[0]?.tracks.push({
      kind: 'video',
      trackId: 'room-state-video-track',
      muted: false,
    });
    emitMediaTrack({
      kind: 'video',
      trackId: 'room-state-video-track',
    }, remoteMember);

    expect(remoteTrackHandler).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'video',
      track: remoteTrack,
      participantId: 'member-2',
      providerSessionId: 'member-2',
    }));
  });

  it('maps dual video-like fallback tracks when video and screen are both published', async () => {
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);

    const remoteMember = { memberId: 'member-2', userId: 'member-2', state: {} };
    const mediaMembers: RoomMediaMember[] = [
      {
        member: remoteMember,
        state: {},
        tracks: [
          { kind: 'video', trackId: 'room-video-track', muted: false },
          { kind: 'screen', trackId: 'room-screen-track', muted: false },
        ],
      },
    ];
    const { transport, peerConnections } = createTransport({
      currentMember: {
        memberId: 'member-1',
        userId: 'member-1',
        state: {},
      },
      members: [
        { memberId: 'member-1', userId: 'member-1', state: {} },
        remoteMember,
      ],
      mediaMembers,
    });

    const remoteEvents: string[] = [];
    transport.onRemoteTrack((event) => {
      remoteEvents.push(`${event.kind}:${event.track.id}`);
    });
    await transport.connect();

    peerConnections[0]?.emitRemoteTrack(new FakeTrack('webrtc-video-track', 'video') as unknown as MediaStreamTrack);
    peerConnections[0]?.emitRemoteTrack(new FakeTrack('webrtc-screen-track', 'video') as unknown as MediaStreamTrack);

    expect(remoteEvents).toEqual([
      'video:webrtc-video-track',
      'screen:webrtc-screen-track',
    ]);
  });

  it('retries negotiation after a peer reports disconnected with published media but no remote track', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);

    const remoteMember = { memberId: 'member-2', userId: 'member-2', state: {} };
    const mediaMembers: RoomMediaMember[] = [
      {
        member: remoteMember,
        state: {
          video: {
            published: true,
            muted: false,
          },
        },
        tracks: [],
      },
    ];
    const { transport, room, peerConnections, emitMediaStateChange } = createTransport({
      currentMember: {
        memberId: 'member-1',
        userId: 'member-1',
        state: {},
      },
      members: [
        { memberId: 'member-1', userId: 'member-1', state: {} },
        remoteMember,
      ],
      mediaMembers,
    });

    await transport.connect();
    expect(peerConnections).toHaveLength(1);

    emitMediaStateChange(remoteMember, mediaMembers[0]?.state);
    peerConnections[0]?.setIceConnectionState('disconnected');
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.runAllTicks();

    expect(room.signals.sendTo).toHaveBeenCalledWith(
      'member-2',
      'edgebase.media.p2p.offer',
      expect.objectContaining({
        description: expect.objectContaining({ type: 'offer' }),
      }),
    );

    vi.useRealTimers();
  });

  it('batches ICE candidates per peer before sending room signals', async () => {
    vi.useFakeTimers();
    const { transport, room, peerConnections } = createTransport({
      currentMember: {
        memberId: 'member-1',
        userId: 'member-1',
        state: {},
      },
      members: [
        { memberId: 'member-1', userId: 'member-1', state: {} },
        { memberId: 'member-2', userId: 'member-2', state: {} },
      ],
    });

    await transport.connect();
    expect(peerConnections).toHaveLength(1);

    peerConnections[0]?.onicecandidate?.({
      candidate: { candidate: 'candidate-1' } as RTCIceCandidate,
    });
    peerConnections[0]?.onicecandidate?.({
      candidate: { candidate: 'candidate-2' } as RTCIceCandidate,
    });

    await vi.advanceTimersByTimeAsync(50);

    const iceCalls = (room.signals.sendTo as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([memberId, event]) => memberId === 'member-2' && event === 'edgebase.media.p2p.ice',
    );

    expect(iceCalls).toHaveLength(1);
    expect(iceCalls[0]?.[2]).toEqual({
      candidates: [
        { candidate: 'candidate-1' },
        { candidate: 'candidate-2' },
      ],
    });

    vi.useRealTimers();
  });

  it('rolls back polite peers before applying a colliding remote offer', async () => {
    const remoteMember = { memberId: 'member-1', userId: 'member-1', state: {} };
    const { transport, room, emitSignal, peerConnections } = createTransport({
      currentMember: {
        memberId: 'member-2',
        userId: 'member-2',
        state: {},
      },
      members: [
        remoteMember,
        { memberId: 'member-2', userId: 'member-2', state: {} },
      ],
    });

    await transport.connect();
    expect(peerConnections).toHaveLength(1);

    await peerConnections[0]?.setLocalDescription();
    expect(peerConnections[0]?.signalingState).toBe('have-local-offer');

    emitSignal(
      'edgebase.media.p2p.offer',
      { description: { type: 'offer', sdp: 'remote-offer' } },
      { memberId: 'member-1' },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(peerConnections[0]?.remoteDescription).toEqual({
      type: 'offer',
      sdp: 'remote-offer',
    });
    expect(room.signals.sendTo).toHaveBeenCalledWith(
      'member-1',
      'edgebase.media.p2p.answer',
      expect.objectContaining({
        description: expect.objectContaining({ type: 'answer' }),
      }),
    );
  });
});
