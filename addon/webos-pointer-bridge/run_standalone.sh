#!/usr/bin/env sh
set -eu

if [ ! -f "${OPTIONS_PATH}" ]; then
    echo "Missing TV configuration: ${OPTIONS_PATH}" >&2
    echo "Mount a JSON file containing a 'tvs' array at /config/tvs.json." >&2
    exit 1
fi

mkdir -p "${KEYS_DIR}"
cd /opt/webos-bridge
exec python -u run_addon.py
