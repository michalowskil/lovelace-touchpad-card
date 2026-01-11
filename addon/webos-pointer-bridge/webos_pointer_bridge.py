"""
https://michalowskil.github.io/lovelace-touchpad-card/
LICENSE: CC BY-NC-ND 4.0

Minimal pointer bridge for LG webOS.

This opens a local WebSocket server that accepts the same messages as the
touchpad card (move/scroll/click) and forwards them to the TV's pointer socket.

Usage (example):
    python backend/webos_pointer_bridge.py --tv-host 192.168.0.6 --listen-port 8777 --use-ssl --tv-port 3001 --origin --client-key-file backend/webos_client_key_sypialnia.json

    python backend/webos_pointer_bridge.py --tv-host 192.168.0.129 --listen-port 8778 --use-ssl --tv-port 3001 --origin --client-key-file backend/webos_client_key_salon.json

On first run the TV will prompt for pairing. The returned client-key is cached
in webos_client_key.json next to this script.
"""

import argparse
import asyncio
import json
import logging
import math
import ssl
from pathlib import Path
from typing import Optional

import websockets
from websockets.client import ClientConnection
from websockets.exceptions import ConnectionClosed, InvalidMessage
from websockets.server import ServerConnection

POINTER_URI = "ssap://com.webos.service.networkinput/getPointerInputSocket"
IME_URI = "ssap://com.webos.service.ime/registerRemoteKeyboard"
# webOS pointer socket becomes non-linear with large deltas; keep packets small.
MAX_POINTER_DELTA = 40
MAX_POINTER_CHUNKS = 64
SCROLL_SCALE = 0.005


