# Card Changelog

## 0.13.0
- Added a Home Assistant only controls profile for action-based remotes without a Windows or LG webOS backend.

## 0.12.0
- Added an Audio controls editor section with selectable device-volume or Home Assistant action modes.
- Added separate Tap and Hold Home Assistant actions for Volume up, Volume down, and Mute audio buttons.

## 0.11.0
- Added Double tap actions to Gesture mode and Home Assistant gesture mode.
- Added an optional webOS setting that closes the app launcher after selecting an app.
- Restored the dashboard scroll position after exiting fullscreen touchpad mode.

## 0.10.0
- Added Home Assistant gesture mode with a separate touchpad toggle and visual-editor configurable actions.

## 0.9.0
- Added a configurable Gesture mode button with swipe, tap, and hold actions for PC and LG webOS controls.
- Added a remembered webOS app toggle button that shows or hides configured app shortcuts.

## 0.8.0
- Added an optional fullscreen touchpad mode with native Fullscreen API support and a card-level fallback for mobile WebViews.
- Repositioned the status text, keyboard toggle, and fullscreen button for a cleaner fullscreen/mobile layout.

## 0.7.0
- Added optional webOS app launcher buttons, configurable from the card editor or YAML.
- Dim unavailable webOS app buttons when the bridge can read the TV app list, with a launch-failure message fallback.
- Added an optional "Add from TV" picker that imports webOS app shortcuts when the TV provides an app list.

## 0.6.1
- Fixed the card editor so a configuration returns to the single-device layout after removing devices down to one.
- Kept the theme selector visible for both single-device and multi-device configurations.
- Removed redundant helper text from the card editor device sections.

## 0.6.0
- Added optional multi-device mode. A single card can now switch between configured endpoints.
- Multi-device cards now remember speed, lock, and keyboard-panel state separately per device.
- Added light, dark, and automatic theme modes.
- Added an editor option to disable automatic focus when opening the keyboard panel.
- Renamed the UI/backend selector to `controls_profile`; existing `backend` YAML remains supported as an alias.

## 0.3.1
- Card editor: numeric fields (sensitivity, scroll, double-tap window, tap suppression) are easier to edit; labels show defaults so leaving a field blank falls back to a sensible value.

## 0.2.0
- Added keyboard and volume controls.
- Added remembering selected toggles (multiplier, lock, keyboard).

## 0.1.4
- First release.
