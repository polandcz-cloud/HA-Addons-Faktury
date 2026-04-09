#!/bin/sh
set -e

# Read port from HA options
if [ -f /data/options.json ]; then
  PORT=$(cat /data/options.json | sed -n 's/.*"port":\([0-9]*\).*/\1/p')
fi
PORT=${PORT:-3000}

export DATA_DIR="/config"
export PORT="${PORT}"

echo "======================================="
echo "  FakturaApp v2.1 starting"
echo "  Port: ${PORT}"
echo "  Data: ${DATA_DIR}"
echo "======================================="

cd /app
exec node server.js
