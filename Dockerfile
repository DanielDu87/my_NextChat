FROM node:18-alpine AS base

ARG ALPINE_MIRROR=""
ARG NPM_REGISTRY="https://registry.npmmirror.com/"
ARG RT_CLIENT_TGZ_URL="https://github.com/Azure-Samples/aoai-realtime-audio-sdk/releases/download/js/v0.5.0/rt-client-0.5.0.tgz"
ARG DEFAULT_RT_CLIENT_TGZ_URL="https://github.com/Azure-Samples/aoai-realtime-audio-sdk/releases/download/js/v0.5.0/rt-client-0.5.0.tgz"

RUN if [ -n "$ALPINE_MIRROR" ]; then \
    sed -i "s|https\?://dl-cdn.alpinelinux.org/alpine|$ALPINE_MIRROR|g" /etc/apk/repositories; \
    fi

FROM base AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json yarn.lock ./

RUN if [ "$RT_CLIENT_TGZ_URL" != "$DEFAULT_RT_CLIENT_TGZ_URL" ]; then \
    sed -i "s|$DEFAULT_RT_CLIENT_TGZ_URL|$RT_CLIENT_TGZ_URL|g" package.json yarn.lock; \
    fi \
  && HUSKY=0 yarn config set registry "$NPM_REGISTRY" \
  && HUSKY=0 yarn install --frozen-lockfile --non-interactive

FROM base AS builder

RUN apk update && apk add --no-cache git

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=1536
ENV OPENAI_API_KEY=""
ENV GOOGLE_API_KEY=""
ENV CODE=""

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
