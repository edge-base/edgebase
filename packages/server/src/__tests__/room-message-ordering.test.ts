import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class DurableObject {},
}));

// Regression guard for the join/member_state race: the hibernation runtime
// delivers a new webSocketMessage event as soon as a previous handler awaits
// something outside the storage input gate (e.g. an async join access rule
// doing sub-requests). Without per-socket serialization, a client that sends
// `join` immediately followed by `member_state` gets the state update
// processed mid-join and rejected with "Join the room before updating member
// state" despite correct client-side ordering.
describe('room websocket message ordering', () => {
  async function makeRoom() {
    const { RoomRuntimeBaseDO } = await import('../durable-objects/room-runtime-base.js');
    return Object.create(RoomRuntimeBaseDO.prototype) as {
      webSocketMessage: (ws: unknown, message: string) => Promise<void>;
      processWebSocketMessage: (ws: unknown, message: string) => Promise<void>;
    };
  }

  it('serializes messages per socket so a state update cannot overtake a slow join', async () => {
    const room = await makeRoom();
    const order: string[] = [];
    room.processWebSocketMessage = vi.fn(async (_ws: unknown, message: string) => {
      order.push(`start:${message}`);
      // Simulate a slow async join access rule (sub-request to another DO).
      if (message === 'join') await new Promise((resolve) => setTimeout(resolve, 25));
      order.push(`end:${message}`);
    });

    const ws = {};
    const join = room.webSocketMessage(ws, 'join');
    const state = room.webSocketMessage(ws, 'member_state');
    await Promise.all([join, state]);

    expect(order).toEqual(['start:join', 'end:join', 'start:member_state', 'end:member_state']);
  });

  it('keeps sockets independent and survives a rejected message', async () => {
    const room = await makeRoom();
    const order: string[] = [];
    room.processWebSocketMessage = vi.fn(async (ws: unknown, message: string) => {
      if (message === 'boom') throw new Error('boom');
      if (message === 'slow') await new Promise((resolve) => setTimeout(resolve, 25));
      order.push(`${(ws as { id: string }).id}:${message}`);
    });

    const a = { id: 'a' };
    const b = { id: 'b' };
    // A slow message on socket A must not delay socket B.
    const slow = room.webSocketMessage(a, 'slow');
    await room.webSocketMessage(b, 'fast');
    expect(order).toEqual(['b:fast']);
    await slow;
    expect(order).toEqual(['b:fast', 'a:slow']);

    // A rejection surfaces to the caller but does not wedge the chain.
    await expect(room.webSocketMessage(a, 'boom')).rejects.toThrow('boom');
    await room.webSocketMessage(a, 'after');
    expect(order).toEqual(['b:fast', 'a:slow', 'a:after']);
  });
});
