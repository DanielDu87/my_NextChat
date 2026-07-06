#!/usr/bin/env bash

# ⚠️ 已弃用：本脚本用于本地构建后上传镜像到服务器
# 新的部署方式：直接在服务器上使用 Git SSH 同步代码并本地构建
# 请参考 README_BAOTA.md 中的更新升级流程

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SAFE_COMPOSE_SCRIPT="$ROOT_DIR/scripts/docker-compose-safe.sh"
DEFAULT_ENV_FILE=".env.baota"
DEFAULT_REMOTE_APP_DIR="/www/dk_project/my_NextChat"
DEFAULT_REMOTE_IMAGE_DIR="/www/dk_project/my_NextChat_img"
DEFAULT_REMOTE_COMPOSE_FILE="docker-compose.baota.yml"
DEFAULT_IMAGE_NAME="nextchat-baota:latest"
DEFAULT_IMAGE_PLATFORM="linux/amd64"
DEFAULT_BUILDER_NAME="default"
DEFAULT_DOCKER_CONTEXT="default"

REMOTE_HOST=""
REMOTE_PORT="22"
REMOTE_USER="root"
REMOTE_PASSWORD=""
REMOTE_APP_DIR="$DEFAULT_REMOTE_APP_DIR"
REMOTE_IMAGE_DIR="$DEFAULT_REMOTE_IMAGE_DIR"
REMOTE_COMPOSE_FILE="$DEFAULT_REMOTE_COMPOSE_FILE"
ENV_FILE="$DEFAULT_ENV_FILE"
IMAGE_NAME="${NEXTCHAT_IMAGE:-$DEFAULT_IMAGE_NAME}"
IMAGE_PLATFORM="${NEXTCHAT_PLATFORM:-$DEFAULT_IMAGE_PLATFORM}"
BUILDER_NAME="${NEXTCHAT_BUILDER:-$DEFAULT_BUILDER_NAME}"
DOCKER_CONTEXT_NAME="${DOCKER_CONTEXT:-$DEFAULT_DOCKER_CONTEXT}"
LOCAL_HTTP_PROXY="${http_proxy:-${HTTP_PROXY:-}}"
LOCAL_HTTPS_PROXY="${https_proxy:-${HTTPS_PROXY:-}}"
LOCAL_ALL_PROXY="${all_proxy:-${ALL_PROXY:-}}"

normalize_proxy_for_container() {
  local proxy_value="${1:-}"

  if [[ -z "$proxy_value" ]]; then
    return 0
  fi

  proxy_value="${proxy_value/127.0.0.1/host.docker.internal}"
  proxy_value="${proxy_value/localhost/host.docker.internal}"
  printf '%s' "$proxy_value"
}

usage() {
  cat <<EOF
用法：
  $0 --host <主机> --password <密码> [选项]

选项：
  --host <主机>             远程服务器地址
  --port <端口>             SSH 端口，默认 22
  --user <用户>             SSH 用户，默认 root
  --password <密码>         SSH 密码
  --remote-app-dir <路径>   远程项目目录，默认 $DEFAULT_REMOTE_APP_DIR
  --remote-image-dir <路径> 远程镜像包目录，默认 $DEFAULT_REMOTE_IMAGE_DIR
  --env-file <文件>         本地/远程共用环境文件，默认 $DEFAULT_ENV_FILE
  --image <名称>            镜像名，默认 $DEFAULT_IMAGE_NAME
  --platform <平台>         镜像平台，默认 $DEFAULT_IMAGE_PLATFORM
  --builder <名称>          buildx builder，默认 $DEFAULT_BUILDER_NAME
  --context <名称>          docker context，默认 $DEFAULT_DOCKER_CONTEXT
  --help                    显示帮助

示例：
  $0 \\
    --host 149.88.67.171 \\
    --port 48571 \\
    --user root \\
    --password 'your-password'
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令: $1" >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      REMOTE_HOST="${2:-}"
      shift 2
      ;;
    --port)
      REMOTE_PORT="${2:-}"
      shift 2
      ;;
    --user)
      REMOTE_USER="${2:-}"
      shift 2
      ;;
    --password)
      REMOTE_PASSWORD="${2:-}"
      shift 2
      ;;
    --remote-app-dir)
      REMOTE_APP_DIR="${2:-}"
      shift 2
      ;;
    --remote-image-dir)
      REMOTE_IMAGE_DIR="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --image)
      IMAGE_NAME="${2:-}"
      shift 2
      ;;
    --platform)
      IMAGE_PLATFORM="${2:-}"
      shift 2
      ;;
    --builder)
      BUILDER_NAME="${2:-}"
      shift 2
      ;;
    --context)
      DOCKER_CONTEXT_NAME="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$REMOTE_HOST" || -z "$REMOTE_PASSWORD" ]]; then
  echo "必须提供 --host 和 --password" >&2
  usage
  exit 1
