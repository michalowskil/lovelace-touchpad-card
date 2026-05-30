"""
Tray launcher for the Windows touchpad backend.

Starts the WebSocket server in the background, adds a system tray icon,
and offers a small log window that can be shown/hidden without stopping
the server. Intended for autostart so no console window has to stay open.
"""

import argparse
import asyncio
import json
import logging
import queue
import sys
import threading
import tkinter as tk
import urllib.request
import webbrowser
from pathlib import Path
from tkinter import scrolledtext
from typing import Any, Optional

import pystray
from PIL import Image, ImageDraw, ImageTk
from pystray import MenuItem as Item

from ws_touchpad import serve

LOG_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"
QUEUE_LIMIT = 1000
VERSION_FILE_NAME = "VERSION"
SERVER_VERSION_ASSET_NAME = "touchpad-server.version.json"
DEFAULT_APP_VERSION = "unknown"
LATEST_RELEASE_API_URL = "https://api.github.com/repos/michalowskil/lovelace-touchpad-card/releases/latest"
LATEST_RELEASE_URL = "https://github.com/michalowskil/lovelace-touchpad-card/releases/latest"
UPDATE_CHECK_INITIAL_DELAY_MS = 10_000
UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
UPDATE_CHECK_TIMEOUT_SECONDS = 10


def _resource_dir() -> Path:
    bundled_dir = getattr(sys, "_MEIPASS", None)
    if bundled_dir:
        return Path(str(bundled_dir))
    return Path(__file__).resolve().parent


def _read_app_version() -> str:
    try:
        version = (_resource_dir() / VERSION_FILE_NAME).read_text(encoding="utf-8").strip()
        if version.lower().startswith("v"):
            version = version[1:]
        return version or DEFAULT_APP_VERSION
    except Exception:
        return DEFAULT_APP_VERSION


APP_VERSION = _read_app_version()


def hide_console_window() -> None:
    """Hide the console window if we were started from cmd.exe."""
    try:
        import ctypes

        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)
    except Exception:
        # If hiding fails, just continue with the window visible.
        pass


def get_log_file() -> Path:
    base_dir = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
    return base_dir / "touchpad-server.log"


class QueueHandler(logging.Handler):
    """Push log records into a bounded queue for the UI."""

    def __init__(self, log_queue: "queue.Queue[str]") -> None:
        super().__init__()
        self.log_queue = log_queue

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            try:
                self.log_queue.put_nowait(msg)
            except queue.Full:
                try:
                    # Drop the oldest message to make room.
                    self.log_queue.get_nowait()
                    self.log_queue.put_nowait(msg)
                except queue.Empty:
                    pass
        except Exception:
            self.handleError(record)


class LogWindow:
    """Simple Tk window that shows log lines; closing or minimizing hides it."""

    def __init__(
        self,
        root: tk.Tk,
        log_queue: "queue.Queue[str]",
        log_file: Path,
        icon_photo: Optional[tk.PhotoImage] = None,
    ) -> None:
        self.root = root
        self.log_queue = log_queue
        self.log_file = log_file
        self.icon_photo = icon_photo
        self.window: Optional[tk.Toplevel] = None
        self.text: Optional[scrolledtext.ScrolledText] = None

    def is_visible(self) -> bool:
        return bool(self.window and self.window.state() == "normal")

    def show(self) -> None:
        if self.window is None:
            self.window = tk.Toplevel(self.root)
            self.window.title(f"Touchpad server ({self.log_file})")
            self.window.geometry("780x420")
            self.window.protocol("WM_DELETE_WINDOW", self.hide)
            self.window.bind("<Unmap>", self._on_unmap)
            if self.icon_photo is not None:
                self.window.iconphoto(False, self.icon_photo)

            self.text = scrolledtext.ScrolledText(self.window, state="disabled", wrap="word")
            self.text.pack(fill="both", expand=True)

            info = f"Logging to: {self.log_file}\n\n"
            self._append(info)
            self._drain_queue()
        else:
            self.window.deiconify()
            self.window.lift()
            self.window.focus_force()

    def hide(self) -> None:
        if self.window is not None:
            self.window.withdraw()

    def destroy(self) -> None:
        if self.window is not None:
            self.window.destroy()
            self.window = None
            self.text = None

    def _on_unmap(self, event: tk.Event) -> None:
        if event.widget is self.window and self.window is not None and self.window.state() == "iconic":
            self.hide()

    def _append(self, message: str) -> None:
        if self.text is None:
            return
        self.text.configure(state="normal")
        self.text.insert("end", message + ("\n" if not message.endswith("\n") else ""))
        self.text.see("end")
        self.text.configure(state="disabled")

    def _drain_queue(self) -> None:
        if self.window is None:
            return
        updated = False
        try:
            while True:
                msg = self.log_queue.get_nowait()
                self._append(msg)
                updated = True
        except queue.Empty:
            pass

        if updated and self.text is not None:
            self.text.see("end")
        if self.window is not None:
            self.window.after(250, self._drain_queue)


