"""
https://michalowskil.github.io/lovelace-touchpad-card/
LICENSE: CC BY-NC-ND 4.0

Simple WebSocket listener that injects mouse events on Windows using SendInput.

Messages expected from the Lovelace card (JSON):
  { "t": "move", "dx": <float>, "dy": <float> }
  { "t": "scroll", "dx": <float>, "dy": <float> }
  { "t": "click" }
  { "t": "double_click" }
  { "t": "right_click" }
  { "t": "down" }
  { "t": "up" }

Run: python backend/ws_touchpad.py --host 0.0.0.0 --port 8765
"""

import argparse
import asyncio
import json
import logging
import threading
from contextlib import suppress
from typing import Any, Dict, Optional

import websockets
from websockets.exceptions import ConnectionClosedError, ConnectionClosedOK
from websockets.server import ServerConnection

try:
    import ctypes
    import ctypes.wintypes as wintypes
except ImportError as err:  # pragma: no cover - platform guard
    raise SystemExit("This script must run on Windows (ctypes and wintypes required)") from err

ULONG_PTR = getattr(wintypes, "ULONG_PTR", ctypes.c_size_t)
user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
# Silence websockets' own per-connection INFO spam; we log our own events.
logging.getLogger("websockets.server").setLevel(logging.WARNING)
logging.getLogger("websockets.client").setLevel(logging.WARNING)

# Constants for SendInput
INPUT_MOUSE = 0
INPUT_KEYBOARD = 1
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_WHEEL = 0x0800
MOUSEEVENTF_HWHEEL = 0x01000
WHEEL_DELTA = 120
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
UOI_NAME = 2
DESKTOP_READOBJECTS = 0x0001
DESKTOP_JOURNALPLAYBACK = 0x0020
DESKTOP_WRITEOBJECTS = 0x0080
DESKTOP_INPUT_ACCESS = DESKTOP_READOBJECTS | DESKTOP_JOURNALPLAYBACK | DESKTOP_WRITEOBJECTS
VK_VOLUME_MUTE = 0x00AD
VK_VOLUME_DOWN = 0x00AE
VK_VOLUME_UP = 0x00AF
KEY_MAP = {
    "enter": 0x000D,
    "backspace": 0x0008,
    "escape": 0x001B,
    "tab": 0x0009,
    "space": 0x0020,
    "delete": 0x002E,
    "arrow_left": 0x0025,
    "arrow_right": 0x0027,
    "arrow_up": 0x0026,
    "arrow_down": 0x0028,
    "home": 0x0024,
    "end": 0x0023,
    "page_up": 0x0021,
    "page_down": 0x0022,
}


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("union", _INPUTUNION)]


SendInput = user32.SendInput
SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
SendInput.restype = wintypes.UINT

OpenInputDesktop = user32.OpenInputDesktop
OpenInputDesktop.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
OpenInputDesktop.restype = wintypes.HANDLE

SetThreadDesktop = user32.SetThreadDesktop
SetThreadDesktop.argtypes = [wintypes.HANDLE]
SetThreadDesktop.restype = wintypes.BOOL

GetThreadDesktop = user32.GetThreadDesktop
GetThreadDesktop.argtypes = [wintypes.DWORD]
GetThreadDesktop.restype = wintypes.HANDLE

CloseDesktop = user32.CloseDesktop
CloseDesktop.argtypes = [wintypes.HANDLE]
CloseDesktop.restype = wintypes.BOOL

GetUserObjectInformationW = user32.GetUserObjectInformationW
GetUserObjectInformationW.argtypes = [
    wintypes.HANDLE,
    ctypes.c_int,
    ctypes.c_void_p,
    wintypes.DWORD,
    ctypes.POINTER(wintypes.DWORD),
]
GetUserObjectInformationW.restype = wintypes.BOOL

GetCurrentThreadId = kernel32.GetCurrentThreadId
GetCurrentThreadId.argtypes = []
GetCurrentThreadId.restype = wintypes.DWORD

_desktop_state = threading.local()


def _last_error() -> int:
    return ctypes.get_last_error()