fi

require_command docker
require_command mkdir
require_command sshpass
require_command ssh
require_command scp
require_command gzip
require_command date

if [[ ! -x "$SAFE_COMPOSE_SCRIPT" ]]; then
  echo "找不到可执行脚本: $SAFE_COMPOSE_SCRIPT" >&2
  exit 1
fi

if [[ ! -f "$ROOT_DIR/$ENV_FILE" ]]; then
  echo "找不到环境文件: $ROOT_DIR/$ENV_FILE" >&2
  exit 1
fi

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
ARCHIVE_BASENAME="nextchat-image-${TIMESTAMP}.tar.gz"
LOCAL_ARCHIVE="/tmp/${ARCHIVE_BASENAME}"
REMOTE_ARCHIVE="${REMOTE_IMAGE_DIR}/${ARCHIVE_BASENAME}"
LOCAL_BUILDX_CONFIG_DIR="/tmp/nextchat-docker-buildx"

mkdir -p "$LOCAL_BUILDX_CONFIG_DIR"

set -a
# shellcheck disable=SC1090
. "$ROOT_DIR/$ENV_FILE"
set +a

APK_MIRROR_VALUE="https://dl-cdn.alpinelinux.org/alpine"
NPM_REGISTRY_VALUE="https://registry.npmjs.org/"
ENABLE_GOOGLE_FONTS_VALUE="${ENABLE_GOOGLE_FONTS:-false}"
GITHUB_BASE_URL_VALUE="${GITHUB_BASE_URL:-https://github.com}"
GITHUB_API_BASE_URL_VALUE="${GITHUB_API_BASE_URL:-https://api.github.com}"
GITHUB_RAW_BASE_URL_VALUE="${GITHUB_RAW_BASE_URL:-https://raw.githubusercontent.com}"
ENABLE_SHAREGPT_VALUE="${ENABLE_SHAREGPT:-false}"
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID_VALUE="${NEXT_PUBLIC_DEFAULT_SYNC_USER_ID:-user:admin}"
BUILD_COMMIT_DATE_VALUE="$(git -C "$ROOT_DIR" log -1 --format='%at000')"
BUILD_COMMIT_HASH_VALUE="$(git -C "$ROOT_DIR" rev-parse HEAD)"
BUILD_HTTP_PROXY="$(normalize_proxy_for_container "$LOCAL_HTTP_PROXY")"
BUILD_HTTPS_PROXY="$(normalize_proxy_for_container "$LOCAL_HTTPS_PROXY")"
BUILD_ALL_PROXY="$(normalize_proxy_for_container "$LOCAL_ALL_PROXY")"

SSH_BASE=(
  sshpass -p "$REMOTE_PASSWORD" ssh
  -o StrictHostKeyChecking=no
  -p "$REMOTE_PORT"
  "${REMOTE_USER}@${REMOTE_HOST}"
)

SCP_BASE=(
  sshpass -p "$REMOTE_PASSWORD" scp
  -o StrictHostKeyChecking=no
  -P "$REMOTE_PORT"
)

echo "[Deploy] 本地构建镜像: $IMAGE_NAME"
echo "[Deploy] 预拉取官方基础镜像: alpine:3.20 ($IMAGE_PLATFORM)"
docker pull --platform "$IMAGE_PLATFORM" alpine:3.20

BUILD_CMD=(
  docker --context "$DOCKER_CONTEXT_NAME" buildx build
  --builder "$BUILDER_NAME"
  --network host
  --platform "$IMAGE_PLATFORM"
  --load
  -t "$IMAGE_NAME"
  --target runner
  -f Dockerfile
  --build-arg "APK_MIRROR=$APK_MIRROR_VALUE"
  --build-arg "NPM_REGISTRY=$NPM_REGISTRY_VALUE"
  --build-arg "ENABLE_GOOGLE_FONTS=$ENABLE_GOOGLE_FONTS_VALUE"
  --build-arg "GITHUB_BASE_URL=$GITHUB_BASE_URL_VALUE"
  --build-arg "GITHUB_API_BASE_URL=$GITHUB_API_BASE_URL_VALUE"
  --build-arg "GITHUB_RAW_BASE_URL=$GITHUB_RAW_BASE_URL_VALUE"
  --build-arg "ENABLE_SHAREGPT=$ENABLE_SHAREGPT_VALUE"
  --build-arg "NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=$NEXT_PUBLIC_DEFAULT_SYNC_USER_ID_VALUE"
  --build-arg "BUILD_COMMIT_DATE=$BUILD_COMMIT_DATE_VALUE"
  --build-arg "BUILD_COMMIT_HASH=$BUILD_COMMIT_HASH_VALUE"
)

