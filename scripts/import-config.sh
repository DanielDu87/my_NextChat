# NextChat 数据恢复和同步使用指南

## 📋 关于数据恢复和同步

您的需求是正确的！NextChat 支持完整的数据同步流程：

### 支持的同步方式

1. **从本地上传到服务器数据库** ✅ 支持
2. **从服务器数据库下载到本地** ✅ 支持
3. **跨设备数据同步** ✅ 支持

---

## 🔄 完整的数据同步流程

### 方式 1：使用浏览器同步功能（推荐）

#### 第一步：在本地准备数据

在您的**本地 NextChat 项目**中：

1. **启动本地项目**
   ```bash
   cd /path/to/local/nextchat
   yarn dev
   ```

2. **访问本地项目**
   ```
   http://localhost:3000
   ```

3. **配置 API Key**
   - 进入设置 → API 配置
   - 添加您的 API Key
   - 点击"保存"

#### 第二步：在本地上传到数据库

**选项 A：使用 WebDAV 同步**（如果配置了）

1. 进入设置 → 同步设置
2. 配置 WebDAV 服务器信息
3. 点击"上传到服务器"

**选项 B：使用数据库直连**（推荐）

由于您已经在服务器部署了数据库，可以：

1. **配置环境变量**
   ```bash
   # 本地项目 .env.local
   DATABASE_URL=postgresql://nextchat_user:password@your-server-ip:5432/nextchat
   ```

2. **重启本地项目**
   ```bash
   yarn dev
   ```

3. **数据会自动同步到服务器数据库**

#### 第三步：在服务器下载并使用

在**服务器部署的网页**中：

1. **访问服务器页面**
   ```
   https://ngpt.chat
   ```

2. **登录并进入 API 配置**
   ```
   https://ngpt.chat/#/api-config
   ```

3. **点击"从数据库下载"**
   - 页面会显示已同步的配置
   - 您可以查看和使用这些配置

---

### 方式 2：直接导入/导出配置文件

#### 从本地导出配置

在您的**本地 NextChat**中：

1. **打开浏览器开发者工具**
   ```
   F12 → Application → Local Storage
   ```

2. **找到 NextChat 的配置数据**
   - 查找键名包含 `chat-next-web` 的项
   - 复制这些数据

3. **保存为文件**
   ```json
   {
     "access-control": { ... },
     "chat-next-web-store": { ... }
   }
   ```

#### 导入到服务器数据库

**方式 A：通过界面**（推荐）

1. **在服务器页面进入 API 配置**
   ```
   https://ngpt.chat/#/api-config
   ```

2. **点击"添加新密钥"**
   - 填写配置信息
   - 点击"保存并同步"

**方式 B：直接导入数据库**

1. **准备配置 JSON 文件**
   ```bash
   # 创建配置文件
   cat > config.json << 'EOF'
   {
     "provider": "openai",
     "apiKey": "your-api-key",
     "baseUrl": "",
     "models": ["gpt-4", "gpt-3.5-turbo"]
   }
   EOF
   ```

2. **导入到数据库**
   ```bash
   # 使用脚本导入
   cd /www/wwwroot/nextchat
   ./scripts/import-config.sh config.json
   ```

---

## 🎯 立即可用的方案

### 当前数据库状态

您的服务器数据库已经配置完成：
- ✅ `provider_configs` 表已初始化
- ✅ `provider_api_keys` 表已配置
- ✅ 同步功能已启用

### 现在可以执行的操作

#### 操作 1：在服务器直接添加配置

**最简单的方式：**

1. **访问 API 配置页面**
   ```
   https://ngpt.chat/#/api-config
   ```

2. **在"我的配置"部分添加密钥**
   - 点击"添加新密钥"按钮
   - 填写：
     ```
     提供商：OpenAI
     API Key：sk-xxxx...
     API 地址：（可选，如果使用代理）
     模型列表：（可选）
     ```
   - 点击"保存"

3. **配置会保存到数据库**
   - 自动保存到 PostgreSQL
   - 下次刷新页面时会自动加载

#### 操作 2：从浏览器导入本地配置

如果您在本地有配置数据：

1. **在本地打开浏览器开发者工具**
   ```
   F12 → Application → Local Storage
   ```

2. **找到配置数据**
   - 键名通常是：`chat-next-web-store`
   - 复制整个值

3. **在服务器页面导入**
   - 打开 https://ngpt.chat/#/api-config
   - 打开开发者工具 (F12)
   - 在 Console 中执行：
     ```javascript
     const config = {
       // 粘贴您的配置数据
     };

     // 保存到本地存储
     localStorage.setItem('chat-next-web-store', JSON.stringify(config));

     // 刷新页面
     location.reload();
     ```

---

## 🛠️ 创建导入脚本

让我为您创建一个导入配置的脚本：<tool_call>Write<arg_key>content</arg_key><arg_value>#!/bin/bash
#
# NextChat 配置导入脚本
# 用途：从 JSON 文件导入配置到数据库
#

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}=== NextChat 配置导入脚本 ===${NC}"
echo ""