def _desktop_name(handle: int) -> str:
    if not handle:
        return "<none>"

    needed = wintypes.DWORD(0)
    GetUserObjectInformationW(handle, UOI_NAME, None, 0, ctypes.byref(needed))
    if needed.value <= 0:
        return f"<unknown:{_last_error()}>"

    char_count = max(1, needed.value // ctypes.sizeof(ctypes.c_wchar))
    buffer = ctypes.create_unicode_buffer(char_count)
    buffer_ptr = ctypes.cast(buffer, ctypes.c_void_p)
    if not GetUserObjectInformationW(handle, UOI_NAME, buffer_ptr, needed.value, ctypes.byref(needed)):
        return f"<unknown:{_last_error()}>"
    return buffer.value


def _close_desktop(handle: int) -> None:
    if handle:
        with suppress(Exception):
            CloseDesktop(handle)


def _log_desktop_once(level: int, key: tuple[Any, ...], message: str, *args: Any) -> None:
    if getattr(_desktop_state, "last_log_key", None) == key:
        return
    _desktop_state.last_log_key = key
    logging.log(level, message, *args)


def _sync_to_input_desktop() -> bool:
    input_desktop = OpenInputDesktop(0, False, DESKTOP_INPUT_ACCESS)
    if not input_desktop:
        err = _last_error()
        _log_desktop_once(
            logging.WARNING,
            ("open-input-desktop", err),
            "OpenInputDesktop failed (%s); input may not reach the active desktop.",
            err,
        )
        return False

    input_name = _desktop_name(input_desktop)
    current_desktop = GetThreadDesktop(GetCurrentThreadId())
    current_name = _desktop_name(current_desktop)

    if current_name == input_name:
        _close_desktop(input_desktop)
        return True

    previous_owned = getattr(_desktop_state, "owned_desktop", None)
    if SetThreadDesktop(input_desktop):
        _desktop_state.owned_desktop = input_desktop
        _desktop_state.last_log_key = None
        logging.info("Input desktop changed: %s -> %s", current_name, input_name)
        if previous_owned:
            _close_desktop(previous_owned)
        return True

    err = _last_error()
    _close_desktop(input_desktop)
    _log_desktop_once(
        logging.WARNING,
        ("set-thread-desktop", current_name, input_name, err),
        "SetThreadDesktop failed (%s -> %s, error %s); input may not reach the active desktop.",
        current_name,
        input_name,
        err,
    )
    return False


def _send_mouse_input(flags: int, dx: int = 0, dy: int = 0, data: int = 0) -> None:
    _sync_to_input_desktop()
    mi = MOUSEINPUT(dx, dy, data, flags, 0, 0)
    inp = INPUT(INPUT_MOUSE, _INPUTUNION(mi))
    result = SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))
    if result != 1:
        logging.warning("SendInput failed (%s)", _last_error())


def _send_keyboard_input(vk: int, flags: int = 0, scan: int = 0) -> None:
    _sync_to_input_desktop()
    ki = KEYBDINPUT(vk, scan, flags, 0, 0)
    inp = INPUT(INPUT_KEYBOARD, _INPUTUNION(ki=ki))
    result = SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))
    if result != 1:
        logging.warning("SendInput (keyboard) failed (%s)", _last_error())


