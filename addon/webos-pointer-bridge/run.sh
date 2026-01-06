#!/usr/bin/env sh
set -eu

cd /opt/webos-bridge
exec python -u run_addon.py
