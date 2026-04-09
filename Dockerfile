ARG BUILD_FROM
FROM $BUILD_FROM

# Přepnout na root
USER root

# Instalace potřebných balíků
RUN apk add --no-cache \
    nodejs \
    npm \
    python3 \
    make \
    g++ \
    sqlite-dev \
    bash

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
