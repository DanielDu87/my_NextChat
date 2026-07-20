FROM docker.m.daocloud.io/library/alpine:3.21

RUN sed -i 's#https\?://dl-cdn.alpinelinux.org/alpine#https://mirrors.aliyun.com/alpine#g' /etc/apk/repositories && \
    apk add --no-cache openssh-client sshpass

COPY docker/postgres-ssh-tunnel/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
