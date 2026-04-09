ARG BUILD_FROM
FROM ${BUILD_FROM}

# Install Node.js - no native build tools needed with sql.js
RUN apk add --no-cache nodejs npm

WORKDIR /app

# Copy and install deps
COPY package.json ./
RUN npm install --production 2>&1

# Copy app
COPY server.js ./
COPY frontend/ ./frontend/

# Copy run script
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
