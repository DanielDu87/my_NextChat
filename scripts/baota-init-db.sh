#!/bin/bash
# =============================================================================
# NextChat 数据库初始化脚本 - 宝塔面板专用
# =============================================================================
# 使用方法：
# 1. 上传此脚本到服务器：/www/wwwroot/nextchat/scripts/baota-init-db.sh
# 2. 添加执行权限：chmod +x scripts/baota-init-db.sh
# 3. 运行脚本：./scripts/baota-init-db.sh
# =============================================================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}============================================================================${NC}"
echo -e "${GREEN}NextChat 数据库初始化脚本${NC}"
echo -e "${GREEN}============================================================================${NC}"
echo ""

# 默认配置
DB_NAME="nextchat"
DB_USER="nextchat_user"
DB_HOST="127.0.0.1"
DB_PORT="5432"

# 提示输入密码
echo -e "${YELLOW}请输入数据库密码（留空自动生成）：${NC}"
read -s DB_PASSWORD
echo ""

if [ -z "$DB_PASSWORD" ]; then
    DB_PASSWORD=$(openssl rand -base64 16 | tr -d "=+/" | cut -c1-16)
    echo -e "${GREEN}自动生成的密码：${DB_PASSWORD}${NC}"
fi

# 检查 PostgreSQL 是否安装
echo -e "${YELLOW}检查 PostgreSQL 安装状态...${NC}"
if ! command -v psql &> /dev/null; then
    echo -e "${RED}错误：未找到 PostgreSQL 命令${NC}"
    echo -e "${YELLOW}请在宝塔面板安装 PostgreSQL：软件商店 -> 搜索 PostgreSQL -> 安装${NC}"
    exit 1
fi

# 检查 PostgreSQL 服务是否运行
echo -e "${YELLOW}检查 PostgreSQL 服务状态...${NC}"
if ! sudo systemctl is-active --quiet postgresql; then
    echo -e "${YELLOW}PostgreSQL 服务未运行，尝试启动...${NC}"
    sudo systemctl start postgresql
    sleep 3
fi

if ! sudo systemctl is-active --quiet postgresql; then
    echo -e "${RED}错误：无法启动 PostgreSQL 服务${NC}"
    exit 1
fi

echo -e "${GREEN}PostgreSQL 服务运行中${NC}"
echo ""

# 创建数据库和用户
echo -e "${YELLOW}创建数据库和用户...${NC}"
sudo -u postgres psql << EOF
-- 创建数据库
CREATE DATABASE ${DB_NAME};

-- 创建用户
CREATE USER ${DB_USER} WITH ENCRYPTED PASSWORD '${DB_PASSWORD}';

-- 授权
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};

-- 连接到数据库并授权 schema
\c ${DB_NAME}
GRANT ALL PRIVILEGES ON SCHEMA public TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${DB_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${DB_USER};

-- 退出
\q
EOF

echo -e "${GREEN}数据库创建完成${NC}"
echo ""

# 测试连接
echo -e "${YELLOW}测试数据库连接...${NC}"
if PGPASSWORD="${DB_PASSWORD}" psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -c "SELECT version();" > /dev/null 2>&1; then
    echo -e "${GREEN}数据库连接测试成功！${NC}"
else
    echo -e "${RED}数据库连接测试失败！${NC}"
    echo -e "${YELLOW}请检查 PostgreSQL 配置文件 pg_hba.conf${NC}"
    exit 1
fi
echo ""

# 保存配置到 .env 文件
ENV_FILE=".env.baota.local"
echo -e "${YELLOW}保存数据库配置到 ${ENV_FILE}...${NC}"

cat > ${ENV_FILE} << EOF
# NextChat 宝塔面板部署配置
# 自动生成于 $(date)

# 基础配置
PORT=3000
CODE=your-access-password-here
OPENAI_API_KEY=

# 同步数据归属 ID（不是登录用户名）
NEXTCHAT_DEFAULT_USER_ID=user:admin
DEFAULT_SYNC_USER_ID=user:admin
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=user:admin

# 数据库配置
PGHOST=${DB_HOST}
PGPORT=${DB_PORT}
PGDATABASE=${DB_NAME}
PGUSER=${DB_USER}
PGPASSWORD=${DB_PASSWORD}
PGSSL=false
PGSSLMODE=disable

# 连接池配置
PGPOOL_MAX=10
PG_CONNECT_TIMEOUT_MS=10000
PG_IDLE_TIMEOUT_MS=30000

# 国内加速配置
ALPINE_MIRROR=https://mirrors.aliyun.com/alpine
NPM_REGISTRY=https://registry.npmmirror.com/

# 其他配置
HIDE_USER_API_KEY=true
DISABLE_GPT4=false
ENABLE_BALANCE_QUERY=false
DISABLE_FAST_LINK=false
ENABLE_MCP=false
ENABLE_GOOGLE_FONTS=false
EOF

echo -e "${GREEN}配置文件已保存${NC}"
echo ""

# 显示配置摘要
echo -e "${GREEN}============================================================================${NC}"
echo -e "${GREEN}数据库初始化完成！${NC}"
echo -e "${GREEN}============================================================================${NC}"
echo ""
echo -e "数据库名称：${YELLOW}${DB_NAME}${NC}"
echo -e "数据库用户：${YELLOW}${DB_USER}${NC}"
echo -e "数据库密码：${YELLOW}${DB_PASSWORD}${NC}"
echo -e "配置文件：${YELLOW}${ENV_FILE}${NC}"
echo ""
echo -e "${YELLOW}下一步操作：${NC}"
echo -e "1. 编辑 ${ENV_FILE}，配置 CODE 和 OPENAI_API_KEY"
echo -e "2. 运行部署命令："
echo -e "   docker-compose --env-file ${ENV_FILE} --profile no-proxy build"
echo -e "   docker-compose --env-file ${ENV_FILE} --profile no-proxy up -d"
echo ""
echo -e "${RED}重要提示：请妥善保管数据库密码！${NC}"
echo ""