class InputInjector:
    def __init__(self, scroll_scale: float = 4.0) -> None:
        self.scroll_scale = scroll_scale
        self._scroll_rem_x = 0.0
        self._scroll_rem_y = 0.0

    def move(self, dx: float, dy: float) -> None:
        _send_mouse_input(MOUSEEVENTF_MOVE, int(round(dx)), int(round(dy)))

    def scroll(self, dx: float, dy: float) -> None:
        # Accumulate pixels into wheel ticks for smoothness
        self._scroll_rem_x += dx * self.scroll_scale
        self._scroll_rem_y += dy * self.scroll_scale

        steps_x = int(self._scroll_rem_x / WHEEL_DELTA)
        steps_y = int(self._scroll_rem_y / WHEEL_DELTA)

        self._scroll_rem_x -= steps_x * WHEEL_DELTA
        self._scroll_rem_y -= steps_y * WHEEL_DELTA

        if steps_y:
            _send_mouse_input(MOUSEEVENTF_WHEEL, data=int(steps_y * WHEEL_DELTA))
        if steps_x:
            _send_mouse_input(MOUSEEVENTF_HWHEEL, data=int(steps_x * WHEEL_DELTA))

    def click(self) -> None:
        _send_mouse_input(MOUSEEVENTF_LEFTDOWN)
        _send_mouse_input(MOUSEEVENTF_LEFTUP)

    def right_click(self) -> None:
        _send_mouse_input(MOUSEEVENTF_RIGHTDOWN)
        _send_mouse_input(MOUSEEVENTF_RIGHTUP)

    def left_down(self) -> None:
        _send_mouse_input(MOUSEEVENTF_LEFTDOWN)

    def left_up(self) -> None:
        _send_mouse_input(MOUSEEVENTF_LEFTUP)

    async def double_click(self) -> None:
        self.click()
        await asyncio.sleep(0.03)
        self.click()

    def type_text(self, text: str) -> None:
        for ch in text:
            if ch == "\n":
                self.press_key("enter")
                continue
            codepoint = ord(ch)
            _send_keyboard_input(0, scan=codepoint, flags=KEYEVENTF_UNICODE)
            _send_keyboard_input(0, scan=codepoint, flags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP)

    def press_key(self, key: str) -> None:
        vk = KEY_MAP.get(key)
        if vk is None:
            logging.warning("Unknown key command: %s", key)
            return
        _send_keyboard_input(vk)
        _send_keyboard_input(vk, flags=KEYEVENTF_KEYUP)

    def adjust_volume(self, action: str) -> None:
        vk_lookup = {
            "up": VK_VOLUME_UP,
            "down": VK_VOLUME_DOWN,
            "mute": VK_VOLUME_MUTE,
        }
        vk = vk_lookup.get(action)
        if vk is None:
            logging.warning("Unknown volume action: %s", action)
            return
        _send_keyboard_input(vk)
        _send_keyboard_input(vk, flags=KEYEVENTF_KEYUP)


async def handle_client(ws: ServerConnection, injector: InputInjector) -> None:
    logging.info("Client connected: %s", ws.remote_address)
    try:
        async for message in ws:
            try:
                data: Dict[str, Any] = json.loads(message)
            except json.JSONDecodeError:
                continue

            msg_type = data.get("t")
            if msg_type == "move":
                injector.move(float(data.get("dx", 0)), float(data.get("dy", 0)))
            elif msg_type == "scroll":
                injector.scroll(float(data.get("dx", 0)), float(data.get("dy", 0)))
            elif msg_type == "click":
                injector.click()
            elif msg_type == "double_click":
                await injector.double_click()
            elif msg_type == "right_click":
                injector.right_click()
            elif msg_type == "down":
                injector.left_down()
            elif msg_type == "up":
                injector.left_up()
            elif msg_type == "text":
                text = data.get("text", "")
                if isinstance(text, str) and text:
                    injector.type_text(text)
            elif msg_type == "key":
                key = data.get("key")
                if isinstance(key, str):
                    injector.press_key(key)
            elif msg_type == "volume":
                action = data.get("action")
                if isinstance(action, str):
                    injector.adjust_volume(action)
    except (ConnectionClosedError, ConnectionClosedOK) as err:
        logging.info(
            "Client closed: %s code=%s reason=%s",
            ws.remote_address,
            err.code,
            err.reason,
        )
    except Exception:
        logging.exception("Client handler error for %s", ws.remote_address)
    finally:
        logging.info(
            "Client disconnected: %s code=%s reason=%s",
            ws.remote_address,
            ws.close_code,
            ws.close_reason,
        )


async def serve(
    host: str,
    port: int,
    scroll_scale: float,
    stop_event: Optional[threading.Event] = None,
) -> None:
    injector = InputInjector(scroll_scale)
    async with websockets.serve(
        lambda ws: handle_client(ws, injector),
        host,
        port,
        max_queue=32,
        ping_interval=15,
        ping_timeout=15,
    ):
        logging.info("Touchpad WebSocket listening on %s:%s", host, port)
        if stop_event is None:
            await asyncio.Future()
        else:
            while not stop_event.is_set():
                await asyncio.sleep(0.5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WebSocket to SendInput bridge for the touchpad card.")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address")
    parser.add_argument("--port", type=int, default=8765, help="TCP port")
    parser.add_argument("--scroll-scale", type=float, default=4.0, help="Pixels per wheel unit multiplier")
    args = parser.parse_args()

    asyncio.run(serve(args.host, args.port, args.scroll_scale))
