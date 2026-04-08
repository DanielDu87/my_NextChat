#!/bin/bash
# =============================================================================
# NextChat 本地开发环境快速启动脚本
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印带颜色的消息
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查 Docker
check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker 未安装，请先安装 Docker"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        print_error "Docker 未运行，请先启动 Docker"
        exit 1
    fi

    print_success "Docker 已就绪"
}

# 检查 Docker Compose
check_docker_compose() {
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose 未安装，请先安装 Docker Compose"
        exit 1
    fi

    print_success "Docker Compose 已就绪"
}

# 检查环境变量文件
check_env_file() {
    if [ ! -f ".env.local" ]; then
        print_warning ".env.local 文件不存在"

        if [ -f ".env.local.example" ]; then
            print_info "从 .env.local.example 创建 .env.local"
            cp .env.local.example .env.local
            print_warning "请编辑 .env.local 文件，设置访问密码和其他配置"
            print_info "编辑命令: nano .env.local"
            read -p "是否现在编辑? (y/N) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                ${EDITOR:-nano} .env.local
            fi
        else
            print_warning "未找到 .env.local.example，将使用默认配置"
        fi
    else
        print_success ".env.local 文件已存在"
    fi
}

# 启动服务
start_services() {
    print_info "启动服务..."

    # 使用 docker compose（新版）或 docker-compose（旧版）
    if docker compose version &> /dev/null; then
        DC="docker compose"
    else
        DC="docker-compose"
    fi

    # 启动数据库
    print_info "启动 PostgreSQL 数据库..."
    $DC --profile local-db up -d postgres

    # 等待数据库就绪
    print_info "等待数据库启动..."
    sleep 10

    # 检查数据库健康状态
    for i in {1..30}; do
        if docker exec nextchat-postgres pg_isready -U postgres &> /dev/null; then
            print_success "数据库已就绪"
            break
        fi
        if [ $i -eq 30 ]; then
            print_error "数据库启动超时"
            exit 1
        fi
        sleep 1
    done

    # 启动开发服务器
    print_info "启动开发服务器..."
    $DC --profile dev up -d nextchat-dev

    # 等待服务器就绪
    print_info "等待开发服务器启动..."
    sleep 5

    # 检查服务健康状态
    for i in {1..60}; do
        if curl -s http://localhost:3000/api/config &> /dev/null; then
            print_success "开发服务器已就绪"
            break
        fi
        if [ $i -eq 60 ]; then
            print_error "开发服务器启动超时"
            print_info "查看日志: docker logs nextchat-dev"
            exit 1
        fi
        sleep 1
    done
}

# 显示状态
show_status() {
    echo ""
    print_info "服务状态："
    docker ps --filter name=nextchat --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

    echo ""
    print_info "访问地址："
    echo "  - 应用: http://localhost:3000"
    echo "  - API健康: http://localhost:3000/api/config"
    echo "  - 数据库健康: http://localhost:3000/api/db/health"

    echo ""
    print_info "常用命令："
    echo "  - 查看日志: docker logs -f nextchat-dev"
    echo "  - 停止服务: $0 stop"
    echo "  - 重启服务: $0 restart"
    echo "  - 清理数据: $0 clean"
}

# 停止服务
stop_services() {
    print_info "停止服务..."

    if docker compose version &> /dev/null; then
        DC="docker compose"
    else
        DC="docker-compose"
    fi

    $DC --profile local-db --profile dev down
    print_success "服务已停止"
}

# 重启服务
restart_services() {
    stop_services
    sleep 2
    start_services
    show_status
}

# 清理数据
clean_data() {
    print_warning "这将删除所有数据库数据，是否继续? (y/N)"
    read -r -n 1
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "清理数据..."

        if docker compose version &> /dev/null; then
            DC="docker compose"
        else
            DC="docker-compose"
        fi

        $DC --profile local-db --profile dev down -v
        print_success "数据已清理"
    else
        print_info "已取消"
    fi
}

# 主函数
main() {
    echo "========================================"
    echo "  NextChat 本地开发环境"
    echo "========================================"
    echo ""

    case "${1:-start}" in
        start)
            check_docker
            check_docker_compose
            check_env_file
            start_services
            show_status
            ;;
        stop)
            stop_services
            ;;
        restart)
            restart_services
            ;;
        clean)
            clean_data
            ;;
        status)
            show_status
            ;;
        *)
            echo "用法: $0 {start|stop|restart|clean|status}"
            echo ""
            echo "命令说明:"
            echo "  start   - 启动开发环境（默认）"
            echo "  stop    - 停止所有服务"
            echo "  restart - 重启所有服务"
            echo "  clean   - 清理所有数据（危险操作）"
            echo "  status  - 显示服务状态"
            exit 1
            ;;
    esac
}

main "$@"
