#!/bin/bash

# NextChat 本地开发环境快速启动脚本
# 用途：自动建立 SSH 隧道并启动开发服务器

set -e

echo "🚀 NextChat 本地开发环境启动"
echo "================================"

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

# 1. 检查 SSH 隧道是否已存在
echo ""
echo "📡 检查 SSH 隧道状态..."
if lsof -i :$LOCAL_PORT > /dev/null 2>&1; then
    echo -e "${GREEN}✅ SSH 隧道已存在（端口 $LOCAL_PORT 正在监听）${NC}"
else
    echo -e "${YELLOW}⚠️  SSH 隧道未建立，正在创建...${NC}"

    # 建立 SSH 隧道
    ssh -f -N -L $LOCAL_PORT:127.0.0.1:$REMOTE_PORT $SSH_USER@$SSH_HOST -p $SSH_PORT -o StrictHostKeyChecking=no

    # 等待隧道建立
    sleep 2

    # 验证隧道是否成功
    if lsof -i :$LOCAL_PORT > /dev/null 2>&1; then
        echo -e "${GREEN}✅ SSH 隧道建立成功${NC}"
    else
        echo -e "${RED}❌ SSH 隧道建立失败${NC}"
        exit 1
    fi
fi

# 2. 验证远程数据库连接
echo ""
echo "🔍 验证远程数据库连接..."
if node check-remote-db.js > /dev/null 2>&1; then
    echo -e "${GREEN}✅ 远程数据库连接正常${NC}"
else
    echo -e "${YELLOW}⚠️  远程数据库连接测试失败（可能是 check-remote-db.js 不存在，继续启动）${NC}"
fi

# 3. 检查依赖是否安装
echo ""
echo "📦 检查依赖..."
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠️  依赖未安装，正在安装...${NC}"
    yarn install
else
    echo -e "${GREEN}✅ 依赖已安装${NC}"
fi

# 4. 启动开发服务器
echo ""
echo "================================"
echo -e "${GREEN}🎉 环境准备完成，启动开发服务器...${NC}"
echo ""
echo "访问地址: http://localhost:3000"
echo "按 Ctrl+C 停止服务器"
echo "================================"
echo ""

# 启动开发服务器
yarn dev
