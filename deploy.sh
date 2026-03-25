#!/bin/bash
# =============================================================================
# NextChat 一键部署脚本
# =============================================================================
# 用法:
#   ./deploy.sh              # 本地开发模式
#   ./deploy.sh production   # 服务器生产模式
#   ./deploy.sh official     # 使用官方镜像
# =============================================================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 打印带颜色的消息
info() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# 检查依赖
check_dependencies() {
    info "检查依赖..."
    command -v docker >/dev/null 2>&1 || error "Docker 未安装，请先安装 Docker"
    command -v docker-compose >/dev/null 2>&1 || error "Docker Compose 未安装，请先安装 Docker Compose"
    info "依赖检查通过 ✓"
}

# 配置 Docker 镜像加速
configure_docker_mirror() {
    info "检查 Docker 镜像加速配置..."

    if [ ! -f /etc/docker/daemon.json ]; then
        warn "未找到 Docker 配置文件，配置国内镜像源..."
        sudo mkdir -p /etc/docker
        sudo tee /etc/docker/daemon.json >/dev/null <<EOF
{
  "registry-mirrors": [
    "https://docker.1panel.live",
    "https://docker.m.daocloud.io",
    "https://registry.cn-hangzhou.aliyuncs.com"
  ],
  "max-concurrent-downloads": 10
}
EOF
        sudo systemctl daemon-reload
        sudo systemctl restart docker
        info "Docker 镜像加速配置完成 ✓"
    else
        info "Docker 配置文件已存在"
    fi
}

# 检查环境变量
check_env() {
    info "检查环境变量..."

    if [ ! -f .env ]; then
        warn "未找到 .env 文件"

        # 交互式创建 .env
        read -p "请输入 OPENAI_API_KEY: " api_key
        read -p "请输入访问密码 (CODE): " code

        cat > .env <<EOF
OPENAI_API_KEY=$api_key
CODE=$code
PORT=3000
EOF
        info ".env 文件已创建 ✓"
    else
        info ".env 文件已存在 ✓"
    fi
}

# 本地开发部署
deploy_dev() {
    info "启动本地开发环境..."
    info "开发模式特性: 热加载、源码挂载、文件监听"

    docker-compose up --build -d

    info "等待服务启动..."
    sleep 5

    if curl -s http://localhost:3000 >/dev/null; then
        info "✓ 服务启动成功!"
        info "访问地址: http://localhost:3000"
        info "查看日志: docker-compose logs -f"
        info "停止服务: docker-compose down"
    else
        error "服务启动失败，请查看日志: docker-compose logs"
    fi
}

# 生产环境部署
deploy_production() {
    info "启动生产环境..."

    check_env
    configure_docker_mirror

    # 启用 BuildKit 加速构建
    export DOCKER_BUILDKIT=1
    export COMPOSE_DOCKER_CLI_BUILD=1

    info "构建并启动容器..."
    docker-compose --profile production up -d --build

    info "等待服务启动..."
    sleep 10

    if curl -s http://localhost:3000 >/dev/null; then
        info "✓ 服务启动成功!"
        info "访问地址: http://localhost:3000"
        info ""
        info "常用命令:"
        info "  查看日志: docker-compose --profile production logs -f"
        info "  重启服务: docker-compose --profile production restart"
        info "  停止服务: docker-compose --profile production down"
        info "  更新服务: docker-compose --profile production pull && docker-compose --profile production up -d"
    else
        error "服务启动失败，请查看日志: docker-compose --profile production logs"
    fi
}

# 使用官方镜像部署
deploy_official() {
    info "使用官方镜像启动..."

    check_env

    docker-compose --profile official up -d

    info "等待服务启动..."
    sleep 5

    if curl -s http://localhost:3000 >/dev/null; then
        info "✓ 服务启动成功!"
        info "访问地址: http://localhost:3000"
    else
        error "服务启动失败"
    fi
}

# 显示帮助
show_help() {
    cat << EOF
NextChat 部署脚本

用法:
  $0 [模式]

模式:
  (无)        本地开发模式 (热加载)
  dev         本地开发模式 (热加载)
  production  生产模式 (本地构建)
  official    生产模式 (官方镜像)

示例:
  $0              # 本地开发
  $0 dev          # 本地开发
  $0 production   # 服务器部署
  $0 official     # 快速部署

环境变量:
  创建 .env 文件配置以下变量:
    OPENAI_API_KEY    API 密钥 (必填)
    CODE              访问密码 (必填)
    PORT              服务端口 (默认: 3000)
    BASE_URL          自定义 API 地址
    HIDE_USER_API_KEY 隐藏用户 API 密钥 (默认: true)

EOF
}

# 主函数
main() {
    local mode="${1:-dev}"

    info "=========================================="
    info "NextChat 部署脚本"
    info "模式: $mode"
    info "=========================================="

    check_dependencies

    case "$mode" in
        dev|"")
            deploy_dev
            ;;
        production)
            deploy_production
            ;;
        official)
            deploy_official
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            error "未知模式: $mode"
            show_help
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"
