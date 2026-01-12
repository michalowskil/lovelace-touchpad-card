"""
Tray launcher for the Windows touchpad backend.

Starts the WebSocket server in the background, adds a system tray icon,
and offers a small log window that can be shown/hidden without stopping
the server. Intended for autostart so no console window has to stay open.
"""

import argparse
import asyncio
import logging
import queue
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import scrolledtext
from typing import Optional

import pystray
from PIL import Image, ImageDraw, ImageTk
from pystray import MenuItem as Item

from ws_touchpad import serve

LOG_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"
QUEUE_LIMIT = 1000


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

        self._attach_log_handlers()

    def run(self) -> None:
        hide_console_window()
        self.server_thread.start()
        self.icon = self._build_icon()
        self.icon.run_detached()
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
            Item("Quit", self._quit),
        )
        return DaemonIcon(
            "touchpad-server",
            self.tray_image,
            title=f"Touchpad server ({self.host}:{self.port})",
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

    def _stop(self) -> None:
        self.stop_event.set()
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
