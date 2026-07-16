import { createHash } from "crypto";
import { buildNormalizedChatIndexSnapshot } from "./chat-conversation-repository";
import {
  getChatIndexState,
  setChatIndexState,
} from "./app-settings-repository";
import { getOrCreateSyncAppUserId } from "./sync-app-user";
import {
  backupPgQuery,
  ensureBackupStorageSchema,
  withBackupPgTransaction,
} from "./backup-postgres";
import {
  ensureSyncStorageSchema,
  pgQuery,
  withPgTransaction,
} from "./postgres";

export async function getChatBackupSettings(externalUserId: string) {
  await ensureBackupStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await backupPgQuery<{
    enabled: boolean;
    interval_minutes: number;
    max_backups: number;
  }>(
    `select enabled, interval_minutes, max_backups
     from backup_chat_settings where user_id = $1::uuid`,
    [userId],
  );
  const row = result.rows[0];
  return {
    enabled: row?.enabled ?? true,
    intervalMinutes: row?.interval_minutes ?? 1440,
    maxBackups: row?.max_backups ?? 30,
  };
}

export async function saveChatBackupSettings(
  externalUserId: string,
  settings: { enabled: boolean; intervalMinutes: number; maxBackups: number },
) {
  await ensureBackupStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  await backupPgQuery(
    `insert into backup_chat_settings (user_id, external_user_id, enabled, interval_minutes, max_backups)
     values ($1::uuid, $2, $3, $4, $5)
     on conflict (user_id) do update set
       external_user_id = excluded.external_user_id,
       enabled = excluded.enabled,
       interval_minutes = excluded.interval_minutes,
       max_backups = excluded.max_backups`,
    [
      userId,
      externalUserId,
      settings.enabled,
      settings.intervalMinutes,
      settings.maxBackups,
    ],
  );
  await pruneChatBackups(externalUserId, settings.maxBackups);
  console.log(
    `[Chat Backup] ✅ 自动备份设置已保存（启用=${settings.enabled}，间隔=${settings.intervalMinutes} 分钟，保留=${settings.maxBackups}）`,
  );
  return settings;
}

export async function pruneChatBackups(externalUserId: string, max: number) {
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await backupPgQuery(
    `delete from backup_chat_runs where id in (
       select id from backup_chat_runs where user_id = $1::uuid
       order by created_at desc offset $2
     )`,
    [userId, max],
  );
  if ((result.rowCount ?? 0) > 0) {
    console.log(
      `[Chat Backup] 🧹 已清理 ${result.rowCount} 条超出保留数量（${max}）的旧备份`,
    );
  }
}

type JsonObject = Record<string, unknown>;

export type ChatBackupSource = "manual" | "auto";
export type ChatBackupBatchMemberStatus = "created" | "skipped" | "failed";

export type ChatBackupBatchMember = {
  userId: string;
  externalUserId: string;
  status: ChatBackupBatchMemberStatus;
  reason?: string;
  sessionCount?: number;
  messageCount?: number;
};

export async function createChatBackupBatch(
  batchId: string,
  source: ChatBackupSource,
) {
  await ensureBackupStorageSchema();
  await backupPgQuery(
    `insert into backup_chat_batches (id, source)
     values ($1::uuid, $2)
     on conflict (id) do nothing`,
    [batchId, source],
  );
}

export async function saveChatBackupBatchMember(
  batchId: string,
  member: ChatBackupBatchMember,
) {
  await ensureBackupStorageSchema();
  await backupPgQuery(
    `insert into backup_chat_batch_members (
       batch_id, user_id, external_user_id, status, reason, session_count, message_count
     ) values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
     on conflict (batch_id, user_id) do update set
       external_user_id = excluded.external_user_id,
       status = excluded.status,
       reason = excluded.reason,
       session_count = excluded.session_count,
       message_count = excluded.message_count`,
    [
      batchId,
      member.userId,
      member.externalUserId,
      member.status,
      member.reason || null,
      member.sessionCount || 0,
      member.messageCount || 0,
    ],
  );
}

type AppUserInfo = {
  userId: string;
  externalId: string | null;
  username: string | null;
  displayName: string | null;
};

