ARG BUILD_FROM
FROM $BUILD_FROM

# Přepnout na root
USER root

# Instalace potřebných balíků
RUN apk add --no-cache nodejs npm python3 make g++ bash

# Pracovní adresář
WORKDIR /app

# Kopírování všech souborů
COPY . .

# Instalace NodeJS balíků
RUN npm install --production

# Povolit spouštěcí skript
RUN chmod a+x /app/run.sh

# Start
CMD [ "/app/run.sh" ]
