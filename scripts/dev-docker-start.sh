#!/bin/bash

# NextChat Docker 热加载开发环境启动脚本
# 用途：使用 Docker 容器运行开发服务器，代码挂载实现热更新
# 重要：永远连接远程数据库，不使用本地 Docker PostgreSQL 容器

set -e

echo "🚀 NextChat Docker 热加载开发环境启动"
echo "========================================"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 配置
SSH_HOST="42.193.15.117"
SSH_PORT="222"
SSH_USER="root"
LOCAL_PORT="15432"
REMOTE_PORT="5432"

# 1. 检查并建立 SSH 隧道（必须绑定 0.0.0.0 以便 Docker 容器通过 host.docker.internal 访问）
echo ""
echo "📡 检查 SSH 隧道状态..."
NEED_TUNNEL=true
if lsof -i :$LOCAL_PORT > /dev/null 2>&1; then
    # 检查是否绑定了 0.0.0.0（Docker 容器需要）
    if netstat -an 2>/dev/null | grep -q "\*\.${LOCAL_PORT}\|0\.0\.0\.0\.${LOCAL_PORT}"; then
        echo -e "${GREEN}✅ SSH 隧道已存在且绑定 0.0.0.0（端口 $LOCAL_PORT 正在监听）${NC}"
        NEED_TUNNEL=false
    else
        echo -e "${YELLOW}⚠️  SSH 隧道存在但仅绑定 localhost，需要重建以支持 Docker 容器访问${NC}"
        lsof -ti :$LOCAL_PORT | xargs kill 2>/dev/null || true
        sleep 1
    fi
fi

if [ "$NEED_TUNNEL" = true ]; then
    echo -e "${YELLOW}⚠️  正在创建 SSH 隧道（绑定 0.0.0.0）...${NC}"
    ssh -f -N -L 0.0.0.0:$LOCAL_PORT:127.0.0.1:$REMOTE_PORT $SSH_USER@$SSH_HOST -p $SSH_PORT -o StrictHostKeyChecking=no

    # 等待隧道建立
    sleep 2

    # 验证隧道是否成功
    if lsof -i :$LOCAL_PORT > /dev/null 2>&1; then
        echo -e "${GREEN}✅ SSH 隧道建立成功（绑定 0.0.0.0:$LOCAL_PORT）${NC}"
    else
        echo -e "${RED}❌ SSH 隧道建立失败${NC}"
        exit 1
    fi
fi

# 2. 检查 Docker 是否运行
echo ""
echo "🐳 检查 Docker 状态..."
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker 未运行，请先启动 Docker${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Docker 已就绪${NC}"

# 3. 停止并删除旧容器（如果存在）
echo ""
echo "🧹 清理旧容器..."
docker-compose --profile dev down 2>/dev/null || true
echo -e "${GREEN}✅ 旧容器已清理${NC}"

# 4. 构建并启动 Docker 开发容器
echo ""
echo "🔨 构建并启动 Docker 开发容器..."
echo -e "${YELLOW}提示：首次启动需要构建镜像，可能需要几分钟...${NC}"

docker-compose --profile dev up -d --build

# 5. 等待容器启动
echo ""
echo "⏳ 等待容器启动..."
sleep 5

# 6. 检查容器状态
if docker ps --filter "name=nextchat-dev" --format "{{.Names}}" | grep -q "nextchat-dev"; then
    echo -e "${GREEN}✅ Docker 开发容器已启动${NC}"
else
    echo -e "${RED}❌ Docker 开发容器启动失败${NC}"
    echo "查看日志: docker-compose logs nextchat-dev"
    exit 1
fi

# 7. 显示状态和日志
echo ""
echo "========================================"
echo -e "${GREEN}🎉 Docker 热加载开发环境已启动${NC}"
echo "========================================"
echo ""
echo "📍 访问地址: http://localhost:3000"
echo "📋 查看日志: docker-compose logs -f nextchat-dev"
echo "🛑 停止服务: docker-compose --profile dev down"
echo ""
echo "💡 代码修改会自动热更新，无需重启容器"
echo ""

# 8. 自动在 Google Chrome Beta 中打开应用
echo "🌐 正在 Google Chrome Beta 中打开应用..."
if open -a "Google Chrome Beta" http://localhost:3000 2>/dev/null; then
    echo -e "${GREEN}✅ 已在 Google Chrome Beta 中打开 http://localhost:3000${NC}"
else
    echo -e "${YELLOW}⚠️  Google Chrome Beta 未安装，使用默认浏览器${NC}"
    open http://localhost:3000
fi

echo ""
echo "正在显示容器日志（按 Ctrl+C 停止查看日志，容器继续运行）..."
echo "========================================"
echo ""

# 显示日志
docker-compose logs -f nextchat-dev
