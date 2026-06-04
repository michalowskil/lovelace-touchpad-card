import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HomeAssistant, LovelaceCardEditor } from 'custom-card-helpers';
import {
  KeyCommand,
  ResolvedTouchpadAudioControlsConfig,
  TouchpadAudioButtonField,
  TouchpadAudioControlsConfig,
  TouchpadAudioControlsMode,
  TouchpadCardConfig,
  TouchpadControlsProfile,
  TouchpadDeviceConfig,
  TouchpadGestureAction,
  TouchpadHAGestureAction,
  TouchpadHAGestureModeConfig,
  TouchpadGestureModeConfig,
  TouchpadMessage,
  TouchpadServerMessage,
  TouchpadThemeMode,
  VolumeAction,
  WebOSAppConfig,
} from './types';
import { DEFAULT_WEBOS_APPS, normalizeWebOSApps } from './webos-apps';
import './touchpad-card-editor';

type PointerGesture = 'move' | 'scroll' | 'gesture' | null;
type GestureDirection = 'swipe_left' | 'swipe_right' | 'swipe_up' | 'swipe_down';
type GestureEventName = GestureDirection | 'tap' | 'double_tap' | 'hold';

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

type FullscreenMode = 'native' | 'soft' | null;

type FullscreenCapableElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenCapableDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

interface FullscreenScrollTarget {
  element: Element;
  left: number;
  top: number;
}

interface FullscreenScrollSnapshot {
  windowX: number;
  windowY: number;
  targets: FullscreenScrollTarget[];
}

interface ResolvedTouchpadDevice extends TouchpadDeviceConfig {
  id: string;
  name: string;
  wsUrl: string;
  controlsProfile: TouchpadControlsProfile;
}

interface TouchpadRuntimeOptions {
  themeMode: TouchpadThemeMode;
  controlsProfile: TouchpadControlsProfile;
  sensitivity: number;
  scrollMultiplier: number;
  invertScroll: boolean;
  doubleTapMs: number;
  tapSuppressionPx: number;
  showLock: boolean;
  showSpeedButtons: boolean;
  showStatusText: boolean;
  showAudioControls: boolean;
  showKeyboardButton: boolean;
  showFullscreenButton: boolean;
  showAppButtons: boolean;
  hideAppLauncherAfterLaunch: boolean;
  autoFocusKeyboard: boolean;
  audioControls: ResolvedTouchpadAudioControlsConfig;
  gestureMode: Required<TouchpadGestureModeConfig>;
  haGestureMode: Required<TouchpadHAGestureModeConfig>;
  webosApps: WebOSAppConfig[];
}

interface PersistedDeviceUiState {
  locked?: boolean;
  speedMultiplier?: number;
  keyboardOpen?: boolean;
  appLauncherOpen?: boolean;
  gestureModeActive?: boolean;
  haGestureModeActive?: boolean;
}

interface PersistedUiState extends PersistedDeviceUiState {
  activeDeviceId?: string;
  deviceIds?: string[];
  deviceStates?: Record<string, PersistedDeviceUiState>;
}

const HOLD_DELAY_MS = 320;
const HOLD_CANCEL_PX = 3;
const GESTURE_SWIPE_MIN_PX = 42;
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
  themeMode: 'auto' as TouchpadThemeMode,
  controlsProfile: 'pc' as TouchpadControlsProfile,
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
  showFullscreenButton: true,
  showAppButtons: false,
  hideAppLauncherAfterLaunch: false,
  autoFocusKeyboard: true,
};

const GESTURE_ACTIONS = new Set<TouchpadGestureAction>([
  'none',
  'enter',
  'backspace',
  'escape',
  'back',
  'tab',
  'space',
  'delete',
  'arrow_left',
  'arrow_right',
  'arrow_up',
  'arrow_down',
  'home',
  'end',
  'page_up',
  'page_down',
  'power',
  'settings',
  'volume_up',
  'volume_down',
  'volume_mute',
]);

function defaultGestureMode(profile: TouchpadControlsProfile): Required<TouchpadGestureModeConfig> {
  return {
    show_button: true,
    invert_swipes: false,
    swipe_left: 'arrow_left',
    swipe_right: 'arrow_right',
    swipe_up: 'arrow_up',
    swipe_down: 'arrow_down',
    tap: 'enter',
    double_tap: 'none',
    hold: profile === 'webos' ? 'back' : 'escape',
  };
}

function defaultHAGestureMode(): Required<TouchpadHAGestureModeConfig> {
  return {
    show_button: false,
    invert_swipes: false,
    swipe_left: { action: 'none' },
    swipe_right: { action: 'none' },
    swipe_up: { action: 'none' },
    swipe_down: { action: 'none' },
    tap: { action: 'none' },
    double_tap: { action: 'none' },
    hold: { action: 'none' },
  };
}

function defaultAudioControls(): ResolvedTouchpadAudioControlsConfig {
  return {
    mode: 'device',
    volume_up: { tap: { action: 'none' }, hold: { action: 'none' } },
    volume_down: { tap: { action: 'none' }, hold: { action: 'none' } },
    volume_mute: { tap: { action: 'none' }, hold: { action: 'none' } },
  };
}

