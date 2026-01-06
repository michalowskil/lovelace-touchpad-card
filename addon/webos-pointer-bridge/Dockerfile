ARG BUILD_FROM=python:3.11-slim
FROM ${BUILD_FROM}

WORKDIR /opt/webos-bridge

RUN pip install --no-cache-dir websockets==15.0.1

COPY backend/webos_pointer_bridge.py ./webos_pointer_bridge.py
COPY addon/webos-pointer-bridge/run_addon.py ./run_addon.py
COPY addon/webos-pointer-bridge/run.sh ./run.sh

RUN chmod +x /opt/webos-bridge/run.sh

CMD ["/opt/webos-bridge/run.sh"]
