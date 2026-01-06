ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM ${BUILD_FROM}

SHELL ["/bin/ash", "-o", "pipefail", "-c"]
WORKDIR /opt/webos-bridge

# Install Python and create an isolated venv to avoid PEP 668 restrictions.
RUN apk add --no-cache python3 py3-virtualenv \
    && python3 -m venv /opt/webos-bridge/venv \
    && /opt/webos-bridge/venv/bin/pip install --no-cache-dir websockets==15.0.1

COPY webos_pointer_bridge.py ./webos_pointer_bridge.py
COPY run_addon.py ./run_addon.py
COPY run.sh ./run.sh

RUN chmod +x /opt/webos-bridge/run.sh

CMD ["/opt/webos-bridge/run.sh"]
