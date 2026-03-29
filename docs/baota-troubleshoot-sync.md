# NextChat 宝塔面板部署问题修复指南

## 问题：点击"保存并同步"提示错误

### 错误信息

```
[API Config] ❌ 数据库同步失败: Error: 没有可同步的配置条目
```

---

## 问题原因

首次部署时，虽然创建了数据库表结构，但 `app_settings` 配置表是空的，没有初始化数据。这会导致：
- 配置无法保存
- 配置无法加载
- 数据同步功能异常

---

## 快速修复

### 在宝塔面板 -> 终端执行：

```bash
# 初始化配置数据
PGPASSWORD=your-password psql -h 127.0.0.1 -U nextchat_user -d nextchat << 'EOF'
DO $$
DECLARE
  user_id uuid;
BEGIN
  -- 获取或创建用户
  SELECT id INTO user_id FROM app_users WHERE external_id = 'single-user';

  IF user_id IS NULL THEN
    INSERT INTO app_users (id, external_id, display_name, locale, timezone, is_active, profile_json)
    VALUES (generate_uuid_v4(), 'single-user', 'single-user', 'zh-CN', 'Asia/Shanghai', true, '{}'::jsonb);

    SELECT id INTO user_id FROM app_users WHERE external_id = 'single-user';
  END IF;

  -- 初始化配置
  DELETE FROM app_settings WHERE user_id = user_id;

  INSERT INTO app_settings (user_id, ui_settings, chat_settings, model_settings, plugin_settings, sync_settings, security_settings, extra_settings)
  VALUES (
    user_id,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb
  );

  RAISE NOTICE '配置初始化完成！用户 ID: %', user_id;
END $$;
EOF
```

**执行成功后会显示：**

```
NOTICE:  配置初始化完成！用户 ID: <uuid>
```

### 验证修复

```bash
# 检查配置是否创建
PGPASSWORD=your-password psql -h 127.0.0.1 -U nextchat_user -d nextchat -c "SELECT COUNT(*) FROM app_settings;"
```

**应该返回：**

```
 count
-------
     1
```

---

## 测试同步功能

1. **刷新浏览器**
2. **点击右上角设置**
3. **点击 "保存并同步"**
4. **应该显示"配置已保存"，不再报错**

---

## 完整的部署顺序（包含初始化）

### 1. 部署 NextChat 容器

按照正常流程部署容器（参考主安装指南）

### 2. 容器启动后，执行初始化配置脚本

```bash
PGPASSWORD=your-password psql -h 127.0.0.1 -U nextchat_user -d nextchat << 'EOF'
DO $$
DECLARE
  user_id uuid;
BEGIN
  SELECT id INTO user_id FROM app_users WHERE external_id = 'single-user';

  IF user_id IS NULL THEN
    INSERT INTO app_users (id, external_id, display_name, locale, timezone, is_active, profile_json)
    VALUES (generate_uuid_v4(), 'single-user', 'single-user', 'zh-CN', 'Asia/Shanghai', true, '{}'::jsonb);

    SELECT id INTO user_id FROM app_users WHERE external_id = 'single-user';
  END IF;

  DELETE FROM app_settings WHERE user_id = user_id;

  INSERT INTO app_settings (user_id, ui_settings, chat_settings, model_settings, plugin_settings, sync_settings, security_settings, extra_settings)
  VALUES (
    user_id,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb
  );

  RAISE NOTICE '配置初始化完成！';
END $$;
EOF
```

### 3. 刷新浏览器，测试同步功能

- 点击设置
- 点击"保存并同步"
- 应该正常工作

---

## 为什么会出现这个问题？

### 数据库初始化流程

NextChat 的数据库初始化流程：

1. **创建数据库表结构** - 自动执行
2. **创建用户记录** - 首次访问时自动创建
3. **创建配置记录** - **需要手动执行或通过界面触发**

### 问题出现的原因

- 部署后直接访问网页，用户记录创建了
- 但配置记录（app_settings）没有自动创建
- 导致同步功能找不到配置数据

### 本地开发 vs 服务器部署

| 环境 | 配置初始化 |
|------|-------------|
| 本地开发 | 首次使用时自动创建 |
| 服务器部署 | 需要手动初始化 |

---

## 自动化初始化脚本

如果希望容器启动时自动初始化，可以创建一个启动脚本：

```bash
# 创建启动脚本
cat > /www/wwwroot/nextchat/init-config.sh << 'EOF'
#!/bin/bash

# 等待数据库就绪
sleep 10

# 初始化配置
PGPASSWORD="${PGPASSWORD}" psql -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" << 'SQLEOF'
DO $$
DECLARE
  user_id uuid;
BEGIN
  SELECT id INTO user_id FROM app_users WHERE external_id = '${NEXT_PUBLIC_DEFAULT_SYNC_USER_ID}';

  IF user_id IS NULL THEN
    INSERT INTO app_users (id, external_id, display_name, locale, timezone, is_active, profile_json)
    VALUES (generate_uuid_v4(), '${NEXT_PUBLIC_DEFAULT_SYNC_USER_ID}', '${NEXT_PUBLIC_DEFAULT_SYNC_USER_ID}', 'zh-CN', 'Asia/Shanghai', true, '{}'::jsonb);

    SELECT id INTO user_id FROM app_users WHERE external_id = '${NEXT_PUBLIC_DEFAULT_SYNC_USER_ID}';
  END IF;

  DELETE FROM app_settings WHERE user_id = user_id;

  INSERT INTO app_settings (user_id, ui_settings, chat_settings, model_settings, plugin_settings, sync_settings, security_settings, extra_settings)
  VALUES (
    user_id,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb
  );

  RAISE NOTICE '配置自动初始化完成！';
END $$;
SQLEOF

echo "配置初始化完成"
EOF

chmod +x /www/wwwroot/nextchat/init-config.sh
```

然后在 `docker-compose.baota.yml` 中添加启动钩子。

---

## 预防措施

为了避免这个问题，建议：

1. **部署完成后立即执行初始化脚本**
2. **在部署文档中作为必需步骤**
3. **提供自动化初始化方案**

---

## 相关文档

- [完整安装指南](docs/BAOTA_INSTALL_GUIDE.md) - 包含初始化步骤的完整部署流程
- [快速开始指南](docs/baota-quick-start.md) - 快速部署步骤
- [自定义镜像部署](docs/baota-custom-provider.md) - 使用自定义镜像的部署说明
