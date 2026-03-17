/**
 * AppState-based lifecycle management for React Native.
 *
 * Responsibility:
 * - Foreground: check if access token is about to expire → pre-emptive refresh
 * - Foreground: reconnect WebSocket if disconnected during background
 * - Background: disconnect WebSocket to avoid battery drain and server-side timeout
 *
 * Usage:
 *   const lifecycle = new LifecycleManager(tokenManager, databaseLive, AppState);
 *   lifecycle.start();
 *   // on unmount or destroy:
 *   lifecycle.stop();
 */

import type { TokenManager } from './token-manager.js';

// ─── Minimal AppState interface ───

export interface AppStateStatus {
  currentState: 'active' | 'background' | 'inactive' | 'unknown' | string;
}

export interface AppStateAdapter {
  currentState: string;
  addEventListener(
    type: 'change',
    handler: (state: string) => void,
  ): { remove: () => void };
}

// ─── Minimal DatabaseLiveClient interface ───

export interface DatabaseLiveClientAdapter {
  disconnect(): void;
  reconnect?(): void;
}

// ─── LifecycleManager ───

export class LifecycleManager {
  private subscription: { remove: () => void } | null = null;
  private previousState: string;

  constructor(
    private tokenManager: TokenManager,
    private databaseLive: DatabaseLiveClientAdapter | null,
    private appState: AppStateAdapter,
    /** Optional: function to trigger token refresh (e.g. doRefresh from HttpClient) */
    private doRefresh?: (refreshToken: string) => Promise<{ accessToken: string; refreshToken: string }>,
  ) {
    this.previousState = appState.currentState;
  }

  /** Start listening to AppState changes. */
  start(): void {
    if (this.subscription) return; // already started

    this.subscription = this.appState.addEventListener('change', this.handleStateChange);
  }

  /** Stop listening to AppState changes and clean up. */
  stop(): void {
    this.subscription?.remove();
    this.subscription = null;
  }

  private handleStateChange = (nextState: string): void => {
    const prev = this.previousState;
    this.previousState = nextState;

    // Only react to transitions
    if (prev === nextState) return;

    if (nextState === 'active') {
      // App came to foreground
      this.onForeground();
    } else if (nextState === 'background' || nextState === 'inactive') {
      // App went to background
      this.onBackground();
    }
  };

  private onForeground(): void {
    // 1. Pre-emptive token refresh (may have expired while backgrounded)
    if (this.doRefresh) {
      void this.tokenManager.getAccessToken(this.doRefresh).catch(() => {
        // Token expired while in background — user will need to sign in again
        // TokenManager.clearTokens() is called internally on 401
      });
    }

    // 2. Reconnect WebSocket if it supports reconnect
    if (this.databaseLive?.reconnect) {
      this.databaseLive.reconnect();
    }
  }

  private onBackground(): void {
    // Disconnect WebSocket to avoid:
    // - Battery drain from keepalive pings
    // - Server-side heartbeat timeout
    // - Unnecessary DO CPU billing
    // Auto-reconnect will restore subscriptions on foreground
    this.databaseLive?.disconnect();
  }
}

// ─── React hook wrapper ───

export interface UseLifecycleOptions {
  tokenManager: TokenManager;
  databaseLive: DatabaseLiveClientAdapter | null;
  appState: AppStateAdapter;
  doRefresh?: (refreshToken: string) => Promise<{ accessToken: string; refreshToken: string }>;
}

/**
 * React hook that manages lifecycle automatically.
 * Starts on mount, stops on unmount.
 *
 * @example
 * function App() {
 *   const { AppState } = require('react-native');
 *   useLifecycle({ tokenManager: client._tokenManager, databaseLive: client._databaseLive, appState: AppState });
 * }
 */
export function useLifecycle({
  tokenManager,
  databaseLive,
  appState,
  doRefresh,
}: UseLifecycleOptions): void {
  // Import useEffect lazily to avoid hard dep on React in non-React-component code
  const { useEffect } = require('react') as typeof import('react');

  useEffect(() => {
    const manager = new LifecycleManager(tokenManager, databaseLive, appState, doRefresh);
    manager.start();
    return () => manager.stop();
  }, [tokenManager, databaseLive, appState, doRefresh]);
}
