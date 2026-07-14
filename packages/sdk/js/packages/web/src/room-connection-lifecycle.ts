/**
 * Internal Room connection lifecycle.
 *
 * The public RoomConnectionState intentionally stays coarse for backwards
 * compatibility. This model owns the protocol checkpoints underneath it so a
 * transport close cannot leave auth/join flags claiming that the session is
 * still usable.
 */

export type RoomConnectionLifecyclePhase =
  | 'idle'
  | 'transport_connecting'
  | 'transport_open'
  | 'authenticating'
  | 'authenticated'
  | 'joining'
  | 'syncing'
  | 'ready'
  | 'reconnect_wait'
  | 'disconnected'
  | 'auth_lost'
  | 'kicked';

export type RoomConnectionLifecycleStop = 'idle' | 'disconnected' | 'auth_lost' | 'kicked';

export interface RoomConnectionLifecycleSnapshot {
  authenticated: boolean;
  joined: boolean;
  phase: RoomConnectionLifecyclePhase;
  synchronized: boolean;
  transportOpen: boolean;
}

export class RoomConnectionLifecycle {
  private authenticatedValue = false;
  private joinedValue = false;
  private phaseValue: RoomConnectionLifecyclePhase = 'idle';
  private synchronizedValue = false;
  private transportOpenValue = false;

  get authenticated(): boolean {
    return this.authenticatedValue;
  }

  get joined(): boolean {
    return this.joinedValue;
  }

  get phase(): RoomConnectionLifecyclePhase {
    return this.phaseValue;
  }

  get synchronized(): boolean {
    return this.synchronizedValue;
  }

  get transportOpen(): boolean {
    return this.transportOpenValue;
  }

  beginTransport(): void {
    this.clearProtocolState();
    this.phaseValue = 'transport_connecting';
  }

  waitForReconnect(): void {
    this.clearProtocolState();
    this.phaseValue = 'reconnect_wait';
  }

  markTransportOpen(): void {
    this.transportOpenValue = true;
    this.phaseValue = 'transport_open';
  }

  beginAuthentication(): void {
    this.phaseValue = 'authenticating';
  }

  markAuthenticated(): void {
    this.transportOpenValue = true;
    this.authenticatedValue = true;
    this.phaseValue = 'authenticated';
  }

  beginJoin(): void {
    this.phaseValue = 'joining';
  }

  markJoinSent(): void {
    this.transportOpenValue = true;
    this.authenticatedValue = true;
    this.joinedValue = true;
    this.synchronizedValue = false;
    this.phaseValue = 'syncing';
  }

  markSynchronized(): void {
    this.transportOpenValue = true;
    this.authenticatedValue = true;
    this.joinedValue = true;
    this.synchronizedValue = true;
    this.phaseValue = 'ready';
  }

  stop(reason: RoomConnectionLifecycleStop): void {
    this.clearProtocolState();
    this.phaseValue = reason;
  }

  /** Compatibility setters for tests and legacy internal call sites. */
  setTransportOpen(open: boolean): void {
    if (open) {
      this.markTransportOpen();
    } else {
      this.stop('disconnected');
    }
  }

  setAuthenticated(authenticated: boolean): void {
    if (authenticated) {
      this.markAuthenticated();
      return;
    }
    this.authenticatedValue = false;
    this.joinedValue = false;
    this.synchronizedValue = false;
    this.phaseValue = this.transportOpenValue ? 'transport_open' : 'disconnected';
  }

  setJoined(joined: boolean): void {
    if (joined) {
      this.markJoinSent();
      return;
    }
    this.joinedValue = false;
    this.synchronizedValue = false;
    this.phaseValue = this.authenticatedValue
      ? 'authenticated'
      : this.transportOpenValue
        ? 'transport_open'
        : 'disconnected';
  }

  snapshot(): RoomConnectionLifecycleSnapshot {
    return {
      authenticated: this.authenticatedValue,
      joined: this.joinedValue,
      phase: this.phaseValue,
      synchronized: this.synchronizedValue,
      transportOpen: this.transportOpenValue,
    };
  }

  private clearProtocolState(): void {
    this.transportOpenValue = false;
    this.authenticatedValue = false;
    this.joinedValue = false;
    this.synchronizedValue = false;
  }
}
