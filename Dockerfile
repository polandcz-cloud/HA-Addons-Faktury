ARG BUILD_FROM
FROM $BUILD_FROM

RUN apk add --no-cache nodejs npm python3 make g++

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ./
COPY frontend/ ./frontend/
COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
