import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HomeAssistant, LovelaceCardEditor } from 'custom-card-helpers';
import { KeyCommand, TouchpadCardConfig, TouchpadMessage, VolumeAction } from './types';
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
const RECONNECT_BASE_MS = 1500;
const RECONNECT_MAX_MS = 15000;

const LOG_PREFIX = 'LOVELACE-TOUCHPAD-CARD';
const LOG_TAG_STYLE = 'background:#1976d2;color:#fff;font-weight:700;padding:2px 6px;border-radius:6px;';
const LOG_TEXT_STYLE = 'color:#1976d2;font-weight:600;';

function logCardError(message: string, detail?: unknown): void {
  const label = `%c${LOG_PREFIX}%c ${message}`;
  if (detail !== undefined) {
    console.groupCollapsed(label, LOG_TAG_STYLE, LOG_TEXT_STYLE);
    console.log(detail);
    console.trace();
    console.groupEnd();
    return;
  }
  console.error(label, LOG_TAG_STYLE, LOG_TEXT_STYLE);
}

function logCardWarn(message: string, detail?: unknown): void {
  const label = `%c${LOG_PREFIX}%c ${message}`;
  if (detail !== undefined) {
    console.groupCollapsed(label, LOG_TAG_STYLE, LOG_TEXT_STYLE);
    console.warn(detail);
    console.groupEnd();
    return;
  }
  console.warn(label, LOG_TAG_STYLE, LOG_TEXT_STYLE);
}