function createStorageId(): string {
  return `tp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

@customElement('touchpad-card')
export class TouchpadCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: TouchpadCardConfig;
  @state() private _devices: ResolvedTouchpadDevice[] = [];
  @state() private _activeDeviceId?: string;
  @state() private _statusDisplay: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
  @state() private _locked = false;
  @state() private _speedMultiplier: 1 | 2 | 3 | 4 = 1;
  @state() private _keyboardOpen = false;
  @state() private _appLauncherOpen = false;
  @state() private _fullscreenActive = false;
  @state() private _gestureModeActive = false;
  @state() private _haGestureModeActive = false;
  @state() private _availableAppIds?: Set<string>;
  @state() private _unavailableAppIds = new Set<string>();
  @state() private _appNotice?: string;

  private socket?: WebSocket;
  private reconnectTimer?: number;
  private rafHandle?: number;
  private statusTimer?: number;
  private appNoticeTimer?: number;
  private detachTimer?: number;
  private wsErrorNotified = false;
  private reconnectDelayMs = RECONNECT_BASE_MS;
  private socketGeneration = 0;
  private fullscreenMode: FullscreenMode = null;
  private fullscreenScrollSnapshot?: FullscreenScrollSnapshot;
  private fullscreenRestoreFrame?: number;
  private fullscreenRestoreFrame2?: number;
  private fullscreenRestoreToken = 0;

  private pointers = new Map<number, PointerState>();
  private gesture: PointerGesture = null;
  private moveAccum = { x: 0, y: 0 };
  private scrollAccum = { x: 0, y: 0 };
  private lastTapTime = 0;
  private tapTimer?: number;
  private gestureLastTapTime = 0;
  private gestureTapTimer?: number;
  private holdTimer?: number;
  private audioHoldTimer?: number;
  private audioPress?: {
    pointerId: number;
    target: HTMLElement;
    holdFired: boolean;
  };
  private suppressAudioClick = false;
  private gestureHoldFired = false;
  private dragPointerId?: number;
  private lockedPan?: LockedPanState;

  private opts: TouchpadRuntimeOptions = {
    themeMode: DEFAULTS.themeMode,
    controlsProfile: DEFAULTS.controlsProfile,
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
    showFullscreenButton: DEFAULTS.showFullscreenButton,
    showAppButtons: DEFAULTS.showAppButtons,
    hideAppLauncherAfterLaunch: DEFAULTS.hideAppLauncherAfterLaunch,
    autoFocusKeyboard: DEFAULTS.autoFocusKeyboard,
    audioControls: defaultAudioControls(),
    gestureMode: defaultGestureMode(DEFAULTS.controlsProfile),
    haGestureMode: defaultHAGestureMode(),
    webosApps: DEFAULT_WEBOS_APPS,
  };

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    return document.createElement('touchpad-card-editor');
  }

  public static getStubConfig(): TouchpadCardConfig {
    return {
      type: 'custom:touchpad-card',
      storage_id: createStorageId(),
      theme_mode: DEFAULTS.themeMode,
      wsUrl: 'ws://YOUR-PC-LAN-IP:8765',
      controls_profile: DEFAULTS.controlsProfile,
      show_lock: DEFAULTS.showLock,
      show_speed_buttons: DEFAULTS.showSpeedButtons,
      show_status_text: DEFAULTS.showStatusText,
      show_audio_controls: DEFAULTS.showAudioControls,
      show_keyboard_button: DEFAULTS.showKeyboardButton,
      show_fullscreen_button: DEFAULTS.showFullscreenButton,
      show_app_buttons: DEFAULTS.showAppButtons,
      hide_app_launcher_after_launch: DEFAULTS.hideAppLauncherAfterLaunch,
      auto_focus_keyboard: DEFAULTS.autoFocusKeyboard,
    };
  }

  public setConfig(config: TouchpadCardConfig): void {
    const devices = this.normalizeDevices(config);

    this._config = config;
    this._devices = devices;
    this._activeDeviceId = this.initialActiveDeviceId(devices);
    this.applyActiveDeviceOptions();

    this._locked = false;
    this._keyboardOpen = false;
    this._appLauncherOpen = false;
    this._gestureModeActive = false;
    this._haGestureModeActive = false;
    this._speedMultiplier = 1;
    this.restoreUiState();
    this.applyActiveDeviceOptions();
    this.reconnectDelayMs = RECONNECT_BASE_MS;
    this.connect();
  }

  public connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('fullscreenchange', this.handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this.handleFullscreenChange);
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
    document.removeEventListener('fullscreenchange', this.handleFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', this.handleFullscreenChange);
    if (this.tapTimer) {
      clearTimeout(this.tapTimer);
      this.tapTimer = undefined;
    }
    this.clearGestureTapTimer();
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = undefined;
    }
    if (this.appNoticeTimer) {
      clearTimeout(this.appNoticeTimer);
      this.appNoticeTimer = undefined;
    }
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = undefined;
    }
    this.cancelAudioPress();
    this.cancelFullscreenScrollRestore();
    this.fullscreenScrollSnapshot = undefined;
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
      this.resetAppAvailability();
      this.detachTimer = undefined;
    }, 2000);
  }

  private normalizeControlsProfile(profile?: TouchpadControlsProfile): TouchpadControlsProfile {
    return profile === 'webos' ? 'webos' : DEFAULTS.controlsProfile;
  }

  private normalizeThemeMode(themeMode?: TouchpadThemeMode): TouchpadThemeMode {
    return themeMode === 'dark' || themeMode === 'light' ? themeMode : DEFAULTS.themeMode;
  }

  private effectiveThemeMode(): 'dark' | 'light' {
    if (this.opts.themeMode !== 'auto') {
      return this.opts.themeMode;
    }
    const hassWithThemes = this.hass as HomeAssistant & { themes?: { darkMode?: boolean } };
    return hassWithThemes.themes?.darkMode ? 'dark' : 'light';
  }

  private configuredControlsProfile(config: Pick<TouchpadDeviceConfig, 'controls_profile' | 'backend'>): TouchpadControlsProfile | undefined {
    return config.controls_profile ?? config.backend;
  }

  private normalizeGestureAction(action: TouchpadGestureAction | undefined, fallback: TouchpadGestureAction): TouchpadGestureAction {
    const normalized = String(action ?? '').trim() as TouchpadGestureAction;
    return GESTURE_ACTIONS.has(normalized) ? normalized : fallback;
  }

  private normalizeHAGestureAction(action: unknown): TouchpadHAGestureAction {
    if (action && typeof action === 'object') {
      return this.deepClone(action) as TouchpadHAGestureAction;
    }
    return { action: 'none' };
  }

  private normalizeAudioControlsMode(mode: unknown): TouchpadAudioControlsMode {
    return mode === 'home_assistant' ? 'home_assistant' : 'device';
  }

  private deepClone(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.deepClone(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, this.deepClone(item)]));
    }
    return value;
  }

  private resolveGestureMode(
    config: TouchpadCardConfig,
    device: TouchpadDeviceConfig | undefined,
    controlsProfile: TouchpadControlsProfile
  ): Required<TouchpadGestureModeConfig> {
    const defaults = defaultGestureMode(controlsProfile);
    const rootProfile = this.normalizeControlsProfile(this.configuredControlsProfile(config));
    const root = !device || rootProfile === controlsProfile ? config.gesture_mode ?? {} : {};
    const local = device?.gesture_mode ?? {};

    return {
      show_button: local.show_button ?? root.show_button ?? defaults.show_button,
      invert_swipes: local.invert_swipes ?? root.invert_swipes ?? defaults.invert_swipes,
      swipe_left: this.normalizeGestureAction(local.swipe_left ?? root.swipe_left, defaults.swipe_left),
      swipe_right: this.normalizeGestureAction(local.swipe_right ?? root.swipe_right, defaults.swipe_right),
      swipe_up: this.normalizeGestureAction(local.swipe_up ?? root.swipe_up, defaults.swipe_up),
      swipe_down: this.normalizeGestureAction(local.swipe_down ?? root.swipe_down, defaults.swipe_down),
      tap: this.normalizeGestureAction(local.tap ?? root.tap, defaults.tap),
      double_tap: this.normalizeGestureAction(local.double_tap ?? root.double_tap, defaults.double_tap),
      hold: this.normalizeGestureAction(local.hold ?? root.hold, defaults.hold),
    };
  }

  private resolveHAGestureMode(config: TouchpadCardConfig, device: TouchpadDeviceConfig | undefined): Required<TouchpadHAGestureModeConfig> {
    const defaults = defaultHAGestureMode();
    const root = config.ha_gesture_mode ?? {};
    const local = device?.ha_gesture_mode ?? {};

    return {
      show_button: local.show_button ?? root.show_button ?? defaults.show_button,
      invert_swipes: local.invert_swipes ?? root.invert_swipes ?? defaults.invert_swipes,
      swipe_left: this.normalizeHAGestureAction(local.swipe_left ?? root.swipe_left),
      swipe_right: this.normalizeHAGestureAction(local.swipe_right ?? root.swipe_right),
      swipe_up: this.normalizeHAGestureAction(local.swipe_up ?? root.swipe_up),
      swipe_down: this.normalizeHAGestureAction(local.swipe_down ?? root.swipe_down),
      tap: this.normalizeHAGestureAction(local.tap ?? root.tap),
      double_tap: this.normalizeHAGestureAction(local.double_tap ?? root.double_tap),
      hold: this.normalizeHAGestureAction(local.hold ?? root.hold),
    };
  }

  private resolveAudioControls(
    config: TouchpadCardConfig,
    device: TouchpadDeviceConfig | undefined
  ): ResolvedTouchpadAudioControlsConfig {
    const defaults = defaultAudioControls();
    const root = config.audio_controls ?? {};
    const local = device?.audio_controls ?? {};

    return {
      mode: this.normalizeAudioControlsMode(local.mode ?? root.mode ?? defaults.mode),
      volume_up: this.resolveAudioButtonActions(local.volume_up, root.volume_up, defaults.volume_up),
      volume_down: this.resolveAudioButtonActions(local.volume_down, root.volume_down, defaults.volume_down),
      volume_mute: this.resolveAudioButtonActions(local.volume_mute, root.volume_mute, defaults.volume_mute),
    };
  }

  private resolveAudioButtonActions(
    local: TouchpadAudioControlsConfig[TouchpadAudioButtonField] | undefined,
    root: TouchpadAudioControlsConfig[TouchpadAudioButtonField] | undefined,
    defaults: ResolvedTouchpadAudioControlsConfig[TouchpadAudioButtonField]
  ): ResolvedTouchpadAudioControlsConfig[TouchpadAudioButtonField] {
    return {
      tap: this.normalizeHAGestureAction(local?.tap ?? root?.tap ?? defaults.tap),
      hold: this.normalizeHAGestureAction(local?.hold ?? root?.hold ?? defaults.hold),
    };
  }

  private resolveOptions(config: TouchpadCardConfig, device?: TouchpadDeviceConfig): TouchpadRuntimeOptions {
    const webosApps = device?.webos_apps ?? config.webos_apps;
    const controlsProfile = this.normalizeControlsProfile(
      this.configuredControlsProfile(device ?? config) ?? this.configuredControlsProfile(config)
    );
    return {
      themeMode: this.normalizeThemeMode(config.theme_mode),
      controlsProfile,
      sensitivity: device?.sensitivity ?? config.sensitivity ?? DEFAULTS.sensitivity,
      scrollMultiplier: device?.scroll_multiplier ?? config.scroll_multiplier ?? DEFAULTS.scrollMultiplier,
      invertScroll: device?.invert_scroll ?? config.invert_scroll ?? DEFAULTS.invertScroll,
      doubleTapMs: device?.double_tap_ms ?? config.double_tap_ms ?? DEFAULTS.doubleTapMs,
      tapSuppressionPx: device?.tap_suppression_px ?? config.tap_suppression_px ?? DEFAULTS.tapSuppressionPx,
      showLock: device?.show_lock ?? config.show_lock ?? DEFAULTS.showLock,
      showSpeedButtons: device?.show_speed_buttons ?? config.show_speed_buttons ?? DEFAULTS.showSpeedButtons,
      showStatusText: device?.show_status_text ?? config.show_status_text ?? DEFAULTS.showStatusText,
      showAudioControls: device?.show_audio_controls ?? config.show_audio_controls ?? DEFAULTS.showAudioControls,
      showKeyboardButton: device?.show_keyboard_button ?? config.show_keyboard_button ?? DEFAULTS.showKeyboardButton,
      showFullscreenButton: device?.show_fullscreen_button ?? config.show_fullscreen_button ?? DEFAULTS.showFullscreenButton,
      showAppButtons: device?.show_app_buttons ?? config.show_app_buttons ?? DEFAULTS.showAppButtons,
      hideAppLauncherAfterLaunch:
        device?.hide_app_launcher_after_launch ??
        config.hide_app_launcher_after_launch ??
        DEFAULTS.hideAppLauncherAfterLaunch,
      autoFocusKeyboard: device?.auto_focus_keyboard ?? config.auto_focus_keyboard ?? DEFAULTS.autoFocusKeyboard,
      audioControls: this.resolveAudioControls(config, device),
      gestureMode: this.resolveGestureMode(config, device, controlsProfile),
      haGestureMode: this.resolveHAGestureMode(config, device),
      webosApps: normalizeWebOSApps(webosApps ?? DEFAULT_WEBOS_APPS),
    };
  }

  private normalizeDevices(config: TouchpadCardConfig): ResolvedTouchpadDevice[] {
    if (Array.isArray(config.devices) && config.devices.length > 0) {
      const seen = new Set<string>();
      return config.devices.map((device, index) => {
        const id = String(device?.id ?? '').trim();
        const wsUrl = String(device?.wsUrl ?? '').trim();

        if (!id) {
          throw new Error(`devices[${index}].id is required`);
        }
        if (!wsUrl) {
          throw new Error(`devices[${index}].wsUrl is required`);
        }
        if (seen.has(id)) {
          throw new Error(`Duplicate touchpad device id: ${id}`);
        }
        seen.add(id);

        const name = String(device?.name ?? id).trim() || id;
        return {
          ...device,
          id,
          name,
          wsUrl,
          controlsProfile: this.normalizeControlsProfile(this.configuredControlsProfile(device) ?? this.configuredControlsProfile(config)),
        };
      });
    }

    const wsUrl = String(config.wsUrl ?? '').trim();
    if (!wsUrl) {
      throw new Error('Either wsUrl or devices is required');
    }

    const controlsProfile = this.normalizeControlsProfile(this.configuredControlsProfile(config));
    return [
      {
        id: 'default',
        name: controlsProfile === 'webos' ? 'TV' : 'PC',
        wsUrl,
        controlsProfile,
        controls_profile: controlsProfile,
        sensitivity: config.sensitivity,
        scroll_multiplier: config.scroll_multiplier,
        invert_scroll: config.invert_scroll,
        double_tap_ms: config.double_tap_ms,
        tap_suppression_px: config.tap_suppression_px,
        show_lock: config.show_lock,
        show_speed_buttons: config.show_speed_buttons,
        show_status_text: config.show_status_text,
        show_audio_controls: config.show_audio_controls,
        show_keyboard_button: config.show_keyboard_button,
        show_fullscreen_button: config.show_fullscreen_button,
        show_app_buttons: config.show_app_buttons,
        hide_app_launcher_after_launch: config.hide_app_launcher_after_launch,
        auto_focus_keyboard: config.auto_focus_keyboard,
        audio_controls: config.audio_controls,
        gesture_mode: config.gesture_mode,
        ha_gesture_mode: config.ha_gesture_mode,
        webos_apps: config.webos_apps,
      },
    ];
  }

  private initialActiveDeviceId(devices: ResolvedTouchpadDevice[]): string | undefined {
    if (this._activeDeviceId && devices.some((device) => device.id === this._activeDeviceId)) {
      return this._activeDeviceId;
    }

    return devices[0]?.id;
  }

  private get activeDevice(): ResolvedTouchpadDevice | undefined {
    return this._devices.find((device) => device.id === this._activeDeviceId) ?? this._devices[0];
  }

  private applyActiveDeviceOptions(): void {
    if (!this._config) return;
    this.opts = this.resolveOptions(this._config, this.activeDevice);
    if (!this.opts.showKeyboardButton) {
      this._keyboardOpen = false;
    }
    if (!this.opts.showLock) {
      this._locked = false;
    }
    if (!this.opts.showSpeedButtons) {
      this._speedMultiplier = 1;
    }
    if (!this.opts.showAudioControls) {
      this.cancelAudioPress();
    }
    if (!this.canShowAppLauncherToggle()) {
      this._appLauncherOpen = false;
    }
    if (!this.opts.gestureMode.show_button) {
      this._gestureModeActive = false;
    }
    if (!this.opts.haGestureMode.show_button) {
      this._haGestureModeActive = false;
    }
    if (!this.opts.showFullscreenButton && this._fullscreenActive) {
      void this.exitFullscreen();
    }
  }

  private isPlaceholderWsUrl(wsUrl: string | undefined): boolean {
    const value = String(wsUrl ?? '').trim();
    if (!value) {
      return true;
    }

    try {
      const hostname = new URL(value).hostname.toLowerCase();
      return hostname === 'your-host' || hostname === 'your-pc-lan-ip' || hostname.startsWith('your-');
    } catch {
      return false;
    }
  }

  private connect(): void {
    const generation = ++this.socketGeneration;
    this.teardownSocket(false);

    const device = this.activeDevice;
    const wsUrl = String(device?.wsUrl ?? '').trim();
    if (!wsUrl || this.isPlaceholderWsUrl(wsUrl)) {
      this.setStatus('disconnected');
      return;
    }

    this.setStatus('connecting');
    this.wsErrorNotified = false;
    try {
      this.socket = new WebSocket(wsUrl);
    } catch (err) {
      logCardError('Failed to initialize WebSocket connection. Check WebSocket URL.', err);
      this.setStatus('error');
      return;
    }

    this.socket.addEventListener('open', () => {
      if (generation !== this.socketGeneration) return;
      this.wsErrorNotified = false;
      this.reconnectDelayMs = RECONNECT_BASE_MS;
      this.setStatus('connected');
      this.queryAppAvailability();
      this.requestUpdate();
    });

    this.socket.addEventListener('message', (event) => {
      if (generation !== this.socketGeneration) return;
      this.handleServerMessage(event.data);
    });

    this.socket.addEventListener('close', () => {
      if (generation !== this.socketGeneration) return;
      this.setStatus('connecting');
      this.requestUpdate();
      this.scheduleReconnect();
    });

    this.socket.addEventListener('error', (event) => {
      if (generation !== this.socketGeneration) return;
      const deviceLabel = this.deviceStatusLabel();
      if (!this.wsErrorNotified) {
        logCardError(`WebSocket error (${deviceLabel}).`, event);
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

  private handleServerMessage(raw: unknown): void {
    if (typeof raw !== 'string') {
      return;
    }

    let data: TouchpadServerMessage;
    try {
      data = JSON.parse(raw) as TouchpadServerMessage;
    } catch (err) {
      logCardWarn('Ignoring invalid server message.', err);
      return;
    }

    if (data.t === 'webos_apps') {
      if (!Array.isArray(data.available_app_ids)) return;
      this._availableAppIds = new Set(data.available_app_ids.map((appId) => String(appId).trim()).filter(Boolean));
      this.requestUpdate();
      return;
    }

    if (data.t === 'app_launch_result' && data.ok === false) {
      const appId = String(data.app_id ?? '').trim();
      if (appId) {
        this._unavailableAppIds = new Set([...this._unavailableAppIds, appId]);
      }
      const appName = (this.appNameForId(appId) ?? appId) || 'App';
      this.showAppNotice(`${appName} not available on this TV`);
    }
  }

  private resetAppAvailability(): void {
    this._availableAppIds = undefined;
    this._unavailableAppIds = new Set<string>();
    this._appNotice = undefined;
    if (this.appNoticeTimer) {
      clearTimeout(this.appNoticeTimer);
      this.appNoticeTimer = undefined;
    }
  }

  private appNameForId(appId: string): string | undefined {
    const app = this.opts.webosApps.find((candidate) => candidate.app_id === appId);
    return app ? this.appDisplayLabel(app) : undefined;
  }

  private isAppUnavailable(appId: string): boolean {
    if (!appId) return true;
    if (this._unavailableAppIds.has(appId)) return true;
    return this._availableAppIds !== undefined && !this._availableAppIds.has(appId);
  }

  private showAppNotice(message: string): void {
    if (this.appNoticeTimer) {
      clearTimeout(this.appNoticeTimer);
    }
    this._appNotice = message;
    this.appNoticeTimer = window.setTimeout(() => {
      this._appNotice = undefined;
      this.appNoticeTimer = undefined;
    }, 3200);
  }

  private teardownSocket(invalidate = true): void {
    if (invalidate) {
      this.socketGeneration += 1;
    }
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

  private viewStorageId(): string {
    return window?.location?.pathname ?? '';
  }

  private appStorageId(): string {
    return navigator?.userAgent ?? 'unknown';
  }

  private configStorageId(): string {
    return String(this._config?.storage_id ?? '').trim();
  }

  private persistenceKeyBase(): string {
    return `touchpad-card:${this.viewStorageId()}`;
  }

  private legacySingleDevicePersistenceKey(): string | null {
    const ws = this._config?.wsUrl ?? this._devices[0]?.wsUrl;
    return ws ? `touchpad-card:${ws}:${this.viewStorageId()}:${this.appStorageId()}` : null;
  }

  private persistenceKey(): string | null {
    const baseKey = this.persistenceKeyBase();
    const storageId = this.configStorageId();

    if (storageId) {
      return `${baseKey}:${storageId}`;
    }

    if (!Array.isArray(this._config?.devices)) {
      return this.legacySingleDevicePersistenceKey();
    }

    return null;
  }

  private previousPersistenceKeys(): string[] {
    const baseKey = this.persistenceKeyBase();
    const currentKey = this.persistenceKey();
    const legacySingleKey = this.legacySingleDevicePersistenceKey();
    return [legacySingleKey, baseKey, `${baseKey}:card`].filter(
      (key, index, keys): key is string => Boolean(key) && key !== currentKey && keys.indexOf(key) === index
    );
  }

  private readPersistedUiState(store: Storage, key: string): PersistedUiState | null {
    try {
      const raw = store.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as PersistedUiState;
    } catch (err) {
      logCardWarn('Failed to read touchpad UI state.', err);
      return null;
    }
  }

  private loadPersistedUiState(): PersistedUiState | null {
    const store = this.storageAvailable();
    const key = this.persistenceKey();
    if (!store || !key) return null;

    for (const previousKey of this.previousPersistenceKeys()) {
      const previousState = this.readPersistedUiState(store, previousKey);
      if (!previousState) {
        continue;
      }
      try {
        store.setItem(key, JSON.stringify(previousState));
        store.removeItem(previousKey);
      } catch (err) {
        logCardWarn('Failed to move touchpad UI state.', err);
      }
      return previousState;
    }

    return this.readPersistedUiState(store, key);
  }

  private isSpeedMultiplier(value: unknown): value is 1 | 2 | 3 | 4 {
    return value === 1 || value === 2 || value === 3 || value === 4;
  }

  private activeDeviceStorageId(): string | undefined {
    return this.activeDevice?.id ?? this._activeDeviceId;
  }

  private resetUiToggles(): void {
    this._locked = false;
    this._speedMultiplier = 1;
    this._keyboardOpen = false;
    this._appLauncherOpen = false;
    this._gestureModeActive = false;
    this._haGestureModeActive = false;
  }

  private restoreDeviceUiState(parsed: PersistedUiState | null = this.loadPersistedUiState()): void {
    const deviceId = this.activeDeviceStorageId();
    const deviceState = deviceId ? parsed?.deviceStates?.[deviceId] : undefined;
    const legacyState =
      parsed &&
      (typeof parsed.locked === 'boolean' ||
        this.isSpeedMultiplier(parsed.speedMultiplier) ||
        typeof parsed.keyboardOpen === 'boolean' ||
        typeof parsed.appLauncherOpen === 'boolean' ||
        typeof parsed.gestureModeActive === 'boolean' ||
        typeof parsed.haGestureModeActive === 'boolean')
        ? parsed
        : undefined;
    const state = deviceState ?? legacyState;

    this.resetUiToggles();
    if (typeof state?.locked === 'boolean') {
      this._locked = state.locked;
    }
    if (this.isSpeedMultiplier(state?.speedMultiplier)) {
      this._speedMultiplier = state.speedMultiplier;
    }
    if (typeof state?.keyboardOpen === 'boolean') {
      this._keyboardOpen = state.keyboardOpen;
    }
    if (typeof state?.appLauncherOpen === 'boolean') {
      this._appLauncherOpen = state.appLauncherOpen;
    }
    if (typeof state?.gestureModeActive === 'boolean') {
      this._gestureModeActive = state.gestureModeActive;
    }
    if (typeof state?.haGestureModeActive === 'boolean') {
      this._haGestureModeActive = state.haGestureModeActive;
    }
    if (this._gestureModeActive && this._haGestureModeActive) {
      this._haGestureModeActive = false;
    }
    this.applyActiveDeviceOptions();
  }

  private restoreUiState(): void {
    const parsed = this.loadPersistedUiState();
    try {
      if (typeof parsed?.activeDeviceId === 'string' && this._devices.some((device) => device.id === parsed.activeDeviceId)) {
        this._activeDeviceId = parsed.activeDeviceId;
      }
      this.restoreDeviceUiState(parsed);
    } catch (err) {
      logCardWarn('Failed to restore touchpad UI state.', err);
    }
  }

  private persistUiState(): void {
    const store = this.storageAvailable();
    const key = this.persistenceKey();
    if (!store || !key) return;
    try {
      const parsed = this.loadPersistedUiState();
      const validDeviceIds = new Set(this._devices.map((device) => device.id));
      const deviceStates: Record<string, PersistedDeviceUiState> = {};
      Object.entries(parsed?.deviceStates ?? {}).forEach(([deviceId, state]) => {
        if (validDeviceIds.has(deviceId)) {
          deviceStates[deviceId] = state;
        }
      });

      const activeDeviceId = this.activeDeviceStorageId();
      if (activeDeviceId) {
        deviceStates[activeDeviceId] = {
          locked: this._locked,
          speedMultiplier: this._speedMultiplier,
          keyboardOpen: this.opts.showKeyboardButton ? this._keyboardOpen : false,
          appLauncherOpen: this.canShowAppLauncherToggle() ? this._appLauncherOpen : false,
          gestureModeActive: this.opts.gestureMode.show_button ? this._gestureModeActive : false,
          haGestureModeActive: this.opts.haGestureMode.show_button ? this._haGestureModeActive : false,
        };
      }

      store.setItem(
        key,
        JSON.stringify({
          activeDeviceId: this._activeDeviceId,
          deviceIds: this._devices.map((device) => device.id),
          deviceStates,
        })
      );
    } catch (err) {
      logCardWarn('Failed to persist touchpad UI state.', err);
    }
  }

  private setStatus(next: 'disconnected' | 'connecting' | 'connected' | 'error', immediate = false): void {
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = undefined;
    }

    if (next === 'connected' || immediate) {
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

  private gestureModeActive(): boolean {
    return this._gestureModeActive || this._haGestureModeActive;
  }

  private handlePointerDown = (ev: PointerEvent): void => {
    if (this._locked) {
      this.startLockedPan(ev);
      return;
    }
    if (this.gestureModeActive()) {
      this.startGestureModePointer(ev);
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
    if (this.gestureModeActive()) {
      this.moveGestureModePointer(ev);
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
    if (this.gestureModeActive()) {
      this.endGestureModePointer(ev);
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
    if (this.gestureModeActive()) {
      this.cancelGestureModePointer(ev);
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

  private startGestureModePointer(ev: PointerEvent): void {
    ev.preventDefault();
    this.captureLayer?.setPointerCapture(ev.pointerId);
    this.endDragIfNeeded();
    this.cancelGestureTapTimer(false);

    const now = performance.now();
    this.pointers.set(ev.pointerId, {
      id: ev.pointerId,
      x: ev.clientX,
      y: ev.clientY,
      startX: ev.clientX,
      startY: ev.clientY,
      startTime: now,
    });

    this.gesture = 'gesture';
    if (this.pointers.size === 1) {
      this.gestureHoldFired = false;
      this.startGestureModeHoldTimer(ev);
    } else {
      this.cancelHoldTimer();
    }
  }

  private moveGestureModePointer(ev: PointerEvent): void {
    const pointer = this.pointers.get(ev.pointerId);
    if (!pointer) return;

    ev.preventDefault();
    pointer.x = ev.clientX;
    pointer.y = ev.clientY;
    this.pointers.set(ev.pointerId, pointer);

    const distFromStart = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
    if (this.holdTimer && distFromStart > HOLD_CANCEL_PX) {
      this.cancelHoldTimer();
    }
  }

  private endGestureModePointer(ev: PointerEvent): void {
    const pointer = this.pointers.get(ev.pointerId);
    if (!pointer) return;

    ev.preventDefault();
    const beforeCount = this.pointers.size;
    const dist = Math.hypot(ev.clientX - pointer.startX, ev.clientY - pointer.startY);

    this.pointers.delete(ev.pointerId);
    this.cancelHoldTimer();

    if (beforeCount === 1 && this.gesture === 'gesture' && !this.gestureHoldFired) {
      const direction = this.gestureSwipeDirection(pointer, ev.clientX, ev.clientY);
      if (direction) {
        this.clearGestureTapTimer();
        this.executeGesture(direction);
      } else if (dist <= this.opts.tapSuppressionPx) {
        this.handleGestureModeTap(performance.now());
      }
    }

    if (this.pointers.size === 0) {
      this.gesture = null;
      this.gestureHoldFired = false;
    }
  }

  private cancelGestureModePointer(ev: PointerEvent): void {
    if (this.pointers.has(ev.pointerId)) {
      this.pointers.delete(ev.pointerId);
    }
    this.cancelHoldTimer();
    if (this.pointers.size === 0) {
      this.clearGestureTapTimer();
      this.gesture = null;
      this.gestureHoldFired = false;
    }
  }

  private startGestureModeHoldTimer(ev: PointerEvent): void {
    this.cancelHoldTimer();
    this.holdTimer = window.setTimeout(() => {
      const pointer = this.pointers.get(ev.pointerId);
      if (!pointer) return;
      const dist = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
      if (this.pointers.size === 1 && this.gesture === 'gesture' && dist <= HOLD_CANCEL_PX) {
        this.gestureHoldFired = true;
        this.clearGestureTapTimer();
        this.executeGesture('hold');
        this.hapticHold();
      }
      this.holdTimer = undefined;
    }, HOLD_DELAY_MS);
  }

  private gestureSwipeDirection(pointer: PointerState, endX: number, endY: number): GestureDirection | null {
    const dx = endX - pointer.startX;
    const dy = endY - pointer.startY;
    const minSwipeDistance = Math.max(GESTURE_SWIPE_MIN_PX, this.opts.tapSuppressionPx * 3);
    if (Math.hypot(dx, dy) < minSwipeDistance) {
      return null;
    }

    const direction: GestureDirection =
      Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'swipe_left' : 'swipe_right') : dy < 0 ? 'swipe_up' : 'swipe_down';
    const invertSwipes = this._haGestureModeActive ? this.opts.haGestureMode.invert_swipes : this.opts.gestureMode.invert_swipes;
    return invertSwipes ? this.invertedGestureDirection(direction) : direction;
  }

  private invertedGestureDirection(direction: GestureDirection): GestureDirection {
    switch (direction) {
      case 'swipe_left':
        return 'swipe_right';
      case 'swipe_right':
        return 'swipe_left';
      case 'swipe_up':
        return 'swipe_down';
      case 'swipe_down':
        return 'swipe_up';
    }
  }

  private executeGesture(eventName: GestureEventName): void {
    if (this._haGestureModeActive) {
      this.executeHAGesture(eventName);
      return;
    }
    this.executeGestureAction(this.opts.gestureMode[eventName]);
  }

  private handleGestureModeTap(now: number): void {
    if (!this.activeGestureDoubleTapConfigured()) {
      this.executeGesture('tap');
      return;
    }

    this.cancelGestureTapTimer(false);
    if (this.gestureLastTapTime > 0 && now - this.gestureLastTapTime <= this.opts.doubleTapMs) {
      this.gestureLastTapTime = 0;
      this.executeGesture('double_tap');
      return;
    }

    this.gestureLastTapTime = now;
    this.gestureTapTimer = window.setTimeout(() => {
      this.executeGesture('tap');
      this.gestureLastTapTime = 0;
      this.gestureTapTimer = undefined;
    }, this.opts.doubleTapMs);
  }

  private activeGestureDoubleTapConfigured(): boolean {
    if (this._haGestureModeActive) {
      return this.hasHAGestureAction(this.opts.haGestureMode.double_tap);
    }
    return this.opts.gestureMode.double_tap !== 'none';
  }

  private cancelGestureTapTimer(resetTime = true): void {
    if (this.gestureTapTimer) {
      clearTimeout(this.gestureTapTimer);
      this.gestureTapTimer = undefined;
    }
    if (resetTime) {
      this.gestureLastTapTime = 0;
    }
  }

  private clearGestureTapTimer(): void {
    this.cancelGestureTapTimer(true);
  }

  private executeGestureAction(action: TouchpadGestureAction): void {
    switch (action) {
      case 'none':
        return;
      case 'volume_up':
        this.sendVolume('up');
        return;
      case 'volume_down':
        this.sendVolume('down');
        return;
      case 'volume_mute':
        this.sendVolume('mute');
        return;
      default:
        this.sendKey(action);
    }
  }

  private executeHAGesture(eventName: GestureEventName): void {
    const action = this.opts.haGestureMode[eventName];
    if (!this.hasHAGestureAction(action)) {
      return;
    }
    if (!this.hass) {
      logCardWarn('Cannot execute Home Assistant gesture action because hass is not available.');
      return;
    }

    void this.executeHAAction(action).catch((err) => {
      logCardError('Failed to execute Home Assistant gesture action.', err);
    });
  }

  private hasHAGestureAction(action: TouchpadHAGestureAction | undefined): boolean {
    if (!action || typeof action !== 'object') {
      return false;
    }
    const type = String(action.action ?? '').trim();
    return Boolean(type) && type !== 'none';
  }

  private async executeHAAction(action: TouchpadHAGestureAction): Promise<void> {
    const type = String(action.action ?? '').trim();
    if (type === 'perform-action' || type === 'perform_action') {
      await this.executeHAPerformAction(action.perform_action ?? action.performAction ?? action.service, action.target, action.data ?? action.service_data);
      return;
    }
  }

  private async executeHAPerformAction(
    performAction: unknown,
    outerTarget: unknown,
    outerData: unknown
  ): Promise<void> {
    const action =
      performAction && typeof performAction === 'object'
        ? (performAction as Record<string, unknown>)
        : { service: performAction };
    const serviceName = String(action.service ?? action.action ?? performAction ?? '');
    const target = action.target ?? outerTarget;
    const data = action.data ?? action.service_data ?? outerData;

    if (serviceName === 'toggle') {
      await this.callHAService('homeassistant.toggle', undefined, target);
      return;
    }

    await this.callHAService(serviceName, data, target);
  }

  private async callHAService(serviceName: string, data: unknown, target: unknown): Promise<void> {
    if (!this.hass) {
      return;
    }
    const [domain, service] = serviceName.split('.', 2);
    if (!domain || !service) {
      logCardWarn('Cannot execute Home Assistant action because service name is invalid.', serviceName);
      return;
    }

    const serviceData = data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
    const serviceTarget = target && typeof target === 'object' ? (target as Record<string, unknown>) : undefined;
    await this.hass.callService(domain, service, serviceData, serviceTarget);
  }

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

  private audioButtonField(action: VolumeAction): TouchpadAudioButtonField {
    switch (action) {
      case 'up':
        return 'volume_up';
      case 'down':
        return 'volume_down';
      case 'mute':
        return 'volume_mute';
    }
  }

  private executeAudioButtonAction(action: VolumeAction, eventName: 'tap' | 'hold'): void {
    if (this.opts.audioControls.mode !== 'home_assistant') {
      if (eventName === 'tap') {
        this.sendVolume(action);
      }
      return;
    }

    const haAction = this.opts.audioControls[this.audioButtonField(action)][eventName];
    if (!this.hasHAGestureAction(haAction)) {
      return;
    }
    if (!this.hass) {
      logCardWarn('Cannot execute Home Assistant audio action because hass is not available.');
      return;
    }

    void this.executeHAAction(haAction).catch((err) => {
      logCardError('Failed to execute Home Assistant audio action.', err);
    });
  }

  private handleAudioPointerDown(ev: PointerEvent, action: VolumeAction): void {
    if (ev.button !== 0) {
      return;
    }
    ev.stopPropagation();
    this.cancelAudioPress();

    const target = ev.currentTarget as HTMLElement;
    this.audioPress = {
      pointerId: ev.pointerId,
      target,
      holdFired: false,
    };
    target.setPointerCapture?.(ev.pointerId);

    if (this.opts.audioControls.mode === 'home_assistant') {
      this.audioHoldTimer = window.setTimeout(() => {
        if (!this.audioPress || this.audioPress.pointerId !== ev.pointerId) {
          return;
        }
        this.audioPress.holdFired = true;
        this.suppressAudioClick = true;
        this.executeAudioButtonAction(action, 'hold');
      }, HOLD_DELAY_MS);
    }
  }

  private handleAudioPointerUp(ev: PointerEvent, action: VolumeAction): void {
    ev.stopPropagation();
    const press = this.audioPress;
    if (!press || press.pointerId !== ev.pointerId) {
      return;
    }

    this.releaseAudioPointerCapture(press.target, ev.pointerId);
    this.clearAudioHoldTimer();
    this.audioPress = undefined;
    this.suppressAudioClick = true;

    if (!press.holdFired) {
      this.executeAudioButtonAction(action, 'tap');
    }
  }

  private handleAudioPointerCancel(ev: PointerEvent): void {
    ev.stopPropagation();
    if (this.audioPress?.pointerId === ev.pointerId) {
      this.cancelAudioPress();
    }
  }

  private handleAudioClick(ev: MouseEvent, action: VolumeAction): void {
    ev.stopPropagation();
    if (this.suppressAudioClick) {
      ev.preventDefault();
      this.suppressAudioClick = false;
      return;
    }
    this.executeAudioButtonAction(action, 'tap');
  }

  private clearAudioHoldTimer(): void {
    if (this.audioHoldTimer) {
      clearTimeout(this.audioHoldTimer);
      this.audioHoldTimer = undefined;
    }
  }

  private cancelAudioPress(): void {
    this.clearAudioHoldTimer();
    if (this.audioPress) {
      this.releaseAudioPointerCapture(this.audioPress.target, this.audioPress.pointerId);
      this.audioPress = undefined;
    }
  }

  private releaseAudioPointerCapture(target: HTMLElement, pointerId: number): void {
    if (target.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  }

  private launchApp(app: WebOSAppConfig): void {
    const appId = app.app_id;
    const label = this.appDisplayLabel(app);
    if (this.isAppUnavailable(appId)) {
      this.showAppNotice(`${label} not available on this TV`);
      return;
    }
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (!appId) return;
    const msg: TouchpadMessage = { t: 'launch_app', app_id: appId };
    try {
      this.socket.send(JSON.stringify(msg));
      if (this.opts.hideAppLauncherAfterLaunch && this._appLauncherOpen) {
        this._appLauncherOpen = false;
        this.persistUiState();
      }
    } catch (err) {
      logCardError('Failed to launch webOS app.', err);
    }
  }

  private appDisplayLabel(app: WebOSAppConfig): string {
    return String(app.name ?? '').trim() || String(app.app_id ?? '').trim() || 'App';
  }

  private queryAppAvailability(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (this.opts.controlsProfile !== 'webos' || !this.opts.showAppButtons) return;
    const appIds = this.opts.webosApps.map((app) => app.app_id).filter(Boolean);
    if (!appIds.length) return;
    const msg: TouchpadMessage = { t: 'query_apps', app_ids: appIds };
    try {
      this.socket.send(JSON.stringify(msg));
    } catch (err) {
      logCardWarn('Failed to query webOS app availability.', err);
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

  private currentFullscreenElement(): Element | null {
    const fullscreenDocument = document as FullscreenCapableDocument;
    return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;
  }

  private requestNativeFullscreen(): Promise<void> | null {
    const target = this as FullscreenCapableElement;
    if (target.requestFullscreen) {
      return target.requestFullscreen();
    }
    if (target.webkitRequestFullscreen) {
      return Promise.resolve(target.webkitRequestFullscreen());
    }
    return null;
  }

  private exitNativeFullscreen(): Promise<void> | null {
    const fullscreenDocument = document as FullscreenCapableDocument;
    if (document.exitFullscreen) {
      return document.exitFullscreen();
    }
    if (fullscreenDocument.webkitExitFullscreen) {
      return Promise.resolve(fullscreenDocument.webkitExitFullscreen());
    }
    return null;
  }

  private handleFullscreenChange = (): void => {
    const fullscreenElement = this.currentFullscreenElement();
    const ownsFullscreen =
      fullscreenElement === this || Boolean(fullscreenElement && (this.contains(fullscreenElement) || this.renderRoot.contains(fullscreenElement)));

    if (ownsFullscreen || (fullscreenElement && this.fullscreenMode === 'native')) {
      this.fullscreenMode = 'native';
      this._fullscreenActive = true;
      return;
    }

    if (this.fullscreenMode === 'native') {
      this.fullscreenMode = null;
      this._fullscreenActive = false;
      this.scheduleFullscreenScrollRestore();
    }
  };

  private enterFullscreen = async (): Promise<void> => {
    if (this._fullscreenActive) return;

    this.captureFullscreenScroll();
    this.resetInteractionState();
    const nativeRequest = this.requestNativeFullscreen();
    if (nativeRequest) {
      this.fullscreenMode = 'native';
      try {
        await nativeRequest;
        this._fullscreenActive = true;
        return;
      } catch (err) {
        this.fullscreenMode = null;
        logCardWarn('Native fullscreen request failed; using card fullscreen fallback.', err);
      }
    }

    this.fullscreenMode = 'soft';
    this._fullscreenActive = true;
  };

  private exitFullscreen = async (): Promise<void> => {
    if (!this._fullscreenActive) return;

    this.resetInteractionState();
    const hasNativeFullscreen = Boolean(this.currentFullscreenElement()) || this.fullscreenMode === 'native';
    this.fullscreenMode = null;
    this._fullscreenActive = false;

    if (hasNativeFullscreen) {
      const nativeExit = this.exitNativeFullscreen();
      if (nativeExit) {
        try {
          await nativeExit;
        } catch (err) {
          logCardWarn('Native fullscreen exit failed.', err);
        }
      }
    }

    this.scheduleFullscreenScrollRestore();
  };

  private toggleFullscreen = (ev: Event): void => {
    ev.stopPropagation();
    void (this._fullscreenActive ? this.exitFullscreen() : this.enterFullscreen());
  };

  private captureFullscreenScroll(): void {
    const targets: FullscreenScrollTarget[] = [];
    const seen = new Set<Element>();
    let node: Node | null = this;

    while (node) {
      const element = node instanceof ShadowRoot ? node.host : node instanceof Element ? node : null;
      if (element && !seen.has(element)) {
        seen.add(element);
        if (this.shouldRestoreScroll(element)) {
          targets.push({ element, left: element.scrollLeft, top: element.scrollTop });
        }
      }
      node = this.composedParentNode(node);
    }

    const scrollingElement = document.scrollingElement;
    if (scrollingElement && !seen.has(scrollingElement)) {
      targets.push({ element: scrollingElement, left: scrollingElement.scrollLeft, top: scrollingElement.scrollTop });
    }

    this.fullscreenScrollSnapshot = {
      windowX: window.scrollX,
      windowY: window.scrollY,
      targets,
    };
  }

  private composedParentNode(node: Node): Node | null {
    if (node.parentNode) {
      return node.parentNode;
    }
    const root = node.getRootNode();
    if (root instanceof ShadowRoot && root !== node) {
      return root.host;
    }
    if (node instanceof ShadowRoot) {
      return node.host;
    }
    return null;
  }

  private shouldRestoreScroll(element: Element): boolean {
    if (element.scrollLeft !== 0 || element.scrollTop !== 0) {
      return true;
    }
    const style = window.getComputedStyle(element);
    const scrollableY = /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    const scrollableX = /(auto|scroll|overlay)/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
    return scrollableX || scrollableY;
  }

  private scheduleFullscreenScrollRestore(): void {
    const snapshot = this.fullscreenScrollSnapshot;
    if (!snapshot) return;

    this.fullscreenScrollSnapshot = undefined;
    this.cancelFullscreenScrollRestore();
    const token = this.fullscreenRestoreToken;

    void this.updateComplete.then(() => {
      if (!this.isConnected || token !== this.fullscreenRestoreToken) return;
      this.fullscreenRestoreFrame = window.requestAnimationFrame(() => {
        if (token !== this.fullscreenRestoreToken) return;
        this.fullscreenRestoreFrame = undefined;
        this.restoreFullscreenScroll(snapshot);
        this.fullscreenRestoreFrame2 = window.requestAnimationFrame(() => {
          if (token !== this.fullscreenRestoreToken) return;
          this.fullscreenRestoreFrame2 = undefined;
          this.restoreFullscreenScroll(snapshot);
        });
      });
    });
  }

  private cancelFullscreenScrollRestore(): void {
    this.fullscreenRestoreToken += 1;
    if (this.fullscreenRestoreFrame != null) {
      window.cancelAnimationFrame(this.fullscreenRestoreFrame);
      this.fullscreenRestoreFrame = undefined;
    }
    if (this.fullscreenRestoreFrame2 != null) {
      window.cancelAnimationFrame(this.fullscreenRestoreFrame2);
      this.fullscreenRestoreFrame2 = undefined;
    }
  }

  private restoreFullscreenScroll(snapshot: FullscreenScrollSnapshot): void {
    snapshot.targets.forEach(({ element, left, top }) => {
      if (!element.isConnected) return;
      element.scrollLeft = left;
      element.scrollTop = top;
    });
    window.scrollTo(snapshot.windowX, snapshot.windowY);
  }

  private toggleLock = (): void => {
    if (!this._locked && this.dragPointerId != null) {
      this.sendButton('up');
      this.dragPointerId = undefined;
    }
    this.cancelHoldTimer();
    this.lockedPan = undefined;
    this._locked = !this._locked;
    if (this._locked) {
      this._gestureModeActive = false;
      this._haGestureModeActive = false;
    }
    this.persistUiState();
  };

  private toggleKeyboardPanel = (): void => {
    if (!this.opts.showKeyboardButton) return;
    this._keyboardOpen = !this._keyboardOpen;
    this.persistUiState();
    if (this._keyboardOpen && this.opts.autoFocusKeyboard) {
      window.setTimeout(() => {
        const input = this.renderRoot?.querySelector('.keyboard-input') as HTMLInputElement | null;
        input?.focus();
      }, 0);
    }
  };

  private toggleAppLauncher = (ev: Event): void => {
    ev.stopPropagation();
    if (!this.canShowAppLauncherToggle()) return;
    this._appLauncherOpen = !this._appLauncherOpen;
    this.persistUiState();
  };

  private toggleGestureMode = (ev: Event): void => {
    ev.stopPropagation();
    if (!this.opts.gestureMode.show_button) return;
    this.resetInteractionState();
    if (!this._gestureModeActive && this._locked) {
      this._locked = false;
    }
    this._gestureModeActive = !this._gestureModeActive;
    if (this._gestureModeActive) {
      this._haGestureModeActive = false;
    }
    this.persistUiState();
  };

  private toggleHAGestureMode = (ev: Event): void => {
    ev.stopPropagation();
    if (!this.opts.haGestureMode.show_button) return;
    this.resetInteractionState();
    if (!this._haGestureModeActive && this._locked) {
      this._locked = false;
    }
    this._haGestureModeActive = !this._haGestureModeActive;
    if (this._haGestureModeActive) {
      this._gestureModeActive = false;
    }
    this.persistUiState();
  };

  private toggleSpeed(mult: 2 | 3 | 4): void {
    this._speedMultiplier = this._speedMultiplier === mult ? 1 : mult;
    this.persistUiState();
  }

  private selectDevice(id: string): void {
    if (id === this._activeDeviceId || !this._devices.some((device) => device.id === id)) {
      return;
    }

    this.persistUiState();
    this.resetInteractionState();
    this.resetAppAvailability();
    this._activeDeviceId = id;
    this.applyActiveDeviceOptions();
    this.restoreDeviceUiState();
    this.reconnectDelayMs = RECONNECT_BASE_MS;
    this.persistUiState();
    this.setStatus('connecting', true);
    this.connect();
  }

  private resetInteractionState(): void {
    this.cancelHoldTimer();
    this.cancelAudioPress();
    this.clearGestureTapTimer();
    if (this.tapTimer) {
      clearTimeout(this.tapTimer);
      this.tapTimer = undefined;
    }
    if (this.rafHandle != null) {
      window.cancelAnimationFrame(this.rafHandle);
      this.rafHandle = undefined;
    }
    if (this.dragPointerId != null) {
      this.sendButton('up');
      this.dragPointerId = undefined;
    }
    this.pointers.clear();
    this.gesture = null;
    this.gestureHoldFired = false;
    this.lastTapTime = 0;
    this.gestureLastTapTime = 0;
    this.lockedPan = undefined;
    this.moveAccum = { x: 0, y: 0 };
    this.scrollAccum = { x: 0, y: 0 };
  }

  private deviceStatusLabel(): string {
    if (this._devices.length > 1) {
      return this.activeDevice?.name ?? 'Device';
    }
    return this.opts.controlsProfile === 'webos' ? 'TV' : 'PC';
  }

  private statusLabel(): string {
    const deviceLabel = this.deviceStatusLabel();
    switch (this._statusDisplay) {
      case 'connected':
        return `${deviceLabel} Connected`;
      case 'connecting':
        return `${deviceLabel} Connecting...`;
      case 'error':
        return `${deviceLabel} Connection error`;
      default:
        return `${deviceLabel} Disconnected`;
    }
  }

  private canShowAppLauncherToggle(): boolean {
    return this.opts.controlsProfile === 'webos' && this.opts.showAppButtons && this.opts.webosApps.length > 0;
  }

  protected render() {
    if (!this._config) return nothing;

    const showKeyboardSection = this.opts.showKeyboardButton && this._keyboardOpen;
    const showDeviceTabs = this._devices.length > 1;
    const isWebos = this.opts.controlsProfile === 'webos';
    const showAppLauncherToggle = this.canShowAppLauncherToggle();
    const showAppLauncher = showAppLauncherToggle && this._appLauncherOpen;
    const themeClass = `theme-${this.effectiveThemeMode()}`;
    const cardClass = `${themeClass} ${this._fullscreenActive ? 'fullscreen' : ''}`;
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
      <ha-card class=${cardClass} @contextmenu=${(e: Event) => e.preventDefault()}>
        ${showDeviceTabs
          ? html`<div class="device-tabs" role="tablist">
              ${this._devices.map(
                (device) => html`<button
                  class="device-tab ${device.id === this._activeDeviceId ? 'active' : ''}"
                  type="button"
                  role="tab"
                  aria-selected=${device.id === this._activeDeviceId ? 'true' : 'false'}
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this.selectDevice(device.id);
                  }}
                >
                  ${device.name}
                </button>`
              )}
            </div>`
          : nothing}
        <div
          class="surface ${this._locked ? 'locked' : ''} ${showKeyboardSection ? 'with-keyboard' : ''} ${showDeviceTabs
            ? 'with-device-tabs'
            : ''} ${showKeyboardSection || showAppLauncher ? 'with-bottom-panel' : ''}"
        >
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
                <button
                  class="icon-btn"
                  type="button"
                  title="Volume up"
                  @pointerdown=${(e: PointerEvent) => this.handleAudioPointerDown(e, 'up')}
                  @pointerup=${(e: PointerEvent) => this.handleAudioPointerUp(e, 'up')}
                  @pointercancel=${(e: PointerEvent) => this.handleAudioPointerCancel(e)}
                  @click=${(e: MouseEvent) => this.handleAudioClick(e, 'up')}
                >
                  <ha-icon icon="mdi:volume-plus"></ha-icon>
                </button>
                <button
                  class="icon-btn"
                  type="button"
                  title="Volume down"
                  @pointerdown=${(e: PointerEvent) => this.handleAudioPointerDown(e, 'down')}
                  @pointerup=${(e: PointerEvent) => this.handleAudioPointerUp(e, 'down')}
                  @pointercancel=${(e: PointerEvent) => this.handleAudioPointerCancel(e)}
                  @click=${(e: MouseEvent) => this.handleAudioClick(e, 'down')}
                >
                  <ha-icon icon="mdi:volume-minus"></ha-icon>
                </button>
                <button
                  class="icon-btn"
                  type="button"
                  title="Mute"
                  @pointerdown=${(e: PointerEvent) => this.handleAudioPointerDown(e, 'mute')}
                  @pointerup=${(e: PointerEvent) => this.handleAudioPointerUp(e, 'mute')}
                  @pointercancel=${(e: PointerEvent) => this.handleAudioPointerCancel(e)}
                  @click=${(e: MouseEvent) => this.handleAudioClick(e, 'mute')}
                >
                  <ha-icon icon="mdi:volume-mute"></ha-icon>
                </button>
              </div>`
            : nothing}
          ${this.opts.showKeyboardButton
            ? html`<button
                class="keyboard-toggle ${this._keyboardOpen ? 'active' : ''}"
                type="button"
                title="Keyboard"
                @click=${this.toggleKeyboardPanel}
              >
                <ha-icon icon="mdi:keyboard-outline"></ha-icon>
              </button>`
            : nothing}
          ${showAppLauncherToggle
            ? html`<button
                class="app-toggle ${this._appLauncherOpen ? 'active' : ''} ${this.opts.showKeyboardButton ? 'with-keyboard-toggle' : ''}"
                type="button"
                title="Apps"
                @click=${this.toggleAppLauncher}
              >
                <ha-icon icon="mdi:apps"></ha-icon>
              </button>`
            : nothing}
          ${this.opts.showFullscreenButton || this.opts.gestureMode.show_button || this.opts.haGestureMode.show_button
            ? html`<div class="mode-toggles">
                ${this.opts.gestureMode.show_button
                  ? html`<button
                      class="gesture-toggle ${this._gestureModeActive ? 'active' : ''}"
                      type="button"
                      title=${this._gestureModeActive ? 'Exit gesture mode' : 'Gesture mode'}
                      @pointerdown=${(e: Event) => e.stopPropagation()}
                      @pointerup=${(e: Event) => e.stopPropagation()}
                      @click=${this.toggleGestureMode}
                    >
                      <ha-icon icon="mdi:gesture-swipe"></ha-icon>
                    </button>`
                  : nothing}
                ${this.opts.showFullscreenButton
                  ? html`<button
                      class="fullscreen-toggle ${this._fullscreenActive ? 'active' : ''}"
                      type="button"
                      title=${this._fullscreenActive ? 'Exit fullscreen' : 'Fullscreen'}
                      @pointerdown=${(e: Event) => e.stopPropagation()}
                      @pointerup=${(e: Event) => e.stopPropagation()}
                      @click=${this.toggleFullscreen}
                    >
                      <ha-icon icon=${this._fullscreenActive ? 'mdi:fullscreen-exit' : 'mdi:fullscreen'}></ha-icon>
                    </button>`
                  : nothing}
                ${this.opts.haGestureMode.show_button
                  ? html`<button
                      class="ha-gesture-toggle ${this._haGestureModeActive ? 'active' : ''}"
                      type="button"
                      title=${this._haGestureModeActive ? 'Exit Home Assistant gesture mode' : 'Home Assistant gesture mode'}
                      @pointerdown=${(e: Event) => e.stopPropagation()}
                      @pointerup=${(e: Event) => e.stopPropagation()}
                      @click=${this.toggleHAGestureMode}
                    >
                      <ha-icon icon="mdi:home-assistant"></ha-icon>
                    </button>`
                  : nothing}
              </div>`
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
                ${this.statusLabel()}${this._locked ? ' (Locked)' : ''}${this._gestureModeActive ? ' (Gestures)' : ''}${this._haGestureModeActive
                  ? ' (HA Gestures)'
                  : ''}
              </div>`
            : nothing}
        </div>
        ${showAppLauncher
          ? html`<div class="app-strip ${showKeyboardSection ? 'with-keyboard' : ''}">
              ${this.opts.webosApps.map(
                (app) => {
                  const unavailable = this.isAppUnavailable(app.app_id);
                  const name = String(app.name ?? '').trim();
                  const icon = String(app.icon ?? '').trim();
                  const label = this.appDisplayLabel(app);
                  const iconOnly = Boolean(icon && !name);
                  return html`<button
                    class="app-btn ${iconOnly ? 'icon-only' : ''} ${unavailable ? 'unavailable' : ''}"
                    title=${unavailable ? `${label} not available on this TV` : label}
                    aria-label=${label}
                    aria-disabled=${unavailable ? 'true' : 'false'}
                    @click=${() => this.launchApp(app)}
                  >
                    ${icon ? html`<ha-icon icon=${icon}></ha-icon>` : nothing}
                    ${name ? html`<span>${name}</span>` : nothing}
                  </button>`;
                }
              )}
              ${this._appNotice ? html`<div class="app-notice">${this._appNotice}</div>` : nothing}
            </div>`
          : nothing}
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

    :host(:fullscreen) {
      width: 100vw;
      height: 100vh;
      height: 100dvh;
      background: var(--tp-panel-bg);
    }

    ha-card {
      overflow: hidden;
    }

    ha-card.fullscreen,
    :host(:fullscreen) ha-card {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      width: 100vw;
      height: 100vh;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      border-radius: 0;
      background: var(--tp-panel-bg);
    }

    ha-card.theme-dark {
      --tp-panel-bg: #161c29;
      --tp-surface-bg: linear-gradient(135deg, #1f2736, #2a3347);
      --tp-text: #f5f5f5;
      --tp-strong-text: #e5ecff;
      --tp-muted-text: #9ea7b7;
      --tp-subtle-text: rgba(255, 255, 255, 0.7);
      --tp-control-bg: rgba(255, 255, 255, 0.04);
      --tp-control-bg-strong: rgba(255, 255, 255, 0.05);
      --tp-control-hover-bg: rgba(255, 255, 255, 0.12);
      --tp-border-subtle: rgba(255, 255, 255, 0.14);
      --tp-border-medium: rgba(255, 255, 255, 0.18);
      --tp-border-strong: rgba(255, 255, 255, 0.32);
      --tp-divider: rgba(255, 255, 255, 0.06);
      --tp-surface-inset: rgba(255, 255, 255, 0.04);
      --tp-input-bg: rgba(255, 255, 255, 0.04);
      --tp-input-border: rgba(255, 255, 255, 0.12);
      --tp-input-focus-ring: rgba(255, 255, 255, 0.08);
      --tp-status-shadow: rgba(0, 0, 0, 0.3);
      --tp-accent: #ff9800;
      --tp-accent-soft: #ffb74d;
      --tp-accent-border: rgba(255, 152, 0, 0.5);
      --tp-accent-bg: rgba(255, 152, 0, 0.08);
      --tp-accent-ring: rgba(255, 152, 0, 0.2);
    }

    ha-card.theme-light {
      --tp-panel-bg: #f7f9fc;
      --tp-surface-bg: linear-gradient(135deg, #eef3f8, #dfe8f1);
      --tp-text: #1f2937;
      --tp-strong-text: #111827;
      --tp-muted-text: #5f6b7a;
      --tp-subtle-text: rgba(31, 41, 55, 0.72);
      --tp-control-bg: rgba(255, 255, 255, 0.72);
      --tp-control-bg-strong: rgba(255, 255, 255, 0.86);
      --tp-control-hover-bg: rgba(255, 255, 255, 0.98);
      --tp-border-subtle: rgba(30, 41, 59, 0.16);
      --tp-border-medium: rgba(30, 41, 59, 0.2);
      --tp-border-strong: rgba(30, 41, 59, 0.34);
      --tp-divider: rgba(30, 41, 59, 0.1);
      --tp-surface-inset: rgba(15, 23, 42, 0.08);
      --tp-input-bg: rgba(255, 255, 255, 0.94);
      --tp-input-border: rgba(30, 41, 59, 0.18);
      --tp-input-focus-ring: rgba(30, 41, 59, 0.08);
      --tp-status-shadow: rgba(255, 255, 255, 0.72);
      --tp-accent: #d97706;
      --tp-accent-soft: #b45309;
      --tp-accent-border: rgba(217, 119, 6, 0.48);
      --tp-accent-bg: rgba(217, 119, 6, 0.12);
      --tp-accent-ring: rgba(217, 119, 6, 0.18);
    }

    .device-tabs {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 10px 12px;
      overflow-x: auto;
      background: var(--tp-panel-bg);
      border-bottom: 1px solid var(--tp-divider);
      scrollbar-width: none;
    }

    .device-tabs::-webkit-scrollbar {
      display: none;
    }

    .device-tab {
      flex: 0 0 auto;
      min-width: 0;
      max-width: 160px;
      height: 34px;
      padding: 0 14px;
      overflow: hidden;
      border-radius: 10px;
      border: 1px solid var(--tp-border-subtle);
      background: var(--tp-control-bg);
      color: var(--tp-muted-text);
      cursor: pointer;
      font-size: 13px;
      line-height: 32px;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: all 140ms ease;
    }

    .device-tab:hover {
      border-color: var(--tp-border-strong);
      color: var(--tp-strong-text);
    }

    .device-tab.active {
      border-color: var(--tp-accent-border);
      color: var(--tp-accent-soft);
      background: var(--tp-accent-bg);
      box-shadow: 0 0 0 1px var(--tp-accent-ring);
    }

    .surface {
      position: relative;
      height: 280px;
      background: var(--tp-surface-bg);
      border-radius: 12px;
      box-shadow: inset 0 0 0 1px var(--tp-surface-inset);
      color: var(--tp-text);
      user-select: none;
      touch-action: none;
    }

    ha-card.fullscreen .surface,
    :host(:fullscreen) .surface {
      flex: 1 1 auto;
      min-height: 0;
      height: auto;
      border-radius: 0;
    }

    .surface.with-device-tabs {
      border-top-left-radius: 0;
      border-top-right-radius: 0;
    }

    .surface.with-keyboard,
    .surface.with-bottom-panel {
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
      border: 1px solid var(--tp-border-medium);
      color: var(--tp-muted-text);
      padding: 6px 10px;
      border-radius: 10px;
      cursor: pointer;
      transition: all 140ms ease;
      z-index: 2;
    }

    .lock.active {
      color: var(--tp-accent);
      border-color: var(--tp-accent-border);
      box-shadow: 0 0 0 1px var(--tp-accent-ring);
    }

    .status {
      position: absolute;
      right: 14px;
      bottom: 12px;
      max-width: calc(100% - 156px);
      font-size: 13px;
      color: var(--tp-subtle-text);
      text-align: right;
      text-shadow: 0 1px 2px var(--tp-status-shadow);
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
      border: 1px solid var(--tp-border-medium);
      color: var(--tp-muted-text);
      padding: 6px 10px;
      border-radius: 10px;
      cursor: pointer;
      transition: all 140ms ease;
    }

    .speed.active {
      color: var(--tp-accent);
      border-color: var(--tp-accent-border);
      box-shadow: 0 0 0 1px var(--tp-accent-ring);
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
      border: 1px solid var(--tp-border-subtle);
      background: var(--tp-control-bg);
      color: var(--tp-strong-text);
      cursor: pointer;
      font-size: 16px;
      transition: all 140ms ease;
    }

    .icon-btn:hover {
      border-color: var(--tp-border-strong);
      background: var(--tp-control-hover-bg);
    }

    .icon-btn:active {
      transform: scale(0.96);
    }

    .keyboard-toggle,
    .app-toggle {
      position: absolute;
      bottom: 12px;
      z-index: 3;
      width: 44px;
      height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 14px;
      border: 1px solid var(--tp-border-medium);
      background: var(--tp-control-bg-strong);
      color: var(--tp-muted-text);
      cursor: pointer;
      font-size: 17px;
      transition: all 140ms ease;
    }

    .keyboard-toggle {
      left: 12px;
    }

    .app-toggle {
      left: 12px;
    }

    .app-toggle.with-keyboard-toggle {
      left: 64px;
    }

    .keyboard-toggle:hover,
    .app-toggle:hover {
      border-color: var(--tp-border-strong);
      color: var(--tp-strong-text);
    }

    .keyboard-toggle.active,
    .app-toggle.active {
      color: var(--tp-accent);
      border-color: var(--tp-accent-border);
      box-shadow: 0 0 0 1px var(--tp-accent-ring);
    }

    .mode-toggles {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      z-index: 3;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .fullscreen-toggle,
    .gesture-toggle,
    .ha-gesture-toggle {
      width: 44px;
      height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 14px;
      border: 1px solid var(--tp-border-medium);
      background: var(--tp-control-bg-strong);
      color: var(--tp-muted-text);
      cursor: pointer;
      font-size: 17px;
      transition: all 140ms ease;
    }

    .fullscreen-toggle:hover,
    .gesture-toggle:hover,
    .ha-gesture-toggle:hover {
      border-color: var(--tp-border-strong);
      color: var(--tp-strong-text);
    }

    .fullscreen-toggle.active,
    .gesture-toggle.active,
    .ha-gesture-toggle.active {
      color: var(--tp-accent);
      border-color: var(--tp-accent-border);
      box-shadow: 0 0 0 1px var(--tp-accent-ring);
    }

    ha-card.fullscreen .mode-toggles,
    :host(:fullscreen) .mode-toggles {
      left: max(12px, env(safe-area-inset-left));
    }

    ha-card.fullscreen .keyboard-toggle,
    :host(:fullscreen) .keyboard-toggle {
      left: max(12px, env(safe-area-inset-left));
      bottom: max(12px, env(safe-area-inset-bottom));
    }

    ha-card.fullscreen .app-toggle,
    :host(:fullscreen) .app-toggle {
      left: max(12px, env(safe-area-inset-left));
      bottom: max(12px, env(safe-area-inset-bottom));
    }

    ha-card.fullscreen .app-toggle.with-keyboard-toggle,
    :host(:fullscreen) .app-toggle.with-keyboard-toggle {
      left: calc(max(12px, env(safe-area-inset-left)) + 52px);
    }

    ha-card.fullscreen .status,
    :host(:fullscreen) .status {
      right: max(14px, env(safe-area-inset-right));
      bottom: max(12px, env(safe-area-inset-bottom));
    }

    .icon-btn ha-icon,
    .keyboard-toggle ha-icon,
    .app-toggle ha-icon,
    .fullscreen-toggle ha-icon,
    .gesture-toggle ha-icon,
    .ha-gesture-toggle ha-icon {
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: inherit;
      --mdc-icon-size: 20px;
    }
    .app-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      padding: 10px 14px;
      overflow: visible;
      background: var(--tp-panel-bg);
      border-top: 1px solid var(--tp-divider);
      border-bottom-left-radius: 12px;
      border-bottom-right-radius: 12px;
    }
    .app-strip.with-keyboard {
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
    }
    ha-card.fullscreen .app-strip,
    :host(:fullscreen) .app-strip {
      flex: 0 0 auto;
      max-height: 28vh;
      max-height: 28dvh;
      overflow-y: auto;
      border-radius: 0;
      padding-right: max(14px, env(safe-area-inset-right));
      padding-left: max(14px, env(safe-area-inset-left));
    }
    .app-btn {
      flex: 0 1 auto;
      max-width: min(160px, 100%);
      height: var(--control-height);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      padding: 0 12px;
      box-sizing: border-box;
      border-radius: 10px;
      border: 1px solid var(--tp-border-subtle);
      background: var(--tp-control-bg-strong);
      color: var(--tp-strong-text);
      cursor: pointer;
      font-size: 13px;
      transition: all 140ms ease;
    }
    .app-btn:hover {
      border-color: var(--tp-border-strong);
      background: var(--tp-control-hover-bg);
    }
    .app-btn.icon-only {
      width: var(--control-height);
      min-width: var(--control-height);
      padding: 0;
    }
    .app-btn.unavailable {
      opacity: 0.42;
      filter: grayscale(1);
      cursor: not-allowed;
    }
    .app-btn.unavailable:hover {
      border-color: var(--tp-border-subtle);
      background: var(--tp-control-bg-strong);
    }
    .app-btn:active {
      transform: scale(0.98);
    }
    .app-btn.unavailable:active {
      transform: none;
    }
    .app-btn ha-icon {
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
      --mdc-icon-size: 18px;
    }
    .app-btn span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .app-notice {
      flex: 0 1 auto;
      max-width: 100%;
      min-height: var(--control-height);
      display: inline-flex;
      align-items: center;
      padding: 0 12px;
      box-sizing: border-box;
      border-radius: 10px;
      border: 1px solid var(--tp-accent-border);
      background: var(--tp-accent-bg);
      color: var(--tp-accent-soft);
      font-size: 13px;
      white-space: normal;
    }
    .controls {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px 14px 14px;
      background: var(--tp-panel-bg);
      border-top: 1px solid var(--tp-divider);
      border-bottom-left-radius: 12px;
      border-bottom-right-radius: 12px;
    }
    ha-card.fullscreen .controls,
    :host(:fullscreen) .controls {
      flex: 0 0 auto;
      max-height: 42vh;
      max-height: 42dvh;
      overflow-y: auto;
      border-radius: 0;
      padding-right: max(14px, env(safe-area-inset-right));
      padding-bottom: max(14px, env(safe-area-inset-bottom));
      padding-left: max(14px, env(safe-area-inset-left));
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
      border: 1px solid var(--tp-border-subtle);
      background: var(--tp-control-bg-strong);
      color: var(--tp-strong-text);
      cursor: pointer;
      transition: all 140ms ease;
    }
    .pill:hover {
      border-color: var(--tp-border-strong);
      background: var(--tp-control-hover-bg);
    }
    .keyboard-input {
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--tp-input-border);
      background: var(--tp-input-bg);
      color: var(--tp-text);
      font-size: 14px;
      outline: none;
    }
    .keyboard-input:focus {
      border-color: var(--tp-border-strong);
      box-shadow: 0 0 0 1px var(--tp-input-focus-ring);
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
    description: 'Control your PC or LG webOS TV from Home Assistant with a touchpad, keyboard, volume controls, and gestures for devices or Home Assistant actions.',
  });
}