class WebOSPointerBridge:
    def __init__(
        self,
        tv_host: str,
        tv_port: int,
        use_ssl: bool,
        listen_host: str,
        listen_port: int,
        client_key_file: Path,
        origin: Optional[str],
    ) -> None:
        self.tv_host = tv_host
        self.tv_port = tv_port
        self.use_ssl = use_ssl
        self.listen_host = listen_host
        self.listen_port = listen_port
        self.client_key_file = client_key_file
        self.origin = origin

        self.client_key: Optional[str] = None
        self.session_ws: Optional[ClientConnection] = None
        self.pointer_ws: Optional[ClientConnection] = None
        self.ime_ws: Optional[ClientConnection] = None
        self._ime_failed = False
        self._connect_lock = asyncio.Lock()
        self._scroll_rem_x = 0.0
        self._scroll_rem_y = 0.0

    async def start(self) -> None:
        self._load_client_key()
        await self.ensure_pointer()
        server = await websockets.serve(self._handle_client, self.listen_host, self.listen_port)
        logging.info("Listening for touchpad clients on ws://%s:%s", self.listen_host, self.listen_port)
        async with server:
            await asyncio.Future()  # run forever

    async def _handle_client(self, ws: ServerConnection) -> None:
        logging.info("Client connected: %s", ws.remote_address)
        try:
            async for raw in ws:
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                msg_type = data.get("t")
                if msg_type == "move":
                    dx = float(data.get("dx", 0))
                    dy = float(data.get("dy", 0))
                    await self._send_move(dx, dy)
                elif msg_type == "scroll":
                    dx = float(data.get("dx", 0))
                    dy = float(data.get("dy", 0))
                    await self._send_scroll(dx, dy)
                elif msg_type == "click":
                    await self._send_click()
                elif msg_type == "double_click":
                    await self._send_click()
                    await asyncio.sleep(0.08)
                    await self._send_click()
                elif msg_type == "text":
                    text = data.get("text", "")
                    if isinstance(text, str) and text:
                        await self._send_text(text)
                elif msg_type == "key":
                    key = data.get("key")
                    if isinstance(key, str):
                        await self._send_key(key)
                elif msg_type == "volume":
                    action = data.get("action")
                    if isinstance(action, str):
                        await self._send_volume(action)
                else:
                    logging.debug("Unsupported message type from client: %s", msg_type)
        except ConnectionClosed:
            logging.info("Client disconnected: %s", ws.remote_address)

    async def _send_pointer(self, payload: str) -> None:
        await self.ensure_pointer()
        if not self.pointer_ws:
            raise ConnectionError("Pointer socket not available")
        try:
            await self.pointer_ws.send(payload)
        except Exception:
            logging.exception("Failed to send pointer payload")
            await self._teardown_pointer()

    def _chunk_pointer_delta(self, dx: float, dy: float) -> list[tuple[int, int]]:
        target_dx = int(round(dx))
        target_dy = int(round(dy))
        max_axis = max(abs(target_dx), abs(target_dy))
        steps = max(1, min(MAX_POINTER_CHUNKS, int(math.ceil(max_axis / MAX_POINTER_DELTA)))) if max_axis else 1
        if steps == 1:
            return [(target_dx, target_dy)]

        # Spread the total delta across a few smaller packets to keep webOS in its linear range.
        chunks: list[tuple[int, int]] = []
        prev_x = prev_y = 0
        for i in range(1, steps + 1):
            next_x = int(round(target_dx * i / steps))
            next_y = int(round(target_dy * i / steps))
            chunk_x = next_x - prev_x
            chunk_y = next_y - prev_y
            if chunk_x != 0 or chunk_y != 0:
                chunks.append((chunk_x, chunk_y))
            prev_x, prev_y = next_x, next_y
        return chunks or [(0, 0)]

    async def _send_move(self, dx: float, dy: float) -> None:
        for chunk_dx, chunk_dy in self._chunk_pointer_delta(dx, dy):
            cmd = f"type:move\ndx:{chunk_dx}\ndy:{chunk_dy}\n\n"
            await self._send_pointer(cmd)

    async def _send_scroll(self, dx: float, dy: float) -> None:
        # webOS scroll is very sensitive; downscale and accumulate to keep motion smooth.
        self._scroll_rem_x += dx * SCROLL_SCALE
        self._scroll_rem_y += dy * SCROLL_SCALE

        scaled_dx = int(round(self._scroll_rem_x))
        scaled_dy = int(round(self._scroll_rem_y))

        self._scroll_rem_x -= scaled_dx
        self._scroll_rem_y -= scaled_dy

        if scaled_dx == 0 and scaled_dy == 0:
            return

        for chunk_dx, chunk_dy in self._chunk_pointer_delta(scaled_dx, scaled_dy):
            cmd = f"type:scroll\ndx:{chunk_dx}\ndy:{chunk_dy}\n\n"
            await self._send_pointer(cmd)

    async def _send_click(self) -> None:
        await self._send_pointer("type:click\n\n")

    async def _send_text(self, text: str) -> None:
        await self.ensure_pointer()
        if await self._send_text_ime(text):
            return
        if await self._send_text_request(text):
            return
        safe = text.replace("\n", "\\n")
        await self._send_pointer(f"type:text\ntext:{safe}\n\n")

    async def _send_text_request(self, text: str) -> bool:
        if not self.session_ws:
            return False
        try:
            msg = {
                "id": "ime_insert",
                "type": "request",
                "uri": "ssap://com.webos.service.ime/insertText",
                "payload": {"text": text},
            }
            await self.session_ws.send(json.dumps(msg))
            resp_raw = await self.session_ws.recv()
            resp = json.loads(resp_raw)
            if resp.get("type") == "response" and resp.get("payload", {}).get("returnValue"):
                return True
        except Exception:
            logging.debug("Direct IME insertText failed", exc_info=True)
        return False

    async def _send_ime_delete(self, count: int = 1) -> bool:
        if not self.session_ws:
            return False
        try:
            msg = {
                "id": "ime_delete",
                "type": "request",
                "uri": "ssap://com.webos.service.ime/deleteCharacters",
                "payload": {"count": count},
            }
            await self.session_ws.send(json.dumps(msg))
            resp_raw = await self.session_ws.recv()
            resp = json.loads(resp_raw)
            return bool(resp.get("type") == "response" and resp.get("payload", {}).get("returnValue"))
        except Exception:
            logging.debug("Direct IME deleteCharacters failed", exc_info=True)
            return False

    async def _send_text_ime(self, text: str) -> bool:
        await self.ensure_ime()
        if not self.ime_ws:
            return False
        try:
            await self.ime_ws.send(json.dumps({"type": "insertText", "text": text}))
            return True
        except Exception:
            logging.exception("IME send failed; falling back to pointer socket")
            await self._teardown_ime()
            return False

    async def _send_button(self, name: str | list[str]) -> None:
        if isinstance(name, list):
            for n in name:
                await self._send_button(n)
            return
        await self._send_pointer(f"type:button\nname:{name}\n\n")

    async def _send_key(self, key: str) -> None:
        if key == "backspace":
            # Try IME delete before falling back to BACKSPACE button.
            if await self._send_ime_delete(1):
                return
        key_map = {
            "enter": "ENTER",
            "backspace": "BACKSPACE",
            "escape": "BACK",
            "back": "BACK",
            "tab": "TAB",
            "space": "SPACE",
            "delete": "BACKSPACE",
            "arrow_left": "LEFT",
            "arrow_right": "RIGHT",
            "arrow_up": "UP",
            "arrow_down": "DOWN",
            "home": "HOME",
            "end": "END",
            "page_up": "PAGEUP",
            "page_down": "PAGEDOWN",
            "power": "POWER",
            "settings": "MENU",
        }
        name = key_map.get(key)
        if not name:
            logging.debug("Unsupported key command for webOS: %s", key)
            return
        await self._send_button(name)

    async def _send_volume(self, action: str) -> None:
        vol_map = {"up": "VOLUMEUP", "down": "VOLUMEDOWN", "mute": "MUTE"}
        name = vol_map.get(action)
        if not name:
            logging.debug("Unsupported volume action for webOS: %s", action)
            return
        await self._send_button(name)

    async def ensure_pointer(self) -> None:
        async with self._connect_lock:
            if self.pointer_ws and not self._is_closed(self.pointer_ws):
                return
            await self._teardown_pointer()
            self._ime_failed = False
            await self._connect_pointer()
            await self._connect_ime()

    async def ensure_ime(self) -> None:
        async with self._connect_lock:
            if self._ime_failed:
                return
            if self.ime_ws and not self._is_closed(self.ime_ws):
                return
            await self._connect_ime()

    async def _connect_pointer(self) -> None:
        async def _open_session(use_ssl: bool, port: int):
            uri = f"{'wss' if use_ssl else 'ws'}://{self.tv_host}:{port}"
            ssl_ctx = ssl._create_unverified_context() if use_ssl else None
            logging.info("Connecting to webOS at %s", uri)
            kwargs = {"ssl": ssl_ctx}
            origin_header = self._origin_header(send_default=False)
            if origin_header:
                kwargs["origin"] = origin_header
            return await websockets.connect(uri, **kwargs)

        session_use_ssl = self.use_ssl
        session_port = self.tv_port
        try:
            self.session_ws = await _open_session(session_use_ssl, session_port)
        except (InvalidMessage, ConnectionRefusedError, OSError) as err:
            if session_use_ssl:
                raise
            # Fallback: many TVs require wss on 3001; try that automatically.
            fallback_port = 3001 if session_port == 3000 else session_port + 1
            logging.warning("Plain WS failed (%s); retrying with wss on port %s", err, fallback_port)
            session_use_ssl = True
            session_port = fallback_port
            self.session_ws = await _open_session(session_use_ssl, session_port)

        await self._register()
        socket_path = await self._get_pointer_socket()
        if not socket_path:
            raise ConnectionError("No pointer socket path returned by TV")

        ptr_ssl = ssl._create_unverified_context() if socket_path.startswith("wss://") else None
        origin_header = self._origin_header()
        if origin_header:
            self.pointer_ws = await websockets.connect(socket_path, ssl=ptr_ssl, origin=origin_header)
        else:
            self.pointer_ws = await websockets.connect(socket_path, ssl=ptr_ssl)
        logging.info("Pointer socket established: %s", socket_path)

    async def _connect_ime(self) -> None:
        if not self.session_ws:
            return
        msg = {"id": "ime_0", "type": "request", "uri": IME_URI}
        try:
            await self.session_ws.send(json.dumps(msg))
            resp_raw = await self.session_ws.recv()
            resp = json.loads(resp_raw)
            socket_path = resp.get("payload", {}).get("socketPath")
            if not socket_path:
                logging.info("IME socket not provided by TV.")
                return
            ssl_ctx = ssl._create_unverified_context() if socket_path.startswith("wss://") else None
            origin_header = self._origin_header()
            if origin_header:
                self.ime_ws = await websockets.connect(socket_path, ssl=ssl_ctx, origin=origin_header)
            else:
                self.ime_ws = await websockets.connect(socket_path, ssl=ssl_ctx)
            logging.info("IME socket established: %s", socket_path)
        except Exception:
            if not self._ime_failed:
                logging.info("IME socket not available; text will use pointer socket.")
            self._ime_failed = True
            self.ime_ws = None

    async def _register(self) -> None:
        payload = {
            "forcePairing": False,
            "pairingType": "PROMPT",
            "manifest": {
                "manifestVersion": 1,
                "appId": "com.codex.touchpad",
                "vendorId": "com.codex",
                "localizedAppNames": {"": "Touchpad Pointer Bridge"},
                "permissions": [
                    "LAUNCH",
                    "CONTROL_INPUT_TEXT",
                    "CONTROL_MOUSE_AND_KEYBOARD",
                    "READ_INSTALLED_APPS",
                ],
                "serial": "0000",
            },
        }
        if self.client_key:
            payload["client-key"] = self.client_key

        msg = {"id": "register_0", "type": "register", "payload": payload}
        await self.session_ws.send(json.dumps(msg))

        while True:
            resp_raw = await self.session_ws.recv()
            resp = json.loads(resp_raw)
            if resp.get("type") == "registered":
                new_key = resp.get("payload", {}).get("client-key")
                if new_key and new_key != self.client_key:
                    self.client_key = new_key
                    self._save_client_key(new_key)
                    logging.info("Paired and saved client key.")
                return

            # PROMPT response means the TV is showing a pairing prompt; wait for the follow-up.
            if resp.get("type") == "response" and resp.get("payload", {}).get("pairingType") == "PROMPT":
                logging.info("Awaiting user approval on TV...")
                continue

            raise ConnectionError(f"Register failed: {resp}")

    async def _get_pointer_socket(self) -> str:
        msg = {"id": "pointer_0", "type": "request", "uri": POINTER_URI}
        await self.session_ws.send(json.dumps(msg))
        resp_raw = await self.session_ws.recv()
        resp = json.loads(resp_raw)
        return resp.get("payload", {}).get("socketPath", "")

    async def _teardown_pointer(self) -> None:
        if self.pointer_ws:
            try:
                await self.pointer_ws.close()
            except Exception:
                pass
        if self.ime_ws:
            try:
                await self.ime_ws.close()
            except Exception:
                pass
        if self.session_ws:
            try:
                await self.session_ws.close()
            except Exception:
                pass
        self.pointer_ws = None
        self.ime_ws = None
        self.session_ws = None
        self._ime_failed = False

    async def _teardown_ime(self) -> None:
        if self.ime_ws:
            try:
                await self.ime_ws.close()
            except Exception:
                pass
        self.ime_ws = None

    @staticmethod
    def _is_closed(conn: ClientConnection) -> bool:
        state = getattr(conn, "state", None)
        if state is not None:
            return str(state).lower().endswith("closed")
        return bool(getattr(conn, "closed", False) or getattr(conn, "closing_exc", None))

    def _origin_header(self, send_default: bool = True) -> str | None:
        if self.origin == "":
            return None
        if self.origin:
            return self.origin
        return "https://www.lge.com" if send_default else None

    def _load_client_key(self) -> None:
        if self.client_key_file.exists():
            try:
                data = json.loads(self.client_key_file.read_text(encoding="utf-8"))
                self.client_key = data.get("client-key")
                if self.client_key:
                    logging.info("Loaded cached client key.")
            except Exception:
                logging.warning("Failed to read client key file; will re-pair.")

    def _save_client_key(self, key: str) -> None:
        try:
            self.client_key_file.write_text(json.dumps({"client-key": key}), encoding="utf-8")
        except Exception:
            logging.warning("Failed to persist client key.", exc_info=True)


