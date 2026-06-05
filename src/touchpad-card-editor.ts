import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, HomeAssistant, LovelaceCardEditor } from 'custom-card-helpers';
import {
  ResolvedTouchpadAudioControlsConfig,
  TouchpadAudioActionEvent,
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
  TouchpadOptionConfig,
  TouchpadServerMessage,
  TouchpadThemeMode,
  WebOSAppConfig,
} from './types';
import { DEFAULT_WEBOS_APPS, defaultWebOSAppIcon } from './webos-apps';

type BooleanOptionField =
  | 'show_lock'
  | 'show_speed_buttons'
  | 'show_status_text'
  | 'show_audio_controls'
  | 'show_keyboard_button'
  | 'show_fullscreen_button'
  | 'show_app_buttons'
  | 'hide_app_launcher_after_launch'
  | 'auto_focus_keyboard'
  | 'invert_scroll';

type NumberOptionField = 'sensitivity' | 'scroll_multiplier' | 'double_tap_ms' | 'tap_suppression_px';
type GestureModeActionField = 'swipe_left' | 'swipe_right' | 'swipe_up' | 'swipe_down' | 'tap' | 'double_tap' | 'hold';
type HAGestureModeActionField = GestureModeActionField;
type TouchpadAudioActionField = `${TouchpadAudioButtonField}_${TouchpadAudioActionEvent}`;
type HAActionEditorField = HAGestureModeActionField | TouchpadAudioActionField;
type GestureActionOption = { value: TouchpadGestureAction; label: string };

const BOOLEAN_DEFAULTS: Record<BooleanOptionField, boolean> = {
  show_lock: true,
  show_speed_buttons: true,
  show_status_text: true,
  show_audio_controls: true,
  show_keyboard_button: true,
  show_fullscreen_button: true,
  show_app_buttons: false,
  hide_app_launcher_after_launch: false,
  auto_focus_keyboard: true,
  invert_scroll: false,
};

const NUMBER_DEFAULTS: Record<NumberOptionField, number> = {
  sensitivity: 1,
  scroll_multiplier: 1,
  double_tap_ms: 250,
  tap_suppression_px: 6,
};

const BOOLEAN_FIELDS: Array<{ field: BooleanOptionField; label: string }> = [
  { field: 'show_lock', label: 'Show LOCK button' },
  { field: 'show_speed_buttons', label: 'Show speed multiplier buttons' },
  { field: 'show_status_text', label: 'Show status text' },
  { field: 'show_audio_controls', label: 'Show audio icons' },
  { field: 'show_keyboard_button', label: 'Show keyboard toggle' },
  { field: 'show_fullscreen_button', label: 'Show fullscreen button' },
  { field: 'auto_focus_keyboard', label: 'Focus keyboard input when opened' },
  { field: 'invert_scroll', label: 'Reverse scroll direction' },
  { field: 'show_app_buttons', label: 'Show webOS app button' },
];

const NUMBER_FIELDS: Array<{ field: NumberOptionField; label: string; step: string }> = [
  { field: 'sensitivity', label: 'Swipe sensitivity', step: '0.1' },
  { field: 'scroll_multiplier', label: 'Scroll multiplier', step: '0.1' },
  { field: 'double_tap_ms', label: 'Double tap window (ms)', step: '1' },
  { field: 'tap_suppression_px', label: 'Max move allowed for tap (px)', step: '1' },
];

const PC_GESTURE_ACTION_OPTIONS: GestureActionOption[] = [
  { value: 'none', label: 'Do nothing' },
  { value: 'enter', label: 'Enter' },
  { value: 'escape', label: 'Escape' },
  { value: 'backspace', label: 'Backspace' },
  { value: 'tab', label: 'Tab' },
  { value: 'space', label: 'Space' },
  { value: 'delete', label: 'Delete' },
  { value: 'arrow_left', label: 'Arrow left' },
  { value: 'arrow_right', label: 'Arrow right' },
  { value: 'arrow_up', label: 'Arrow up' },
  { value: 'arrow_down', label: 'Arrow down' },
  { value: 'home', label: 'Home' },
  { value: 'end', label: 'End' },
  { value: 'page_up', label: 'Page up' },
  { value: 'page_down', label: 'Page down' },
  { value: 'volume_up', label: 'Volume up' },
  { value: 'volume_down', label: 'Volume down' },
  { value: 'volume_mute', label: 'Mute' },
];

const WEBOS_GESTURE_ACTION_OPTIONS: GestureActionOption[] = [
  { value: 'none', label: 'Do nothing' },
  { value: 'enter', label: 'OK' },
  { value: 'back', label: 'Back' },
  { value: 'home', label: 'Home' },
  { value: 'settings', label: 'Settings' },
  { value: 'power', label: 'Power' },
  { value: 'arrow_left', label: 'Left' },
  { value: 'arrow_right', label: 'Right' },
  { value: 'arrow_up', label: 'Up' },
  { value: 'arrow_down', label: 'Down' },
  { value: 'volume_up', label: 'Volume up' },
  { value: 'volume_down', label: 'Volume down' },
  { value: 'volume_mute', label: 'Mute' },
];

const GESTURE_ACTIONS = new Set<TouchpadGestureAction>(
  [...PC_GESTURE_ACTION_OPTIONS, ...WEBOS_GESTURE_ACTION_OPTIONS].map(({ value }) => value)
);

const GESTURE_MODE_FIELDS: Array<{ field: GestureModeActionField; label: string }> = [
  { field: 'swipe_left', label: 'Swipe left' },
  { field: 'swipe_right', label: 'Swipe right' },
  { field: 'swipe_up', label: 'Swipe up' },
  { field: 'swipe_down', label: 'Swipe down' },
  { field: 'tap', label: 'Tap' },
  { field: 'double_tap', label: 'Double tap' },
  { field: 'hold', label: 'Hold' },
];

const AUDIO_BUTTON_FIELDS: Array<{ field: TouchpadAudioButtonField; label: string }> = [
  { field: 'volume_up', label: 'Volume up' },
  { field: 'volume_down', label: 'Volume down' },
  { field: 'volume_mute', label: 'Mute' },
];

const AUDIO_ACTION_EVENTS: Array<{ event: TouchpadAudioActionEvent; label: string }> = [
  { event: 'tap', label: 'Tap' },
  { event: 'hold', label: 'Hold' },
];

const AUDIO_ACTION_FIELDS: Array<{
  field: TouchpadAudioActionField;
  button: TouchpadAudioButtonField;
  event: TouchpadAudioActionEvent;
  label: string;
}> = AUDIO_BUTTON_FIELDS.flatMap(({ field: button, label: buttonLabel }) =>
  AUDIO_ACTION_EVENTS.map(({ event, label }) => ({
    field: `${button}_${event}` as TouchpadAudioActionField,
    button,
    event,
    label: `${buttonLabel} ${label.toLowerCase()}`,
  }))
);

const HA_ACTION_FIELD_LABELS = new Map<HAActionEditorField, string>([
  ...GESTURE_MODE_FIELDS.map(({ field, label }) => [field, label] as [HAActionEditorField, string]),
  ...AUDIO_ACTION_FIELDS.map(({ field, label }) => [field, label] as [HAActionEditorField, string]),
]);

const HA_ACTION_SELECTOR = {
  ui_action: {
    actions: ['perform-action', 'none'],
  },
};

interface TVAppPickerState {
  apps: WebOSAppConfig[];
  loading: boolean;
  message?: string;
  sourceKey?: string;
}

interface HAGestureSelectorValueCache {
  key: string;
  value: TouchpadHAGestureAction;
}

