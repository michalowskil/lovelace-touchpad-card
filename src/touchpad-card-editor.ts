import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fireEvent, HomeAssistant, LovelaceCardEditor } from 'custom-card-helpers';
import { HaFormSchema, TouchpadCardConfig } from './types';

const DEFAULT_FORM_VALUES: Partial<TouchpadCardConfig> = {
  show_lock: true,
  show_speed_buttons: true,
  show_status_text: true,
  sensitivity: 1,
  scroll_multiplier: 1,
  invert_scroll: false,
  double_tap_ms: 250,
  tap_suppression_px: 6,
};

const schema: HaFormSchema[] = [
  {
    name: 'wsUrl',
    type: 'string',
    required: true,
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
    name: 'sensitivity',
    type: 'float',
    default: 1,
  },
  {
    name: 'scroll_multiplier',
    type: 'float',
    default: 1,
  },
  {
    name: 'invert_scroll',
    type: 'boolean',
    default: false,
  },
  {
    name: 'double_tap_ms',
    type: 'integer',
    default: 250,
  },
  {
    name: 'tap_suppression_px',
    type: 'integer',
    default: 6,
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

    this._config = { ...this._config, ...detail };
    fireEvent(this, 'config-changed', { config: this._config });
  }

  private _computeLabel = (field: HaFormSchema): string => {
    switch (field.name) {
      case 'wsUrl':
        return 'WebSocket URL (PC listener)';
      case 'show_lock':
        return 'Show LOCK button';
      case 'show_speed_buttons':
        return 'Show speed multiplier buttons';
      case 'show_status_text':
        return 'Show status text';
      case 'sensitivity':
        return 'Swipe sensitivity';
      case 'scroll_multiplier':
        return 'Scroll multiplier';
      case 'invert_scroll':
        return 'Reverse scroll direction';
      case 'double_tap_ms':
        return 'Double tap window (ms)';
      case 'tap_suppression_px':
        return 'Max move allowed for tap (px)';
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
