#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SAFE_COMPOSE="$ROOT_DIR/scripts/docker-compose-safe.sh"
ENV_FILE="$ROOT_DIR/.env.docker"
ENV_EXAMPLE="$ROOT_DIR/.env.docker.example"

info() { echo "[INFO] $1"; }
error() { echo "[ERROR] $1" >&2; exit 1; }

check_dependencies() {
  command -v docker >/dev/null 2>&1 || error "Docker 未安装"
  docker compose version >/dev/null 2>&1 || error "Docker Compose v2 不可用"
  [ -x "$SAFE_COMPOSE" ] || error "缺少 $SAFE_COMPOSE"
}

ensure_env_file() {
  if [ -f "$ENV_FILE" ]; then
    return
  fi

  [ -f "$ENV_EXAMPLE" ] || error "缺少 $ENV_EXAMPLE"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  info "已创建 $ENV_FILE，请先补齐必要配置后重新执行。"
  exit 0
}

run_compose() {
  "$SAFE_COMPOSE" --env-file "$ENV_FILE" "$@"
}

deploy_dev() {
  info "启动本地开发环境"
  run_compose --profile dev build
  run_compose --profile dev up -d
  info "查看日志: $SAFE_COMPOSE --env-file .env.docker --profile dev logs -f nextchat-dev"
}

deploy_no_proxy() {
  info "启动生产环境（直连数据库）"
  run_compose --profile no-proxy build
  run_compose --profile no-proxy up -d
  info "查看日志: $SAFE_COMPOSE --env-file .env.docker --profile no-proxy logs -f nextchat-production"
}

deploy_ssh_tunnel() {
  info "启动生产环境（SSH 隧道数据库）"
  run_compose --profile no-proxy --profile ssh-tunnel build
  run_compose --profile no-proxy --profile ssh-tunnel up -d
  info "查看日志: $SAFE_COMPOSE --env-file .env.docker --profile no-proxy --profile ssh-tunnel logs -f nextchat-production"
}

deploy_official() {
  info "启动官方镜像"
  run_compose --profile official up -d
  info "查看日志: $SAFE_COMPOSE --env-file .env.docker --profile official logs -f nextchat"
}

show_help() {
  cat <<'EOF'
NextChat 部署脚本

用法:
  ./deploy.sh [dev|no-proxy|production|ssh-tunnel|official]

模式:
  dev         本地开发热加载
  no-proxy    生产部署，默认直连数据库
  production  no-proxy 的兼容别名
  ssh-tunnel  生产部署，叠加 SSH 数据库隧道
  official    使用官方镜像快速启动

说明:
  - 默认使用 .env.docker
  - 如果 .env.docker 不存在，会从 .env.docker.example 自动复制
  - 实际部署说明请看 docs/docker-deploy-cn.md
EOF
}

main() {
  local mode="${1:-dev}"

  check_dependencies
  ensure_env_file

  case "$mode" in
    dev)
      deploy_dev
      ;;
    no-proxy|production)
      deploy_no_proxy
      ;;
    ssh-tunnel)
      deploy_ssh_tunnel
      ;;
    official)
      deploy_official
      ;;
    help|--help|-h)
      show_help
      ;;
    *)
      error "未知模式: $mode"
      ;;
  esac
}

main "$@"
