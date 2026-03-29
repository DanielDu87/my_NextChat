#!/bin/bash
#
# NextChat 数据库 app_settings 清理脚本
# 用途：清理 app_settings 表中的大量插件配置数据，解决数据下载报错问题
# 使用方法：./fix-app-settings.sh
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 配置
DB_CONTAINER="nextchat-postgres"
DB_USER="nextchat_user"
DB_NAME="nextchat"
BACKUP_DIR="/root/nextchat-backups"

echo -e "${GREEN}=== NextChat 数据库 app_settings 清理脚本 ===${NC}"
echo ""

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 检查容器是否运行
echo -e "${YELLOW}1. 检查容器状态...${NC}"
if ! docker ps | grep -q "$DB_CONTAINER"; then
    echo -e "${RED}错误：数据库容器 $DB_CONTAINER 未运行${NC}"
    exit 1
fi
echo -e "${GREEN}✓ 容器运行正常${NC}"
echo ""

# 备份当前数据
echo -e "${YELLOW}2. 备份当前数据...${NC}"
BACKUP_FILE="$BACKUP_DIR/app_settings_backup_$(date +%Y%m%d_%H%M%S).sql"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -t app_settings "$DB_NAME" > "$BACKUP_FILE"
echo -e "${GREEN}✓ 备份完成：$BACKUP_FILE${NC}"
echo ""

# 获取用户列表
echo -e "${YELLOW}3. 获取用户列表...${NC}"
USER_LIST=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "
SELECT id FROM app_users;
")

if [ -z "$USER_LIST" ]; then
    echo -e "${RED}错误：未找到用户${NC}"
    exit 1
fi

# 显示用户列表
echo "找到以下用户："
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "
SELECT
  id,
  external_id,
  created_at
FROM app_users;
"
echo ""

# 显示当前数据大小
echo -e "${YELLOW}4. 检查当前数据大小...${NC}"
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "
SELECT
  user_id,
  length(ui_settings::text) as ui_size,
  length(chat_settings::text) as chat_size,
  length(plugin_settings::text) as plugin_size,
  length(extra_settings::text) as extra_size
FROM app_settings
ORDER BY length(plugin_settings::text) DESC;
"
echo ""

# 询问是否继续
echo -e "${YELLOW}5. 清理 app_settings 数据${NC}"
read -p "是否清理所有用户的 app_settings 数据？(y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}已取消操作${NC}"
    exit 0
fi

# 执行清理
echo -e "${YELLOW}正在清理...${NC}"
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" << 'EOSQL'
-- 开始事务
BEGIN;

-- 为每个用户重新创建干净的配置
WITH users AS (
  SELECT id FROM app_users
),
deleted AS (
  DELETE FROM app_settings
  WHERE user_id IN (SELECT id FROM users)
  RETURNING user_id
)
INSERT INTO app_settings (user_id, ui_settings, chat_settings, model_settings, plugin_settings, sync_settings, security_settings, extra_settings)
SELECT
  id,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb
FROM users;

-- 提交事务
COMMIT;
EOSQL

echo -e "${GREEN}✓ 清理完成${NC}"
echo ""

# 验证清理结果
echo -e "${YELLOW}6. 验证清理结果...${NC}"
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "
SELECT
  user_id,
  length(ui_settings::text) as ui_size,
  length(plugin_settings::text) as plugin_size,
  updated_at
FROM app_settings
ORDER BY updated_at DESC;
"
echo ""

# 测试应用
echo -e "${YELLOW}7. 测试应用...${NC}"
if curl -s http://127.0.0.1:3000 > /dev/null; then
    echo -e "${GREEN}✓ 应用运行正常${NC}"
else
    echo -e "${RED}⚠ 应用可能有问题，请检查${NC}"
fi
echo ""

echo -e "${GREEN}=== 清理完成 ===${NC}"
echo -e "备份文件：$BACKUP_FILE"
echo ""
echo "如需恢复备份："
echo "  docker exec -i $DB_CONTAINER psql -U $DB_USER $DB_NAME < $BACKUP_FILE"