async function getAppUserInfoByIds(userIds: string[]) {
  const normalizedUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (normalizedUserIds.length === 0) return new Map<string, AppUserInfo>();
  await ensureSyncStorageSchema();
  const result = await pgQuery<AppUserInfo>(
    `select id::text as "userId",
            external_id as "externalId",
            username,
            display_name as "displayName"
       from app_users
      where id = any($1::uuid[])`,
    [normalizedUserIds],
  );
  return new Map(result.rows.map((row) => [row.userId, row]));
}

function checksum(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function sanitizeJsonPayload(payload: unknown) {
  return JSON.parse(
    JSON.stringify(payload, (_, value) => {
      if (typeof value === "string") {
        return value.replace(/\u0000/g, "");
      }
      return value;
    }),
  );
}

function getSessionMessages(session: JsonObject) {
  return Array.isArray(session.messages) ? session.messages : [];
}

function getSessionTitle(session: JsonObject) {
  return String(session.topic || "未命名对话");
}

function buildRestoredSessionSearchText(session: JsonObject) {
  return getSessionMessages(session)
    .map((message) => {
      if (!message || typeof message !== "object") return "";
      const content = (message as JsonObject).content;
      if (typeof content === "string") return content;
      try {
        return JSON.stringify(content ?? message);
      } catch {
        return "";
      }
    })
    .filter(Boolean)
    .join("\n")
    .slice(0, 4000);
}

function buildRestoredSessionSummary(session: JsonObject, restoredAt: number) {
  const mask = session.mask;
  const modelConfig =
    mask && typeof mask === "object"
      ? ((mask as JsonObject).modelConfig as JsonObject | undefined)
      : undefined;

  return {
    id: String(session.id || ""),
    topic: getSessionTitle(session),
    messageCount: getSessionMessages(session).length,
    createdAt: restoredAt,
    displayTime: restoredAt,
    avatar:
      mask && typeof mask === "object"
        ? String((mask as JsonObject).avatar || "")
        : "",
    model:
      modelConfig && typeof modelConfig === "object"
        ? String(modelConfig.model || "")
        : "",
    searchText: buildRestoredSessionSearchText(session),
  };
}

async function getLatestChatBackupWatermark(appUserId: string) {
  const result = await backupPgQuery<{ to_watermark: string | null }>(
    `select to_watermark::text
       from backup_chat_runs
      where user_id = $1::uuid
      order by to_watermark desc, created_at desc
      limit 1`,
    [appUserId],
  );
  return result.rows[0]?.to_watermark ?? null;
}

async function getChangedSessionIds(
  appUserId: string,
  fromWatermark: string | null,
) {
  await ensureSyncStorageSchema();
  const params: unknown[] = [appUserId];
  // 包含 `is_deleted = true` 的会话：用户「删除」会话走的是软删除（见
  // chat-conversation-repository.syncNormalizedChatSessions），删除事件本身需要被备份，
  // 实现 CLAUDE.md 承诺的「能恢复已删除对话」。`is_deleted = false` 的会话走常规变更过滤。
  // 使用 `>=` 而非 `>`：防止 watermark 时刻恰好等值的更新被漏掉。
  const changedFilter = fromWatermark
    ? `and (
         c.updated_at >= $2::timestamptz
         or c.is_deleted = true
         or exists (
           select 1 from messages m
            where m.conversation_id = c.id
              and m.updated_at >= $2::timestamptz
         )
       )`
    : "";
  if (fromWatermark) params.push(fromWatermark);

  const result = await pgQuery<{ external_session_id: string }>(
    `select c.external_session_id
      from conversations c
     where c.user_id = $1::uuid
        and (
          exists (select 1 from messages m where m.conversation_id = c.id)
          or c.is_deleted = true
        )
        ${changedFilter}
     order by c.updated_at desc`,
    params,
  );

  return result.rows.map((row) => row.external_session_id).filter(Boolean);
}

async function getSessionSnapshots(appUserId: string, sessionIds: string[]) {
  if (sessionIds.length === 0) return [] as JsonObject[];

  await ensureSyncStorageSchema();
  const conversations = await pgQuery<{
    id: string;
    external_session_id: string;
    metadata_json: JsonObject | null;
    updated_at: string | null;
  }>(
    `select id::text,
            external_session_id,
            metadata_json,
            updated_at::text
       from conversations
      where user_id = $1::uuid
        and external_session_id = any($2::text[])
      order by updated_at desc`,
    [appUserId, sessionIds],
  );

  if (conversations.rows.length === 0) return [];

  const conversationIds = conversations.rows.map((row) => row.id);
  const messages = await pgQuery<{
    conversation_id: string;
    seq: number;
    content_json: JsonObject;
  }>(
    `select conversation_id::text,
            seq,
            content_json
       from messages
      where conversation_id = any($1::uuid[])
      order by conversation_id, seq asc`,
    [conversationIds],
  );
  const messageMap = new Map<string, JsonObject[]>();
  messages.rows.forEach((row) => {
    const nextMessages = messageMap.get(row.conversation_id) || [];
    nextMessages.push(row.content_json);
    messageMap.set(row.conversation_id, nextMessages);
  });

  return conversations.rows.map((row) => {
    const payload = {
      ...(row.metadata_json || {}),
      id: row.external_session_id,
      messages: messageMap.get(row.id) || [],
      // 内部水印仅用于 backup_chat_runs 的 updated_at_snapshot 列，
      // 不写入 session_payload JSONB（用户可消费/前端展示的字段）
      _backupConversationUpdatedAt: row.updated_at,
    } as JsonObject;
    // 写入 DB 前剥离内部字段，避免恢复时泄漏到前端
    const sanitized = sanitizeJsonPayload(payload) as JsonObject;
    delete sanitized._backupConversationUpdatedAt;
    return sanitized;
  });
}

export async function createChatBackup(
  externalUserId: string,
  source: ChatBackupSource = "manual",
  options?: { batchId?: string },
) {
  await ensureBackupStorageSchema();
  const appUserId = await getOrCreateSyncAppUserId(externalUserId);
  const settings = await getChatBackupSettings(externalUserId);

  if (source === "auto") {
    if (!settings.enabled) {
      console.log("[Chat Backup] ℹ️ 自动备份已关闭，跳过本次备份");
      return { created: false, reason: "disabled" };
    }
    const latest = await backupPgQuery<{ created_at: string }>(
      `select created_at::text from backup_chat_runs
       where user_id = $1::uuid order by created_at desc limit 1`,
      [appUserId],
    );
    const row = latest.rows[0];
    if (
      row &&
      Date.now() - new Date(row.created_at).getTime() <
        settings.intervalMinutes * 60_000
    ) {
      console.log(
        `[Chat Backup] ℹ️ 未达到自动备份间隔（${settings.intervalMinutes} 分钟），跳过本次备份`,
      );
      return { created: false, reason: "interval" };
    }
  }

  const fromWatermark = await getLatestChatBackupWatermark(appUserId);
  const toWatermarkResult = await backupPgQuery<{ now: string }>(
    `select now()::text as now`,
  );
  const toWatermark =
    toWatermarkResult.rows[0]?.now || new Date().toISOString();
  const sessionIds = await getChangedSessionIds(appUserId, fromWatermark);
  const sessions = await getSessionSnapshots(appUserId, sessionIds);

  // 如果是自动备份且没有变化的会话，也跳过
  if (source === "auto" && sessions.length === 0) {
    console.log("[Chat Backup] ℹ️ 无变化的会话，跳过本次自动备份");
    return { created: false, reason: "no_changes" };
  }

  const messageCount = sessions.reduce(
    (total, session) => total + getSessionMessages(session).length,
    0,
  );
  const mode = fromWatermark ? "incremental" : "full";
  const digest = checksum({
    source,
    mode,
    fromWatermark,
    toWatermark,
    sessions,
  });

  const backupId = await withBackupPgTransaction(async (client) => {
    // 同一 externalUserId 的并发备份串行化：避免 scheduler + 手动 + pre_restore
    // 同时跑同一用户造成 watermark 竞争、checksum 错位。lockkey 由 hashtext 派生，
    // 落在 bigint 范围内；事务结束自动释放，无需显式 unlock。
    const lockKeyResult = await client.query<{ lock_key: string }>(
      `select hashtext($1)::bigint as lock_key`,
      [externalUserId],
    );
    const lockKey = lockKeyResult.rows[0]?.lock_key;
    if (!lockKey) {
      throw new Error("chat_backup_lock_failed");
    }
    await client.query(`select pg_advisory_xact_lock($1::bigint)`, [lockKey]);

    const runResult = await client.query<{ id: string }>(
      `insert into backup_chat_runs (
         user_id,
         batch_id,
         external_user_id,
         source,
         mode,
         from_watermark,
         to_watermark,
         session_count,
         message_count,
         checksum
       ) values (
         $1::uuid, $2::uuid, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9, $10
       ) returning id::text`,
      [
        appUserId,
        options?.batchId || null,
        externalUserId,
        source,
        mode,
        fromWatermark,
        toWatermark,
        sessions.length,
        messageCount,
        digest,
      ],
    );
    const id = runResult.rows[0]?.id;
    if (!id) throw new Error("chat_backup_create_failed");

    for (const session of sessions) {
      await client.query(
        `insert into backup_chat_conversation_snapshots (
           backup_id,
           user_id,
           external_user_id,
           external_session_id,
           title,
           message_count,
           session_payload,
           checksum,
           updated_at_snapshot
         ) values (
           $1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8, $9::timestamptz
         )`,
        [
          id,
          appUserId,
          externalUserId,
          String(session.id || ""),
          getSessionTitle(session),
          getSessionMessages(session).length,
          JSON.stringify(session),
          checksum(session),
          typeof session._backupConversationUpdatedAt === "string"
            ? session._backupConversationUpdatedAt
            : null,
        ],
      );
    }

    return id;
  });

  await pruneChatBackups(externalUserId, settings.maxBackups);

  console.log(
    `[Chat Backup] ✅ 对话备份已创建（来源: ${source}，模式: ${mode}，会话数: ${
      sessions.length
    }，消息数: ${messageCount}${
      options?.batchId ? "，已归入全员备份批次" : ""
    }）`,
  );

  return {
    created: true,
    id: backupId,
    batchId: options?.batchId || null,
    source,
    mode,
    fromWatermark,
    toWatermark,
    sessionCount: sessions.length,
    messageCount,
  };
}

export async function listChatBackups(
  externalUserId?: string,
  searchText?: string,
) {
  await ensureBackupStorageSchema();
  const appUserId = externalUserId
    ? await getOrCreateSyncAppUserId(externalUserId)
    : "";
  const params: unknown[] = [];
  const filters: string[] = [];
  if (appUserId) {
    params.push(appUserId);
    filters.push(`r.user_id = $${params.length}::uuid`);
  }
  const keyword = String(searchText || "").trim();
  if (keyword) {
    params.push(`%${keyword}%`);
    const keywordParam = `$${params.length}`;
    filters.push(`exists (
        select 1
         from backup_chat_conversation_snapshots s
          join backup_chat_runs sr on sr.id = s.backup_id
         where (
            s.backup_id = r.id
            or (
              s.user_id = r.user_id
              and sr.created_at <= r.created_at
            )
          )
           and (
             s.title ilike ${keywordParam}
             or s.external_session_id ilike ${keywordParam}
             or s.session_payload::text ilike ${keywordParam}
           )
    )`);
  }
  const whereClause =
    filters.length > 0 ? `where ${filters.join(" and ")}` : "";
  const result = await backupPgQuery<{
    id: string;
    batch_id: string | null;
    user_id: string;
    external_user_id: string | null;
    source: ChatBackupSource;
    mode: string;
    from_watermark: string | null;
    to_watermark: string;
    session_count: number;
    message_count: number;
    created_at: string;
  }>(
    `select r.id::text,
            r.batch_id::text,
            r.user_id::text,
            r.external_user_id,
            r.source,
            r.mode,
            r.from_watermark::text,
            r.to_watermark::text,
            coalesce(full_stats.session_count, 0)::int as session_count,
            coalesce(full_stats.message_count, 0)::int as message_count,
            r.created_at::text
       from backup_chat_runs r
       left join lateral (
         select count(*) as session_count,
                coalesce(sum(latest.message_count), 0) as message_count
           from (
             select distinct on (s.external_session_id)
                    s.external_session_id,
                    s.message_count
               from backup_chat_conversation_snapshots s
               join backup_chat_runs sr on sr.id = s.backup_id
              where s.user_id = r.user_id
                and sr.user_id = r.user_id
                and sr.created_at <= r.created_at
              order by s.external_session_id,
                       coalesce(s.updated_at_snapshot, s.created_at) desc,
                       s.created_at desc
           ) latest
       ) full_stats on true
       ${whereClause}
      order by r.created_at desc
      limit 100`,
    params,
  );
  const userInfoMap = await getAppUserInfoByIds(
    result.rows.map((row) => row.user_id),
  );

  const backups = result.rows.map((row) => ({
    ...(userInfoMap.get(row.user_id) || {}),
    id: row.id,
    batchId: row.batch_id || row.id,
    isLegacyBatch: !row.batch_id,
    userId: row.user_id,
    externalId:
      userInfoMap.get(row.user_id)?.externalId || row.external_user_id,
    username: userInfoMap.get(row.user_id)?.username || null,
    displayName: userInfoMap.get(row.user_id)?.displayName || null,
    source: row.source,
    mode: row.mode,
    fromWatermark: row.from_watermark,
    toWatermark: row.to_watermark,
    sessionCount: row.session_count,
    messageCount: row.message_count,
    createdAt: row.created_at,
  }));
  const batchIds = Array.from(
    new Set(backups.map((backup) => backup.batchId).filter(Boolean)),
  );
  const batchMemberResult =
    batchIds.length > 0
      ? await backupPgQuery<{
          batch_id: string;
          user_id: string;
          external_user_id: string | null;
          status: ChatBackupBatchMemberStatus;
          reason: string | null;
          session_count: number;
          message_count: number;
        }>(
          `select batch_id::text, user_id::text, external_user_id, status, reason,
                  session_count, message_count
             from backup_chat_batch_members
            where batch_id = any($1::uuid[])
            order by created_at asc`,
          [batchIds],
        )
      : { rows: [] };
  const batchMembers = new Map<string, ChatBackupBatchMember[]>();
  batchMemberResult.rows.forEach((row) => {
    const members = batchMembers.get(row.batch_id) || [];
    members.push({
      userId: row.user_id,
      externalUserId: row.external_user_id || "",
      status: row.status,
      reason: row.reason || undefined,
      sessionCount: row.session_count,
      messageCount: row.message_count,
    });
    batchMembers.set(row.batch_id, members);
  });
  const batchUsers = new Map<string, typeof backups>();
  backups.forEach((backup) => {
    const users = batchUsers.get(backup.batchId) || [];
    users.push(backup);
    batchUsers.set(backup.batchId, users);
  });

  return backups.map((backup) => ({
    ...backup,
    batchUsers: batchUsers.get(backup.batchId) || [backup],
    batchMembers: batchMembers.get(backup.batchId) || [],
  }));
}

export async function listChatBackupSummaries(userIds?: string[]) {
  const normalizedUserIds = Array.from(
    new Set(
      (userIds || []).map((id) => String(id || "").trim()).filter(Boolean),
    ),
  );
  const params: unknown[] = [];
  const userFilter =
    normalizedUserIds.length > 0 ? `where u.id = any($1::uuid[])` : "";
  if (normalizedUserIds.length > 0) {
    params.push(normalizedUserIds);
  }

  await ensureSyncStorageSchema();
  const userResult = await pgQuery<{
    user_id: string;
    external_id: string | null;
    username: string | null;
    display_name: string | null;
    conversation_count: string;
  }>(
    `select
       u.id::text as user_id,
       u.external_id,
       u.username,
       u.display_name,
       coalesce(s.conversation_count, 0)::text as conversation_count
     from app_users u
     left join (
       select
         user_id,
         count(*) as conversation_count
       from conversations
       group by user_id
     ) s on s.user_id = u.id
     ${userFilter}
     order by
       lower(coalesce(u.username, u.display_name, u.external_id, '')) asc`,
    params,
  );
  const summaryUserIds = userResult.rows.map((row) => row.user_id);
  await ensureBackupStorageSchema();
  const backupResult =
    summaryUserIds.length > 0
      ? await backupPgQuery<{
          user_id: string;
          backup_count: string;
          last_backup_at: string | null;
        }>(
          `select user_id::text,
                  count(*)::text as backup_count,
                  max(created_at)::text as last_backup_at
             from backup_chat_runs
            where user_id = any($1::uuid[])
            group by user_id`,
          [summaryUserIds],
        )
      : { rows: [] };
  const backupStats = new Map(
    backupResult.rows.map((row) => [
      row.user_id,
      {
        backupCount: Number(row.backup_count || 0) || 0,
        lastBackupAt: row.last_backup_at,
      },
    ]),
  );

  const users = userResult.rows.map((row) => {
    const stats = backupStats.get(row.user_id);
    return {
      userId: row.user_id,
      externalId: row.external_id,
      username: row.username,
      displayName: row.display_name,
      backupCount: stats?.backupCount ?? 0,
      conversationCount: Number(row.conversation_count || 0) || 0,
      lastBackupAt: stats?.lastBackupAt ?? null,
    };
  });

  return {
    backupMode: "incremental",
    totalBackupCount: users.reduce(
      (total, user) => total + user.backupCount,
      0,
    ),
    totalConversationCount: users.reduce(
      (total, user) => total + user.conversationCount,
      0,
    ),
    users,
  };
}

export async function getChatBackupDetail(
  externalUserId: string | undefined,
  backupId: string,
  searchText?: string,
) {
  await ensureBackupStorageSchema();
  const appUserId = externalUserId
    ? await getOrCreateSyncAppUserId(externalUserId)
    : "";
  const params: unknown[] = [backupId];
  const userFilter = appUserId ? `and r.user_id = $2::uuid` : "";
  if (appUserId) {
    params.push(appUserId);
  }
  const runResult = await backupPgQuery<{
    id: string;
    user_id: string;
    external_user_id: string | null;
    source: ChatBackupSource;
    mode: string;
    from_watermark: string | null;
    to_watermark: string;
    session_count: number;
    message_count: number;
    created_at: string;
  }>(
    `select r.id::text,
            r.user_id::text,
            r.external_user_id,
            r.source,
            r.mode,
            r.from_watermark::text,
            r.to_watermark::text,
            r.session_count,
            r.message_count,
            r.created_at::text
       from backup_chat_runs r
      where r.id = $1::uuid
        ${userFilter}
      limit 1`,
    params,
  );
  const run = runResult.rows[0];
  if (!run) return null;
  const userInfo = (await getAppUserInfoByIds([run.user_id])).get(run.user_id);

  const snapshotParams: unknown[] = [run.user_id, run.created_at];
  const keyword = String(searchText || "").trim();
  const searchFilter = keyword
    ? (() => {
        snapshotParams.push(`%${keyword}%`);
        const keywordParam = `$${snapshotParams.length}`;
        return `and (
          s.title ilike ${keywordParam}
          or s.external_session_id ilike ${keywordParam}
          or s.session_payload::text ilike ${keywordParam}
        )`;
      })()
    : "";

  const snapshots = await backupPgQuery<{
    id: string;
    external_session_id: string;
    title: string;
    message_count: number;
    session_payload: JsonObject;
    created_at: string;
  }>(
    `select distinct on (s.external_session_id)
            s.id::text,
            s.external_session_id,
            s.title,
            s.message_count,
            s.session_payload,
            s.created_at::text
       from backup_chat_conversation_snapshots s
       join backup_chat_runs r on r.id = s.backup_id
      where s.user_id = $1::uuid
        and r.user_id = $1::uuid
        and r.created_at <= $2::timestamptz
        ${searchFilter}
      order by s.external_session_id,
               coalesce(s.updated_at_snapshot, s.created_at) desc,
               s.created_at desc`,
    snapshotParams,
  );

  return {
    id: run.id,
    userId: run.user_id,
    externalId: userInfo?.externalId || run.external_user_id,
    username: userInfo?.username || null,
    displayName: userInfo?.displayName || null,
    source: run.source,
    mode: run.mode,
    fromWatermark: run.from_watermark,
    toWatermark: run.to_watermark,
    sessionCount: run.session_count,
    messageCount: run.message_count,
    createdAt: run.created_at,
    sessions: snapshots.rows.map((row) => ({
      id: row.id,
      externalSessionId: row.external_session_id,
      title: row.title,
      messageCount: row.message_count,
      createdAt: row.created_at,
      payload: row.session_payload,
    })),
  };
}

export async function deleteChatBackup(
  externalUserId: string | undefined,
  backupId: string,
) {
  await ensureBackupStorageSchema();
  const appUserId = externalUserId
    ? await getOrCreateSyncAppUserId(externalUserId)
    : "";
  const params: unknown[] = [backupId];
  const userFilter = appUserId ? `and user_id = $2::uuid` : "";
  if (appUserId) {
    params.push(appUserId);
  }
  const result = await backupPgQuery<{ id: string }>(
    `delete from backup_chat_runs
      where id = $1::uuid
        ${userFilter}
      returning id::text`,
    params,
  );
  return Boolean(result.rows[0]?.id);
}

export async function deleteChatBackupConversationSnapshot(params: {
  externalUserId?: string;
  backupId: string;
  externalSessionId: string;
}) {
  await ensureBackupStorageSchema();
  const appUserId = params.externalUserId
    ? await getOrCreateSyncAppUserId(params.externalUserId)
    : "";

  return withBackupPgTransaction(async (client) => {
    const ownerResult = await client.query<{ user_id: string }>(
      `select user_id::text
         from backup_chat_runs
        where id = $1::uuid
          ${appUserId ? "and user_id = $2::uuid" : ""}
        limit 1`,
      appUserId ? [params.backupId, appUserId] : [params.backupId],
    );
    const ownerUserId = ownerResult.rows[0]?.user_id || "";
    if (!ownerUserId) return false;

    const deleteResult = await client.query<{ id: string }>(
      `delete from backup_chat_conversation_snapshots
        where backup_id = $1::uuid
          and user_id = $2::uuid
          and external_session_id = $3
        returning id::text`,
      [params.backupId, ownerUserId, params.externalSessionId],
    );
    if (!deleteResult.rows[0]?.id) return false;

    // 不再篡改 backup_chat_runs 的 session_count/message_count（保留不可变快照语义）。
    // 仅更新 checksum 和 metadata 标记本次发生过 snapshot 删除，便于审计追踪。
    await client.query(
      `update backup_chat_runs r
          set checksum = $3,
              metadata = metadata || jsonb_build_object(
                'deletedSnapshots',
                coalesce(metadata->'deletedSnapshots', '[]'::jsonb) ||
                jsonb_build_array(jsonb_build_object(
                  'externalSessionId', $4::text,
                  'deletedAt', $5::text
                ))
              )
        where r.id = $1::uuid
          and r.user_id = $2::uuid`,
      [
        params.backupId,
        ownerUserId,
        checksum({
          backupId: params.backupId,
          deletedSessionId: params.externalSessionId,
          deletedAt: new Date().toISOString(),
        }),
        params.externalSessionId,
        new Date().toISOString(),
      ],
    );

    return true;
  });
}

// 简单比较两个会话是否内容相同
function areSessionsEqual(sess1: JsonObject, sess2: JsonObject): boolean {
  try {
    // 比较消息数量
    const msgs1 = Array.isArray(sess1.messages) ? sess1.messages : [];
    const msgs2 = Array.isArray(sess2.messages) ? sess2.messages : [];
    if (msgs1.length !== msgs2.length) return false;

    // 简单比较：比较标题和消息数量
    const title1 = String(sess1.topic || sess1.title || "");
    const title2 = String(sess2.topic || sess2.title || "");
    if (title1 !== title2) return false;

    // 更详细的比较：比较每条消息的角色和内容
    for (let i = 0; i < msgs1.length; i++) {
      const msg1 = msgs1[i] as JsonObject;
      const msg2 = msgs2[i] as JsonObject;

      // 比较角色
      if (String(msg1.role || "") !== String(msg2.role || "")) return false;

      // 比较内容
      const content1 =
        typeof msg1.content === "string"
          ? msg1.content
          : JSON.stringify(msg1.content);
      const content2 =
        typeof msg2.content === "string"
          ? msg2.content
          : JSON.stringify(msg2.content);
      if (content1 !== content2) return false;
    }

    return true;
  } catch {
    return false;
  }
}

export async function restoreChatBackupConversation(params: {
  externalUserId?: string;
  backupId: string;
  externalSessionId: string;
}) {
  await ensureBackupStorageSchema();
  const appUserId = params.externalUserId
    ? await getOrCreateSyncAppUserId(params.externalUserId)
    : "";
  const restoreUserFilter = appUserId ? `and s.user_id = $3::uuid` : "";
  const restoreParams = appUserId
    ? [params.backupId, params.externalSessionId, appUserId]
    : [params.backupId, params.externalSessionId];
  const snapshot = await backupPgQuery<{
    user_id: string;
    external_user_id: string | null;
    session_payload: JsonObject;
  }>(
    `select s.user_id::text as user_id,
            s.external_user_id,
            s.session_payload
       from backup_chat_conversation_snapshots s
      where s.backup_id = $1::uuid
        and s.external_session_id = $2
        ${restoreUserFilter}
      limit 1`,
    restoreParams,
  );
  const row = snapshot.rows[0];
  const session = row?.session_payload;
  const userInfo = row?.user_id
    ? (await getAppUserInfoByIds([row.user_id])).get(row.user_id)
    : undefined;
  const externalUserId =
    userInfo?.externalId ||
    row?.external_user_id ||
    params.externalUserId ||
    "";
  if (!session || !externalUserId) return null;
  const restoreTime = Date.now();
  const restoredSession = sanitizeJsonPayload({
    ...session,
    createdAt: restoreTime,
    lastUpdate: restoreTime,
    _syncIndexOrder: 0,
    _backupRestoredAt: new Date(restoreTime).toISOString(),
  }) as JsonObject;

  // 检查会话是否已存在且内容相同
  let sessionAlreadyExistsAndSame = false;
  try {
    // 尝试获取当前数据库中是否已存在该会话
    const { getChatSessionById } = await import(
      "./chat-conversation-repository"
    );
    const existingSession = await getChatSessionById(
      externalUserId,
      params.externalSessionId,
    );
    if (existingSession) {
      sessionAlreadyExistsAndSame = areSessionsEqual(
        existingSession,
        restoredSession,
      );
    }
  } catch (e) {
    // 如果获取失败，继续执行恢复
  }

  const { syncNormalizedChatSessions } = await import(
    "./chat-conversation-repository"
  );
  await withPgTransaction(async (client) => {
    await syncNormalizedChatSessions(client, {
      externalUserId,
      upsertSessions: [restoredSession],
      deleteSessionIds: [],
    });
  });

  const currentIndexState = await getChatIndexState(externalUserId);
  const index = await buildNormalizedChatIndexSnapshot(
    externalUserId,
    currentIndexState && typeof currentIndexState === "object"
      ? (currentIndexState as Record<string, unknown>)
      : undefined,
  );
  if (index?.state) {
    const sessionIds = Array.isArray(index.state.sessionIds)
      ? index.state.sessionIds.map(String).filter(Boolean)
      : [];
    const sessionSummaries =
      index.state.sessionSummaries &&
      typeof index.state.sessionSummaries === "object" &&
      !Array.isArray(index.state.sessionSummaries)
        ? (index.state.sessionSummaries as Record<string, unknown>)
        : {};

    // 安全地从 deletedSessionTimestamps 中清除该会话标记
    let deletedTimestamps: Record<string, number> = {};
    if (
      index.state &&
      typeof index.state === "object" &&
      "deletedSessionTimestamps" in index.state
    ) {
      const ts = (index.state as any).deletedSessionTimestamps;
      if (ts && typeof ts === "object") {
        deletedTimestamps = { ...ts };
      }
    }
    delete deletedTimestamps[params.externalSessionId];

    const newIndexState: Record<string, unknown> = {
      ...index.state,
      currentSessionId: params.externalSessionId,
      currentSessionIndex: 0,
      sessionIds: [
        params.externalSessionId,
        ...sessionIds.filter(
          (sessionId) => sessionId !== params.externalSessionId,
        ),
      ],
      sessionSummaries: {
        ...sessionSummaries,
        [params.externalSessionId]: buildRestoredSessionSummary(
          restoredSession,
          restoreTime,
        ),
      },
    };

    // 只有当 deletedTimestamps 不为空时才添加，或者覆盖现有的
    if (
      Object.keys(deletedTimestamps).length > 0 ||
      "deletedSessionTimestamps" in (index.state || {})
    ) {
      newIndexState.deletedSessionTimestamps = deletedTimestamps;
    }

    await setChatIndexState(externalUserId, newIndexState);
  }

  return {
    userId: row.user_id,
    externalUserId,
    username: userInfo?.username || null,
    displayName: userInfo?.displayName || null,
    externalSessionId: params.externalSessionId,
    title: getSessionTitle(restoredSession),
    messageCount: getSessionMessages(restoredSession).length,
    restoredAt: restoreTime,
    session: restoredSession,
    sessionAlreadyExistsAndSame,
  };
}
