/**
 * room-config-normalization.test.ts — Config Normalization Gate
 *
 * Validates that the config normalization layer correctly:
 *   - Migrates legacy handlers to canonical state/hooks shapes
 *   - Rejects mixed legacy + canonical definitions with different values
 *   - Allows identical legacy + canonical (no-op migration)
 *   - Rejects top-level legacy aliases (onCreate, onJoin, etc.)
 */
import { describe, it, expect } from 'vitest';
import { materializeConfig } from '@edge-base/shared';

// ─── 1. Legacy → Canonical Auto-Migration ───

describe('Room config normalization — legacy auto-migration', () => {
  it('handlers.actions migrates to state.actions', () => {
    const handler = () => ({ done: true });
    const config = materializeConfig({
      rooms: {
        game: {
          public: true,
          handlers: {
            actions: { DO_THING: handler },
          },
        },
      },
    });
    expect(config.rooms!.game.state!.actions!.DO_THING).toBe(handler);
  });

  it('handlers.timers migrates to state.timers', () => {
    const handler = () => {};
    const config = materializeConfig({
      rooms: {
        game: {
          public: true,
          handlers: {
            timers: { TICK: handler },
          },
        },
      },
    });
    expect(config.rooms!.game.state!.timers!.TICK).toBe(handler);
  });

  it('handlers.lifecycle migrates to hooks.lifecycle', () => {
    const handler = () => {};
    const config = materializeConfig({
      rooms: {
        game: {
          public: true,
          handlers: {
            lifecycle: { onCreate: handler },
          },
        },
      },
    });
    expect(config.rooms!.game.hooks!.lifecycle!.onCreate).toBe(handler);
  });

  it('migrates all three handler groups at once', () => {
    const actionHandler = () => ({});
    const timerHandler = () => {};
    const lifecycleHandler = () => {};
    const config = materializeConfig({
      rooms: {
        game: {
          public: true,
          handlers: {
            actions: { MOVE: actionHandler },
            timers: { TURN: timerHandler },
            lifecycle: { onJoin: lifecycleHandler },
          },
        },
      },
    });
    expect(config.rooms!.game.state!.actions!.MOVE).toBe(actionHandler);
    expect(config.rooms!.game.state!.timers!.TURN).toBe(timerHandler);
    expect(config.rooms!.game.hooks!.lifecycle!.onJoin).toBe(lifecycleHandler);
  });
});

// ─── 2. Canonical-Only (No Migration Needed) ───

describe('Room config normalization — canonical only', () => {
  it('state.actions without handlers passes through unchanged', () => {
    const handler = () => ({});
    const config = materializeConfig({
      rooms: {
        game: {
          public: true,
          state: { actions: { MOVE: handler } },
        },
      },
    });
    expect(config.rooms!.game.state!.actions!.MOVE).toBe(handler);
  });

  it('hooks.lifecycle without handlers passes through unchanged', () => {
    const handler = () => {};
    const config = materializeConfig({
      rooms: {
        game: {
          public: true,
          hooks: { lifecycle: { onCreate: handler } },
        },
      },
    });
    expect(config.rooms!.game.hooks!.lifecycle!.onCreate).toBe(handler);
  });
});

// ─── 3. Mixed Conflict Rejection ───

describe('Room config normalization — conflict rejection', () => {
  it('throws when handlers.actions and state.actions differ', () => {
    expect(() =>
      materializeConfig({
        rooms: {
          game: {
            public: true,
            handlers: { actions: { A: () => ({}) } },
            state: { actions: { B: () => ({}) } },
          },
        },
      }),
    ).toThrow('cannot define both handlers.actions and state.actions');
  });

  it('throws when handlers.timers and state.timers differ', () => {
    expect(() =>
      materializeConfig({
        rooms: {
          game: {
            public: true,
            handlers: { timers: { T1: () => {} } },
            state: { timers: { T2: () => {} } },
          },
        },
      }),
    ).toThrow('cannot define both handlers.timers and state.timers');
  });

  it('throws when handlers.lifecycle and hooks.lifecycle differ', () => {
    expect(() =>
      materializeConfig({
        rooms: {
          game: {
            public: true,
            handlers: { lifecycle: { onCreate: () => {} } },
            hooks: { lifecycle: { onJoin: () => {} } },
          },
        },
      }),
    ).toThrow('cannot define both handlers.lifecycle and hooks.lifecycle');
  });

  it('allows identical references in both handlers and canonical (no-op)', () => {
    const handler = () => ({});
    const actions = { MOVE: handler };
    expect(() =>
      materializeConfig({
        rooms: {
          game: {
            public: true,
            handlers: { actions },
            state: { actions },
          },
        },
      }),
    ).not.toThrow();
  });
});

// ─── 4. Legacy Alias Rejection ───

describe('Room config normalization — legacy alias rejection', () => {
  it('rejects top-level rooms.ns.onCreate', () => {
    expect(() =>
      materializeConfig({
        rooms: {
          game: {
            public: true,
            onCreate: () => {},
          } as any,
        },
      }),
    ).toThrow('Legacy config syntax');
  });

  it('rejects top-level rooms.ns.onJoin', () => {
    expect(() =>
      materializeConfig({
        rooms: {
          game: {
            public: true,
            onJoin: () => {},
          } as any,
        },
      }),
    ).toThrow('Legacy config syntax');
  });

  it('rejects top-level rooms.ns.mode', () => {
    expect(() =>
      materializeConfig({
        rooms: {
          game: {
            public: true,
            mode: 'authoritative',
          } as any,
        },
      }),
    ).toThrow('Legacy config syntax');
  });
});

// ─── 5. Multiple Namespace Isolation ───

describe('Room config normalization — namespace isolation', () => {
  it('normalizes each namespace independently', () => {
    const actionA = () => ({});
    const actionB = () => ({});
    const config = materializeConfig({
      rooms: {
        alpha: {
          public: true,
          handlers: { actions: { A: actionA } },
        },
        beta: {
          public: true,
          state: { actions: { B: actionB } },
        },
      },
    });
    expect(config.rooms!.alpha.state!.actions!.A).toBe(actionA);
    expect(config.rooms!.beta.state!.actions!.B).toBe(actionB);
    expect(config.rooms!.alpha.state!.actions!.B).toBeUndefined();
  });
});
