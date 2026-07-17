#!/bin/sh

set -eu

BUILDX_CONFIG_DIR="${BUILDX_CONFIG:-/tmp/nextchat-docker-buildx}"
mkdir -p "$BUILDX_CONFIG_DIR"

export BUILDX_CONFIG="$BUILDX_CONFIG_DIR"

# 构建时始终使用当前仓库提交，避免服务器残留环境变量覆盖实际部署版本。
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  BUILD_COMMIT_HASH="$(git rev-parse HEAD)"
  BUILD_COMMIT_DATE="$(git log -1 --format='%at000')"
  export BUILD_COMMIT_HASH BUILD_COMMIT_DATE
fi

exec docker compose "$@"
