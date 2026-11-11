#!/usr/bin/env sh
set -eu

python_path="${1:?Python executable path is required}"

cd /opt/webos-bridge
exec "${python_path}" -u run_addon.py
