"""
Simple WebSocket listener that injects mouse events on Windows using SendInput.

Messages expected from the Lovelace card (JSON):
  { "t": "move", "dx": <float>, "dy": <float> }
  { "t": "scroll", "dx": <float>, "dy": <float> }
  { "t": "click" }
  { "t": "double_click" }
  { "t": "right_click" }
  { "t": "down" }
  { "t": "up" }

Run: python ws_touchpad.py --host 0.0.0.0 --port 8765
"""

import argparse
import asyncio
import json
import logging
from typing import Any, Dict

import websockets
from websockets.exceptions import ConnectionClosedError, ConnectionClosedOK
from websockets.server import WebSocketServerProtocol

try:
    import ctypes
    import ctypes.wintypes as wintypes
except ImportError as err:  # pragma: no cover - platform guard
    raise SystemExit("This script must run on Windows (ctypes and wintypes required)") from err

ULONG_PTR = getattr(wintypes, "ULONG_PTR", ctypes.c_size_t)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
# Silence websockets' own per-connection INFO spam; we log our own events.
logging.getLogger("websockets.server").setLevel(logging.WARNING)
logging.getLogger("websockets.client").setLevel(logging.WARNING)

# Constants for SendInput
INPUT_MOUSE = 0
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_WHEEL = 0x0800
MOUSEEVENTF_HWHEEL = 0x01000
WHEEL_DELTA = 120
KEYEVENTF_KEYUP = 0x0002
VK_CONTROL = 0x11


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("union", _INPUTUNION)]


SendInput = ctypes.windll.user32.SendInput
keybd_event = ctypes.windll.user32.keybd_event


def _send_mouse_input(flags: int, dx: int = 0, dy: int = 0, data: int = 0) -> None:
    mi = MOUSEINPUT(dx, dy, data, flags, 0, 0)
    inp = INPUT(INPUT_MOUSE, _INPUTUNION(mi))
    result = SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))
    if result != 1:
        logging.warning("SendInput failed (%s)", ctypes.GetLastError())


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

    def wake(self) -> None:
        # Try both a small mouse wiggle and a modifier key tap to break screensavers/lock screens.
        _send_mouse_input(MOUSEEVENTF_MOVE, 2, 0)
        _send_mouse_input(MOUSEEVENTF_MOVE, -2, 0)
        keybd_event(VK_CONTROL, 0, 0, 0)
        keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)


async def handle_client(ws: WebSocketServerProtocol, injector: InputInjector) -> None:
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
            elif msg_type == "wake":
                injector.wake()
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


async def main(host: str, port: int, scroll_scale: float) -> None:
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
        await asyncio.Future()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WebSocket to SendInput bridge for the touchpad card.")
    parser.add_argument("--host", default="0.0.0.0", help="Bind address")
    parser.add_argument("--port", type=int, default=8765, help="TCP port")
    parser.add_argument("--scroll-scale", type=float, default=4.0, help="Pixels per wheel unit multiplier")
    args = parser.parse_args()

    asyncio.run(main(args.host, args.port, args.scroll_scale))
