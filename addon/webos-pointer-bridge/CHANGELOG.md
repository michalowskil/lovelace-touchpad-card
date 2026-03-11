# webOS Pointer Bridge Changelog

## 0.3.2
- Use the current multi-arch Home Assistant base image so local add-on builds work on aarch64.
- Remove deprecated add-on architecture entries.
- Reduce log noise for retryable TV connection failures and WebSocket connection events.

## 0.3.1
- Smoother pointer movement on webOS at high sensitivity (smaller, chunked deltas).
- Much gentler default scrolling when the card scroll multiplier is 1 (lower scroll scale).

## 0.3.0
- Initial release (multi-TV support, host network).
