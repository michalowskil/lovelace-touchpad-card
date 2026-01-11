import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, HomeAssistant, LovelaceCardEditor } from 'custom-card-helpers';
import { HaFormSchema, TouchpadCardConfig } from './types';

const DEFAULT_FORM_VALUES: Partial<TouchpadCardConfig> = {
  backend: 'pc',
  show_lock: true,
  show_speed_buttons: true,
  show_status_text: true,
  show_audio_controls: true,
  show_keyboard_button: true,
  invert_scroll: false,
};

const schema: HaFormSchema[] = [
  {
    name: 'wsUrl',
    type: 'string',
    required: true,
  },
  {
    name: 'backend',
    type: 'string',
    selector: {
      select: {
        options: [
          { value: 'pc', label: 'PC backend' },
          { value: 'webos', label: 'LG webOS backend' },
        ],
      },
    },
  },
  {
    name: 'show_lock',
    type: 'boolean',
    default: true,
  },
  {
    name: 'show_speed_buttons',
    type: 'boolean',
    default: true,
  },
  {
    name: 'show_status_text',
    type: 'boolean',
    default: true,
  },
  {
    name: 'show_audio_controls',
    type: 'boolean',
    default: true,
  },
  {
    name: 'show_keyboard_button',
    type: 'boolean',
    default: true,
  },
  {
    name: 'sensitivity',
    type: 'float',
    required: false,
  },
  {
    name: 'scroll_multiplier',
    type: 'float',
    required: false,
  },
  {
    name: 'invert_scroll',
    type: 'boolean',
    default: false,
  },
  {
    name: 'double_tap_ms',
    type: 'integer',
    required: false,
  },
  {
    name: 'tap_suppression_px',
    type: 'integer',
    required: false,
  },
];

@customElement('touchpad-card-editor')
export class TouchpadCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: TouchpadCardConfig;
  private _formObserver?: MutationObserver;

  public setConfig(config: TouchpadCardConfig): void {
    this._config = { ...DEFAULT_FORM_VALUES, ...config };
  }

  private _valueChanged(ev: CustomEvent): void {
    if (!this._config) return;
    const detail = (ev.detail as { value?: Partial<TouchpadCardConfig> })?.value;
    if (!detail) return;

    const numericFields = new Set<keyof TouchpadCardConfig>(['sensitivity', 'scroll_multiplier', 'double_tap_ms', 'tap_suppression_px']);
    const cleaned: Partial<TouchpadCardConfig> = {};
    Object.entries(detail).forEach(([key, value]) => {
      if (numericFields.has(key as keyof TouchpadCardConfig)) {
        if (value === '' || value === null || Number.isNaN(value as number)) {
          cleaned[key as keyof TouchpadCardConfig] = undefined;
          return;
        }
      }
      cleaned[key as keyof TouchpadCardConfig] = value as TouchpadCardConfig[keyof TouchpadCardConfig];
    });

    this._config = { ...this._config, ...cleaned };
    fireEvent(this, 'config-changed', { config: this._config });
  }

  private _computeLabel = (field: HaFormSchema): string => {
    switch (field.name) {
      case 'wsUrl':
        return 'WebSocket URL (backend listener)';
      case 'backend':
        return 'Backend type';
      case 'show_lock':
        return 'Show LOCK button';
      case 'show_speed_buttons':
        return 'Show speed multiplier buttons';
      case 'show_status_text':
        return 'Show status text';
      case 'show_audio_controls':
        return 'Show audio icons';
      case 'show_keyboard_button':
        return 'Show keyboard toggle';
      case 'sensitivity':
        return 'Swipe sensitivity (default 1)';
      case 'scroll_multiplier':
        return 'Scroll multiplier (default 1)';
      case 'invert_scroll':
        return 'Reverse scroll direction';
      case 'double_tap_ms':
        return 'Double tap window (ms, default 250)';
      case 'tap_suppression_px':
        return 'Max move allowed for tap (px, default 6)';
      default:
        return String(field.name);
    }
  };

  protected render() {
    if (!this.hass) return html``;

    const data = { ...DEFAULT_FORM_VALUES, ...this._config };

    return html`
      <div class="editor">
        <ha-form
          .hass=${this.hass}
          .data=${data}
          .schema=${schema}
          .computeLabel=${this._computeLabel}
          @value-changed=${this._valueChanged}
        ></ha-form>
      </div>
    `;
  }

  protected updated(): void {
    this._removeBooleanMargin();
  }

  public disconnectedCallback(): void {
    this._formObserver?.disconnect();
    this._formObserver = undefined;
    super.disconnectedCallback();
  }

  private _removeBooleanMargin(): void {
    const form = this.shadowRoot?.querySelector('ha-form') as HTMLElement | null;
    const formRoot = form?.shadowRoot;
    if (!formRoot) return;

    const apply = () => {
      formRoot.querySelectorAll<HTMLElement>('ha-form-boolean').forEach((el) => {
        if (el.style.marginBottom !== '0px') {
          el.style.marginBottom = '0px';
        }
      });
    };

    apply();

    if (!this._formObserver) {
      this._formObserver = new MutationObserver(() => apply());
      this._formObserver.observe(formRoot, { childList: true, subtree: true });
    }
  }

  static styles = css`
    .editor {
      padding: 12px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'touchpad-card-editor': TouchpadCardEditor;
  }
}
