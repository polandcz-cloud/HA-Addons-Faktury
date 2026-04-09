ARG ARG BUILD_FROM=ghcr.io/hassio-addons/base-nodejs:18.0.0
FROM $BUILD_FROM

# Přepnout na root
USER root

# Instalace potřebných balíků
RUN apk add --no-cache nodejs npm python3 make g++ bash

# Pracovní adresář
WORKDIR /app

# Kopírování všech souborů
COPY package.json ./
COPY server.js ./
COPY frontend/ ./frontend/
COPY run.sh /

# Instalace NodeJS balíků
RUN npm install --production

# Povolit spouštěcí skript
RUN chmod a+x /app/run.sh

# Start
CMD [ "/app/run.sh" ]
