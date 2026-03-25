FROM docker.m.daocloud.io/library/node:20-alpine AS base

ARG APK_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/alpine
ARG NPM_REGISTRY=https://registry.npmmirror.com

ENV NEXT_TELEMETRY_DISABLED=1

RUN sed -i "s#https\\?://dl-cdn.alpinelinux.org/alpine#${APK_MIRROR}#g" /etc/apk/repositories
RUN apk add --no-cache libc6-compat
RUN npm config set registry "${NPM_REGISTRY}" && \
    yarn config set registry "${NPM_REGISTRY}" && \
    yarn config set network-timeout 600000 -g

WORKDIR /app

FROM base AS dev

ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["yarn", "dev", "--hostname", "0.0.0.0"]

FROM base AS deps

COPY package.json yarn.lock ./
COPY vendor ./vendor
RUN yarn install

FROM base AS builder

RUN apk add --no-cache git

ENV OPENAI_API_KEY=""
ENV GOOGLE_API_KEY=""
ENV CODE=""

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN yarn build

FROM base AS runner

RUN apk add --no-cache proxychains-ng

ENV PROXY_URL=""
ENV OPENAI_API_KEY=""
ENV GOOGLE_API_KEY=""
ENV CODE=""
ENV ENABLE_MCP=""

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/server ./.next/server

RUN mkdir -p /app/app/mcp && chmod 777 /app/app/mcp
COPY --from=builder /app/app/mcp/mcp_config.default.json /app/app/mcp/mcp_config.json

EXPOSE 3000

CMD if [ -n "$PROXY_URL" ]; then \
    export HOSTNAME="0.0.0.0"; \
    protocol=$(echo $PROXY_URL | cut -d: -f1); \
    host=$(echo $PROXY_URL | cut -d/ -f3 | cut -d: -f1); \
    port=$(echo $PROXY_URL | cut -d: -f3); \
    conf=/etc/proxychains.conf; \
    echo "strict_chain" > $conf; \
    echo "proxy_dns" >> $conf; \
    echo "remote_dns_subnet 224" >> $conf; \
    echo "tcp_read_time_out 15000" >> $conf; \
    echo "tcp_connect_time_out 8000" >> $conf; \
    echo "localnet 127.0.0.0/255.0.0.0" >> $conf; \
    echo "localnet ::1/128" >> $conf; \
    echo "[ProxyList]" >> $conf; \
    echo "$protocol $host $port" >> $conf; \
    cat /etc/proxychains.conf; \
    proxychains -f $conf node server.js; \
    else \
    node server.js; \
    fi
