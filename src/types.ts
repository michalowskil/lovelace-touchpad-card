import { LovelaceCardConfig } from 'custom-card-helpers';

export interface TouchpadCardConfig extends LovelaceCardConfig {
  type: string;
  wsUrl: string;
  backend?: 'pc' | 'webos';
  show_lock?: boolean;
  show_speed_buttons?: boolean;
  show_status_text?: boolean;
  show_audio_controls?: boolean;
  show_keyboard_button?: boolean;
  sensitivity?: number;
  scroll_multiplier?: number;
  invert_scroll?: boolean;
  double_tap_ms?: number;
  tap_suppression_px?: number;
}

export type HaFormSchema =
  | { name: keyof TouchpadCardConfig; type: 'string'; required?: boolean; selector?: { select: { options: Array<{ value: string; label: string }> } } }
  | { name: keyof TouchpadCardConfig; type: 'boolean'; default?: boolean }
  | { name: keyof TouchpadCardConfig; type: 'float'; default?: number; required?: boolean }
  | { name: keyof TouchpadCardConfig; type: 'integer'; default?: number; required?: boolean };

export type KeyCommand =
  | 'enter'
  | 'backspace'
  | 'escape'
  | 'back'
  | 'tab'
  | 'space'
  | 'delete'
  | 'arrow_left'
  | 'arrow_right'
  | 'arrow_up'
  | 'arrow_down'
  | 'home'
  | 'end'
  | 'page_up'
  | 'page_down'
  | 'power'
  | 'settings';

export type VolumeAction = 'up' | 'down' | 'mute';

export type TouchpadMessage =
  | { t: 'move'; dx: number; dy: number }
  | { t: 'scroll'; dx: number; dy: number }
  | { t: 'click' }
  | { t: 'double_click' }
  | { t: 'right_click' }
  | { t: 'down' }
  | { t: 'up' }
  | { t: 'text'; text: string }
  | { t: 'key'; key: KeyCommand }
  | { t: 'volume'; action: VolumeAction };