function createStorageId(): string {
  return `tp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

@customElement('touchpad-card-editor')
export class TouchpadCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: TouchpadCardConfig;
  @state() private _selectedDeviceIndex = 0;
  @state() private _tvAppPicker: TVAppPickerState = { apps: [], loading: false };
  private _tvAppRequestToken = 0;
  private _openHAGestureActionFields = new Set<HAActionEditorField>();
  private _closedHAGestureActionFields = new Set<HAActionEditorField>();
  private _haGestureSelectorValues = new Map<HAActionEditorField, HAGestureSelectorValueCache>();

  public setConfig(config: TouchpadCardConfig): void {
    const devices = this._devicesFromConfig(config);
    this._config = devices.length === 1 ? this._singleConfigFromDevice(config, devices[0]) : { ...config };

    const currentDevices = this._devicesFromConfig(this._config);
    if (currentDevices.length === 0) {
      this._selectedDeviceIndex = 0;
      return;
    }
    if (this._selectedDeviceIndex >= currentDevices.length) {
      this._selectedDeviceIndex = currentDevices.length - 1;
    }
  }

  protected render() {
    if (!this.hass || !this._config) return html``;

    const config = this._currentConfig();
    const devices = this._devicesFromConfig(config);
    const singleConfig = devices.length === 1 ? this._singleConfigFromDevice(config, devices[0]) : config;

    return html`
      <div class="editor">
        ${this._renderCardConfig(config)}
        ${devices.length > 1 ? this._renderMultiDeviceConfig(devices) : this._renderSingleDeviceConfig(singleConfig)}
      </div>
    `;
  }

  private _renderCardConfig(config: TouchpadCardConfig): TemplateResult {
    return html`
      <section class="config-section">
        <div class="fields">
          ${this._renderThemeModeField(this._themeModeValue(config), (value) => this._updateRootField('theme_mode', value))}
        </div>
      </section>
    `;
  }

  private _renderSingleDeviceConfig(config: TouchpadCardConfig): TemplateResult {
    const controlsProfile = this._controlsProfileValue(config);
    return html`
      <section class="config-section">
        <div class="section-header">
          <div>
            <h3>Single device</h3>
          </div>
          <button class="secondary" type="button" @click=${this._addDevice}>Add device</button>
        </div>

        <div class="fields">
          ${this._renderControlsProfileField(controlsProfile, (value) => this._updateRootField('controls_profile', value))}
          ${controlsProfile === 'home_assistant'
            ? null
            : this._renderTextField('WebSocket URL', config.wsUrl ?? '', 'ws://YOUR-PC-LAN-IP:8765', (value) =>
                this._updateRootField('wsUrl', value)
              )}
        </div>

        ${this._renderOptions(config, controlsProfile, config.wsUrl ?? '', (field, value) =>
          this._updateRootField(field, value)
        )}
      </section>
    `;
  }

  private _renderMultiDeviceConfig(devices: TouchpadDeviceConfig[]): TemplateResult {
    const selectedIndex = Math.min(this._selectedDeviceIndex, devices.length - 1);
    const selectedDevice = devices[selectedIndex];
    const validationMessages = this._validationMessages(devices);

    return html`
      <section class="config-section">
        <div class="section-header">
          <div>
            <h3>Devices</h3>
          </div>
          <button class="secondary" type="button" @click=${this._addDevice}>Add device</button>
        </div>

        <div class="tabs" role="tablist">
          ${devices.map(
            (device, index) => html`
              <button
                class="tab ${index === selectedIndex ? 'active' : ''}"
                type="button"
                role="tab"
                aria-selected=${index === selectedIndex ? 'true' : 'false'}
                @click=${() => (this._selectedDeviceIndex = index)}
              >
                ${this._deviceLabel(device, index)}
              </button>
            `
          )}
        </div>

        ${validationMessages.length > 0
          ? html`<div class="validation">${validationMessages.map((message) => html`<div>${message}</div>`)}</div>`
          : null}

        ${selectedDevice ? this._renderDeviceConfig(selectedDevice, selectedIndex, devices.length) : null}
      </section>
    `;
  }

  private _renderDeviceConfig(device: TouchpadDeviceConfig, index: number, deviceCount: number): TemplateResult {
    const controlsProfile = this._controlsProfileValue(device);
    return html`
      <div class="device-config">
        <div class="device-header">
          <h4>${this._deviceLabel(device, index)}</h4>
          <button class="danger" type="button" ?disabled=${deviceCount <= 1} @click=${() => this._removeDevice(index)}>Remove</button>
        </div>

        <div class="fields">
          ${this._renderTextField('Display name', device.name ?? '', 'Salon', (value) =>
            this._updateDeviceName(index, value)
          )}
          ${this._renderControlsProfileField(controlsProfile, (value) =>
            this._updateDeviceField(index, 'controls_profile', value)
          )}
          ${controlsProfile === 'home_assistant'
            ? null
            : this._renderTextField('WebSocket URL', device.wsUrl ?? '', 'ws://homeassistant.local:8778', (value) =>
                this._updateDeviceField(index, 'wsUrl', value)
              )}
        </div>

        ${this._renderOptions(device, controlsProfile, device.wsUrl ?? '', (field, value) =>
          this._updateDeviceField(index, field, value)
        )}
      </div>
    `;
  }

  private _renderOptions(
    source: TouchpadOptionConfig,
    controlsProfile: TouchpadControlsProfile,
    wsUrl: string,
    update: (field: keyof TouchpadOptionConfig, value: unknown) => void
  ): TemplateResult {
    const isHAOnly = controlsProfile === 'home_assistant';
    const booleanFields = BOOLEAN_FIELDS.filter(
      ({ field }) =>
        field !== 'show_app_buttons' &&
        field !== 'show_audio_controls' &&
        !(
          isHAOnly &&
          (field === 'show_speed_buttons' ||
            field === 'show_status_text' ||
            field === 'show_keyboard_button' ||
            field === 'auto_focus_keyboard')
        )
    );
    const numberFields = NUMBER_FIELDS.filter(
      ({ field }) => !isHAOnly || (field !== 'sensitivity' && field !== 'scroll_multiplier')
    );
    const showWebOSAppSection = controlsProfile === 'webos';

    return html`
      <details class="option-group collapsible">
        <summary>Controls</summary>
        <div class="collapsible-content">
          <div class="toggles">
            ${booleanFields.map(
              ({ field, label }) => html`
                <label class="toggle">
                  <input
                    type="checkbox"
                    .checked=${this._booleanValue(source, field)}
                    @change=${(ev: Event) => update(field, (ev.target as HTMLInputElement).checked)}
                  />
                  <span>${label}</span>
                </label>
              `
            )}
          </div>
        </div>
      </details>

      ${this._renderAudioControls(source, controlsProfile, update)}
      ${showWebOSAppSection ? this._renderWebOSApps(source, wsUrl, update) : null}
      ${isHAOnly ? null : this._renderGestureMode(source, controlsProfile, (gestureMode) => update('gesture_mode', gestureMode))}
      ${this._renderHAGestureMode(source, controlsProfile, (gestureMode) => update('ha_gesture_mode', gestureMode))}

      <details class="option-group collapsible">
        <summary>Touchpad tuning</summary>
        <div class="collapsible-content">
          <div class="fields">
            ${numberFields.map(({ field, label, step }) =>
              this._renderNumberField(label, this._numberValue(source, field), NUMBER_DEFAULTS[field], step, (value) => update(field, value))
            )}
          </div>
        </div>
      </details>
    `;
  }

  protected updated(): void {
    this._syncGestureActionSelects();
  }

  private _computeHAGestureActionLabel = (schema: { name?: string }): string => {
    return HA_ACTION_FIELD_LABELS.get(schema.name as HAActionEditorField) ?? '';
  };

  private _renderAudioControls(
    source: TouchpadOptionConfig,
    controlsProfile: TouchpadControlsProfile,
    update: (field: keyof TouchpadOptionConfig, value: unknown) => void
  ): TemplateResult {
    const isHAOnly = controlsProfile === 'home_assistant';
    const audioControls = this._audioControlsValue(source);
    const audioMode = isHAOnly ? 'home_assistant' : audioControls.mode;
    const updateAudioControls = (patch: Partial<TouchpadAudioControlsConfig>) =>
      update('audio_controls', { ...audioControls, mode: audioMode, ...patch });

    return html`
      <details class="option-group collapsible">
        <summary>Audio controls</summary>
        <div class="collapsible-content">
          <div class="toggles">
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${this._booleanValue(source, 'show_audio_controls')}
                @change=${(ev: Event) => update('show_audio_controls', (ev.target as HTMLInputElement).checked)}
              />
              <span>Show audio icons</span>
            </label>
          </div>
          ${isHAOnly
            ? null
            : html`<div class="fields">
                <label class="field">
                  <span>Audio button actions</span>
                  <select
                    .value=${audioMode}
                    @change=${(ev: Event) =>
                      updateAudioControls({ mode: this._asAudioControlsMode((ev.target as HTMLSelectElement).value) })}
                  >
                    <option value="device">Device volume controls</option>
                    <option value="home_assistant">Home Assistant actions</option>
                  </select>
                </label>
              </div>`}
          ${audioMode === 'home_assistant'
            ? html`<div class="ha-gesture-actions audio-actions">
                ${AUDIO_ACTION_FIELDS.map(({ field, button, event, label }) =>
                  this._renderHAActionField(field, label, audioControls[button][event], (value) =>
                    updateAudioControls({ [button]: { ...audioControls[button], [event]: value } })
                  )
                )}
              </div>`
            : null}
        </div>
      </details>
    `;
  }

  private _renderGestureMode(
    source: TouchpadOptionConfig,
    controlsProfile: TouchpadControlsProfile,
    update: (gestureMode: TouchpadGestureModeConfig) => void
  ): TemplateResult {
    const gestureMode = this._gestureModeValue(source, controlsProfile);
    const updateGestureMode = (patch: Partial<TouchpadGestureModeConfig>) => update({ ...gestureMode, ...patch });

    return html`
      <details class="option-group collapsible">
        <summary>Gesture controls</summary>
        <div class="collapsible-content">
          <div class="toggles">
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${gestureMode.show_button}
                @change=${(ev: Event) => updateGestureMode({ show_button: (ev.target as HTMLInputElement).checked })}
              />
              <span>Show gesture mode button</span>
            </label>
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${gestureMode.invert_swipes}
                @change=${(ev: Event) => updateGestureMode({ invert_swipes: (ev.target as HTMLInputElement).checked })}
              />
              <span>Reverse swipe directions</span>
            </label>
          </div>
          <div class="fields">
            ${GESTURE_MODE_FIELDS.map(({ field, label }) =>
              this._renderGestureActionField(field, label, gestureMode[field], controlsProfile, (value) => updateGestureMode({ [field]: value }))
            )}
          </div>
        </div>
      </details>
    `;
  }

  private _renderHAGestureMode(
    source: TouchpadOptionConfig,
    controlsProfile: TouchpadControlsProfile,
    update: (gestureMode: TouchpadHAGestureModeConfig) => void
  ): TemplateResult {
    const isHAOnly = controlsProfile === 'home_assistant';
    const gestureMode = this._haGestureModeValue(source);
    const updateGestureMode = (patch: Partial<TouchpadHAGestureModeConfig>) => update({ ...gestureMode, ...patch });

    return html`
      <details class="option-group collapsible">
        <summary>Home Assistant gesture controls</summary>
        <div class="collapsible-content">
          <div class="toggles">
            ${isHAOnly
              ? null
              : html`<label class="toggle">
                  <input
                    type="checkbox"
                    .checked=${gestureMode.show_button}
                    @change=${(ev: Event) => updateGestureMode({ show_button: (ev.target as HTMLInputElement).checked })}
                  />
                  <span>Show Home Assistant gesture mode button</span>
                </label>`}
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${gestureMode.invert_swipes}
                @change=${(ev: Event) => updateGestureMode({ invert_swipes: (ev.target as HTMLInputElement).checked })}
              />
              <span>Reverse swipe directions</span>
            </label>
          </div>
          <div class="ha-gesture-actions">
            ${GESTURE_MODE_FIELDS.map(({ field, label }) =>
              this._renderHAGestureActionField(field, label, gestureMode[field], (value) => updateGestureMode({ [field]: value }))
            )}
          </div>
        </div>
      </details>
    `;
  }

  private _renderHAGestureActionField(
    field: HAGestureModeActionField,
    label: string,
    value: TouchpadHAGestureAction,
    update: (value: TouchpadHAGestureAction) => void
  ): TemplateResult {
    return this._renderHAActionField(field, label, value, update, field === 'double_tap' ? this._renderDoubleTapDelayHint() : null);
  }

  private _renderHAActionField(
    field: HAActionEditorField,
    label: string,
    value: TouchpadHAGestureAction,
    update: (value: TouchpadHAGestureAction) => void,
    hint: TemplateResult | null = null
  ): TemplateResult {
    const actionCount = this._hasHAGestureAction(value) ? 1 : 0;
    const open = this._openHAGestureActionFields.has(field) || (actionCount > 0 && !this._closedHAGestureActionFields.has(field));
    return html`
      <details class="ha-gesture-action" .open=${open} @toggle=${(ev: Event) => this._rememberHAGestureActionOpen(field, ev)}>
        <summary>
          <span>${label}</span>
          <span class="ha-action-count">${actionCount === 1 ? '1 action' : `${actionCount} actions`}</span>
        </summary>
        <div class="ha-action-editor">
          ${hint}
          ${this._renderHAActionSelector(field, value, update)}
          <div class="button-row">
            <button class="secondary" type="button" ?disabled=${actionCount === 0} @click=${() => update({ action: 'none' })}>Clear</button>
          </div>
        </div>
      </details>
    `;
  }

  private _renderHAActionSelector(
    field: HAActionEditorField,
    value: TouchpadHAGestureAction,
    update: (value: TouchpadHAGestureAction) => void
  ): TemplateResult {
    const selectorValue = this._haGestureSelectorValue(field, value);
    return html`
      <ha-form
        class="ha-action-selector"
        data-ha-gesture-field=${field}
        .hass=${this.hass}
        .data=${{ [field]: selectorValue }}
        .schema=${[{ name: field, required: true, selector: HA_ACTION_SELECTOR }]}
        .computeLabel=${this._computeHAGestureActionLabel}
        @value-changed=${(ev: CustomEvent<{ value?: Record<string, unknown> }>) => {
          const next = this._normalizeHAGestureAction(ev.detail?.value?.[field]);
          if (!this._sameHAGestureActions(value, next)) {
            update(next);
          }
        }}
      ></ha-form>
    `;
  }

  private _renderDoubleTapDelayHint(): TemplateResult {
    return html`<div class="gesture-hint">Using Double tap delays Tap by the double tap window.</div>`;
  }

  private _renderWebOSApps(
    source: TouchpadOptionConfig,
    wsUrl: string,
    update: (field: keyof TouchpadOptionConfig, value: unknown) => void
  ): TemplateResult {
    const apps = this._webOSAppsValue(source);
    const showApps = this._booleanValue(source, 'show_app_buttons');
    const hideAfterLaunch = this._booleanValue(source, 'hide_app_launcher_after_launch');
    const sourceKey = this._tvAppSourceKey(wsUrl);
    const picker = this._tvAppPicker.sourceKey === sourceKey ? this._tvAppPicker : { apps: [], loading: false };
    const existingIds = new Set(apps.map((app) => app.app_id));
    const tvApps = picker.apps.filter((app) => !existingIds.has(app.app_id));
    const pickerMessage = picker.message ?? (picker.apps.length > 0 && tvApps.length === 0 ? 'All TV apps are already in the list.' : undefined);
    return html`
      <details class="option-group collapsible">
        <summary>webOS app buttons</summary>
        <div class="collapsible-content">
          <div class="toggles">
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${showApps}
                @change=${(ev: Event) => update('show_app_buttons', (ev.target as HTMLInputElement).checked)}
              />
              <span>Show webOS app button</span>
            </label>
            <label class="toggle">
              <input
                type="checkbox"
                .checked=${hideAfterLaunch}
                @change=${(ev: Event) => update('hide_app_launcher_after_launch', (ev.target as HTMLInputElement).checked)}
              />
              <span>Hide app bar after app selection</span>
            </label>
          </div>
          <div class="app-toolbar">
            <h4>Apps</h4>
            <div class="button-row">
              <button
                class="secondary"
                type="button"
                @click=${() => update('webos_apps', [...apps, { name: 'App', app_id: '', icon: 'mdi:apps' }])}
              >
                Add app
              </button>
              <button
                class="secondary"
                type="button"
                ?disabled=${!String(wsUrl).trim() || picker.loading}
                @click=${() => this._loadAppsFromTV(wsUrl)}
              >
                ${picker.loading ? 'Loading...' : 'Add from TV'}
              </button>
            </div>
          </div>
          ${pickerMessage ? html`<div class="app-picker-message">${pickerMessage}</div>` : null}
          ${tvApps.length > 0
            ? html`<div class="tv-app-picker">
                ${tvApps.map(
                  (app) => html`<button class="tv-app-option" type="button" @click=${() => update('webos_apps', [...apps, app])}>
                    ${app.icon ? html`<ha-icon icon=${app.icon}></ha-icon>` : null}
                    <span>${app.name}</span>
                  </button>`
                )}
              </div>`
            : null}
          <div class="app-list">
            ${apps.map(
              (app, index) => html`
                <div class="app-row">
                  <div class="app-main-fields">
                    ${this._renderTextField('Name', app.name ?? '', 'Netflix', (value) =>
                      this._updateWebOSApp(apps, index, 'name', value, (nextApps) => update('webos_apps', nextApps))
                    )}
                    ${this._renderTextField('App ID', app.app_id ?? '', 'netflix', (value) =>
                      this._updateWebOSApp(apps, index, 'app_id', value, (nextApps) => update('webos_apps', nextApps))
                    )}
                  </div>
                  <div class="app-action-fields">
                    ${this._renderIconField('Icon', app.icon ?? '', 'compact', (value) =>
                      this._updateWebOSApp(apps, index, 'icon', value || undefined, (nextApps) => update('webos_apps', nextApps))
                    )}
                    <button
                      class="danger remove-app"
                      type="button"
                      @click=${() => update('webos_apps', apps.filter((_, appIndex) => appIndex !== index))}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              `
            )}
          </div>
        </div>
      </details>
    `;
  }

  private _renderTextField(label: string, value: string, placeholder: string, update: (value: string) => void): TemplateResult {
    return html`
      <label class="field">
        <span>${label}</span>
        <input type="text" .value=${value} placeholder=${placeholder} @input=${(ev: Event) => update((ev.target as HTMLInputElement).value)} />
      </label>
    `;
  }

  private _renderIconField(label: string, value: string, variant: 'default' | 'compact', update: (value: string) => void): TemplateResult {
    if (customElements.get('ha-icon-picker')) {
      return html`
        <label class="field icon-picker-field ${variant}">
          <span>${label}</span>
          <ha-icon-picker
            .hass=${this.hass}
            .label=${label}
            .value=${value}
            @value-changed=${(ev: CustomEvent<{ value?: string }>) => update(ev.detail?.value || '')}
          ></ha-icon-picker>
        </label>
      `;
    }

    return this._renderTextField(label, value, 'mdi:apps', update);
  }

  private _tvAppSourceKey(wsUrl: string): string {
    return String(wsUrl ?? '').trim();
  }

  private _loadAppsFromTV(wsUrl: string): void {
    const url = String(wsUrl ?? '').trim();
    const sourceKey = this._tvAppSourceKey(url);
    if (!url) {
      this._tvAppPicker = { apps: [], loading: false, sourceKey, message: 'Set a WebSocket URL first.' };
      return;
    }

    const token = ++this._tvAppRequestToken;
    this._tvAppPicker = { apps: [], loading: true, sourceKey };

    let socket: WebSocket | undefined;
    let settled = false;
    let timeoutId: number | undefined;

    const finish = (next: TVAppPickerState) => {
      if (settled || token !== this._tvAppRequestToken) return;
      settled = true;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close();
      }
      this._tvAppPicker = next;
    };

    try {
      socket = new WebSocket(url);
    } catch (err) {
      this._tvAppPicker = { apps: [], loading: false, sourceKey, message: 'Could not open the WebSocket URL.' };
      return;
    }

    timeoutId = window.setTimeout(() => {
      finish({ apps: [], loading: false, sourceKey, message: 'TV did not return an app list. Add apps manually.' });
    }, 8000);

    socket.addEventListener('open', () => {
      try {
        socket?.send(JSON.stringify({ t: 'list_apps' }));
      } catch (err) {
        finish({ apps: [], loading: false, sourceKey, message: 'Could not ask the bridge for apps.' });
      }
    });

    socket.addEventListener('message', (event) => {
      let data: TouchpadServerMessage;
      try {
        data = JSON.parse(String(event.data)) as TouchpadServerMessage;
      } catch {
        return;
      }

      if (data.t !== 'webos_app_list') {
        return;
      }

      const apps = this._normalizeTVApps(data.apps);
      const message = apps.length > 0 ? undefined : data.message ?? 'TV did not provide an app list. Add apps manually.';
      finish({ apps, loading: false, sourceKey, message });
    });

    socket.addEventListener('error', () => {
      finish({ apps: [], loading: false, sourceKey, message: 'Could not read apps from TV. Add apps manually.' });
    });
  }

  private _normalizeTVApps(apps: WebOSAppConfig[] | undefined): WebOSAppConfig[] {
    if (!Array.isArray(apps)) {
      return [];
    }

    const seen = new Set<string>();
    return apps
      .map((app) => {
        const name = String(app?.name ?? '').trim();
        const appId = String(app?.app_id ?? '').trim();
        const icon = String(app?.icon ?? '').trim() || defaultWebOSAppIcon(name, appId);
        return { name: name || appId, app_id: appId, icon };
      })
      .filter((app) => {
        if (!app.name || !app.app_id || seen.has(app.app_id)) {
          return false;
        }
        seen.add(app.app_id);
        return true;
      });
  }

  private _renderNumberField(
    label: string,
    value: number | undefined,
    placeholder: number,
    step: string,
    update: (value: number | undefined) => void
  ): TemplateResult {
    return html`
      <label class="field">
        <span>${label}</span>
        <input
          type="number"
          .value=${value === undefined ? '' : String(value)}
          placeholder=${String(placeholder)}
          step=${step}
          min="0"
          @change=${(ev: Event) => update(this._parseNumber((ev.target as HTMLInputElement).value))}
        />
      </label>
    `;
  }

  private _renderGestureActionField(
    field: GestureModeActionField,
    label: string,
    value: TouchpadGestureAction,
    controlsProfile: TouchpadControlsProfile,
    update: (value: TouchpadGestureAction) => void
  ): TemplateResult {
    const options = this._gestureActionOptions(controlsProfile, value);
    return html`
      <label class="field">
        <span>${label}</span>
        <select
          class="gesture-action-select"
          data-gesture-field=${field}
          data-gesture-value=${value}
          @change=${(ev: Event) => update(this._asGestureAction((ev.target as HTMLSelectElement).value))}
        >
          ${options.map(
            ({ value: optionValue, label: optionLabel }) =>
              html`<option value=${optionValue} ?selected=${optionValue === value}>${optionLabel}</option>`
          )}
        </select>
        ${field === 'double_tap' ? this._renderDoubleTapDelayHint() : null}
      </label>
    `;
  }

  private _gestureActionOptions(controlsProfile: TouchpadControlsProfile, selectedValue: TouchpadGestureAction): GestureActionOption[] {
    const options = controlsProfile === 'webos' ? WEBOS_GESTURE_ACTION_OPTIONS : PC_GESTURE_ACTION_OPTIONS;
    if (options.some(({ value }) => value === selectedValue)) {
      return options;
    }
    const selectedOption = [...PC_GESTURE_ACTION_OPTIONS, ...WEBOS_GESTURE_ACTION_OPTIONS].find(({ value }) => value === selectedValue);
    return selectedOption ? [...options, selectedOption] : options;
  }

  private _syncGestureActionSelects(): void {
    const selects = this.renderRoot.querySelectorAll<HTMLSelectElement>('select.gesture-action-select');
    selects.forEach((select) => {
      const value = select.dataset.gestureValue;
      if (value && select.value !== value) {
        select.value = value;
      }
    });
  }

  private _renderControlsProfileField(value: TouchpadControlsProfile, update: (value: TouchpadControlsProfile) => void): TemplateResult {
    return html`
      <label class="field">
        <span>Controls profile</span>
        <select .value=${value} @change=${(ev: Event) => update(this._asControlsProfile((ev.target as HTMLSelectElement).value))}>
          <option value="pc">MS Windows</option>
          <option value="webos">LG webOS</option>
          <option value="home_assistant">Home Assistant only</option>
        </select>
      </label>
    `;
  }

  private _renderThemeModeField(value: TouchpadThemeMode, update: (value: TouchpadThemeMode) => void): TemplateResult {
    return html`
      <label class="field">
        <span>Theme</span>
        <select .value=${value} @change=${(ev: Event) => update(this._asThemeMode((ev.target as HTMLSelectElement).value))}>
          <option value="auto">Automatic</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
    `;
  }

  private _currentConfig(): TouchpadCardConfig {
    return {
      type: 'custom:touchpad-card',
      ...this._config,
    };
  }

  private _devicesFromConfig(config?: TouchpadCardConfig): TouchpadDeviceConfig[] {
    return Array.isArray(config?.devices) ? config.devices.map((device) => ({ ...device })) : [];
  }

  private _deviceLabel(device: TouchpadDeviceConfig, index: number): string {
    const label = String(device.name || device.id || '').trim();
    return label || `Device ${index + 1}`;
  }

  private _booleanValue(source: TouchpadOptionConfig, field: BooleanOptionField): boolean {
    return source[field] ?? this._config?.[field] ?? BOOLEAN_DEFAULTS[field];
  }

  private _webOSAppsValue(source: TouchpadOptionConfig): WebOSAppConfig[] {
    const apps = source.webos_apps ?? this._config?.webos_apps ?? DEFAULT_WEBOS_APPS;
    if (!Array.isArray(apps)) {
      return [];
    }
    return apps.map((app) => ({
      name: String(app?.name ?? ''),
      app_id: String(app?.app_id ?? ''),
      icon: app?.icon ? String(app.icon) : undefined,
    }));
  }

  private _defaultGestureMode(profile: TouchpadControlsProfile): Required<TouchpadGestureModeConfig> {
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

  private _gestureModeValue(source: TouchpadOptionConfig, controlsProfile: TouchpadControlsProfile): Required<TouchpadGestureModeConfig> {
    const defaults = this._defaultGestureMode(controlsProfile);
    const root = this._rootGestureModeForProfile(source, controlsProfile);
    const local = source.gesture_mode ?? {};

    return {
      show_button: local.show_button ?? root.show_button ?? defaults.show_button,
      invert_swipes: local.invert_swipes ?? root.invert_swipes ?? defaults.invert_swipes,
      swipe_left: this._asGestureAction(local.swipe_left ?? root.swipe_left, defaults.swipe_left),
      swipe_right: this._asGestureAction(local.swipe_right ?? root.swipe_right, defaults.swipe_right),
      swipe_up: this._asGestureAction(local.swipe_up ?? root.swipe_up, defaults.swipe_up),
      swipe_down: this._asGestureAction(local.swipe_down ?? root.swipe_down, defaults.swipe_down),
      tap: this._asGestureAction(local.tap ?? root.tap, defaults.tap),
      double_tap: this._asGestureAction(local.double_tap ?? root.double_tap, defaults.double_tap),
      hold: this._asGestureAction(local.hold ?? root.hold, defaults.hold),
    };
  }

  private _defaultHAGestureMode(): Required<TouchpadHAGestureModeConfig> {
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

  private _haGestureModeValue(source: TouchpadOptionConfig): Required<TouchpadHAGestureModeConfig> {
    const defaults = this._defaultHAGestureMode();
    const root = this._rootHAGestureMode(source);
    const local = source.ha_gesture_mode ?? {};

    return {
      show_button: local.show_button ?? root.show_button ?? defaults.show_button,
      invert_swipes: local.invert_swipes ?? root.invert_swipes ?? defaults.invert_swipes,
      swipe_left: this._asHAGestureAction(local.swipe_left ?? root.swipe_left),
      swipe_right: this._asHAGestureAction(local.swipe_right ?? root.swipe_right),
      swipe_up: this._asHAGestureAction(local.swipe_up ?? root.swipe_up),
      swipe_down: this._asHAGestureAction(local.swipe_down ?? root.swipe_down),
      tap: this._asHAGestureAction(local.tap ?? root.tap),
      double_tap: this._asHAGestureAction(local.double_tap ?? root.double_tap),
      hold: this._asHAGestureAction(local.hold ?? root.hold),
    };
  }

  private _defaultAudioControls(): ResolvedTouchpadAudioControlsConfig {
    return {
      mode: 'device',
      volume_up: { tap: { action: 'none' }, hold: { action: 'none' } },
      volume_down: { tap: { action: 'none' }, hold: { action: 'none' } },
      volume_mute: { tap: { action: 'none' }, hold: { action: 'none' } },
    };
  }

  private _audioControlsValue(source: TouchpadOptionConfig): ResolvedTouchpadAudioControlsConfig {
    const defaults = this._defaultAudioControls();
    const root = this._rootAudioControls(source);
    const local = source.audio_controls ?? {};

    return {
      mode: this._asAudioControlsMode(local.mode ?? root.mode ?? defaults.mode),
      volume_up: this._audioButtonActionsValue(local.volume_up, root.volume_up, defaults.volume_up),
      volume_down: this._audioButtonActionsValue(local.volume_down, root.volume_down, defaults.volume_down),
      volume_mute: this._audioButtonActionsValue(local.volume_mute, root.volume_mute, defaults.volume_mute),
    };
  }

  private _audioButtonActionsValue(
    local: TouchpadAudioControlsConfig[TouchpadAudioButtonField] | undefined,
    root: TouchpadAudioControlsConfig[TouchpadAudioButtonField] | undefined,
    defaults: ResolvedTouchpadAudioControlsConfig[TouchpadAudioButtonField]
  ): ResolvedTouchpadAudioControlsConfig[TouchpadAudioButtonField] {
    return {
      tap: this._asHAGestureAction(local?.tap ?? root?.tap ?? defaults.tap),
      hold: this._asHAGestureAction(local?.hold ?? root?.hold ?? defaults.hold),
    };
  }

  private _rootGestureModeForProfile(
    source: TouchpadOptionConfig,
    controlsProfile: TouchpadControlsProfile
  ): TouchpadGestureModeConfig {
    if (source === this._config) {
      return {};
    }
    const rootProfile = this._asControlsProfile(this._config?.controls_profile ?? this._config?.backend ?? 'pc');
    return rootProfile === controlsProfile ? this._config?.gesture_mode ?? {} : {};
  }

  private _rootHAGestureMode(source: TouchpadOptionConfig): TouchpadHAGestureModeConfig {
    return source === this._config ? {} : this._config?.ha_gesture_mode ?? {};
  }

  private _rootAudioControls(source: TouchpadOptionConfig): TouchpadAudioControlsConfig {
    return source === this._config ? {} : this._config?.audio_controls ?? {};
  }

  private _updateWebOSApp(
    apps: WebOSAppConfig[],
    index: number,
    field: keyof WebOSAppConfig,
    value: string | undefined,
    update: (apps: WebOSAppConfig[]) => void
  ): void {
    const cleanValue = typeof value === 'string' && (field === 'app_id' || field === 'icon') ? value.trim() : value;
    const next = apps.map((app, appIndex) => {
      if (appIndex !== index) return app;
      const nextApp = { ...app };
      if (cleanValue === undefined) {
        delete nextApp[field];
      } else {
        nextApp[field] = cleanValue;
      }
      return nextApp;
    });
    update(next);
  }

  private _numberValue(source: TouchpadOptionConfig, field: NumberOptionField): number | undefined {
    return source[field] ?? this._config?.[field];
  }

  private _controlsProfileValue(source: Pick<TouchpadCardConfig, 'controls_profile' | 'backend'>): TouchpadControlsProfile {
    return this._asControlsProfile(source.controls_profile ?? source.backend ?? this._config?.controls_profile ?? this._config?.backend ?? 'pc');
  }

  private _themeModeValue(source: Pick<TouchpadCardConfig, 'theme_mode'>): TouchpadThemeMode {
    return this._asThemeMode(source.theme_mode ?? this._config?.theme_mode ?? 'auto');
  }

  private _parseNumber(value: string): number | undefined {
    if (value.trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private _asControlsProfile(value: string): TouchpadControlsProfile {
    if (value === 'webos' || value === 'home_assistant') {
      return value;
    }
    return 'pc';
  }

  private _asThemeMode(value: string): TouchpadThemeMode {
    return value === 'dark' || value === 'light' ? value : 'auto';
  }

  private _asAudioControlsMode(value: unknown): TouchpadAudioControlsMode {
    return value === 'home_assistant' ? 'home_assistant' : 'device';
  }

  private _asGestureAction(value: unknown, fallback: TouchpadGestureAction = 'none'): TouchpadGestureAction {
    const normalized = String(value ?? '').trim() as TouchpadGestureAction;
    return GESTURE_ACTIONS.has(normalized) ? normalized : fallback;
  }

  private _asHAGestureAction(value: unknown): TouchpadHAGestureAction {
    return this._normalizeHAGestureAction(value);
  }

  private _normalizeHAGestureAction(value: unknown): TouchpadHAGestureAction {
    if (value && typeof value === 'object') {
      return this._deepMutableClone(value) as TouchpadHAGestureAction;
    }
    return { action: 'none' };
  }

  private _sameHAGestureActions(left: TouchpadHAGestureAction, right: TouchpadHAGestureAction): boolean {
    return this._stableStringify(left) === this._stableStringify(right);
  }

  private _haGestureSelectorValue(field: HAActionEditorField, value: TouchpadHAGestureAction): TouchpadHAGestureAction {
    const key = this._stableStringify(value);
    const cached = this._haGestureSelectorValues.get(field);
    if (cached?.key === key) {
      return cached.value;
    }

    const nextValue = this._deepMutableClone(value) as TouchpadHAGestureAction;
    this._haGestureSelectorValues.set(field, { key, value: nextValue });
    return nextValue;
  }

  private _hasHAGestureAction(value: TouchpadHAGestureAction | undefined): boolean {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const action = String(value.action ?? '').trim();
    return Boolean(action) && action !== 'none';
  }

  private _deepMutableClone(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this._deepMutableClone(item));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, this._deepMutableClone(item)]));
    }
    return value;
  }

  private _stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this._stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this._stableStringify(record[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  private _rememberHAGestureActionOpen(field: HAActionEditorField, ev: Event): void {
    const details = ev.currentTarget as HTMLDetailsElement;
    if (details.open) {
      this._openHAGestureActionFields.add(field);
      this._closedHAGestureActionFields.delete(field);
    } else {
      this._openHAGestureActionFields.delete(field);
      this._closedHAGestureActionFields.add(field);
    }
  }

  private _cleanGestureModeAfterProfileChange(
    target: TouchpadOptionConfig,
    previousProfile: TouchpadControlsProfile,
    nextProfile: TouchpadControlsProfile
  ): void {
    if (nextProfile === 'home_assistant') {
      delete target.gesture_mode;
      return;
    }
    if (previousProfile === nextProfile) {
      return;
    }
    if (!target.gesture_mode || this._isDefaultGestureMode(target.gesture_mode, previousProfile)) {
      delete target.gesture_mode;
    }
  }

  private _isDefaultGestureMode(gestureMode: TouchpadGestureModeConfig, controlsProfile: TouchpadControlsProfile): boolean {
    const defaults = this._defaultGestureMode(controlsProfile);
    return (
      (gestureMode.show_button ?? defaults.show_button) === defaults.show_button &&
      (gestureMode.invert_swipes ?? defaults.invert_swipes) === defaults.invert_swipes &&
      this._asGestureAction(gestureMode.swipe_left, defaults.swipe_left) === defaults.swipe_left &&
      this._asGestureAction(gestureMode.swipe_right, defaults.swipe_right) === defaults.swipe_right &&
      this._asGestureAction(gestureMode.swipe_up, defaults.swipe_up) === defaults.swipe_up &&
      this._asGestureAction(gestureMode.swipe_down, defaults.swipe_down) === defaults.swipe_down &&
      this._asGestureAction(gestureMode.tap, defaults.tap) === defaults.tap &&
      this._asGestureAction(gestureMode.double_tap, defaults.double_tap) === defaults.double_tap &&
      this._asGestureAction(gestureMode.hold, defaults.hold) === defaults.hold
    );
  }

  private _updateRootField(field: keyof TouchpadCardConfig, value: unknown): void {
    const next = this._currentConfig();
    const previousProfile = this._controlsProfileValue(next);
    this._assign(next, field, value);
    if (field === 'controls_profile') {
      this._cleanGestureModeAfterProfileChange(next, previousProfile, this._controlsProfileValue(next));
    }
    this._commitConfig(next);
  }

  private _updateDeviceField(index: number, field: keyof TouchpadDeviceConfig, value: unknown): void {
    const config = this._currentConfig();
    const devices = this._devicesFromConfig(config);
    const current = devices[index];
    if (!current) return;

    const nextDevice = { ...current };
    const previousProfile = this._controlsProfileValue(nextDevice);
    this._assign(nextDevice, field, value);
    if (field === 'controls_profile') {
      this._cleanGestureModeAfterProfileChange(nextDevice, previousProfile, this._controlsProfileValue(nextDevice));
    }
    devices[index] = nextDevice;

    const next: TouchpadCardConfig = { ...config, devices };
    this._commitConfig(next);
  }

  private _updateDeviceName(index: number, value: string): void {
    const config = this._currentConfig();
    const devices = this._devicesFromConfig(config);
    const current = devices[index];
    if (!current) return;

    const displayName = value.trim() ? value : undefined;
    const otherDevices = devices.filter((_, deviceIndex) => deviceIndex !== index);
    const nextId = current.id || this._uniqueDeviceId(displayName || `Device ${index + 1}`, otherDevices);
    const nextDevice = {
      ...current,
      id: nextId,
      name: displayName,
    };

    devices[index] = nextDevice;
    const next: TouchpadCardConfig = { ...config, devices };
    this._commitConfig(next);
  }

  private _addDevice = (): void => {
    const config = this._currentConfig();
    const existingDevices = this._devicesFromConfig(config);
    const devices = existingDevices.length > 0 ? existingDevices : [this._singleConfigToDevice(config)];
    devices.push(this._newDevice(devices));

    const next: TouchpadCardConfig = {
      ...config,
      devices,
    };

    if (existingDevices.length === 0) {
      delete next.wsUrl;
      delete next.backend;
      delete next.controls_profile;
      delete next.gesture_mode;
      delete next.ha_gesture_mode;
      delete next.audio_controls;
    }

    this._selectedDeviceIndex = devices.length - 1;
    this._commitConfig(next);
  };

  private _removeDevice(index: number): void {
    const config = this._currentConfig();
    const devices = this._devicesFromConfig(config);
    if (devices.length <= 1) return;

    devices.splice(index, 1);
    if (devices.length === 1) {
      this._selectedDeviceIndex = 0;
      this._commitConfig(this._singleConfigFromDevice(config, devices[0]));
      return;
    }

    const next: TouchpadCardConfig = { ...config, devices };
    this._selectedDeviceIndex = Math.max(0, Math.min(index, devices.length - 1));
    this._commitConfig(next);
  }

  private _singleConfigFromDevice(config: TouchpadCardConfig, device: TouchpadDeviceConfig): TouchpadCardConfig {
    const controlsProfile = this._asControlsProfile(device.controls_profile ?? device.backend ?? config.controls_profile ?? config.backend ?? 'pc');
    const rootProfile = this._asControlsProfile(config.controls_profile ?? config.backend ?? 'pc');
    const next: TouchpadCardConfig = {
      ...config,
      wsUrl: device.wsUrl,
      controls_profile: controlsProfile,
      show_lock: device.show_lock,
      show_speed_buttons: device.show_speed_buttons,
      show_status_text: device.show_status_text,
      show_audio_controls: device.show_audio_controls,
      show_keyboard_button: device.show_keyboard_button,
      show_fullscreen_button: device.show_fullscreen_button,
      show_app_buttons: device.show_app_buttons,
      hide_app_launcher_after_launch: device.hide_app_launcher_after_launch,
      auto_focus_keyboard: device.auto_focus_keyboard,
      audio_controls: device.audio_controls ? { ...device.audio_controls } : config.audio_controls,
      gesture_mode: device.gesture_mode ? { ...device.gesture_mode } : rootProfile === controlsProfile ? config.gesture_mode : undefined,
      ha_gesture_mode: device.ha_gesture_mode ? { ...device.ha_gesture_mode } : config.ha_gesture_mode,
      webos_apps: device.webos_apps,
      invert_scroll: device.invert_scroll,
      sensitivity: device.sensitivity,
      scroll_multiplier: device.scroll_multiplier,
      double_tap_ms: device.double_tap_ms,
      tap_suppression_px: device.tap_suppression_px,
    };

    delete next.devices;
    delete next.backend;
    return next;
  }

  private _singleConfigToDevice(config: TouchpadCardConfig): TouchpadDeviceConfig {
    const controlsProfile = this._asControlsProfile(config.controls_profile ?? config.backend ?? 'pc');
    const name = this._defaultDeviceName(controlsProfile);
    const id = this._uniqueDeviceId(name, []);
    const device = this._withDefaultOptions({
      id,
      name,
      wsUrl: config.wsUrl ?? '',
      controls_profile: controlsProfile,
    });

    this._copyOptions(config, device);
    return device;
  }

  private _newDevice(existingDevices: TouchpadDeviceConfig[]): TouchpadDeviceConfig {
    const name = `Device ${existingDevices.length + 1}`;
    const id = this._uniqueDeviceId(name, existingDevices);
    return this._withDefaultOptions({
      id,
      name,
      wsUrl: 'ws://YOUR-HOST:8765',
      controls_profile: 'pc',
    });
  }

  private _withDefaultOptions(device: TouchpadDeviceConfig): TouchpadDeviceConfig {
    return {
      ...device,
      show_lock: BOOLEAN_DEFAULTS.show_lock,
      show_speed_buttons: BOOLEAN_DEFAULTS.show_speed_buttons,
      show_status_text: BOOLEAN_DEFAULTS.show_status_text,
      show_audio_controls: BOOLEAN_DEFAULTS.show_audio_controls,
      show_keyboard_button: BOOLEAN_DEFAULTS.show_keyboard_button,
      show_fullscreen_button: BOOLEAN_DEFAULTS.show_fullscreen_button,
      show_app_buttons: BOOLEAN_DEFAULTS.show_app_buttons,
      hide_app_launcher_after_launch: BOOLEAN_DEFAULTS.hide_app_launcher_after_launch,
      auto_focus_keyboard: BOOLEAN_DEFAULTS.auto_focus_keyboard,
      invert_scroll: BOOLEAN_DEFAULTS.invert_scroll,
    };
  }

  private _copyOptions(source: TouchpadOptionConfig, target: TouchpadDeviceConfig): void {
    target.show_lock = source.show_lock ?? BOOLEAN_DEFAULTS.show_lock;
    target.show_speed_buttons = source.show_speed_buttons ?? BOOLEAN_DEFAULTS.show_speed_buttons;
    target.show_status_text = source.show_status_text ?? BOOLEAN_DEFAULTS.show_status_text;
    target.show_audio_controls = source.show_audio_controls ?? BOOLEAN_DEFAULTS.show_audio_controls;
    target.show_keyboard_button = source.show_keyboard_button ?? BOOLEAN_DEFAULTS.show_keyboard_button;
    target.show_fullscreen_button = source.show_fullscreen_button ?? BOOLEAN_DEFAULTS.show_fullscreen_button;
    target.show_app_buttons = source.show_app_buttons ?? BOOLEAN_DEFAULTS.show_app_buttons;
    target.hide_app_launcher_after_launch =
      source.hide_app_launcher_after_launch ?? BOOLEAN_DEFAULTS.hide_app_launcher_after_launch;
    target.auto_focus_keyboard = source.auto_focus_keyboard ?? BOOLEAN_DEFAULTS.auto_focus_keyboard;
    if (source.audio_controls) {
      target.audio_controls = { ...source.audio_controls };
    } else {
      delete target.audio_controls;
    }
    if (source.gesture_mode) {
      target.gesture_mode = { ...source.gesture_mode };
    } else {
      delete target.gesture_mode;
    }
    if (source.ha_gesture_mode) {
      target.ha_gesture_mode = { ...source.ha_gesture_mode };
    } else {
      delete target.ha_gesture_mode;
    }
    target.webos_apps = source.webos_apps?.map((app) => ({ ...app }));
    target.invert_scroll = source.invert_scroll ?? BOOLEAN_DEFAULTS.invert_scroll;
    target.sensitivity = source.sensitivity;
    target.scroll_multiplier = source.scroll_multiplier;
    target.double_tap_ms = source.double_tap_ms;
    target.tap_suppression_px = source.tap_suppression_px;
  }

  private _uniqueDeviceId(base: string, devices: TouchpadDeviceConfig[]): string {
    const used = new Set(devices.map((device) => device.id));
    const normalized = this._deviceIdFromName(base);
    let candidate = normalized;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${normalized}_${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private _deviceIdFromName(name: string): string {
    return (
      name
        .trim()
        .normalize('NFD')
        .replace(/\u0142/g, 'l')
        .replace(/\u0141/g, 'L')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'device'
    );
  }

  private _validationMessages(devices: TouchpadDeviceConfig[]): string[] {
    const messages: string[] = [];
    const ids = devices.map((device) => String(device.id ?? '').trim());
    const duplicateIds = ids.filter((id, index) => id && ids.indexOf(id) !== index);

    if (ids.some((id) => !id)) {
      messages.push('Every device needs a display name.');
    }
    if (duplicateIds.length > 0) {
      messages.push('Device display names need to generate unique internal IDs.');
    }
    if (devices.some((device) => this._controlsProfileValue(device) !== 'home_assistant' && !String(device.wsUrl ?? '').trim())) {
      messages.push('Every device needs a WebSocket URL.');
    }
    return messages;
  }

  private _defaultDeviceName(profile: TouchpadControlsProfile): string {
    switch (profile) {
      case 'webos':
        return 'TV';
      case 'home_assistant':
        return 'Home Assistant';
      default:
        return 'PC';
    }
  }

  private _assign(target: object, field: string | number | symbol, value: unknown): void {
    const writable = target as Record<string, unknown>;
    const key = String(field);
    if (value === undefined) {
      delete writable[key];
      return;
    }
    writable[key] = value;
  }

  private _commitConfig(config: TouchpadCardConfig): void {
    const next = this._cleanConfig(config);
    this._config = next;
    fireEvent(this, 'config-changed', { config: next });
  }

  private _cleanConfig(config: TouchpadCardConfig): TouchpadCardConfig {
    const next = this._withoutUndefinedConfig(config);
    if (!String(next.storage_id ?? '').trim()) {
      next.storage_id = createStorageId();
    }
    this._migrateControlsProfile(next);
    if (next.devices) {
      next.devices = next.devices.map((device) => {
        const nextDevice = this._withoutUndefinedDevice(device);
        this._migrateControlsProfile(nextDevice);
        return nextDevice;
      });
    }
    if (!next.devices?.length) {
      delete next.devices;
    }
    delete (next as TouchpadCardConfig & { default_device?: unknown }).default_device;
    return next;
  }

  private _migrateControlsProfile(target: TouchpadCardConfig | TouchpadDeviceConfig): void {
    if (!target.controls_profile && target.backend) {
      target.controls_profile = target.backend;
    }
    delete target.backend;
  }

  private _withoutUndefinedConfig(source: TouchpadCardConfig): TouchpadCardConfig {
    const next: TouchpadCardConfig = { ...source };
    this._deleteUndefinedKeys(next as TouchpadCardConfig & Record<string, unknown>);
    return next;
  }

  private _withoutUndefinedDevice(source: TouchpadDeviceConfig): TouchpadDeviceConfig {
    const next: TouchpadDeviceConfig = { ...source };
    this._deleteUndefinedKeys(next as TouchpadDeviceConfig & Record<string, unknown>);
    return next;
  }

  private _deleteUndefinedKeys(target: Record<string, unknown>): void {
    Object.keys(target).forEach((key) => {
      if (target[key] === undefined) {
        delete target[key];
      }
    });
  }

  static styles = css`
    .editor {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 12px;
      color: var(--primary-text-color);
    }

    .config-section,
    .device-config {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .section-header,
    .device-header {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      justify-content: space-between;
    }

    h3,
    h4,
    p {
      margin: 0;
    }

    h3 {
      font-size: 16px;
      font-weight: 600;
    }

    h4 {
      font-size: 14px;
      font-weight: 600;
    }

    p {
      margin-top: 4px;
      color: var(--secondary-text-color);
      font-size: 13px;
      line-height: 1.35;
    }

    .fields {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    }

    .field {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 6px;
      font-size: 13px;
      color: var(--secondary-text-color);
    }

    .gesture-hint {
      color: var(--secondary-text-color);
      font-size: 12px;
      line-height: 1.35;
    }

    input[type='text'],
    input[type='number'],
    select,
    textarea,
    ha-icon-picker {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
    }

    input[type='text'],
    input[type='number'],
    select,
    textarea {
      height: 40px;
      padding: 0 10px;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.35));
      border-radius: 6px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      font: inherit;
    }

    textarea {
      min-height: 140px;
      padding: 10px;
      resize: vertical;
    }

    input[type='text']:focus,
    input[type='number']:focus,
    select:focus,
    textarea:focus {
      border-color: var(--primary-color);
      outline: none;
    }

    .icon-picker-field {
      min-width: 0;
    }

    .icon-picker-field.compact ha-icon-picker {
      --mdc-shape-small: 6px;
    }

    .option-group {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-top: 2px;
    }

    .collapsible > summary {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      color: var(--primary-text-color);
      list-style: none;
      user-select: none;
    }

    .collapsible > summary::-webkit-details-marker {
      display: none;
    }

    .collapsible > summary::before {
      content: '';
      width: 0;
      height: 0;
      border-top: 5px solid transparent;
      border-bottom: 5px solid transparent;
      border-left: 7px solid var(--secondary-text-color);
      transform: rotate(0deg);
      transition: transform 120ms ease;
    }

    .collapsible[open] > summary::before {
      transform: rotate(90deg);
    }

    .collapsible-content {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 10px;
      margin-left: 16px;
    }

    .option-header,
    .app-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
    }

    .app-toolbar .button-row {
      flex: 0 0 auto;
    }

    .button-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }

    .toggles {
      display: grid;
      gap: 8px 16px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    }

    .toggle {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 10px;
      color: var(--primary-text-color);
      font-size: 14px;
      line-height: 1.3;
    }

    .toggle input {
      flex: 0 0 auto;
      margin-left: 0;
    }

    .ha-gesture-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .ha-gesture-action {
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.35));
      border-radius: 8px;
      padding: 10px 12px;
    }

    .ha-gesture-action summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      cursor: pointer;
      list-style: none;
      color: var(--primary-text-color);
      font-size: 13px;
      font-weight: 600;
    }

    .ha-gesture-action summary::-webkit-details-marker {
      display: none;
    }

    .ha-action-count {
      color: var(--secondary-text-color);
      font-weight: 500;
    }

    .ha-action-editor {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 10px;
    }

    .ha-action-selector {
      min-width: 0;
    }

    .app-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .app-picker-message {
      padding: 8px 10px;
      border-radius: 6px;
      background: rgba(127, 127, 127, 0.12);
      color: var(--secondary-text-color);
      font-size: 13px;
      line-height: 1.35;
    }

    .tv-app-picker {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      max-height: 160px;
      overflow-y: auto;
      padding: 2px;
    }

    .tv-app-option {
      max-width: 220px;
      display: inline-flex;
      gap: 8px;
      align-items: center;
      padding: 0 12px;
    }

    .tv-app-option ha-icon {
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
      --mdc-icon-size: 18px;
    }

    .tv-app-option span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .app-row {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
      padding: 10px;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.28));
      border-radius: 8px;
      background: rgba(127, 127, 127, 0.04);
    }

    .app-main-fields,
    .app-action-fields {
      display: grid;
      gap: 10px 12px;
      min-width: 0;
      align-items: end;
    }

    .app-main-fields {
      grid-template-columns: minmax(130px, 0.85fr) minmax(180px, 1.15fr);
    }

    .app-action-fields {
      grid-template-columns: minmax(220px, 1fr) 92px;
    }

    .remove-app {
      width: 92px;
      min-width: 0;
    }

    @media (max-width: 700px) {
      .app-main-fields,
      .app-action-fields {
        grid-template-columns: 1fr;
      }

      .remove-app {
        width: 100%;
      }
    }

    .tabs {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 2px;
      scrollbar-width: none;
    }

    .tabs::-webkit-scrollbar {
      display: none;
    }

    .tab,
    button {
      height: 36px;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.35));
      border-radius: 6px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      cursor: pointer;
      font: inherit;
      white-space: nowrap;
    }

    .tab {
      max-width: 180px;
      overflow: hidden;
      padding: 0 12px;
      text-overflow: ellipsis;
    }

    .tab.active {
      border-color: var(--primary-color);
      color: var(--primary-color);
    }

    button.secondary,
    button.danger {
      flex: 0 0 auto;
      padding: 0 12px;
    }

    button.danger {
      color: var(--error-color, #db4437);
    }

    button:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    .device-config {
      padding: 12px;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.35));
      border-radius: 8px;
    }

    .validation {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 10px 12px;
      border-radius: 6px;
      background: rgba(219, 68, 55, 0.12);
      color: var(--error-color, #db4437);
      font-size: 13px;
      line-height: 1.35;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'touchpad-card-editor': TouchpadCardEditor;
  }
}
