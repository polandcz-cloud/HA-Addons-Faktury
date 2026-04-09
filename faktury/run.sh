#!/usr/bin/with-contenv bashio
PORT=$(bashio::config 'port')
export DATA_DIR="/config"
export PORT="${PORT}"
bashio::log.info "Starting FakturaApp v2 on port ${PORT}..."
cd /app
exec node server.js
