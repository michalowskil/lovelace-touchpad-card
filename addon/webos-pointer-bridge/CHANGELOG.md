# webOS Pointer Bridge Changelog

## 0.4.1
- Open the touchpad port before the TV handshake, so the card can connect while webOS is still waking up.
- Do not wait for the optional IME socket before pointer and button input. Some LG TVs answer that request only after about 5 minutes.
- Reconnect a dropped TV socket in the background instead of stalling every cursor and button event on that wait.

## 0.4.0
- Added support for launching webOS apps from touchpad-card app buttons.
- Report installed webOS app IDs and failed app launches back to the card.
- Added a normalized installed-app list response for the card editor's "Add from TV" picker.

## 0.3.2
- Use the current multi-arch Home Assistant base image so local add-on builds work on aarch64.
- Remove deprecated add-on architecture entries.
- Reduce log noise for retryable TV connection failures and WebSocket connection events.

## 0.3.1
- Smoother pointer movement on webOS at high sensitivity (smaller, chunked deltas).
- Much gentler default scrolling when the card scroll multiplier is 1 (lower scroll scale).

## 0.3.0
- Initial release (multi-TV support, host network).
