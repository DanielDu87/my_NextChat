#!/bin/bash

# NextChat 开发环境停止脚本
# 用途：关闭 SSH 隧道

set -e

echo "🛑 停止 NextChat 开发环境"
echo "================================"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

LOCAL_PORT="15432"

# 查找 SSH 隧道进程
echo ""
echo "🔍 查找 SSH 隧道进程..."

SSH_PID=$(lsof -ti :$LOCAL_PORT 2>/dev/null || echo "")

if [ -z "$SSH_PID" ]; then
    echo -e "${YELLOW}⚠️  未找到 SSH 隧道进程（端口 $LOCAL_PORT 未被占用）${NC}"
else
    echo -e "${GREEN}找到进程 PID: $SSH_PID${NC}"
    echo ""
    echo "正在关闭 SSH 隧道..."
    kill $SSH_PID

    # 等待进程关闭
    sleep 1

    # 验证是否关闭成功
    if lsof -i :$LOCAL_PORT > /dev/null 2>&1; then
        echo -e "${RED}❌ SSH 隧道关闭失败，尝试强制关闭...${NC}"
        kill -9 $SSH_PID
    else
        echo -e "${GREEN}✅ SSH 隧道已关闭${NC}"
    fi
fi

echo ""
echo "================================"
echo -e "${GREEN}🎉 开发环境已停止${NC}"
echo "================================"
