#!/usr/bin/env sh
set -eu

cd /opt/webos-bridge
exec python3 -u run_addon.py
