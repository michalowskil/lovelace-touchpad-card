#!/usr/bin/env sh
set -eu

cd /opt/webos-bridge
exec /opt/webos-bridge/venv/bin/python -u run_addon.py
