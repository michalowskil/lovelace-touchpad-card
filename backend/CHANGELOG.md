# Windows Backend Changelog

## 0.5.1
- Tray update checks now compare the published Windows backend version manifest instead of the general GitHub release tag, so card-only releases do not notify Windows users.

## 0.5.0
- Before sending input, switch the backend input thread to the current Windows input desktop. This should allow input to reach the active desktop when a non-locking screensaver is running.
- Added a simple tray update check that notifies when a newer GitHub release is available.

## 0.4.0
- Windows backend now ships as a tray-first `touchpad-server.exe` (no console); tray icon toggles the log window.

## 0.2.0
- Added keyboard and volume support.
- Switched server to the current `websockets.server` API to drop deprecation warnings.

## 0.1.4
- First release.
