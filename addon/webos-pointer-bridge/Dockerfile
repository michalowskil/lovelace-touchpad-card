ARG BUILD_FROM=ghcr.io/home-assistant/{arch}-base:3.19
FROM ${BUILD_FROM}

SHELL ["/bin/ash", "-o", "pipefail", "-c"]
WORKDIR /opt/webos-bridge

RUN apk add --no-cache python3 py3-pip \
    && python3 -m pip install --no-cache-dir websockets==15.0.1

COPY webos_pointer_bridge.py ./webos_pointer_bridge.py
COPY run_addon.py ./run_addon.py
COPY run.sh ./run.sh

RUN chmod +x /opt/webos-bridge/run.sh

CMD ["/opt/webos-bridge/run.sh"]
