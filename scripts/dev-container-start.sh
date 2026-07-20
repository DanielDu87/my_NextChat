#!/bin/sh

set -eu

APP_DIR="/app"
NODE_MODULES_DIR="$APP_DIR/node_modules"
SEEDED_NODE_MODULES_DIR="/opt/nextchat-node_modules"
DEPS_HASH_FILE="$NODE_MODULES_DIR/.nextchat-deps-hash"

compute_deps_hash() {
  if command -v sha256sum >/dev/null 2>&1; then
    cat "$APP_DIR/package.json" "$APP_DIR/yarn.lock" | sha256sum | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    cat "$APP_DIR/package.json" "$APP_DIR/yarn.lock" | shasum -a 256 | awk '{print $1}'
    return
  fi

  wc -c "$APP_DIR/package.json" "$APP_DIR/yarn.lock" | tail -n 1 | awk '{print $1}'
}

mkdir -p "$NODE_MODULES_DIR"

if [ ! -f "$NODE_MODULES_DIR/.yarn-integrity" ] && [ -d "$SEEDED_NODE_MODULES_DIR" ]; then
  echo "[dev-container] 使用镜像内依赖缓存初始化 node_modules"
  cp -a "$SEEDED_NODE_MODULES_DIR"/. "$NODE_MODULES_DIR"/
fi

CURRENT_DEPS_HASH="$(compute_deps_hash)"
STORED_DEPS_HASH=""
if [ -f "$DEPS_HASH_FILE" ]; then
  STORED_DEPS_HASH="$(cat "$DEPS_HASH_FILE")"
fi

if [ ! -f "$NODE_MODULES_DIR/.yarn-integrity" ] || [ "$CURRENT_DEPS_HASH" != "$STORED_DEPS_HASH" ]; then
  echo "[dev-container] 检测到依赖缺失或 package 清单变化，执行 yarn install"
  yarn install --frozen-lockfile --ignore-engines --network-timeout 600000
  printf '%s' "$CURRENT_DEPS_HASH" > "$DEPS_HASH_FILE"
else
  echo "[dev-container] 依赖已就绪，跳过 yarn install"
fi

exec yarn dev --hostname 0.0.0.0
