ARG NODE_IMAGE="node:18-alpine"
FROM ${NODE_IMAGE} AS base

ARG NODE_IMAGE
ARG ALPINE_MIRROR=""
ARG NPM_REGISTRY="https://registry.npmmirror.com/"
ARG RT_CLIENT_TGZ_URL="file:vendor/rt-client-0.5.0.tgz"
ARG DEFAULT_RT_CLIENT_TGZ_URL="file:vendor/rt-client-0.5.0.tgz"
ARG YARN_NETWORK_TIMEOUT="600000"
ARG SASS_BINARY_SITE=""
ARG ELECTRON_MIRROR=""
ARG PLAYWRIGHT_DOWNLOAD_HOST=""
ARG PUPPETEER_DOWNLOAD_HOST=""
ARG CYPRESS_DOWNLOAD_MIRROR=""
ARG NODEJS_ORG_MIRROR=""

ENV SASS_BINARY_SITE="${SASS_BINARY_SITE}" \
    ELECTRON_MIRROR="${ELECTRON_MIRROR}" \
    PLAYWRIGHT_DOWNLOAD_HOST="${PLAYWRIGHT_DOWNLOAD_HOST}" \
    PUPPETEER_DOWNLOAD_HOST="${PUPPETEER_DOWNLOAD_HOST}" \
    CYPRESS_DOWNLOAD_MIRROR="${CYPRESS_DOWNLOAD_MIRROR}" \
    NODEJS_ORG_MIRROR="${NODEJS_ORG_MIRROR}"

RUN if [ -n "$ALPINE_MIRROR" ]; then \
    sed -i "s|https\?://dl-cdn.alpinelinux.org/alpine|$ALPINE_MIRROR|g" /etc/apk/repositories; \
    fi

FROM base AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json yarn.lock ./
COPY vendor ./vendor

RUN if [ "$RT_CLIENT_TGZ_URL" != "$DEFAULT_RT_CLIENT_TGZ_URL" ]; then \
    sed -i "s|$DEFAULT_RT_CLIENT_TGZ_URL|$RT_CLIENT_TGZ_URL|g" package.json yarn.lock; \
    fi \
  && HUSKY=0 yarn config set registry "$NPM_REGISTRY" \
  && HUSKY=0 yarn config set network-timeout "$YARN_NETWORK_TIMEOUT" \
  && HUSKY=0 yarn install --frozen-lockfile --non-interactive

FROM base AS builder

RUN apk update && apk add --no-cache git

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=1536
ENV OPENAI_API_KEY=""
ENV GOOGLE_API_KEY=""
ENV CODE=""
ENV ENABLE_GOOGLE_FONTS="false"
ENV ENABLE_SHAREGPT="false"
ENV SHAREGPT_URL=""
ENV MCP_MARKET_URL=""
ENV ENABLE_EDGE_TTS="false"
ENV EDGE_TTS_VOICES_URL=""
ENV EDGE_TTS_WSS_URL=""

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN yarn build

FROM base AS runner
WORKDIR /app

ENV OPENAI_API_KEY=""
ENV GOOGLE_API_KEY=""
ENV CODE=""
ENV ENABLE_MCP=""
ENV ENABLE_GOOGLE_FONTS="false"
ENV ENABLE_SHAREGPT="false"
ENV SHAREGPT_URL=""
ENV MCP_MARKET_URL=""
ENV ENABLE_EDGE_TTS="false"
ENV EDGE_TTS_VOICES_URL=""
ENV EDGE_TTS_WSS_URL=""
ENV DATABASE_URL=""
ENV PGHOST=""
ENV PGPORT="5432"
ENV PGDATABASE=""
ENV PGUSER=""
ENV PGPASSWORD=""
ENV PGSSL=""
ENV PGPOOL_MAX="10"
ENV PG_CONNECT_TIMEOUT_MS="10000"
ENV PG_IDLE_TIMEOUT_MS="30000"
ENV WEBDAV_BASE_URL=""
ENV WEBDAV_USERNAME=""
ENV WEBDAV_PASSWORD=""

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/server ./.next/server

RUN mkdir -p /app/app/mcp && chmod 777 /app/app/mcp
COPY --from=builder /app/app/mcp/mcp_config.default.json /app/app/mcp/mcp_config.json

EXPOSE 3000

CMD ["node", "server.js"]
