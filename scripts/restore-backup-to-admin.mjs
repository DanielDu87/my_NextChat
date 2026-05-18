#!/usr/bin/env node

/**
 * 将备份中的所有对话合并导入到 admin 用户
 * 跳过已存在的对话（按 external_session_id 判断）
 */

import { Pool } from "pg";
import { readFileSync } from "fs";
import { join } from "path";

const BACKUP_DIR = "/Users/dyx/Code/NextChat/db-backup-20260514-165123";
const DATABASE_URL =
  "postgresql://dyx:NrCCTyikNREXjiZ6@localhost:15432/nextchat";

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    // 读取备份数据
    const conversations = JSON.parse(
      readFileSync(join(BACKUP_DIR, "conversations.json"), "utf-8")
    ).data;
    const messages = JSON.parse(
      readFileSync(join(BACKUP_DIR, "messages.json"), "utf-8")
    ).data;

    console.log(
      `备份: ${conversations.length} 个对话, ${messages.length} 条消息`
    );

    // 获取 admin 用户 ID
    const { rows } = await pool.query(
      "SELECT id::text FROM app_users WHERE lower(username) = 'admin' LIMIT 1"
    );
    const adminUserId = rows[0].id;
    console.log(`admin 用户 ID: ${adminUserId}`);

    // 获取备份用户 ID（所有对话都属于同一用户）
    const backupUserId = conversations[0].user_id;
    console.log(`备份用户 ID: ${backupUserId}`);

    // 查找备份用户对应的 admin 的 external_id
    const { rows: adminUserRows } = await pool.query(
      "SELECT external_id FROM app_users WHERE id = $1::uuid",
      [adminUserId]
    );
    const adminExternalId = adminUserRows[0].external_id;
    console.log(`admin external_id: ${adminExternalId}`);

    // 获取已有对话的 external_session_id
    const { rows: existing } = await pool.query(
      "SELECT external_session_id FROM conversations WHERE user_id = $1::uuid AND external_session_id IS NOT NULL",
      [adminUserId]
    );
    const existingIds = new Set(existing.map((r) => r.external_session_id));
    console.log(`admin 已有 ${existingIds.size} 个对话`);

    // 按消息数分类
    const msgByConvId = {};
    for (const msg of messages) {
      if (!msgByConvId[msg.conversation_id]) {
        msgByConvId[msg.conversation_id] = [];
      }
      msgByConvId[msg.conversation_id].push(msg);
    }

    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i];
      const extId = conv.external_session_id;

      if (!extId || existingIds.has(extId)) {
        skipped++;
        continue;
      }

      const convMessages = msgByConvId[conv.id] || [];
      const hasRealMessages = convMessages.some(
        (m) => m.content_text && m.content_text.trim().length > 0
      );
      // 也检查 content_json 中的消息
      const hasJsonMessages = convMessages.some((m) => {
        const cj = m.content_json;
        if (!cj) return false;
        if (typeof cj === "string") {
          try {
            const parsed = JSON.parse(cj);
            return parsed.content && String(parsed.content).trim().length > 0;
          } catch {
            return false;
          }
        }
        if (cj.content) return String(cj.content).trim().length > 0;
        return false;
      });

      // 构建正确的 metadata_json（包含同步系统需要的字段）
      const oldMetadata =
        typeof conv.metadata_json === "string"
          ? JSON.parse(conv.metadata_json || "{}")
          : conv.metadata_json || {};
      const metadataJson = {
        ...oldMetadata,
        id: extId,
        topic: conv.title || "新的聊天",
        _syncMessageCount: convMessages.length,
        _syncIndexOrder: i,
      };

      // 确保 createdAt/lastUpdate 存在
      if (!metadataJson.createdAt && conv.created_at) {
        metadataJson.createdAt = new Date(conv.created_at).getTime();
      }
      if (!metadataJson.lastUpdate && conv.updated_at) {
        metadataJson.lastUpdate = new Date(conv.updated_at).getTime();
      }

      // 插入对话
      await pool.query(
        `INSERT INTO conversations (id, user_id, external_session_id, title, model_name, provider_name, conversation_type, metadata_json, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          conv.id,
          adminUserId,
          extId,
          conv.title,
          conv.model_name || null,
          conv.provider_name || null,
          conv.conversation_type || "chat",
          JSON.stringify(metadataJson),
          conv.created_at || new Date().toISOString(),
          conv.updated_at || new Date().toISOString(),
        ]
      );

      // 插入消息
      for (const msg of convMessages) {
        const contentJson =
          typeof msg.content_json === "string"
            ? msg.content_json
            : JSON.stringify(msg.content_json || {});
        const metadataJsonMsg =
          typeof msg.metadata_json === "string"
            ? msg.metadata_json
            : JSON.stringify(msg.metadata_json || {});

        await pool.query(
          `INSERT INTO messages (id, conversation_id, external_message_id, seq, role, status, content_text, content_json, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
           ON CONFLICT (id) DO NOTHING`,
          [
            msg.id,
            conv.id,
            msg.external_message_id || null,
            msg.seq ?? 0,
            msg.role || "user",
            msg.status || "done",
            msg.content_text || null,
            contentJson,
            msg.created_at || new Date().toISOString(),
            msg.updated_at || new Date().toISOString(),
          ]
        );
      }

      imported++;
      if (conv.title && conv.title !== "新的聊天") {
        console.log(
          `  ✅ [${imported}] ${conv.title} (${convMessages.length} 条消息)`
        );
      }
    }

    console.log(`\n🎉 导入完成: ${imported} 个新对话, ${skipped} 个跳过`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ 错误:", err);
  process.exit(1);
});
