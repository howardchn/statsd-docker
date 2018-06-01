FROM node:4.4.5

EXPOSE 8125/udp
EXPOSE 8126

ADD ./resources/statsd-0.8.0.tar.gz /usr/local/statsd/
WORKDIR /usr/local/statsd/statsd-0.8.0
COPY ./resources/logicmonitor-backend.js backends/
ENTRYPOINT [ "node", "stats.js", "statsd.conf.js" ]