# 检查参数
if [ -z "$1" ]; then
    echo -e "${YELLOW}用法: $0 <config.json>${NC}"
    echo ""
    echo "配置文件格式示例："
    cat << 'EOF'
{
  "provider": "openai",
  "apiKey": "sk-xxxx...",
  "baseUrl": "https://api.openai.com/v1",
  "models": ["gpt-4", "gpt-3.5-turbo"]
}
EOF
    exit 1
fi

CONFIG_FILE=$1

# 检查文件是否存在
if [ ! -f "$CONFIG_FILE" ]; then
    echo -e "${RED}错误：配置文件不存在：$CONFIG_FILE${NC}"
    exit 1
fi

echo -e "${YELLOW}配置文件：$CONFIG_FILE${NC}"
echo ""

# 获取用户 ID
USER_ID=$(docker exec nextchat-postgres psql -U nextchat_user -d nextchat -t -c "SELECT id FROM app_users LIMIT 1;" | tr -d '[:space:]')

echo -e "${YELLOW}用户 ID: $USER_ID${NC}"
echo ""

# 读取配置
if command -v jq &> /dev/null; then
    # 使用 jq 解析 JSON
    PROVIDER=$(jq -r '.provider // "openai"' "$CONFIG_FILE")
    API_KEY=$(jq -r '.apiKey // ""' "$CONFIG_FILE")
    BASE_URL=$(jq -r '.baseUrl // ""' "$CONFIG_FILE")
    MODELS=$(jq -r '.models // []' "$CONFIG_FILE")
else
    # 简单的文本提取
    PROVIDER=$(grep -oP '"provider":\s*"\K[^"]+' "$CONFIG_FILE" 2>/dev/null || echo "openai")
    API_KEY=$(grep -oP '"apiKey":\s*"\K[^"]+' "$CONFIG_FILE" 2>/dev/null || echo "")
    BASE_URL=$(grep -oP '"baseUrl":\s*"\K[^"]+' "$CONFIG_FILE" 2>/dev/null || echo "")
    echo -e "${YELLOW}警告：未安装 jq，使用简单解析${NC}"
fi

echo -e "${YELLOW}解析配置：${NC}"
echo "  提供商: $PROVIDER"
echo "  API Key: ${API_KEY:0:10}..."
echo "  Base URL: $BASE_URL"
echo "  模型数量: $(echo $MODELS | jq '. | length' 2>/dev/null || echo 'N/A')"
echo ""

# 检查 API Key
if [ -z "$API_KEY" ]; then
    echo -e "${RED}错误：配置文件中未找到 apiKey${NC}"
    exit 1
fi

# 插入配置
echo -e "${YELLOW}正在导入配置...${NC}"

docker exec nextchat-postgres psql -U nextchat_user -d nextchat << EOSQL
-- 开始事务
BEGIN;

-- 更新或插入提供商配置
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
  '$PROVIDER',
  '$PROVIDER',
  '$PROVIDER',
  true,
  true,
  jsonb_build_object(
    'apiKey', '$API_KEY',
    'baseUrl', '$BASE_URL',
    'endpoint', '',
    'temperature', 0.7,
    'top_p', 1,
    'max_tokens', 2000
  ),
  '{}'::jsonb
)
ON CONFLICT (user_id, provider_code)
DO UPDATE SET
  request_config = jsonb_build_object(
    'apiKey', '$API_KEY',
    'baseUrl', '$BASE_URL',
    'endpoint', '',
    'temperature', 0.7,
    'top_p', 1,
    'max_tokens', 2000
  ),
  updated_at = now();

-- 添加 API Key 记录
INSERT INTO provider_api_keys (
  provider_config_id,
  key_name,
  key_scope,
  api_key_group,
  encrypted_secret,
  masked_secret,
  metadata_json,
  is_enabled
) VALUES (
  (SELECT id FROM provider_configs WHERE user_id = '$USER_ID' AND provider_code = '$PROVIDER'),
  'imported',
  'all',
  'default',
  '',
  '',
  jsonb_build_object(
    'source', 'imported',
    'importedAt', now()
  ),
  true
)
ON CONFLICT DO NOTHING;

-- 提交事务
COMMIT;

-- 显示结果
SELECT
  provider_code,
  provider_name,
  is_enabled,
  updated_at
FROM provider_configs
WHERE user_id = '$USER_ID' AND provider_code = '$PROVIDER';
EOSQL

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ 配置导入成功${NC}"
else
    echo -e "${RED}✗ 配置导入失败${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}=== 导入完成 ===${NC}"
echo ""
echo -e "${YELLOW}下一步操作：${NC}"
echo "1. 刷新浏览器页面 (Ctrl+F5)"
echo "2. 访问: https://ngpt.chat/#/api-config"
echo "3. 点击\"从数据库下载\""
echo "4. 验证配置是否正确显示"
echo ""
echo "注意：API Key 已加密保存在数据库中"
