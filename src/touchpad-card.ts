import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HomeAssistant, LovelaceCardEditor } from 'custom-card-helpers';
import { TouchpadCardConfig, TouchpadMessage } from './types';
import './touchpad-card-editor';

type PointerGesture = 'move' | 'scroll' | null;

interface PointerState {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
}

interface LockedPanState {
  id: number;
  lastY: number;
}

const HOLD_DELAY_MS = 320;
const HOLD_CANCEL_PX = 3;

const DEFAULTS = {
  sensitivity: 1,
  scrollMultiplier: 1,
  invertScroll: false,
  doubleTapMs: 250,
  tapSuppressionPx: 6,
  showLock: true,
  showSpeedButtons: true,
  showStatusText: true,
};

@customElement('touchpad-card')
export class TouchpadCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: TouchpadCardConfig;
  @state() private _connected = false;
  @state() private _status: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  @state() private _statusDisplay: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  @state() private _locked = false;
  @state() private _speedMultiplier: 1 | 2 | 3 | 4 = 1;

  private socket?: WebSocket;
  private reconnectTimer?: number;
  private rafHandle?: number;
  private statusTimer?: number;
  private detachTimer?: number;

  private pointers = new Map<number, PointerState>();
  private gesture: PointerGesture = null;
  private moveAccum = { x: 0, y: 0 };
  private scrollAccum = { x: 0, y: 0 };
  private lastTapTime = 0;
  private tapTimer?: number;
  private holdTimer?: number;
  private lastWake = 0;
  private dragPointerId?: number;
  private lockedPan?: LockedPanState;

  private opts = {
    sensitivity: DEFAULTS.sensitivity,
    scrollMultiplier: DEFAULTS.scrollMultiplier,
    invertScroll: DEFAULTS.invertScroll,
    doubleTapMs: DEFAULTS.doubleTapMs,
    tapSuppressionPx: DEFAULTS.tapSuppressionPx,
    showLock: DEFAULTS.showLock,
    showSpeedButtons: DEFAULTS.showSpeedButtons,
    showStatusText: DEFAULTS.showStatusText,
  };

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    return document.createElement('touchpad-card-editor');
  }

  public static getStubConfig(): TouchpadCardConfig {
    return {
      type: 'custom:touchpad-card',
      wsUrl: 'ws://YOUR-PC-LAN-IP:8765',
      show_lock: DEFAULTS.showLock,
      show_speed_buttons: DEFAULTS.showSpeedButtons,
      show_status_text: DEFAULTS.showStatusText,
    };
  }

  public setConfig(config: TouchpadCardConfig): void {
    if (!config.wsUrl) {
      throw new Error('wsUrl is required');
    }

    this._config = config;
    this.opts = {
      sensitivity: config.sensitivity ?? DEFAULTS.sensitivity,
      scrollMultiplier: config.scroll_multiplier ?? DEFAULTS.scrollMultiplier,
      invertScroll: config.invert_scroll ?? DEFAULTS.invertScroll,
      doubleTapMs: config.double_tap_ms ?? DEFAULTS.doubleTapMs,
      tapSuppressionPx: config.tap_suppression_px ?? DEFAULTS.tapSuppressionPx,
      showLock: config.show_lock ?? DEFAULTS.showLock,
      showSpeedButtons: config.show_speed_buttons ?? DEFAULTS.showSpeedButtons,
      showStatusText: config.show_status_text ?? DEFAULTS.showStatusText,
    };

    this._locked = false;
    this.connect();
  }

  public connectedCallback(): void {
    super.connectedCallback();
    if (this.detachTimer) {
      clearTimeout(this.detachTimer);
      this.detachTimer = undefined;
    }
    if (this._config && (!this.socket || this.socket.readyState === WebSocket.CLOSED)) {
      this.connect();
    }
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.tapTimer) {
      clearTimeout(this.tapTimer);
      this.tapTimer = undefined;
    }
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = undefined;
    }
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = undefined;
    }
    if (this.dragPointerId != null) {
      this.sendButton('up');
      this.dragPointerId = undefined;
    }
    if (this.detachTimer) {
      clearTimeout(this.detachTimer);
    }
    // Delay teardown slightly to avoid churn when HA re-parents the card in the DOM.
    this.detachTimer = window.setTimeout(() => {
      this.teardownSocket();
      this.detachTimer = undefined;
    }, 2000);
  }

  private connect(): void {
    this.teardownSocket();

    if (!this._config?.wsUrl) {
      this.setStatus('disconnected');
      return;
    }

    this.setStatus('connecting');
    try {
      this.socket = new WebSocket(this._config.wsUrl);
    } catch (err) {
      console.error(err);
      this.setStatus('error');
      return;
    }

    this.socket.addEventListener('open', () => {
      this._connected = true;
      this.setStatus('connected');
      this.requestUpdate();
    });

    this.socket.addEventListener('close', () => {
      this._connected = false;
      this.setStatus('connecting');
      this.requestUpdate();
      this.scheduleReconnect();
    });

    this.socket.addEventListener('error', (event) => {
      console.error('WebSocket error', event);
      this.setStatus('error');
      this.requestUpdate();
    });
  }

  private scheduleReconnect(): void {
    if (!this.isConnected || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, 1500);
  }

  private teardownSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }
  }

  private setStatus(next: 'disconnected' | 'connecting' | 'connected' | 'error'): void {
    this._status = next;

    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = undefined;
    }

    if (next === 'connected') {
      this._statusDisplay = next;
      return;
    }

    // Debounce transient status flips to avoid UI flicker
    this.statusTimer = window.setTimeout(() => {
      this._statusDisplay = next;
      this.statusTimer = undefined;
    }, 600);
  }

  private get captureLayer(): HTMLElement | null {
    return this.renderRoot.querySelector('.capture');
  }

  private handlePointerDown = (ev: PointerEvent): void => {
    if (this._locked) {
      this.startLockedPan(ev);
      return;
    }
    ev.preventDefault();
    this.captureLayer?.setPointerCapture(ev.pointerId);
    this.wakeHost(true);

    const now = performance.now();
    this.pointers.set(ev.pointerId, {
      id: ev.pointerId,
      x: ev.clientX,
      y: ev.clientY,
      startX: ev.clientX,
      startY: ev.clientY,
      startTime: now,
    });

    if (this.pointers.size === 1) {
      this.gesture = 'move';
      this.startHoldTimer(ev);
    } else if (this.pointers.size >= 2) {
      this.cancelHoldTimer();
      this.endDragIfNeeded();
      this.gesture = 'scroll';
    }
  };

  private handlePointerMove = (ev: PointerEvent): void => {
    if (this._locked) {
      this.moveLockedPan(ev);
      return;
    }
    const pointer = this.pointers.get(ev.pointerId);
    if (!pointer) return;

    ev.preventDefault();
    this.wakeHost();

    const before = this.centroid();
    pointer.x = ev.clientX;
    pointer.y = ev.clientY;
    this.pointers.set(ev.pointerId, pointer);
    const after = this.centroid();

    const distFromStart = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
    if (this.holdTimer && distFromStart > HOLD_CANCEL_PX) {
      this.cancelHoldTimer();
    }

    if (this.pointers.size >= 2) {
      this.cancelHoldTimer();
      this.endDragIfNeeded();
      this.gesture = 'scroll';
    }

    if (this.gesture === 'move' && this.pointers.size === 1) {
      const mult = this.opts.sensitivity * this._speedMultiplier;
      this.moveAccum.x += (after.x - before.x) * mult;
      this.moveAccum.y += (after.y - before.y) * mult;
      this.queueSend();
    } else if (this.gesture === 'scroll' && this.pointers.size >= 2) {
      const dir = this.opts.invertScroll ? -1 : 1;
      this.scrollAccum.x += (after.x - before.x) * this.opts.scrollMultiplier * dir;
      this.scrollAccum.y += (after.y - before.y) * this.opts.scrollMultiplier * dir;
      this.queueSend();
    }
  };

  private handlePointerUp = (ev: PointerEvent): void => {
    if (this._locked) {
      this.endLockedPan(ev);
      return;
    }
    const pointer = this.pointers.get(ev.pointerId);
    if (!pointer) return;
    ev.preventDefault();

    const wasDragging = this.dragPointerId === ev.pointerId;
    if (wasDragging) {
      this.sendButton('up');
      this.dragPointerId = undefined;
    }
    this.cancelHoldTimer();

    const beforeCount = this.pointers.size;
    const now = performance.now();
    const dist = Math.hypot(ev.clientX - pointer.startX, ev.clientY - pointer.startY);
    const duration = now - pointer.startTime;

    this.pointers.delete(ev.pointerId);

    if (beforeCount === 2) {
      // Possible two-finger tap (right click)
      const remaining = [...this.pointers.values()][0];
      if (remaining) {
        const distOther = Math.hypot(remaining.x - remaining.startX, remaining.y - remaining.startY);
        const elapsed = now - Math.min(pointer.startTime, remaining.startTime);
        if (dist <= this.opts.tapSuppressionPx && distOther <= this.opts.tapSuppressionPx && elapsed <= this.opts.doubleTapMs) {
          this.sendTap('right_click');
          this.pointers.clear();
          this.gesture = null;
          return;
        }
      }
    }
    if (this.pointers.size === 0) {
      if (!wasDragging && this.gesture === 'move' && dist <= this.opts.tapSuppressionPx && duration <= this.opts.doubleTapMs) {
        if (this.tapTimer) {
          clearTimeout(this.tapTimer);
          this.tapTimer = undefined;
        }

        if (now - this.lastTapTime <= this.opts.doubleTapMs) {
          this.sendTap('double_click');
          this.lastTapTime = 0;
        } else {
          this.lastTapTime = now;
          this.tapTimer = window.setTimeout(() => {
            this.sendTap('click');
            this.lastTapTime = 0;
            this.tapTimer = undefined;
          }, this.opts.doubleTapMs);
        }
      }
      this.gesture = null;
    } else if (this.pointers.size === 1 && this.gesture === 'scroll') {
      // When one finger leaves during scroll, keep it from becoming a tap.
      this.gesture = 'move';
    }
  };

  private handlePointerCancel = (ev: PointerEvent): void => {
    if (this._locked) {
      this.endLockedPan(ev);
      return;
    }
    if (this.pointers.has(ev.pointerId)) {
      this.pointers.delete(ev.pointerId);
    }
    if (this.dragPointerId === ev.pointerId) {
      this.sendButton('up');
      this.dragPointerId = undefined;
    }
    this.cancelHoldTimer();
    if (this.pointers.size === 0) {
      this.gesture = null;
    }
  };

  private startLockedPan(ev: PointerEvent): void {
    if (ev.pointerType !== 'touch' && ev.pointerType !== 'pen') return;
    this.captureLayer?.setPointerCapture(ev.pointerId);
    this.lockedPan = { id: ev.pointerId, lastY: ev.clientY };
  }

  private moveLockedPan(ev: PointerEvent): void {
    if (!this.lockedPan || this.lockedPan.id !== ev.pointerId) return;
    if (ev.pointerType !== 'touch' && ev.pointerType !== 'pen') return;
    ev.preventDefault();

    const deltaY = ev.clientY - this.lockedPan.lastY;
    if (deltaY !== 0) {
      const dir = this.opts.invertScroll ? -1 : 1;
      window.scrollBy({ top: -deltaY * dir, behavior: 'auto' });
      this.lockedPan.lastY = ev.clientY;
    }
  }

  private endLockedPan(ev: PointerEvent): void {
    if (this.lockedPan?.id === ev.pointerId) {
      this.lockedPan = undefined;
    }
    if (this.captureLayer?.hasPointerCapture?.(ev.pointerId)) {
      this.captureLayer.releasePointerCapture(ev.pointerId);
    }
  }

  private startHoldTimer(ev: PointerEvent): void {
    if (ev.pointerType !== 'touch' && ev.pointerType !== 'pen') return;
    this.cancelHoldTimer();
    this.holdTimer = window.setTimeout(() => {
      const pointer = this.pointers.get(ev.pointerId);
      if (!pointer) return;
      const dist = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
      if (this.pointers.size === 1 && this.gesture === 'move' && this.dragPointerId == null && dist <= HOLD_CANCEL_PX) {
        this.dragPointerId = ev.pointerId;
        this.sendButton('down');
        this.hapticHold();
      }
      this.holdTimer = undefined;
    }, HOLD_DELAY_MS);
  }

  private cancelHoldTimer(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = undefined;
    }
  }

  private endDragIfNeeded(pointerId?: number): void {
    if (this.dragPointerId == null) return;
    if (pointerId == null || this.dragPointerId === pointerId) {
      this.sendButton('up');
      this.dragPointerId = undefined;
    }
  }

  private centroid(): { x: number; y: number } {
    if (this.pointers.size === 0) return { x: 0, y: 0 };
    let sumX = 0;
    let sumY = 0;
    this.pointers.forEach((p) => {
      sumX += p.x;
      sumY += p.y;
    });
    const count = this.pointers.size || 1;
    return { x: sumX / count, y: sumY / count };
  }

  private queueSend(): void {
    if (this.rafHandle != null) return;
    this.rafHandle = window.requestAnimationFrame(() => {
      this.rafHandle = undefined;
      this.flush();
    });
  }

  private flush(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.moveAccum = { x: 0, y: 0 };
      this.scrollAccum = { x: 0, y: 0 };
      return;
    }

    const messages: TouchpadMessage[] = [];

    if (Math.abs(this.moveAccum.x) > 0 || Math.abs(this.moveAccum.y) > 0) {
      messages.push({ t: 'move', dx: this.moveAccum.x, dy: this.moveAccum.y });
      this.moveAccum = { x: 0, y: 0 };
    }

    if (Math.abs(this.scrollAccum.x) > 0 || Math.abs(this.scrollAccum.y) > 0) {
      messages.push({ t: 'scroll', dx: this.scrollAccum.x, dy: this.scrollAccum.y });
      this.scrollAccum = { x: 0, y: 0 };
    }

    for (const msg of messages) {
      try {
        this.socket.send(JSON.stringify(msg));
      } catch (err) {
        console.error('Failed to send pointer data', err);
      }
    }
  }

  private sendTap(kind: 'click' | 'double_click' | 'right_click'): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const msg: TouchpadMessage = { t: kind };
    try {
      this.socket.send(JSON.stringify(msg));
    } catch (err) {
      console.error('Failed to send tap', err);
    }
  }

  private sendButton(kind: 'down' | 'up'): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const msg: TouchpadMessage = { t: kind };
    try {
      this.socket.send(JSON.stringify(msg));
    } catch (err) {
      console.error('Failed to send button state', err);
    }
  }

  private hapticHold(): void {
    if (navigator?.vibrate) {
      navigator.vibrate(15);
    }
  }

  private wakeHost(force = false): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (!force && now - this.lastWake < 800) return;
    this.lastWake = now;

    try {
      this.socket.send(JSON.stringify({ t: 'wake' }));
    } catch (err) {
      console.error('Failed to send wake request', err);
    }
  }

  private toggleLock = (): void => {
    if (!this._locked && this.dragPointerId != null) {
      this.sendButton('up');
      this.dragPointerId = undefined;
    }
    this.cancelHoldTimer();
    this.lockedPan = undefined;
    this._locked = !this._locked;
  };

  private toggleSpeed(mult: 2 | 3 | 4): void {
    this._speedMultiplier = this._speedMultiplier === mult ? 1 : mult;
  }

  private statusLabel(): string {
    switch (this._statusDisplay) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return 'Connection error';
      default:
        return 'Disconnected';
    }
  }

  protected render() {
    if (!this._config) return nothing;

    return html`
      <ha-card @contextmenu=${(e: Event) => e.preventDefault()}>
        <div class="surface ${this._locked ? 'locked' : ''}">
          ${this.opts.showSpeedButtons
            ? html`<div class="speed-buttons">
                ${[2, 3, 4].map(
                  (mult) => html`<button
                    class="speed ${this._speedMultiplier === mult ? 'active' : ''}"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this.toggleSpeed(mult as 2 | 3 | 4);
                    }}
                  >
                    &times;${mult}
                  </button>`
                )}
              </div>`
            : nothing}
          ${this.opts.showLock
            ? html`<button
                class="lock ${this._locked ? 'active' : ''}"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this.toggleLock();
                }}
              >
                LOCK
              </button>`
            : nothing}
          <div
            class="capture"
            @pointerdown=${this.handlePointerDown}
            @pointermove=${this.handlePointerMove}
            @pointerup=${this.handlePointerUp}
            @pointercancel=${this.handlePointerCancel}
            @pointerleave=${this.handlePointerCancel}
            @pointerout=${this.handlePointerCancel}
          ></div>
          ${this.opts.showStatusText
            ? html`<div class="status">
                ${this.statusLabel()}${this._locked ? ' (Locked)' : ''}
              </div>`
            : nothing}
        </div>
      </ha-card>
    `;
  }

  static styles = css`
    :host {
      display: block;
    }

    ha-card {
      overflow: hidden;
    }

    .surface {
      position: relative;
      height: 280px;
      background: linear-gradient(135deg, #1f2736, #2a3347);
      border-radius: 12px;
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
      color: #f5f5f5;
      user-select: none;
      touch-action: none;
    }

    .surface.locked {
      touch-action: pan-y;
    }

    .capture {
      position: absolute;
      inset: 0;
      touch-action: none;
    }

    .surface.locked .capture {
      pointer-events: auto;
      touch-action: none;
    }

    .lock {
      position: absolute;
      top: 10px;
      right: 14px;
      z-index: 2;
      font-size: 12px;
      letter-spacing: 0.12em;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: #9ea7b7;
      padding: 6px 10px;
      border-radius: 10px;
      cursor: pointer;
      transition: all 140ms ease;
    }

    .lock.active {
      color: #ff9800;
      border-color: rgba(255, 152, 0, 0.5);
      box-shadow: 0 0 0 1px rgba(255, 152, 0, 0.2);
    }

    .status {
      position: absolute;
      left: 14px;
      bottom: 12px;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.7);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      pointer-events: none;
    }

    .speed-buttons {
      position: absolute;
      top: 10px;
      left: 14px;
      display: flex;
      gap: 8px;
      z-index: 2;
    }

    .speed {
      font-size: 12px;
      letter-spacing: 0.08em;
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: #9ea7b7;
      padding: 6px 10px;
      border-radius: 10px;
      cursor: pointer;
      transition: all 140ms ease;
    }

    .speed.active {
      color: #ff9800;
      border-color: rgba(255, 152, 0, 0.5);
      box-shadow: 0 0 0 1px rgba(255, 152, 0, 0.2);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'touchpad-card': TouchpadCard;
  }
  interface Window {
    customCards?: Array<{ type: string; name: string; description: string }>;
  }
}

window.customCards = window.customCards || [];
if (!window.customCards.find((c) => c.type === 'touchpad-card')) {
  window.customCards.push({
    type: 'touchpad-card',
    name: 'Lovelace Touchpad Card',
    description: 'Use this card like a real touchpad on your computer.',
  });
}
