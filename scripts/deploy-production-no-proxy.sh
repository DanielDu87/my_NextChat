#!/bin/sh

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
COMPOSE="$ROOT_DIR/scripts/docker-compose-safe.sh"
ENV_FILE="${ENV_FILE:-.env.docker}"
PROFILE="${PROFILE:-no-proxy}"
SERVICE="${SERVICE:-nextchat-production}"
CONTAINER="${CONTAINER:-nextchat}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"
ALPINE_MIRROR="${ALPINE_MIRROR:-https://mirrors.aliyun.com/alpine}"

cd "$ROOT_DIR"

log() {
  printf '[deploy] %s\n' "$*"
}

run_no_proxy() {
  env \
    HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= \
    http_proxy= https_proxy= all_proxy= \
    NPM_REGISTRY="$NPM_REGISTRY" \
    ALPINE_MIRROR="$ALPINE_MIRROR" \
    "$@"
}

if [ "${SKIP_PULL:-0}" != "1" ]; then
  log "拉取最新代码"
  git pull --ff-only
fi

DEPLOY_COMMIT_HASH="$(git rev-parse --short=12 HEAD 2>/dev/null || printf unknown)"
unset BUILD_COMMIT_HASH BUILD_COMMIT_DATE

log "无代理构建镜像: commit=$DEPLOY_COMMIT_HASH"
run_no_proxy "$COMPOSE" --env-file "$ENV_FILE" --profile "$PROFILE" build

log "启动生产容器"
"$COMPOSE" --env-file "$ENV_FILE" --profile "$PROFILE" up -d

log "等待健康状态"
i=0
while [ "$i" -lt "${HEALTH_RETRIES:-30}" ]; do
  status="$(docker inspect "$CONTAINER" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
  if [ "$status" = "healthy" ] || [ "$status" = "running" ]; then
    break
  fi
  i=$((i + 1))
  sleep 2
done

status="$(docker inspect "$CONTAINER" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
if [ "$status" != "healthy" ] && [ "$status" != "running" ]; then
  log "容器未就绪: status=${status:-unknown}"
  "$COMPOSE" --env-file "$ENV_FILE" --profile "$PROFILE" logs --tail=80 "$SERVICE"
  exit 1
fi

log "容器状态: $status"
docker exec "$CONTAINER" wget -q -O /dev/null http://127.0.0.1:3000/api/config
log "HTTP 自检通过"