const DEFAULTS = {
  backend: 'pc' as 'pc' | 'webos',
  sensitivity: 1,
  scrollMultiplier: 1,
  invertScroll: false,
  doubleTapMs: 250,
  tapSuppressionPx: 6,
  showLock: true,
  showSpeedButtons: true,
  showStatusText: true,
  showAudioControls: true,
  showKeyboardButton: true,
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
  @state() private _keyboardOpen = false;

  private socket?: WebSocket;
  private reconnectTimer?: number;
  private rafHandle?: number;
  private statusTimer?: number;
  private detachTimer?: number;
  private wsErrorNotified = false;
  private reconnectDelayMs = RECONNECT_BASE_MS;

  private pointers = new Map<number, PointerState>();
  private gesture: PointerGesture = null;
  private moveAccum = { x: 0, y: 0 };
  private scrollAccum = { x: 0, y: 0 };
  private lastTapTime = 0;
  private tapTimer?: number;
  private holdTimer?: number;
  private dragPointerId?: number;
  private lockedPan?: LockedPanState;

  private opts = {
    backend: DEFAULTS.backend,
    sensitivity: DEFAULTS.sensitivity,
    scrollMultiplier: DEFAULTS.scrollMultiplier,
    invertScroll: DEFAULTS.invertScroll,
    doubleTapMs: DEFAULTS.doubleTapMs,
    tapSuppressionPx: DEFAULTS.tapSuppressionPx,
    showLock: DEFAULTS.showLock,
    showSpeedButtons: DEFAULTS.showSpeedButtons,
    showStatusText: DEFAULTS.showStatusText,
    showAudioControls: DEFAULTS.showAudioControls,
    showKeyboardButton: DEFAULTS.showKeyboardButton,
  };

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    return document.createElement('touchpad-card-editor');
  }

  public static getStubConfig(): TouchpadCardConfig {
    return {
      type: 'custom:touchpad-card',
      wsUrl: 'ws://YOUR-PC-LAN-IP:8765',
      backend: DEFAULTS.backend,
      show_lock: DEFAULTS.showLock,
      show_speed_buttons: DEFAULTS.showSpeedButtons,
      show_status_text: DEFAULTS.showStatusText,
      show_audio_controls: DEFAULTS.showAudioControls,
      show_keyboard_button: DEFAULTS.showKeyboardButton,
    };
  }

  public setConfig(config: TouchpadCardConfig): void {
    if (!config.wsUrl) {
      throw new Error('wsUrl is required');
    }

    this._config = config;
    this.opts = {
      backend: config.backend === 'webos' ? 'webos' : DEFAULTS.backend,
      sensitivity: config.sensitivity ?? DEFAULTS.sensitivity,
      scrollMultiplier: config.scroll_multiplier ?? DEFAULTS.scrollMultiplier,
      invertScroll: config.invert_scroll ?? DEFAULTS.invertScroll,
      doubleTapMs: config.double_tap_ms ?? DEFAULTS.doubleTapMs,
      tapSuppressionPx: config.tap_suppression_px ?? DEFAULTS.tapSuppressionPx,
      showLock: config.show_lock ?? DEFAULTS.showLock,
      showSpeedButtons: config.show_speed_buttons ?? DEFAULTS.showSpeedButtons,
      showStatusText: config.show_status_text ?? DEFAULTS.showStatusText,
      showAudioControls: config.show_audio_controls ?? DEFAULTS.showAudioControls,
      showKeyboardButton: config.show_keyboard_button ?? DEFAULTS.showKeyboardButton,
    };

    this._locked = false;
    this._keyboardOpen = false;
    this._speedMultiplier = 1;
    this.restoreUiState();
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
    this.wsErrorNotified = false;
    try {
      this.socket = new WebSocket(this._config.wsUrl);
    } catch (err) {
      logCardError('Failed to initialize WebSocket connection. Check backend.', err);
      this.setStatus('error');
      return;
    }

    this.socket.addEventListener('open', () => {
      this._connected = true;
      this.wsErrorNotified = false;
      this.reconnectDelayMs = RECONNECT_BASE_MS;
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
      const backendLabel = this.opts.backend === 'webos' ? 'webOS' : 'Windows';
      if (!this.wsErrorNotified) {
        logCardError(`WebSocket error (${backendLabel}).`, event);
        this.wsErrorNotified = true;
      }
      this.setStatus('error');
      this.requestUpdate();
    });
  }

  private scheduleReconnect(): void {
    if (!this._config || this.reconnectTimer) {
      return;
    }

    const delay = this.reconnectDelayMs;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
    this.reconnectDelayMs = Math.min(Math.round(this.reconnectDelayMs * 1.8), RECONNECT_MAX_MS);
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

  private storageAvailable(): Storage | null {
    try {
      const store = window.localStorage;
      const probe = '__touchpad_probe__';
      store.setItem(probe, '1');
      store.removeItem(probe);
      return store;
    } catch {
      return null;
    }
  }

  private persistenceKey(): string | null {
    const ws = this._config?.wsUrl;
    if (!ws) return null;
    const appId = navigator?.userAgent ?? 'unknown';
    const viewId = window?.location?.pathname ?? '';
    return `touchpad-card:${ws}:${viewId}:${appId}`;
  }

  private restoreUiState(): void {
    const store = this.storageAvailable();
    const key = this.persistenceKey();
    if (!store || !key) return;
    try {
      const raw = store.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{
        locked: boolean;
        speedMultiplier: number;
        keyboardOpen: boolean;
      }>;
      if (typeof parsed.locked === 'boolean') {
        this._locked = parsed.locked;
      }
      if (parsed.speedMultiplier === 1 || parsed.speedMultiplier === 2 || parsed.speedMultiplier === 3 || parsed.speedMultiplier === 4) {
        this._speedMultiplier = parsed.speedMultiplier;
      }
      if (typeof parsed.keyboardOpen === 'boolean' && this.opts.showKeyboardButton) {
        this._keyboardOpen = parsed.keyboardOpen;
      }
    } catch (err) {
      logCardWarn('Failed to restore touchpad UI state.', err);
    }
  }

  private persistUiState(): void {
    const store = this.storageAvailable();
    const key = this.persistenceKey();
    if (!store || !key) return;
    try {
      store.setItem(
        key,
        JSON.stringify({
          locked: this._locked,
          speedMultiplier: this._speedMultiplier,
          keyboardOpen: this.opts.showKeyboardButton ? this._keyboardOpen : false,
        })
      );
    } catch (err) {
      logCardWarn('Failed to persist touchpad UI state.', err);
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
      // Locked mode always scrolls in the natural finger direction; do not apply invertScroll here.
      window.scrollBy({ top: -deltaY, behavior: 'auto' });
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
        logCardError('Failed to send pointer data.', err);
      }
    }
  }

  private sendTap(kind: 'click' | 'double_click' | 'right_click'): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const msg: TouchpadMessage = { t: kind };
    try {
      this.socket.send(JSON.stringify(msg));
    } catch (err) {
      logCardError('Failed to send tap.', err);
    }
  }

  private sendButton(kind: 'down' | 'up'): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const msg: TouchpadMessage = { t: kind };
    try {
      this.socket.send(JSON.stringify(msg));
    } catch (err) {
      logCardError('Failed to send button state.', err);
    }
  }

  private sendText(text: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (!text) return;
    const msg: TouchpadMessage = { t: 'text', text };
    try {
      this.socket.send(JSON.stringify(msg));
    } catch (err) {
      logCardError('Failed to send text.', err);
    }
  }

  private sendKey(key: KeyCommand): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const msg: TouchpadMessage = { t: 'key', key };
    try {
      this.socket.send(JSON.stringify(msg));
    } catch (err) {
      logCardError('Failed to send key.', err);
    }
  }

  private sendVolume(action: VolumeAction): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const msg: TouchpadMessage = { t: 'volume', action };
    try {
      this.socket.send(JSON.stringify(msg));
    } catch (err) {
      logCardError('Failed to send volume action.', err);
    }
  }

  private handleKeyboardInput = (ev: InputEvent): void => {
    const target = ev.target as HTMLInputElement;
    const inputType = ev.inputType;
    const data = ev.data ?? '';

    if (inputType === 'insertText' && data) {
      this.sendText(data);
    } else if (inputType === 'insertLineBreak') {
      this.sendKey('enter');
    } else if (inputType === 'insertFromPaste') {
      const pasted = typeof data === 'string' && data ? data : target.value;
      if (pasted) {
        this.sendText(pasted);
      }
    }
  };

  private handleKeyboardKeydown = (ev: KeyboardEvent): void => {
    const mapped = this.mapKey(ev.key);
    if (mapped) {
      const allowNativeEdit = mapped === 'backspace' || mapped === 'delete';
      if (!allowNativeEdit) {
        ev.preventDefault();
      }
      this.sendKey(mapped);
      return;
    }

    if (ev.key === 'AudioVolumeUp' || ev.key === 'VolumeUp') {
      ev.preventDefault();
      this.sendVolume('up');
      return;
    }

    if (ev.key === 'AudioVolumeDown' || ev.key === 'VolumeDown') {
      ev.preventDefault();
      this.sendVolume('down');
      return;
    }

    if (ev.key === 'AudioVolumeMute' || ev.key === 'VolumeMute') {
      ev.preventDefault();
      this.sendVolume('mute');
    }
  };

  private mapKey(key: string): KeyCommand | null {
    switch (key) {
      case 'Enter':
        return 'enter';
      case 'Backspace':
        return 'backspace';
      case 'Escape':
        return 'escape';
      case 'Tab':
        return 'tab';
      case 'Delete':
        return 'delete';
      case ' ':
      case 'Spacebar':
        return 'space';
      case 'ArrowLeft':
        return 'arrow_left';
      case 'ArrowRight':
        return 'arrow_right';
      case 'ArrowUp':
        return 'arrow_up';
      case 'ArrowDown':
        return 'arrow_down';
      case 'Home':
        return 'home';
      case 'End':
        return 'end';
      case 'PageUp':
        return 'page_up';
      case 'PageDown':
        return 'page_down';
      default:
        return null;
    }
  }

  private hapticHold(): void {
    if (navigator?.vibrate) {
      navigator.vibrate(15);
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
    this.persistUiState();
  };

  private toggleKeyboardPanel = (): void => {
    if (!this.opts.showKeyboardButton) return;
    this._keyboardOpen = !this._keyboardOpen;
    this.persistUiState();
    if (this._keyboardOpen) {
      window.setTimeout(() => {
        const input = this.renderRoot?.querySelector('.keyboard-input') as HTMLInputElement | null;
        input?.focus();
      }, 0);
    }
  };

  private toggleSpeed(mult: 2 | 3 | 4): void {
    this._speedMultiplier = this._speedMultiplier === mult ? 1 : mult;
    this.persistUiState();
  }

  private statusLabel(): string {
    const backendLabel = this.opts.backend === 'webos' ? 'TV' : 'PC';
    switch (this._statusDisplay) {
      case 'connected':
        return `${backendLabel} Connected`;
      case 'connecting':
        return `${backendLabel} Connecting...`;
      case 'error':
        return `${backendLabel} Connection error`;
      default:
        return `${backendLabel} Disconnected`;
    }
  }

  protected render() {
    if (!this._config) return nothing;

    const showKeyboardSection = this.opts.showKeyboardButton && this._keyboardOpen;
    const isWebos = this.opts.backend === 'webos';
    const keyboardPlaceholder = isWebos ? 'Tap to type on TV' : 'Tap to type on PC';
    const leftButtons = isWebos
      ? [
          { label: 'Settings', key: 'settings' as KeyCommand },
          { label: 'Back', key: 'back' as KeyCommand },
          { label: 'Home', key: 'home' as KeyCommand },
          { label: 'OK', key: 'enter' as KeyCommand },
          { label: 'Power Off', key: 'power' as KeyCommand },
        ]
      : [
          { label: 'Tab', key: 'tab' as KeyCommand },
          { label: 'Esc', key: 'escape' as KeyCommand },
          { label: 'Del', key: 'delete' as KeyCommand },
          { label: 'Home', key: 'home' as KeyCommand },
          { label: 'End', key: 'end' as KeyCommand },
          { label: 'PgUp', key: 'page_up' as KeyCommand },
          { label: 'PgDown', key: 'page_down' as KeyCommand },
        ];
    const arrowButtons = [
      { label: '↑', key: 'arrow_up' as KeyCommand, class: 'arrow-up', title: 'Arrow up' },
      { label: '←', key: 'arrow_left' as KeyCommand, class: 'arrow-left', title: 'Arrow left' },
      { label: '↓', key: 'arrow_down' as KeyCommand, class: 'arrow-down', title: 'Arrow down' },
      { label: '→', key: 'arrow_right' as KeyCommand, class: 'arrow-right', title: 'Arrow right' },
    ];

    return html`
      <ha-card @contextmenu=${(e: Event) => e.preventDefault()}>
        <div class="surface ${this._locked ? 'locked' : ''} ${showKeyboardSection ? 'with-keyboard' : ''}">
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
          ${this.opts.showAudioControls
            ? html`<div class="audio-stack">
                <button class="icon-btn" title="Volume up" @click=${() => this.sendVolume('up')}>
                  <ha-icon icon="mdi:volume-plus"></ha-icon>
                </button>
                <button class="icon-btn" title="Volume down" @click=${() => this.sendVolume('down')}>
                  <ha-icon icon="mdi:volume-minus"></ha-icon>
                </button>
                <button class="icon-btn" title="Mute" @click=${() => this.sendVolume('mute')}>
                  <ha-icon icon="mdi:volume-mute"></ha-icon>
                </button>
              </div>`
            : nothing}
          ${this.opts.showKeyboardButton
            ? html`<button
                class="keyboard-toggle ${this._keyboardOpen ? 'active' : ''}"
                title="Keyboard"
                @click=${this.toggleKeyboardPanel}
              >
                <ha-icon icon="mdi:keyboard-outline"></ha-icon>
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
        ${showKeyboardSection
          ? html`<div class="controls">
                  <div class="left-panel">
                    <input
                      class="keyboard-input"
                      type="text"
                      inputmode="text"
                      autocomplete="off"
                      autocorrect="off"
                      autocapitalize="none"
                      spellcheck="false"
                      placeholder="${keyboardPlaceholder}"
                      @input=${this.handleKeyboardInput}
                      @keydown=${this.handleKeyboardKeydown}
                    />
                    ${leftButtons.map(
                      (btn) => html`<button class="pill" @click=${() => this.sendKey(btn.key)}>${btn.label}</button>`
                    )}
                  </div>
                  <div class="right-panel">
                    ${arrowButtons.map(
                      (btn) =>
                        html`<button
                          class="pill arrow ${btn.class}"
                          @click=${() => this.sendKey(btn.key)}
                          title=${btn.title}
                        >
                          ${btn.label}
                        </button>`
                    )}
                  </div>
            </div>`
          : nothing}
      </ha-card>
    `;
  }

  static styles = css`
    :host {
      display: block;
      --control-height: 36px;
      --arrow-size: var(--control-height);
      --arrow-gap: 8px;
      --arrow-cluster-width: calc(var(--arrow-size) * 3 + var(--arrow-gap) * 2);
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

    .surface.with-keyboard {
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
    }

    .surface.locked {
      touch-action: pan-y;
    }

    .capture {
      position: absolute;
      inset: 0;
      touch-action: none;
      z-index: 1;
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
      z-index: 2;
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

    .audio-stack {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      flex-direction: column;
      gap: 8px;
      z-index: 3;
    }

    .icon-btn {
      width: 38px;
      height: 38px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.04);
      color: #e5ecff;
      cursor: pointer;
      font-size: 16px;
      transition: all 140ms ease;
    }

    .icon-btn:hover {
      border-color: rgba(255, 255, 255, 0.32);
      background: rgba(255, 255, 255, 0.12);
    }

    .icon-btn:active {
      transform: scale(0.96);
    }

    .keyboard-toggle {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      z-index: 3;
      width: 44px;
      height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(255, 255, 255, 0.05);
      color: #9ea7b7;
      cursor: pointer;
      font-size: 17px;
      transition: all 140ms ease;
    }

    .keyboard-toggle:hover {
      border-color: rgba(255, 255, 255, 0.32);
      color: #e5ecff;
    }

    .keyboard-toggle.active {
      color: #ff9800;
      border-color: rgba(255, 152, 0, 0.5);
      box-shadow: 0 0 0 1px rgba(255, 152, 0, 0.2);
    }
    .icon-btn ha-icon,
    .keyboard-toggle ha-icon {
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: inherit;
      --mdc-icon-size: 20px;
    }
    .controls {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px 14px 14px;
      background: #161c29;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      border-bottom-left-radius: 12px;
      border-bottom-right-radius: 12px;
    }
    .left-panel {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: flex-start;
    }
    .left-panel .keyboard-input {
      flex: 1 1 100%;
      min-width: 0;
      height: var(--control-height);
      width: auto;
      box-sizing: border-box;
      padding: 0 10px;
    }
    .left-panel .pill {
      flex: 0 0 auto;
      height: var(--control-height);
      padding: 0 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .right-panel {
      flex: 0 0 var(--arrow-cluster-width);
      display: grid;
      grid-template-columns: repeat(3, var(--arrow-size));
      grid-template-rows: repeat(2, var(--arrow-size));
      gap: var(--arrow-gap);
      justify-items: center;
      align-items: center;
      margin-left: 10px;
      align-self: flex-start;
    }
    .pill.arrow {
      width: var(--arrow-size);
      height: var(--arrow-size);
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      line-height: 1;
    }
    .arrow-up {
      grid-column: 2;
      grid-row: 1;
    }
    .arrow-left {
      grid-column: 1;
      grid-row: 2;
    }
    .arrow-down {
      grid-column: 2;
      grid-row: 2;
    }
    .arrow-right {
      grid-column: 3;
      grid-row: 2;
    }
    .pill {
      padding: 8px 12px;
      font-size: 13px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.05);
      color: #e5ecff;
      cursor: pointer;
      transition: all 140ms ease;
    }
    .pill:hover {
      border-color: rgba(255, 255, 255, 0.32);
      background: rgba(255, 255, 255, 0.12);
    }
    .keyboard-input {
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.04);
      color: #f5f5f5;
      font-size: 14px;
      outline: none;
    }
    .keyboard-input:focus {
      border-color: rgba(255, 255, 255, 0.32);
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
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
    description: 'Control your PC or LG webOS TV from Home Assistant with a touchpad, keyboard input, and volume controls.',
  });
}
