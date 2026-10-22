# 基础镜像保持官方名，加速由 mirror builder / daemon registry-mirrors 承担
# （coding-deploy.md 第 3 节第 10 条）；需要时 --build-arg ALPINE_IMAGE=... 覆盖。
ARG ALPINE_IMAGE=alpine:3.21
FROM ${ALPINE_IMAGE}

RUN sed -i 's#https\?://dl-cdn.alpinelinux.org/alpine#https://mirrors.aliyun.com/alpine#g' /etc/apk/repositories && \
    apk add --no-cache openssh-client sshpass

COPY docker/postgres-ssh-tunnel/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
