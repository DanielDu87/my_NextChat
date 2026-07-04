#!/bin/sh

set -eu

BUILDX_CONFIG_DIR="${BUILDX_CONFIG:-/tmp/nextchat-docker-buildx}"
mkdir -p "$BUILDX_CONFIG_DIR"

export BUILDX_CONFIG="$BUILDX_CONFIG_DIR"

# 构建时自动注入当前提交，避免界面版本长期显示 unknown。
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if [ -z "${BUILD_COMMIT_HASH:-}" ] || [ "${BUILD_COMMIT_HASH}" = "unknown" ]; then
    BUILD_COMMIT_HASH="$(git rev-parse HEAD)"
    export BUILD_COMMIT_HASH
  fi
  if [ -z "${BUILD_COMMIT_DATE:-}" ] || [ "${BUILD_COMMIT_DATE}" = "unknown" ]; then
    BUILD_COMMIT_DATE="$(git log -1 --format='%at000')"
    export BUILD_COMMIT_DATE
  fi
fi

exec docker compose "$@"
