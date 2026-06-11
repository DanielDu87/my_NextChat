#!/usr/bin/env node
/* eslint-disable no-console */
// 数据库迁移后全面审计脚本（只读）
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

async function columnExists(client, table, column) {
  const r = await client.query(`
    select exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=$1 and column_name=$2
    ) as e
  `, [table, column]);
  return r.rows[0].e;
}

async function indexExists(client, name) {
  const r = await client.query(`
    select exists (
      select 1 from pg_indexes
      where schemaname='public' and indexname=$1
    ) as e
  `, [name]);
  return r.rows[0].e;
}

async function run(client, sql, params) {
  const r = await client.query(sql, params);
  return r.rows;
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

  const audit = {};

  try {
    await client.connect();
    console.log("[ok] 已连接到数据库\n");

    // ============================================================
    // 1) 9 张核心表 + 行数
    // ============================================================
    const coreTables = [
      "app_users","auth_sessions","app_settings",
      "conversations","messages",
      "provider_configs","provider_api_keys",
      "sync_secrets","site_access_settings",
    ];
    audit.coreTables = {};
    for (const t of coreTables) {
      const ok = await tableExists(client, t);
      if (ok) {
        const r = await run(client, `select count(*)::text as c from "${t}"`);
        audit.coreTables[t] = Number(r[0].c);
      } else {
        audit.coreTables[t] = "MISSING";
      }
    }
    console.log("[1] 9 张核心表行数:");
    for (const [t, c] of Object.entries(audit.coreTables)) {
      console.log(`  - ${t}: ${c}`);
    }

    // ============================================================
    // 2) 4 张已下线模型表 = 0
    // ============================================================
    const modelTables = ["user_model_refresh_states","model_catalog","model_sync_runs","model_source_index_snapshots"];
    audit.modelTables = {};
    for (const t of modelTables) {
      audit.modelTables[t] = await tableExists(client, t) ? "存在（异常）" : "已下线";
    }
    console.log("\n[2] 4 张下线模型表 (期望全部已下线):");
    for (const [t, s] of Object.entries(audit.modelTables)) {
      console.log(`  - ${t}: ${s}`);
    }

    // ============================================================
    // 3) 3 个冗余索引 = 0
    // ============================================================
    const redundantIdx = [
      "idx_messages_conversation_seq",
      "idx_provider_configs_user_id",
      "idx_provider_api_keys_provider_config_id",
    ];
    audit.redundantIdx = {};
    for (const i of redundantIdx) {
      audit.redundantIdx[i] = await indexExists(client, i) ? "存在（异常）" : "已删除";
    }
    console.log("\n[3] 3 个冗余索引 (期望全部已删除):");
    for (const [i, s] of Object.entries(audit.redundantIdx)) {
      console.log(`  - ${i}: ${s}`);
    }

    // ============================================================
    // 4) 关键列就位
    // ============================================================
    const expectedCols = [
      ["app_users","last_chat_at"],
      ["app_users","last_login_at"],
      ["app_settings","chat_settings"],
      ["app_settings","plugin_settings"],
      ["app_settings","security_settings"],
      ["app_settings","extra_settings"],
      ["app_settings","ui_settings"],
      ["app_settings","model_settings"],
      ["app_settings","sync_settings"],
      ["provider_configs","api_path"],
      ["provider_configs","api_format"],
      ["provider_api_keys","last_verified_at"],
      ["messages","reasoning_text"],
      ["messages","tool_calls"],
      ["messages","metadata_json"],
    ];
    audit.columns = {};
    for (const [t, c] of expectedCols) {
      audit.columns[`${t}.${c}`] = await columnExists(client, t, c) ? "存在" : "不存在";
    }
    console.log("\n[4] 关键列:");
    for (const [k, v] of Object.entries(audit.columns)) {
      console.log(`  - ${k}: ${v}`);
    }

    // ============================================================
    // 5) 11 张历史/预留表 = 0
    // ============================================================
    const histTables = [
      "user_app_update_state","user_custom_models","user_model_cache",
      "user_plugins","user_masks","user_prompts","user_sd_tasks",
      "message_attachments","tags","share_links","model_aliases",
    ];
    audit.histTables = {};
    for (const t of histTables) {
      audit.histTables[t] = await tableExists(client, t) ? "存在（异常）" : "已下线";
    }
    console.log("\n[5] 11 张历史/预留表 (期望全部已下线):");
    for (const [t, s] of Object.entries(audit.histTables)) {
      console.log(`  - ${t}: ${s}`);
    }

    // ============================================================
    // 6) 重复数据
    // ============================================================
    console.log("\n[6] 重复数据审计:");
    const dupChecks = [
      {
        name: "app_users external_id 重复",
        sql: `select external_id, count(*) c from app_users
              where external_id is not null group by external_id having count(*) > 1`,
      },
      {
        name: "app_users username 大小写冲突",
        sql: `select lower(username) u, count(*) c from app_users
              where username is not null group by lower(username) having count(*) > 1`,
      },
      {
        name: "provider_configs (user_id, provider_code) 重复",
        sql: `select user_id::text, provider_code, count(*) c from provider_configs
              group by 1,2 having count(*) > 1`,
      },
      {
        name: "provider_api_keys (provider_config_id, key_name) 重复",
        sql: `select provider_config_id::text, key_name, count(*) c from provider_api_keys
              group by 1,2 having count(*) > 1`,
      },
      {
        name: "conversations (user_id, external_session_id) 重复",
        sql: `select user_id::text, external_session_id, count(*) c from conversations
              where external_session_id is not null
              group by 1,2 having count(*) > 1`,
      },
      {
        name: "messages (conversation_id, seq) 重复",
        sql: `select conversation_id::text, seq, count(*) c from messages
              group by 1,2 having count(*) > 1`,
      },
      {
        name: "sync_secrets (user_id, secret_key) 重复",
        sql: `select user_id, secret_key, count(*) c from sync_secrets
              group by 1,2 having count(*) > 1`,
      },
    ];
    audit.duplicates = {};
    for (const c of dupChecks) {
      const r = await run(client, c.sql);
      audit.duplicates[c.name] = r.length === 0 ? "无重复" : `${r.length} 组重复`;
      console.log(`  - ${c.name}: ${audit.duplicates[c.name]}`);
    }

    // ============================================================
    // 7) 孤儿数据
    // ============================================================
    console.log("\n[7] 孤儿数据审计:");
    const orphanChecks = [
      {
        name: "auth_sessions.user_id 孤儿",
        sql: `select count(*) c from auth_sessions s
              left join app_users u on u.id = s.user_id
              where u.id is null`,
      },
      {
        name: "provider_configs.user_id 孤儿",
        sql: `select count(*) c from provider_configs pc
              left join app_users u on u.id = pc.user_id
              where u.id is null`,
      },
      {
        name: "provider_api_keys.provider_config_id 孤儿",
        sql: `select count(*) c from provider_api_keys pak
              left join provider_configs pc on pc.id = pak.provider_config_id
              where pc.id is null`,
      },
      {
        name: "app_settings.user_id 孤儿",
        sql: `select count(*) c from app_settings s
              left join app_users u on u.id = s.user_id
              where u.id is null`,
      },
      {
        name: "conversations.user_id 孤儿",
        sql: `select count(*) c from conversations c
              left join app_users u on u.id = c.user_id
              where u.id is null`,
      },
      {
        name: "messages.conversation_id 孤儿",
        sql: `select count(*) c from messages m
              left join conversations c on c.id = m.conversation_id
              where c.id is null`,
      },
    ];
    audit.orphans = {};
    for (const c of orphanChecks) {
      const r = await run(client, c.sql);
      audit.orphans[c.name] = `${r[0].c} 条`;
      console.log(`  - ${c.name}: ${audit.orphans[c.name]}`);
    }

    // ============================================================
    // 8) 异常数据
    // ============================================================
    console.log("\n[8] 异常数据审计:");
    const abnormalChecks = [
      {
        name: "app_users.is_active 分布",
        sql: `select is_active, count(*) c from app_users group by 1`,
        format: (rows) => rows.map((r) => `${r.is_active}=${r.c}`).join(", "),
      },
      {
        name: "app_users.last_chat_at 是否为 NULL",
        sql: `select
                count(*) filter (where last_chat_at is null) as null_count,
                count(*) filter (where last_chat_at is not null) as non_null_count
              from app_users`,
        format: (rows) => `null=${rows[0].null_count}, non_null=${rows[0].non_null_count}`,
      },
      {
        name: "auth_sessions 过期 vs 活跃",
        sql: `select
                count(*) filter (where expires_at > now()) as active,
                count(*) filter (where expires_at <= now()) as expired
              from auth_sessions`,
        format: (rows) => `active=${rows[0].active}, expired=${rows[0].expired}`,
      },
      {
        name: "conversations.is_archived/is_pinned/is_deleted 分布",
        sql: `select is_archived, is_pinned, is_deleted, count(*) c
              from conversations group by 1,2,3 order by 1,2,3`,
        format: (rows) => rows.length === 0
          ? "无"
          : rows.map((r) => `archived=${r.is_archived}/pinned=${r.is_pinned}/deleted=${r.is_deleted} → ${r.c}`).join("; "),
      },
      {
        name: "conversations.metadata_json 非空行数",
        sql: `select
                count(*) filter (where metadata_json = '{}'::jsonb) as empty,
                count(*) filter (where metadata_json <> '{}'::jsonb) as non_empty
              from conversations`,
        format: (rows) => `empty=${rows[0].empty}, non_empty=${rows[0].non_empty}`,
      },
      {
        name: "messages.role 异常枚举",
        sql: `select distinct role from messages
              where role not in ('system','user','assistant','tool')`,
        format: (rows) => rows.length === 0 ? "无" : rows.map((r) => r.role).join(", "),
      },
      {
        name: "messages.content_text/json 双空",
        sql: `select count(*) c from messages
              where (content_text is null or content_text = '')
                and (content_json is null or content_json = '{}'::jsonb)`,
        format: (rows) => `${rows[0].c} 条`,
      },
      {
        name: "messages.reasoning_text 填充率",
        sql: `select
                count(*) filter (where reasoning_text is not null and reasoning_text <> '') as filled,
                count(*) as total
              from messages`,
        format: (rows) => `${rows[0].filled}/${rows[0].total}`,
      },
      {
        name: "messages.tool_calls 填充率",
        sql: `select
                count(*) filter (where tool_calls <> '[]'::jsonb) as filled,
                count(*) as total
              from messages`,
        format: (rows) => `${rows[0].filled}/${rows[0].total}`,
      },
    ];
    audit.abnormal = {};
    for (const c of abnormalChecks) {
      const r = await run(client, c.sql);
      audit.abnormal[c.name] = c.format(r);
      console.log(`  - ${c.name}: ${audit.abnormal[c.name]}`);
    }

    // ============================================================
    // 9) 索引清单
    // ============================================================
    console.log("\n[9] 全部索引清单:");
    const allIdx = await run(client, `
      select tablename, indexname
      from pg_indexes
      where schemaname = 'public'
      order by tablename, indexname
    `);
    audit.indexes = allIdx;
    for (const r of allIdx) {
      console.log(`  - ${r.tablename}.${r.indexname}`);
    }

    // ============================================================
    // 10) 索引使用情况
    // ============================================================
    console.log("\n[10] 索引使用情况 (pg_stat_user_indexes):");
    const idxStat = await run(client, `
      select relname as tablename, indexrelname as indexname,
             idx_scan, idx_tup_read, idx_tup_fetch
      from pg_stat_user_indexes
      where schemaname = 'public'
      order by relname, indexrelname
    `);
    audit.idxStat = idxStat;
    for (const r of idxStat) {
      console.log(`  - ${r.tablename}.${r.indexname}: scan=${r.idx_scan}, read=${r.idx_tup_read}`);
    }

    // ============================================================
    // 11) 软删除空壳会话
    // ============================================================
    console.log("\n[11] 软删除空壳会话:");
    const emptyDeleted = await run(client, `
      select count(*) c from conversations c
      where c.is_deleted = true
        and not exists (select 1 from messages m where m.conversation_id = c.id)
    `);
    audit.emptyDeleted = Number(emptyDeleted[0].c);
    console.log(`  - conversations.is_deleted=true 且无 messages: ${audit.emptyDeleted} 条`);

    // ============================================================
    // 12) 评估结果
    // ============================================================
    console.log("\n[12] 评估结果:");
    const issues = [];

    if (Object.values(audit.modelTables).some((s) => s === "存在（异常）")) {
      issues.push("存在未下线的模型表");
    }
    if (Object.values(audit.redundantIdx).some((s) => s === "存在（异常）")) {
      issues.push("存在未删除的冗余索引");
    }
    if (Object.values(audit.histTables).some((s) => s === "存在（异常）")) {
      issues.push("存在未清理的历史/预留表");
    }
    if (audit.columns["app_users.last_login_at"] === "存在") {
      issues.push("app_users.last_login_at 未 drop");
    }
    if (audit.columns["app_settings.ui_settings"] === "存在" ||
        audit.columns["app_settings.model_settings"] === "存在" ||
        audit.columns["app_settings.sync_settings"] === "存在") {
      issues.push("app_settings 仍存在历史列");
    }
    if (Object.values(audit.duplicates).some((s) => s !== "无重复")) {
      issues.push("存在重复数据");
    }
    if (Object.entries(audit.orphans).some(([k, v]) => v !== "0 条" && !v.startsWith("0"))) {
      const nonZero = Object.entries(audit.orphans).filter(([, v]) => !v.startsWith("0"));
      if (nonZero.length > 0) {
        issues.push(`存在孤儿数据: ${nonZero.map(([k]) => k).join("; ")}`);
      }
    }

    if (issues.length === 0) {
      console.log("  ✅ 全部通过，无异常");
    } else {
      console.log("  ⚠️ 发现问题:");
      issues.forEach((i) => console.log(`    - ${i}`));
    }

    console.log("\n[done] 迁移后审计完成");
  } catch (e) {
    console.error("[error]", e.message);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main();
