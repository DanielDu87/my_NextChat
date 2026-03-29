#!/bin/bash
#
# NextChat 配置初始化脚本
# 用途：初始化必要的数据库配置，解决同步问题
#

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== NextChat 配置初始化脚本 ===${NC}"
echo ""

# 获取用户 ID（去除空白字符）
USER_ID=$(docker exec nextchat-postgres psql -U nextchat_user -d nextchat -t -c "SELECT id FROM app_users LIMIT 1;" | tr -d '[:space:]')
echo -e "${YELLOW}用户 ID: $USER_ID${NC}"
echo ""

# 检查当前配置
echo -e "${YELLOW}1. 检查当前配置状态...${NC}"
PROVIDER_COUNT=$(docker exec nextchat-postgres psql -U nextchat_user -d nextchat -t -c "SELECT COUNT(*) FROM provider_configs;")
echo -e "${YELLOW}提供商配置数量: $PROVIDER_COUNT${NC}"

if [ "$PROVIDER_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ 已有提供商配置，无需初始化${NC}"
    exit 0
fi

echo ""
echo -e "${YELLOW}2. 初始化默认提供商配置...${NC}"

# 初始化 OpenAI 配置（作为默认配置）
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
INSERT INTO provider_configs (
  user_id,
  provider_code,
  provider_name,
  provider_type,
  is_enabled,
  is_default,
  request_config,
  raw_payload
) VALUES (
  '$USER_ID',
  'openai',
  'OpenAI',
  'openai',
  true,
  true,
  '{
    \"baseUrl\": \"\",
    \"endpoint\": \"\",
    \"apiKey\": \"\",
    \"temperature\": 0.7,
    \"top_p\": 1,
    \"max_tokens\": 2000,
    \"presence_penalty\": 0,
    \"frequency_penalty\": 0
  }'::jsonb,
  '{}'::jsonb
);
"

echo -e "${GREEN}✓ OpenAI 配置已添加${NC}"

# 验证结果
echo ""
echo -e "${YELLOW}3. 验证配置...${NC}"
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  provider_code,
  provider_name,
  is_enabled,
  is_default
FROM provider_configs;
"

echo ""
echo -e "${YELLOW}4. 更新 sync_settings...${NC}"
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
UPDATE app_settings
SET sync_settings = jsonb_build_object(
  'lastSyncTime', 0,
  'lastSyncStatus', 'success',
  'syncEnabled', true,
  'autoSync', true
)
WHERE user_id = '$USER_ID';
"

echo -e "${GREEN}✓ sync_settings 已更新${NC}"

# 验证
echo ""
echo -e "${YELLOW}5. 最终验证...${NC}"
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  jsonb_object_keys(sync_settings) as sync_keys,
  (SELECT COUNT(*) FROM provider_configs) as provider_count
FROM app_settings
WHERE user_id = '$USER_ID';
"

echo ""
echo -e "${GREEN}=== 初始化完成 ===${NC}"
echo ""
echo -e "${YELLOW}下一步操作：${NC}"
echo "1. 刷新浏览器页面 (Ctrl+F5)"
echo "2. 进入设置 → API 配置"
echo "3. 配置您的 API Key"
echo "4. 测试同步功能"
echo ""
echo "注意：这只是初始化了默认配置结构，实际使用时需要配置真实的 API Key"
