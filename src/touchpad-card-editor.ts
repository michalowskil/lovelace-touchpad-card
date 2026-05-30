import { css, html, LitElement } from 'lit';
import type { TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, HomeAssistant, LovelaceCardEditor } from 'custom-card-helpers';
import { TouchpadCardConfig, TouchpadControlsProfile, TouchpadDeviceConfig, TouchpadOptionConfig, TouchpadThemeMode } from './types';

type BooleanOptionField =
  | 'show_lock'
  | 'show_speed_buttons'
  | 'show_status_text'
  | 'show_audio_controls'
  | 'show_keyboard_button'
  | 'auto_focus_keyboard'
  | 'invert_scroll';

type NumberOptionField = 'sensitivity' | 'scroll_multiplier' | 'double_tap_ms' | 'tap_suppression_px';

const BOOLEAN_DEFAULTS: Record<BooleanOptionField, boolean> = {
  show_lock: true,
  show_speed_buttons: true,
  show_status_text: true,
  show_audio_controls: true,
  show_keyboard_button: true,
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
  { field: 'auto_focus_keyboard', label: 'Focus keyboard input when opened' },
  { field: 'invert_scroll', label: 'Reverse scroll direction' },
];

const NUMBER_FIELDS: Array<{ field: NumberOptionField; label: string; step: string }> = [
  { field: 'sensitivity', label: 'Swipe sensitivity', step: '0.1' },
  { field: 'scroll_multiplier', label: 'Scroll multiplier', step: '0.1' },
  { field: 'double_tap_ms', label: 'Double tap window (ms)', step: '1' },
  { field: 'tap_suppression_px', label: 'Max move allowed for tap (px)', step: '1' },
];

function createStorageId(): string {
  return `tp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

@customElement('touchpad-card-editor')
export class TouchpadCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: TouchpadCardConfig;
  @state() private _selectedDeviceIndex = 0;

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
    return html`
      <section class="config-section">
        <div class="section-header">
          <div>
            <h3>Single device</h3>
          </div>
          <button class="secondary" type="button" @click=${this._addDevice}>Add device</button>
        </div>

        <div class="fields">
          ${this._renderTextField('WebSocket URL', config.wsUrl ?? '', 'ws://YOUR-PC-LAN-IP:8765', (value) =>
            this._updateRootField('wsUrl', value)
          )}
          ${this._renderControlsProfileField(this._controlsProfileValue(config), (value) => this._updateRootField('controls_profile', value))}
        </div>

        ${this._renderOptions(config, (field, value) => this._updateRootField(field, value))}
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
          ${this._renderTextField('WebSocket URL', device.wsUrl ?? '', 'ws://homeassistant.local:8778', (value) =>
            this._updateDeviceField(index, 'wsUrl', value)
          )}
          ${this._renderControlsProfileField(this._controlsProfileValue(device), (value) =>
            this._updateDeviceField(index, 'controls_profile', value)
          )}
        </div>

        ${this._renderOptions(device, (field, value) => this._updateDeviceField(index, field, value))}
      </div>
    `;
  }

  private _renderOptions(
    source: TouchpadOptionConfig,
    update: (field: BooleanOptionField | NumberOptionField, value: boolean | number | undefined) => void
  ): TemplateResult {
    return html`
      <div class="option-group">
        <h4>Controls</h4>
        <div class="toggles">
          ${BOOLEAN_FIELDS.map(
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

      <div class="option-group">
        <h4>Gestures</h4>
        <div class="fields">
          ${NUMBER_FIELDS.map(({ field, label, step }) =>
            this._renderNumberField(label, this._numberValue(source, field), NUMBER_DEFAULTS[field], step, (value) => update(field, value))
          )}
        </div>
      </div>
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

  private _renderControlsProfileField(value: TouchpadControlsProfile, update: (value: TouchpadControlsProfile) => void): TemplateResult {
    return html`
      <label class="field">
        <span>Controls profile</span>
        <select .value=${value} @change=${(ev: Event) => update(this._asControlsProfile((ev.target as HTMLSelectElement).value))}>
          <option value="pc">PC controls</option>
          <option value="webos">LG webOS controls</option>
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
    return value === 'webos' ? 'webos' : 'pc';
  }

  private _asThemeMode(value: string): TouchpadThemeMode {
    return value === 'dark' || value === 'light' ? value : 'auto';
  }

  private _updateRootField(field: keyof TouchpadCardConfig, value: unknown): void {
    const next = this._currentConfig();
    this._assign(next, field, value);
    this._commitConfig(next);
  }

  private _updateDeviceField(index: number, field: keyof TouchpadDeviceConfig, value: unknown): void {
    const config = this._currentConfig();
    const devices = this._devicesFromConfig(config);
    const current = devices[index];
    if (!current) return;

    const nextDevice = { ...current };
    this._assign(nextDevice, field, value);
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
    const next: TouchpadCardConfig = {
      ...config,
      wsUrl: device.wsUrl,
      controls_profile: this._asControlsProfile(device.controls_profile ?? device.backend ?? config.controls_profile ?? config.backend ?? 'pc'),
      show_lock: device.show_lock,
      show_speed_buttons: device.show_speed_buttons,
      show_status_text: device.show_status_text,
      show_audio_controls: device.show_audio_controls,
      show_keyboard_button: device.show_keyboard_button,
      auto_focus_keyboard: device.auto_focus_keyboard,
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
    const name = controlsProfile === 'webos' ? 'TV' : 'PC';
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
    target.auto_focus_keyboard = source.auto_focus_keyboard ?? BOOLEAN_DEFAULTS.auto_focus_keyboard;
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
    if (devices.some((device) => !String(device.wsUrl ?? '').trim())) {
      messages.push('Every device needs a WebSocket URL.');
    }
    return messages;
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

    input[type='text'],
    input[type='number'],
    select {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      height: 40px;
      padding: 0 10px;
      border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.35));
      border-radius: 6px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      font: inherit;
    }

    input[type='text']:focus,
    input[type='number']:focus,
    select:focus {
      border-color: var(--primary-color);
      outline: none;
    }

    .option-group {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-top: 2px;
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
