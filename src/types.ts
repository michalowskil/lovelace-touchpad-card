import { LovelaceCardConfig } from 'custom-card-helpers';

export type TouchpadControlsProfile = 'pc' | 'webos';

export interface TouchpadEndpointConfig {
  wsUrl?: string;
  controls_profile?: TouchpadControlsProfile;
  /** @deprecated Use controls_profile. Kept as a backwards-compatible alias. */
  backend?: TouchpadControlsProfile;
}

export interface TouchpadOptionConfig {
  show_lock?: boolean;
  show_speed_buttons?: boolean;
  show_status_text?: boolean;
  show_audio_controls?: boolean;
  show_keyboard_button?: boolean;
  auto_focus_keyboard?: boolean;
  sensitivity?: number;
  scroll_multiplier?: number;
  invert_scroll?: boolean;
  double_tap_ms?: number;
  tap_suppression_px?: number;
}

export interface TouchpadDeviceConfig extends TouchpadEndpointConfig, TouchpadOptionConfig {
  id: string;
  name?: string;
  wsUrl: string;
}

export interface TouchpadCardConfig extends LovelaceCardConfig, TouchpadEndpointConfig, TouchpadOptionConfig {
  type: string;
  storage_id?: string;
  devices?: TouchpadDeviceConfig[];
}

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