class ServerThread(threading.Thread):
    """Run the async WebSocket server in a background thread."""

    def __init__(self, host: str, port: int, scroll_scale: float, stop_event: threading.Event) -> None:
        super().__init__(daemon=True)
        self.host = host
        self.port = port
        self.scroll_scale = scroll_scale
        self.stop_event = stop_event
        self.error: Optional[BaseException] = None

    def run(self) -> None:
        try:
            logging.info("Starting touchpad server on %s:%s (tray mode)", self.host, self.port)
            asyncio_run = getattr(asyncio, "run", None)
            if asyncio_run is None:  # pragma: no cover - Python <3.7 safety
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                loop.run_until_complete(serve(self.host, self.port, self.scroll_scale, self.stop_event))
            else:
                asyncio_run(serve(self.host, self.port, self.scroll_scale, self.stop_event))
        except Exception as err:  # pragma: no cover - background thread guard
            self.error = err
            logging.exception("Touchpad server stopped with an error")
            self.stop_event.set()


class DaemonIcon(pystray.Icon):
    """pystray Icon with daemonized message loop thread to avoid lingering processes."""

    def run_detached(self, setup=None) -> None:
        self._start_setup(setup)
        threading.Thread(target=lambda: self._run(), daemon=True).start()


class TrayApp:
    def __init__(self, host: str, port: int, scroll_scale: float) -> None:
        self.host = host
        self.port = port
        self.scroll_scale = scroll_scale

        self.root = tk.Tk()
        self.root.withdraw()
        self.root.title("Touchpad server")

        self.stop_event = threading.Event()
        self.log_queue: "queue.Queue[str]" = queue.Queue(maxsize=QUEUE_LIMIT)
        self.log_file = get_log_file()
        self.tray_image = self._create_image()
        self.tk_icon = ImageTk.PhotoImage(self.tray_image.resize((32, 32), Image.LANCZOS))
        self.root.iconphoto(True, self.tk_icon)
        self.log_window = LogWindow(self.root, self.log_queue, self.log_file, icon_photo=self.tk_icon)
        self.icon: Optional[pystray.Icon] = None
        self.server_thread = ServerThread(self.host, self.port, self.scroll_scale, self.stop_event)
        self.update_check_running = False
        self.update_timer: Optional[str] = None
        self.notified_server_version: Optional[str] = None
        self.latest_release_url = LATEST_RELEASE_URL

        self._attach_log_handlers()

    def run(self) -> None:
        hide_console_window()
        logging.info("Touchpad server version %s", APP_VERSION)
        self.server_thread.start()
        self.icon = self._build_icon()
        self.icon.run_detached()
        self._schedule_update_check(UPDATE_CHECK_INITIAL_DELAY_MS)
        self.root.mainloop()
        self._shutdown()

    def _attach_log_handlers(self) -> None:
        formatter = logging.Formatter(LOG_FORMAT)

        queue_handler = QueueHandler(self.log_queue)
        queue_handler.setLevel(logging.INFO)
        queue_handler.setFormatter(formatter)
        logging.getLogger().addHandler(queue_handler)

        try:
            self.log_file.parent.mkdir(parents=True, exist_ok=True)
            file_handler = logging.FileHandler(self.log_file, encoding="utf-8")
            file_handler.setLevel(logging.INFO)
            file_handler.setFormatter(formatter)
            logging.getLogger().addHandler(file_handler)
        except Exception:
            logging.exception("Could not set up log file %s", self.log_file)

    def _build_icon(self) -> pystray.Icon:
        menu = pystray.Menu(
            Item(lambda _: "Hide log window" if self.log_window.is_visible() else "Show log window", self._toggle_logs, default=True),
            Item("Check for updates", self._check_updates_now),
            Item("Open latest release", self._open_latest_release),
            Item("Quit", self._quit),
        )
        return DaemonIcon(
            "touchpad-server",
            self.tray_image,
            title=f"Touchpad server v{APP_VERSION} ({self.host}:{self.port})",
            menu=menu,
        )

    def _create_image(self, size: int = 64) -> Image.Image:
        image = Image.new("RGBA", (size, size), (28, 33, 45, 255))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((10, 10, size - 10, size - 10), radius=14, fill=(0, 173, 181, 255), outline=(255, 255, 255, 180), width=2)
        draw.line((18, size - 22, size - 18, size - 22), fill=(255, 255, 255, 220), width=3)
        draw.line((32, 22, 32, size - 22), fill=(255, 255, 255, 220), width=3)
        draw.line((size - 32, 22, size - 32, size - 22), fill=(255, 255, 255, 220), width=3)
        return image

    def _toggle_logs(self, icon: pystray.Icon, _: Item) -> None:
        self.root.after(0, self._do_toggle_logs)

    def _do_toggle_logs(self) -> None:
        if self.log_window.is_visible():
            self.log_window.hide()
        else:
            self.log_window.show()

    def _quit(self, icon: pystray.Icon, _: Item) -> None:
        self.root.after(0, self._stop)

    def _check_updates_now(self, icon: pystray.Icon, _: Item) -> None:
        self.root.after(0, lambda: self._start_update_check(notify_when_current=True, reschedule=False))

    def _open_latest_release(self, icon: pystray.Icon, _: Item) -> None:
        self.root.after(0, lambda: webbrowser.open(self.latest_release_url or LATEST_RELEASE_URL))

    def _schedule_update_check(self, delay_ms: int = UPDATE_CHECK_INTERVAL_MS) -> None:
        if self.stop_event.is_set():
            return
        if self.update_timer is not None:
            self.root.after_cancel(self.update_timer)
        self.update_timer = self.root.after(delay_ms, self._run_scheduled_update_check)

    def _run_scheduled_update_check(self) -> None:
        self.update_timer = None
        self._start_update_check(notify_when_current=False, reschedule=True)

    def _start_update_check(self, notify_when_current: bool, reschedule: bool) -> None:
        if self.update_check_running:
            if notify_when_current:
                self._notify("Touchpad server", "An update check is already running.")
            return
        self.update_check_running = True
        threading.Thread(
            target=self._run_update_check,
            args=(notify_when_current, reschedule),
            daemon=True,
        ).start()

    def _run_update_check(self, notify_when_current: bool, reschedule: bool) -> None:
        latest: Optional[dict[str, Any]] = None
        error: Optional[BaseException] = None
        try:
            latest = self._fetch_latest_server_update()
        except Exception as err:
            error = err
        self.root.after(0, lambda: self._finish_update_check(latest, error, notify_when_current, reschedule))

    def _fetch_latest_release(self) -> dict[str, Any]:
        request = urllib.request.Request(
            LATEST_RELEASE_API_URL,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": f"touchpad-server/{APP_VERSION}",
            },
        )
        with urllib.request.urlopen(request, timeout=UPDATE_CHECK_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8-sig"))

    def _fetch_latest_server_update(self) -> dict[str, Any]:
        release = self._fetch_latest_release()
        manifest_url = _release_asset_url(release, SERVER_VERSION_ASSET_NAME)
        update = {
            "release_tag": str(release.get("tag_name") or ""),
            "release_url": str(release.get("html_url") or LATEST_RELEASE_URL),
            "manifest_url": manifest_url,
            "server_version": "",
        }
        if not manifest_url:
            return update

        manifest = self._fetch_json(manifest_url)
        update["server_version"] = str(manifest.get("version") or "").strip()
        return update

    def _fetch_json(self, url: str) -> dict[str, Any]:
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": f"touchpad-server/{APP_VERSION}",
            },
        )
        with urllib.request.urlopen(request, timeout=UPDATE_CHECK_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8-sig"))

    def _finish_update_check(
        self,
        latest: Optional[dict[str, Any]],
        error: Optional[BaseException],
        notify_when_current: bool,
        reschedule: bool,
    ) -> None:
        self.update_check_running = False

        if reschedule and not self.stop_event.is_set():
            self._schedule_update_check()

        if error is not None:
            logging.info("Update check failed: %s", error)
            if notify_when_current:
                self._notify("Touchpad server", "Could not check for updates. See the log for details.")
            return

        if latest is None:
            return

        release_tag = str(latest.get("release_tag") or "")
        if not release_tag:
            logging.info("Update check returned no release tag.")
            return

        latest_url = str(latest.get("release_url") or LATEST_RELEASE_URL)
        self.latest_release_url = latest_url

        latest_server_version = str(latest.get("server_version") or "").strip()
        if not latest_server_version:
            logging.info(
                "Latest release %s does not include %s; skipping touchpad server update notification.",
                release_tag,
                SERVER_VERSION_ASSET_NAME,
            )
            if notify_when_current:
                self._notify("Touchpad server", "Latest release does not include touchpad server version information.")
            return

        if not _parse_version(APP_VERSION):
            logging.info("Current touchpad server version is unavailable; skipping update comparison.")
            if notify_when_current:
                self._notify("Touchpad server", "Could not determine the current touchpad server version.")
            return

        if not _parse_version(latest_server_version):
            logging.info("Latest touchpad server version is invalid: %s", latest_server_version)
            if notify_when_current:
                self._notify("Touchpad server", "Latest release has invalid touchpad server version information.")
            return

        if _is_newer_version(latest_server_version, APP_VERSION):
            logging.info("New touchpad server version available: %s (release %s)", latest_server_version, release_tag)
            if notify_when_current or self.notified_server_version != latest_server_version:
                self.notified_server_version = latest_server_version
                self._notify(
                    "Touchpad server update available",
                    f"Version {latest_server_version} is available. Open the tray menu and download the new touchpad-server.exe from the latest release.",
                )
            return

        logging.info(
            "No newer touchpad server version found (current %s, latest server %s, release %s).",
            APP_VERSION,
            latest_server_version,
            release_tag,
        )
        if notify_when_current:
            self._notify("Touchpad server", f"No newer version found. You are running {APP_VERSION}.")

    def _notify(self, title: str, message: str) -> None:
        if self.icon is not None and getattr(self.icon, "HAS_NOTIFICATION", False):
            try:
                self.icon.notify(message, title)
                return
            except Exception:
                logging.exception("Could not show tray notification")
        logging.info("%s: %s", title, message)

    def _stop(self) -> None:
        self.stop_event.set()
        if self.update_timer is not None:
            self.root.after_cancel(self.update_timer)
            self.update_timer = None
        self.log_window.destroy()
        if self.icon is not None:
            self.icon.visible = False
            self.icon.stop()
        self.root.quit()

    def _shutdown(self) -> None:
        self.stop_event.set()
        if self.server_thread.is_alive():
            self.server_thread.join(timeout=5)
        if self.icon is not None:
            try:
                self.icon.visible = False
                self.icon.stop()
            except Exception:
                pass
        self.log_window.destroy()
        self.root.destroy()
        sys.exit(0)


def _parse_version(value: str) -> tuple[int, ...]:
    base = value.strip().lower()
    if base.startswith("v"):
        base = base[1:]
    base = base.split("-", 1)[0]
    parts: list[int] = []
    for part in base.split("."):
        if not part.isdigit():
            return ()
        parts.append(int(part))
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)


def _is_newer_version(latest: str, current: str) -> bool:
    latest_parts = _parse_version(latest)
    current_parts = _parse_version(current)
    return bool(latest_parts and current_parts and latest_parts > current_parts)


def _release_asset_url(release: dict[str, Any], name: str) -> str:
    assets = release.get("assets")
    if not isinstance(assets, list):
        return ""
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        if asset.get("name") == name:
            return str(asset.get("browser_download_url") or "")
    return ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start the touchpad backend as a tray icon.")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address")
    parser.add_argument("--port", type=int, default=8765, help="TCP port")
    parser.add_argument("--scroll-scale", type=float, default=4.0, help="Pixels per wheel unit multiplier")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    app = TrayApp(args.host, args.port, args.scroll_scale)
    app.run()
