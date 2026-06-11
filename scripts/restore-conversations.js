#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BACKUP_DIR = process.argv[2] || '/tmp/db-backup';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// 用户ID映射：备份中的admin -> 当前数据库的admin
const USER_ID_MAP = {
  '5aee9a15-f9c9-49c6-9c39-12e58ac9c25e': '30764ca3-d589-4ad7-bd20-02fe1c5cc1d2'
};

async function restoreConversations() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const conversationsBackup = JSON.parse(
      fs.readFileSync(path.join(BACKUP_DIR, 'conversations.json'), 'utf8')
    );
    
    const messagesBackup = JSON.parse(
      fs.readFileSync(path.join(BACKUP_DIR, 'messages.json'), 'utf8')
    );

    console.log(`\n备份数据统计:`);
    console.log(`  对话数: ${conversationsBackup.rowCount}`);
    console.log(`  消息数: ${messagesBackup.rowCount}`);

    let conversationsInserted = 0;
    let conversationsSkipped = 0;
    let messagesInserted = 0;
    let messagesSkipped = 0;

    // 恢复对话
    console.log(`\n开始恢复对话...`);
    for (const conv of conversationsBackup.data) {
      // 跳过user:admin的对话
      if (!USER_ID_MAP[conv.user_id]) {
        conversationsSkipped++;
        continue;
      }

      // 检查对话是否已存在
      const checkResult = await client.query(
        'SELECT id FROM conversations WHERE id = $1',
        [conv.id]
      );

      if (checkResult.rows.length > 0) {
        conversationsSkipped++;
        continue;
      }

      // 映射用户ID
      const newUserId = USER_ID_MAP[conv.user_id];

      // 插入对话
      await client.query(`
        INSERT INTO conversations (
          id, user_id, external_session_id, provider_config_id,
          title, summary, system_prompt, model_name, provider_name,
          conversation_type, is_archived, is_pinned, is_deleted,
          metadata_json, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `, [
        conv.id,
        newUserId,
        conv.external_session_id,
        conv.provider_config_id,
        conv.title,
        conv.summary,
        conv.system_prompt,
        conv.model_name,
        conv.provider_name,
        conv.conversation_type,
        conv.is_archived,
        conv.is_pinned,
        conv.is_deleted,
        conv.metadata_json,
        conv.created_at,
        conv.updated_at
      ]);

      conversationsInserted++;
    }

    console.log(`  ✅ 插入: ${conversationsInserted}, 跳过: ${conversationsSkipped}`);

    // 恢复消息
    console.log(`\n开始恢复消息...`);
    for (const msg of messagesBackup.data) {
      // 检查对应的对话是否存在
      const convCheck = await client.query(
        'SELECT id FROM conversations WHERE id = $1',
        [msg.conversation_id]
      );

      if (convCheck.rows.length === 0) {
        messagesSkipped++;
        continue;
      }

      // 检查消息是否已存在
      const msgCheck = await client.query(
        'SELECT id FROM messages WHERE id = $1',
        [msg.id]
      );

      if (msgCheck.rows.length > 0) {
        messagesSkipped++;
        continue;
      }

      // 插入消息
      await client.query(`
        INSERT INTO messages (
          id, conversation_id, parent_id, external_message_id,
          seq, role, status, model_name, provider_name,
          content_text, content_json, metadata_json,
          created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `, [
        msg.id,
        msg.conversation_id,
        msg.parent_id,
        msg.external_message_id,
        msg.seq,
        msg.role,
        msg.status,
        msg.model_name,
        msg.provider_name,
        msg.content_text,
        msg.content_json,
        msg.metadata_json,
        msg.created_at,
        msg.updated_at
      ]);

      messagesInserted++;
    }

    console.log(`  ✅ 插入: ${messagesInserted}, 跳过: ${messagesSkipped}`);

    await client.query('COMMIT');

    console.log(`\n========================================`);
    console.log(`恢复完成！`);
    console.log(`  对话: 插入 ${conversationsInserted}, 跳过 ${conversationsSkipped}`);
    console.log(`  消息: 插入 ${messagesInserted}, 跳过 ${messagesSkipped}`);
    console.log(`========================================\n`);

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  try {
    console.log('开始恢复对话数据...');
    console.log(`备份目录: ${BACKUP_DIR}\n`);

    await restoreConversations();

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('恢复失败:', err);
    await pool.end();
    process.exit(1);
  }
}

main();
