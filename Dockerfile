# syntax=docker/dockerfile:1
# =============================================================================
# NextChat Dockerfile - 优化版
# 支持本地开发热加载和服务器生产部署
# =============================================================================

# 国内镜像源配置（可覆盖）
FROM docker.1panel.live/library/node:20-alpine AS base

ARG APK_MIRROR=https://mirrors.tuna.tsinghua.edu.cn/alpine
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG NODE_OPTIONS=--max-old-space-size=4096

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=${NODE_OPTIONS}

WORKDIR /app

# 一次性配置所有源和安装基础包（减少层数）
RUN set -eux; \
    sed -i "s#https\\?://dl-cdn.alpinelinux.org/alpine#${APK_MIRROR}#g" /etc/apk/repositories && \
    apk add --no-cache libc6-compat git && \
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

# 先复制依赖定义文件（利用 Docker 层缓存）
COPY package.json yarn.lock ./
COPY vendor ./vendor
COPY .npmrc ./

# 使用 npm ci 替代 yarn install（更快更可靠）
RUN npm ci --prefer-offline --no-audit

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
FROM docker.1panel.live/library/node:20-alpine AS runner

# 生产环境变量
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PROXY_URL="" \
    OPENAI_API_KEY="" \
    GOOGLE_API_KEY="" \
    CODE="" \
    ENABLE_MCP=""

# 安装运行时依赖
RUN apk add --no-cache proxychains-ng dumb-init

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
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
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
