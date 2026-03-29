#!/bin/bash
#
# NextChat app-config 修复脚本
# 用途：修复 model_settings 中缺少 app-config 的问题
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== NextChat app-config 修复脚本 ===${NC}"
echo ""

# 获取用户 ID
USER_ID=$(docker exec nextchat-postgres psql -U nextchat_user -d nextchat -t -c "SELECT id FROM app_users LIMIT 1;")
echo -e "${YELLOW}用户 ID: $USER_ID${NC}"
echo ""

# 检查当前配置
echo -e "${YELLOW}1. 检查当前配置...${NC}"
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  jsonb_object_keys(model_settings) as model_keys,
  jsonb_object_keys(extra_settings) as extra_keys
FROM app_settings
WHERE user_id = '$USER_ID';
"
echo ""

# 备份当前配置
echo -e "${YELLOW}2. 备份当前配置...${NC}"
BACKUP_FILE="/root/app_settings_backup_$(date +%Y%m%d_%H%M%S).sql"
docker exec nextchat-postgres pg_dump -U nextchat_user -t app_settings nextchat > "$BACKUP_FILE"
echo -e "${GREEN}✓ 备份完成：$BACKUP_FILE${NC}"
echo ""

# 修复 model_settings
echo -e "${YELLOW}3. 修复 model_settings...${NC}"
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
UPDATE app_settings
SET model_settings = jsonb_build_object(
  'app-config', jsonb_build_object(
    'models', '[]'::jsonb,
    'customModels', ''::text,
    'providers', '{}'::jsonb,
    'lastUpdate', 0,
    'version', '1.0'
  )
)
WHERE user_id = '$USER_ID'
AND NOT (model_settings ? 'app-config');
"
echo -e "${GREEN}✓ model_settings 已更新${NC}"
echo ""

# 验证修复结果
echo -e "${YELLOW}4. 验证修复结果...${NC}"
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  user_id,
  model_settings -> 'app-config' as app_config,
  jsonb_object_keys(model_settings) as keys
FROM app_settings
WHERE user_id = '$USER_ID';
"
echo ""

# 测试应用
echo -e "${YELLOW}5. 测试应用...${NC}"
if curl -s http://127.0.0.1:3000 > /dev/null; then
    echo -e "${GREEN}✓ 应用运行正常${NC}"
else
    echo -e "${RED}⚠ 应用可能有问题${NC}"
fi
echo ""

echo -e "${GREEN}=== 修复完成 ===${NC}"
echo ""
echo -e "${YELLOW}下一步操作：${NC}"
echo "1. 刷新浏览器页面（Ctrl+F5 强制刷新）"
echo "2. 打开浏览器开发者工具（F12）"
echo "3. 检查控制台是否还有错误"
echo "4. 测试应用功能是否正常"
echo ""
echo "如果问题仍然存在，请查看："
echo "  - 数据库故障排查指南: docs/baota-database-troubleshooting.md"
