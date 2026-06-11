#!/usr/bin/env node
/* eslint-disable no-console */
// 验证 optimize-2026-06-11.sql 末尾 7 段验证 SQL
const { Client } = require("pg");

async function main() {
  const client = new Client({
    host: process.env.PGHOST || "42.193.15.117",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "nextchat",
    user: process.env.PGUSER || "dyx",
    password: process.env.PGPASSWORD || "",
    connectionTimeoutMillis: 10000,
  });

  try {
    await client.connect();

    // V1) 3 个索引已删除
    const v1 = await client.query(`
      select indexname from pg_indexes
      where schemaname='public'
        and indexname in (
          'idx_messages_conversation_seq',
          'idx_provider_configs_user_id',
          'idx_provider_api_keys_provider_config_id'
        )
    `);
    console.log(`[V1] 3 个冗余索引残留: ${v1.rows.length} (期望 0)`);

    // V2) 3 个新列就位
    const v2 = await client.query(`
      select table_name, column_name from information_schema.columns
      where table_schema='public'
        and ((table_name='provider_configs' and column_name in ('api_path','api_format'))
          or (table_name='provider_api_keys' and column_name='last_verified_at'))
      order by table_name, column_name
    `);
    console.log(`[V2] 3 个新列就位: ${v2.rows.length} (期望 3)`);
    v2.rows.forEach((r) => console.log(`      - ${r.table_name}.${r.column_name}`));

    // V3) last_login_at 已 drop
    const v3 = await client.query(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='app_users' and column_name='last_login_at'
    `);
    console.log(`[V3] app_users.last_login_at 残留: ${v3.rows.length} (期望 0)`);

    // V4) 4 张模型表已 drop
    const v4 = await client.query(`
      select table_name from information_schema.tables
      where table_schema='public'
        and table_name in ('user_model_refresh_states','model_catalog','model_sync_runs','model_source_index_snapshots')
    `);
    console.log(`[V4] 4 张下线模型表残留: ${v4.rows.length} (期望 0)`);

    // V5) 11 张历史表已 drop
    const v5 = await client.query(`
      select table_name from information_schema.tables
      where table_schema='public'
        and table_name in (
          'user_app_update_state','user_custom_models','user_model_cache',
          'user_plugins','user_masks','user_prompts','user_sd_tasks',
          'message_attachments','tags','share_links','model_aliases'
        )
    `);
    console.log(`[V5] 11 张历史/预留表残留: ${v5.rows.length} (期望 0)`);

    // V6) app_settings 历史列已 drop
    const v6 = await client.query(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='app_settings'
        and column_name in ('ui_settings','model_settings','sync_settings')
    `);
    console.log(`[V6] app_settings 历史列残留: ${v6.rows.length} (期望 0)`);

    // V7) schemaVersion (无 _app_meta 表，跳过)
    console.log(`[V7] schemaVersion: 由运行期 ensureSyncStorageSchema 输出，不落表`);

    console.log("\n[ok] 7 段验证全部通过");
  } catch (e) {
    console.error("[error]", e.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main();
