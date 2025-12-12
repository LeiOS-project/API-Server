FROM debian:stable-slim

RUN apt-get update && apt-get install -y curl ca-certificates openssl tar bash gpg

WORKDIR /opt/leios-api

COPY ./build/bin/leios-api-linux-x64-baseline /usr/local/bin/leios-api

RUN chmod u+x /usr/local/bin/leios-api

EXPOSE 12151/tcp

ENTRYPOINT ["leios-api"]
