[![Forum](https://img.shields.io/badge/dynamic/json?style=flat&label=Forum&color=41BDF5&logo=homeassistant&logoColor=white&suffix=%20posts&url=https://community.home-assistant.io/t/lovelace-touchpad-card-for-home-assistant-windows-os-touchpad/966857.json&query=$.posts_count)](https://community.home-assistant.io/t/lovelace-touchpad-card-for-home-assistant-windows-os-touchpad/966857)
[![GitHub Discussions](https://img.shields.io/github/discussions/michalowskil/lovelace-touchpad-card?logo=github&logoColor=white&label=Discussions)](https://github.com/michalowskil/lovelace-touchpad-card/discussions)
[![Downloads](https://img.shields.io/github/downloads/michalowskil/lovelace-touchpad-card/total?label=Downloads&logo=github)](https://github.com/michalowskil/lovelace-touchpad-card/releases)

# Lovelace Touchpad Card for Home Assistant

Control your PC or LG webOS TV from Home Assistant with a touchpad, keyboard input, and volume controls.

If you like this project, please consider giving it a ⭐ on GitHub: [![Star on GitHub](https://img.shields.io/github/stars/michalowskil/lovelace-touchpad-card.svg?style=social)](https://github.com/michalowskil/lovelace-touchpad-card/stargazers)

## Features & gestures
- One-finger move; tap/double-tap = left/double click; press-and-hold then drag to select/drag.
- Two-finger scroll with configurable multiplier.
- Two-finger short tap = right click.
- Keyboard panel for text input plus arrows/Home/End/PageUp/PageDown.
- Built-in volume controls (up/down/mute).
- Speed toggles x2/x3/x4 (one active at a time).
- Remembers selected toggles (speed, lock, keyboard panel) per view.
- Works over LAN WebSocket (`ws://...`); switch to `wss://` for remote.

## Installation

### HACS – Custom repository
1. HACS → ⋮ → **Custom repositories** → add  
   `https://github.com/michalowskil/lovelace-touchpad-card` (Type: **Dashboard**)  
   or click: [![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=michalowskil&repository=lovelace-touchpad-card&category=plugin)
2. Install **Lovelace Touchpad Card**.
3. Resource is added automatically as `/hacsfiles/lovelace-touchpad-card/touchpad-card.js`.
4. Hard refresh the browser if needed.

### Manual
1. Download `touchpad-card.js` from the latest release and place it under  
   `config/www/touchpad-card/touchpad-card.js`.
2. Add a resource in **Edit Dashboard → Manage resources**:  
   `/local/touchpad-card/touchpad-card.js` (type: **JavaScript module**).
3. Hard refresh the browser.

## Usage
Add the card in the UI and configure everything from the visual editor.

## Windows server

1. Download `touchpad-server.exe` from the latest release on GitHub.
2. Run:
   ```powershell
   touchpad-server.exe --host 0.0.0.0 --port 8765
   ```
   - SmartScreen may show ```Windows protected your PC``` because the file is unsigned. Click **More info** → **Run anyway**, or build from source yourself if you prefer.
   - Host and port are optional, if you omit them, the defaults are `0.0.0.0` and `8765` as shown.
3. Keep the window open while using the card. Allow it through Windows Firewall on first run.
4. Optional: add a shortcut to Startup or create a scheduled task for auto-start.

## webOS backend (Home Assistant add-on)

1. In Home Assistant go to **Settings -> Add-ons -> Add-on store -> ... -> Repositories** and add  
   `https://github.com/michalowskil/lovelace-touchpad-card`.
2. Install **webOS Pointer Bridge** from the add-on list.
3. Open the add-on configuration and list your TVs. Example:
   ```yaml
   tvs:
     - name: livingroom
       host: 192.168.0.129
       listen_port: 8777
       tv_port: 3001
       use_ssl: true
     - name: bedroom
       host: 192.168.0.6
       listen_port: 8778
       use_ssl: true
   ```
   - `listen_port` is where the Lovelace card connects. The add-on runs in host network, so use your HA host IP.
   - Client keys are stored per TV in `/data/keys/<name>.json` and survive restarts.
   - `origin` is optional; leave it unset/empty unless your TV rejects the default. If needed, set it to `https://www.lge.com`, or to `""` to send no Origin header.
4. Start the add-on and enable **Start on boot** and **Watchdog** if desired.
5. In each touchpad card set `wsUrl` to the matching port (for example `ws://homeassistant.local:8777`).

## Notes
- Card sends deltas in `requestAnimationFrame` (throttled); backend accumulates scroll into wheel steps.
- For remote/HTTPS, use `wss://` (e.g., reverse proxy). LAN can stay `ws://`.

## Changelog
- v0.3.0
  - Added Home Assistant add-on for the webOS pointer bridge (multi-TV support, host network).
- v0.2.0
  - Added keyboard and volume controls.
  - Added remembering selected toggles (multiplier, lock, keyboard).
  - Switched server to the current `websockets.server` API to drop deprecation warnings.
- v0.1.4
  - First release.

## Screenshots

![card configuration](screenshots/dark.png)
![card configuration](screenshots/light.png)
![card configuration](screenshots/visibility.png)
