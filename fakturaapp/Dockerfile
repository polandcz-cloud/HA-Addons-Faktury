ARG BUILD_FROM
FROM ${BUILD_FROM}

WORKDIR /app

COPY package.json ./
RUN npm install --production --no-optional 2>&1 && npm cache clean --force

COPY server.js ./
COPY frontend/ ./frontend/

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
