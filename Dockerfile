# # syntax=docker/dockerfile:1
# =============================================================================
# NextChat Dockerfile - 优化版
# 支持本地开发热加载和服务器生产部署
# =============================================================================

# 基础镜像使用官方 Alpine，并通过 apk 安装 Node 20 与 Yarn
FROM alpine:3.20 AS base

ARG APK_MIRROR=https://dl-cdn.alpinelinux.org/alpine
ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG NODE_OPTIONS=--max-old-space-size=4096
ARG ENABLE_GOOGLE_FONTS=false
ARG GITHUB_BASE_URL=https://github.com
ARG GITHUB_API_BASE_URL=https://api.github.com
ARG GITHUB_RAW_BASE_URL=https://raw.githubusercontent.com
ARG ENABLE_SHAREGPT=false
ARG SHAREGPT_URL=
ARG MCP_MARKET_URL=
ARG ENABLE_EDGE_TTS=false
ARG EDGE_TTS_VOICES_URL=
ARG EDGE_TTS_WSS_URL=
ARG DEFAULT_INPUT_TEMPLATE=
ARG NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=
ARG BUILD_COMMIT_DATE=unknown
ARG BUILD_COMMIT_HASH=unknown
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG ALL_PROXY
ARG http_proxy
ARG https_proxy
ARG all_proxy

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=${NODE_OPTIONS} \
    ENABLE_GOOGLE_FONTS=${ENABLE_GOOGLE_FONTS} \
    GITHUB_BASE_URL=${GITHUB_BASE_URL} \
    GITHUB_API_BASE_URL=${GITHUB_API_BASE_URL} \
    GITHUB_RAW_BASE_URL=${GITHUB_RAW_BASE_URL} \
    ENABLE_SHAREGPT=${ENABLE_SHAREGPT} \
    SHAREGPT_URL=${SHAREGPT_URL} \
    MCP_MARKET_URL=${MCP_MARKET_URL} \
    ENABLE_EDGE_TTS=${ENABLE_EDGE_TTS} \
    EDGE_TTS_VOICES_URL=${EDGE_TTS_VOICES_URL} \
    EDGE_TTS_WSS_URL=${EDGE_TTS_WSS_URL} \
    DEFAULT_INPUT_TEMPLATE=${DEFAULT_INPUT_TEMPLATE} \
    NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=${NEXT_PUBLIC_DEFAULT_SYNC_USER_ID} \
    BUILD_COMMIT_DATE=${BUILD_COMMIT_DATE} \
    BUILD_COMMIT_HASH=${BUILD_COMMIT_HASH} \
    HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    ALL_PROXY=${ALL_PROXY} \
    http_proxy=${http_proxy} \
    https_proxy=${https_proxy} \
    all_proxy=${all_proxy}

WORKDIR /app

# 一次性配置所有源和安装基础包（减少层数）
RUN set -eux; \
    sed -i "s#https\\?://dl-cdn.alpinelinux.org/alpine#${APK_MIRROR}#g" /etc/apk/repositories && \
    apk add --no-cache libc6-compat git nodejs npm yarn && \
    npm config set registry "${NPM_REGISTRY}" && \
    yarn config set registry "${NPM_REGISTRY}" && \
    yarn config set network-timeout 600000 -g && \
    # 创建 .npmrc 持久化配置
    echo "registry=${NPM_REGISTRY}" > .npmrc && \
    echo "fetch-retries=5" >> .npmrc && \
    echo "fetch-retry-mintimeout=20000" >> .npmrc && \
    echo "fetch-retry-maxtimeout=120000" >> .npmrc

FROM base AS dev

# 开发环境变量
ENV HOSTNAME=0.0.0.0 \
    NODE_ENV=development \
    WATCHPACK_POLLING=true

EXPOSE 3000

CMD ["yarn", "dev", "--hostname", "0.0.0.0"]

# =============================================================================
# 依赖安装阶段 - 优化缓存利用
# =============================================================================
FROM base AS deps

ENV HUSKY=0

# 先复制依赖定义文件（利用 Docker 层缓存）
COPY package.json yarn.lock ./
COPY vendor ./vendor

# 仓库仅维护 yarn.lock，生产构建统一使用 Yarn 安装依赖
RUN yarn install --frozen-lockfile --network-timeout 600000

# =============================================================================
# 构建阶段
# =============================================================================
FROM base AS builder

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# 复制已安装的依赖
COPY --from=deps /app/node_modules ./node_modules

# 复制源代码（最后复制，避免代码变更导致重新安装依赖）
COPY . .

# 构建应用
RUN yarn build && \
    # 清理不需要的文件减小镜像体积
    rm -rf node_modules/.cache && \
    yarn cache clean

# =============================================================================
# 生产运行阶段 - 轻量化
# =============================================================================
FROM alpine:3.20 AS runner

ARG APK_MIRROR=https://dl-cdn.alpinelinux.org/alpine
ARG BUILD_COMMIT_DATE=unknown
ARG BUILD_COMMIT_HASH=unknown
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG ALL_PROXY
ARG http_proxy
ARG https_proxy
ARG all_proxy

# 生产环境变量
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PROXY_URL="" \
    OPENAI_API_KEY="" \
    GOOGLE_API_KEY="" \
    CODE="" \
    ENABLE_MCP="" \
    BUILD_COMMIT_DATE=${BUILD_COMMIT_DATE} \
    BUILD_COMMIT_HASH=${BUILD_COMMIT_HASH} \
    HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    ALL_PROXY=${ALL_PROXY} \
    http_proxy=${http_proxy} \
    https_proxy=${https_proxy} \
    all_proxy=${all_proxy}

# 安装运行时依赖
RUN set -eux; \
    sed -i "s#https\\?://dl-cdn.alpinelinux.org/alpine#${APK_MIRROR}#g" /etc/apk/repositories && \
    apk add --no-cache nodejs proxychains-ng dumb-init

WORKDIR /app

# 从构建阶段复制必要文件
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/server ./.next/server

# MCP 配置
RUN mkdir -p /app/app/mcp && chmod 777 /app/app/mcp
COPY --from=builder /app/app/mcp/mcp_config.default.json /app/app/mcp/mcp_config.json

EXPOSE 3000

# 使用 dumb-init 启动（处理信号和僵尸进程）
ENTRYPOINT ["dumb-init", "--"]

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/config', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动命令（支持代理）
CMD if [ -n "$PROXY_URL" ]; then \
    protocol=$(echo $PROXY_URL | cut -d: -f1); \
    host=$(echo $PROXY_URL | cut -d/ -f3 | cut -d: -f1); \
    port=$(echo $PROXY_URL | cut -d: -f3); \
    conf=/etc/proxychains.conf; \
    echo "strict_chain" > $conf; \
    echo "proxy_dns" >> $conf; \
    echo "tcp_read_time_out 15000" >> $conf; \
    echo "tcp_connect_time_out 8000" >> $conf; \
    echo "[ProxyList]" >> $conf; \
    echo "$protocol $host $port" >> $conf; \
    proxychains -f $conf node server.js; \
    else \
    node server.js; \
    fi