if [[ -n "$BUILD_HTTP_PROXY" ]]; then
  BUILD_CMD+=(--build-arg "HTTP_PROXY=$BUILD_HTTP_PROXY" --build-arg "http_proxy=$BUILD_HTTP_PROXY")
fi

if [[ -n "$BUILD_HTTPS_PROXY" ]]; then
  BUILD_CMD+=(--build-arg "HTTPS_PROXY=$BUILD_HTTPS_PROXY" --build-arg "https_proxy=$BUILD_HTTPS_PROXY")
fi

if [[ -n "$BUILD_ALL_PROXY" ]]; then
  BUILD_CMD+=(--build-arg "ALL_PROXY=$BUILD_ALL_PROXY" --build-arg "all_proxy=$BUILD_ALL_PROXY")
fi

BUILD_CMD+=(.)

(
  cd "$ROOT_DIR"
  BUILDX_CONFIG="$LOCAL_BUILDX_CONFIG_DIR" "${BUILD_CMD[@]}"
)

echo "[Deploy] 导出镜像到: $LOCAL_ARCHIVE"
rm -f "$LOCAL_ARCHIVE"
docker save "$IMAGE_NAME" | gzip -1 >"$LOCAL_ARCHIVE"

echo "[Deploy] 上传部署文件到远程服务器"
"${SSH_BASE[@]}" "mkdir -p '$REMOTE_APP_DIR/scripts' '$REMOTE_IMAGE_DIR'"
"${SCP_BASE[@]}" "$ROOT_DIR/docker-compose.baota.yml" \
  "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_APP_DIR}/docker-compose.baota.yml"
"${SCP_BASE[@]}" "$ROOT_DIR/scripts/docker-compose-safe.sh" \
  "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_APP_DIR}/scripts/docker-compose-safe.sh"
"${SCP_BASE[@]}" "$ROOT_DIR/scripts/sync-baota-dockersite-container-id.sh" \
  "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_APP_DIR}/scripts/sync-baota-dockersite-container-id.sh"
"${SCP_BASE[@]}" "$LOCAL_ARCHIVE" \
  "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_ARCHIVE}"

echo "[Deploy] 远端加载镜像并启动容器"
"${SSH_BASE[@]}" "
  set -euo pipefail
  chmod +x '$REMOTE_APP_DIR/scripts/docker-compose-safe.sh'
  chmod +x '$REMOTE_APP_DIR/scripts/sync-baota-dockersite-container-id.sh'
  gunzip -c '$REMOTE_ARCHIVE' | docker load
  cd '$REMOTE_APP_DIR'
  NEXTCHAT_IMAGE='$IMAGE_NAME' \
  NEXTCHAT_PLATFORM='$IMAGE_PLATFORM' \
  BUILD_COMMIT_DATE='$BUILD_COMMIT_DATE_VALUE' \
  BUILD_COMMIT_HASH='$BUILD_COMMIT_HASH_VALUE' \
    docker compose \
    --env-file '$ENV_FILE' \
    -f '$REMOTE_COMPOSE_FILE' \
    up -d --no-build nextchat
  docker ps --format '{{.Names}}\t{{.Status}}' | grep -E '^nextchat\\b|^nextchat-postgres\\b'
  for i in \$(seq 1 60); do
    docker inspect nextchat --format '{{.State.Health.Status}}' | grep -qx healthy && break
    if [[ \"\$i\" -eq 60 ]]; then
      echo 'nextchat 健康检查超时' >&2
      exit 1
    fi
    sleep 2
  done
  '$REMOTE_APP_DIR/scripts/sync-baota-dockersite-container-id.sh'
"

echo "[Deploy] 完成"
echo "[Deploy] 远程镜像包: $REMOTE_ARCHIVE"
echo "[Deploy] 镜像标签: $IMAGE_NAME"
echo "[Deploy] 镜像平台: $IMAGE_PLATFORM"
