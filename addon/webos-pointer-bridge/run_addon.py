import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
if BACKEND_DIR.exists():
    sys.path.insert(0, str(BACKEND_DIR))

from webos_pointer_bridge import WebOSPointerBridge


DEFAULT_TV_PORT = 3001
DEFAULT_USE_SSL = True
DEFAULT_ORIGIN = None
DEFAULT_LISTEN_BASE = 8777
OPTIONS_PATH = Path("/data/options.json")
KEYS_DIR = Path("/data/keys")


def load_options() -> List[Dict[str, Any]]:
    raw = OPTIONS_PATH.read_text(encoding="utf-8")
    data = json.loads(raw)
    tvs = data.get("tvs") or []
    if not isinstance(tvs, list):
        raise ValueError("options.tvs must be a list")
    return tvs


def build_tv_configs(tvs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    configs: List[Dict[str, Any]] = []
    for idx, tv in enumerate(tvs):
        host = tv.get("host")
        if not host or not isinstance(host, str):
            raise ValueError(f"TV entry {idx} is missing a valid 'host'")

        name = tv.get("name") or f"tv{idx + 1}"
        listen_port = tv.get("listen_port")
        if not listen_port:
            listen_port = DEFAULT_LISTEN_BASE + idx

        tv_port = tv.get("tv_port") or DEFAULT_TV_PORT
        use_ssl = tv.get("use_ssl")
        if use_ssl is None:
            use_ssl = DEFAULT_USE_SSL
        origin = tv.get("origin")
        if origin is None:
            origin = DEFAULT_ORIGIN

        configs.append(
            {
                "name": name,
                "host": host,
                "listen_port": int(listen_port),
                "tv_port": int(tv_port),
                "use_ssl": bool(use_ssl),
                "origin": origin,
            }
        )
    return configs


async def run_bridge(tv_cfg: Dict[str, Any]) -> None:
    name = tv_cfg["name"]
    key_path = KEYS_DIR / f"{name}.json"
    key_path.parent.mkdir(parents=True, exist_ok=True)

    bridge = WebOSPointerBridge(
        tv_host=tv_cfg["host"],
        tv_port=tv_cfg["tv_port"],
        use_ssl=tv_cfg["use_ssl"],
        listen_host="0.0.0.0",
        listen_port=tv_cfg["listen_port"],
        client_key_file=key_path,
        origin=tv_cfg["origin"] or None,
    )

    while True:
        try:
            logging.info("Starting bridge for %s (ws://0.0.0.0:%s -> %s)", name, tv_cfg["listen_port"], tv_cfg["host"])
            await bridge.start()
        except asyncio.CancelledError:
            raise
        except Exception:
            logging.exception("Bridge for %s crashed; retrying in 5s", name)
            await asyncio.sleep(5)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    try:
        tvs_raw = load_options()
        configs = build_tv_configs(tvs_raw)
    except Exception:
        logging.exception("Failed to load add-on options")
        return

    if not configs:
        logging.warning("No TVs configured; nothing to do.")
        await asyncio.Future()
        return

    tasks = [asyncio.create_task(run_bridge(cfg)) for cfg in configs]

    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
