#!/bin/sh

# Read port from HA options, fallback to 3000
if command -v bashio > /dev/null 2>&1; then
  PORT=$(bashio::config 'port' 2>/dev/null || echo 3000)
else
  # Parse options.json directly if bashio not available
  PORT=$(cat /data/options.json 2>/dev/null | grep -o '"port":[0-9]*' | grep -o '[0-9]*' || echo 3000)
fi

export DATA_DIR="/config"
export PORT="${PORT}"

echo "[FakturaApp] Starting on port ${PORT}"
echo "[FakturaApp] Data dir: ${DATA_DIR}"

cd /app
exec node server.js