async def main() -> None:
    parser = argparse.ArgumentParser(description="Bridge touchpad events to LG webOS pointer socket.")
    parser.add_argument("--tv-host", required=True, help="IP/DNS of the LG webOS TV")
    parser.add_argument("--tv-port", type=int, default=3000, help="webOS websocket port (3000/ws or 3001/wss)")
    parser.add_argument("--use-ssl", action="store_true", help="Use wss:// (port 3001) instead of ws://")
    parser.add_argument(
        "--origin",
        nargs="?",
        const="",
        default=None,
        help="Origin header to send; provide empty/omit value to skip sending (some TVs reject unknown origins)",
    )
    parser.add_argument("--listen-host", default="0.0.0.0", help="Host/IP to bind for card websocket")
    parser.add_argument("--listen-port", type=int, default=8777, help="Port to bind for card websocket")
    parser.add_argument(
        "--client-key-file",
        type=Path,
        default=Path(__file__).with_name("webos_client_key.json"),
        help="Where to cache the TV client key",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    bridge = WebOSPointerBridge(
        tv_host=args.tv_host,
        tv_port=args.tv_port,
        use_ssl=args.use_ssl,
        listen_host=args.listen_host,
        listen_port=args.listen_port,
        client_key_file=args.client_key_file,
        origin=args.origin or None,
    )
    await bridge.start()


if __name__ == "__main__":
    asyncio.run(main())
