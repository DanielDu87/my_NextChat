#!/usr/bin/env node
/* eslint-disable no-console */
// 数据库预检脚本：迁移前只读检查（兼容表已缺失的情况）
const { Client } = require("pg");

async function tableExists(client, name) {
  const r = await client.query(`
    select exists (
      select 1 from information_schema.tables
      where table_schema='public' and table_name=$1
    ) as e
  `, [name]);
  return r.rows[0].e;
}

async function countRows(client, name) {
  if (!(await tableExists(client, name))) return "不存在";
  const r = await client.query(`select count(*)::text as c from "${name}"`);
  return `${r.rows[0].c} 行`;
}

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
    console.log("[ok] 已连接到数据库");

    // 1. 列出所有表
    const tables = await client.query(`
      select table_name,
             pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) as size
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `);
    console.log(`\n[1] 当前 public schema 共 ${tables.rows.length} 张表:`);
    tables.rows.forEach((r) => console.log(`  - ${r.table_name} (${r.size})`));

    // 2. 4 张模型表
    console.log(`\n[2] 4 张待下线模型表:`);
    for (const t of ["user_model_refresh_states","model_catalog","model_sync_runs","model_source_index_snapshots"]) {
      console.log(`  - ${t}: ${await countRows(client, t)}`);
    }

    // 3. 3 个待删除索引
    const idx = await client.query(`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'idx_messages_conversation_seq',
          'idx_provider_configs_user_id',
          'idx_provider_api_keys_provider_config_id'
        )
    `);
    console.log(`\n[3] 3 个待删除索引:`);
    if (idx.rows.length === 0) {
      console.log("  (均不存在，迁移可跳过)");
    } else {
      idx.rows.forEach((r) => console.log(`  - ${r.indexname}`));
    }

    // 4. last_login_at
    const lastLogin = await client.query(`
      select column_name
      from information_schema.columns
      where table_schema='public' and table_name='app_users' and column_name='last_login_at'
    `);
    console.log(`\n[4] app_users.last_login_at: ${lastLogin.rows.length > 0 ? "存在（需 drop）" : "不存在（已干净）"}`);

    // 5. 3 个待补齐列
    const newCols = await client.query(`
      select table_name, column_name
      from information_schema.columns
      where table_schema='public'
        and ((table_name='provider_configs' and column_name in ('api_path','api_format'))
          or (table_name='provider_api_keys' and column_name='last_verified_at'))
      order by table_name, column_name
    `);
    console.log(`\n[5] 3 个待补齐列:`);
    const expected = ["provider_configs.api_path","provider_configs.api_format","provider_api_keys.last_verified_at"];
    const found = newCols.rows.map((r) => `${r.table_name}.${r.column_name}`);
    expected.forEach((e) => console.log(`  - ${e}: ${found.includes(e) ? "已存在" : "需补齐"}`));

    // 6. app_settings 历史列
    const histCols = await client.query(`
      select column_name
      from information_schema.columns
      where table_schema='public' and table_name='app_settings'
        and column_name in ('ui_settings','model_settings','sync_settings')
      order by column_name
    `);
    console.log(`\n[6] app_settings 历史列:`);
    if (histCols.rows.length === 0) {
      console.log("  (均不存在，干净)");
    } else {
      histCols.rows.forEach((r) => console.log(`  - ${r.column_name} 存在（需 drop）`));
    }

    // 7. 11 张历史/预留表
    const histTables = [
      "user_app_update_state","user_custom_models","user_model_cache",
      "user_plugins","user_masks","user_prompts","user_sd_tasks",
      "message_attachments","tags","share_links","model_aliases",
    ];
    console.log(`\n[7] 11 张历史/预留空表:`);
    for (const t of histTables) {
      console.log(`  - ${t}: ${await tableExists(client, t) ? "存在" : "不存在"}`);
    }

    // 8. 当前 schemaVersion
    const appVersion = await client.query(`
      select setting_value
      from _app_meta
      where setting_key = 'schema_version'
      limit 1
    `).catch(() => ({ rows: [] }));
    console.log(`\n[8] _app_meta.schema_version: ${appVersion.rows[0]?.setting_value || "(无 _app_meta 表或未设置)"}`);

    console.log("\n[done] 预检完成");
  } catch (e) {
    console.error("[error]", e.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main();
