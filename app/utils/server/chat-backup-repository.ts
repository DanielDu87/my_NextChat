import { createHash } from "crypto";
import { buildNormalizedChatIndexSnapshot } from "./chat-conversation-repository";
import {
  getChatIndexState,
  setChatIndexState,
} from "./app-settings-repository";
import { getOrCreateSyncAppUserId } from "./sync-app-user";
import {
  ensureSyncStorageSchema,
  pgQuery,
  withPgTransaction,
} from "./postgres";

export async function getChatBackupSettings(externalUserId: string) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery<{
    enabled: boolean;
    interval_minutes: number;
    max_backups: number;
  }>(
    `select enabled, interval_minutes, max_backups
     from chat_backup_settings where user_id = $1::uuid`,
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
  console.log("[Chat Backup] ⚙️ 开始保存自动备份设置", settings);
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  await pgQuery(
    `insert into chat_backup_settings (user_id, enabled, interval_minutes, max_backups)
     values ($1::uuid, $2, $3, $4)
     on conflict (user_id) do update set
       enabled = excluded.enabled,
       interval_minutes = excluded.interval_minutes,
       max_backups = excluded.max_backups`,
    [userId, settings.enabled, settings.intervalMinutes, settings.maxBackups],
  );
  await pruneChatBackups(externalUserId, settings.maxBackups);
  console.log("[Chat Backup] ✅ 自动备份设置已保存");
  return settings;
}

export async function pruneChatBackups(externalUserId: string, max: number) {
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery(
    `delete from chat_backup_runs where id in (
       select id from chat_backup_runs where user_id = $1::uuid
       order by created_at desc offset $2
     )`,
    [userId, max],
  );
  if ((result.rowCount ?? 0) > 0) {
    console.log("[Chat Backup] 🧹 已清理超出保留数量的旧备份", {
      删除数量: result.rowCount,
      最大保留数量: max,
    });
  }
}

type JsonObject = Record<string, unknown>;

export type ChatBackupSource = "manual" | "auto";

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
  const result = await pgQuery<{ to_watermark: string | null }>(
    `select to_watermark::text
       from chat_backup_runs
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
  const params: unknown[] = [appUserId];
  const changedFilter = fromWatermark
    ? `and (
         c.updated_at > $2::timestamptz
         or exists (
           select 1 from messages m
            where m.conversation_id = c.id
              and m.updated_at > $2::timestamptz
         )
       )`
    : "";
  if (fromWatermark) params.push(fromWatermark);

  const result = await pgQuery<{ external_session_id: string }>(
    `select c.external_session_id
      from conversations c
     where c.user_id = $1::uuid
        and exists (select 1 from messages m where m.conversation_id = c.id)
        ${changedFilter}
     order by c.updated_at desc`,
    params,
  );

  return result.rows.map((row) => row.external_session_id).filter(Boolean);
}

async function getSessionSnapshots(appUserId: string, sessionIds: string[]) {
  if (sessionIds.length === 0) return [] as JsonObject[];

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
      _backupConversationUpdatedAt: row.updated_at,
    };
    return sanitizeJsonPayload(payload) as JsonObject;
  });
}

export async function createChatBackup(
  externalUserId: string,
  source: ChatBackupSource = "manual",
) {
  await ensureSyncStorageSchema();
  const appUserId = await getOrCreateSyncAppUserId(externalUserId);
  const settings = await getChatBackupSettings(externalUserId);

  if (source === "auto") {
    if (!settings.enabled) {
      console.log("[Chat Backup] ⏭️ 自动备份已关闭，跳过本次备份");
      return { created: false, reason: "disabled" };
    }
    const latest = await pgQuery<{ created_at: string }>(
      `select created_at::text from chat_backup_runs
       where user_id = $1::uuid order by created_at desc limit 1`,
      [appUserId],
    );
    const row = latest.rows[0];
    if (
      row &&
      Date.now() - new Date(row.created_at).getTime() <
        settings.intervalMinutes * 60_000
    ) {
      console.log("[Chat Backup] ⏭️ 未达到自动备份间隔，跳过本次备份", {
        备份间隔分钟: settings.intervalMinutes,
      });
      return { created: false, reason: "interval" };
    }
  }

  const fromWatermark = await getLatestChatBackupWatermark(appUserId);
  const toWatermarkResult = await pgQuery<{ now: string }>(
    `select now()::text as now`,
  );
  const toWatermark =
    toWatermarkResult.rows[0]?.now || new Date().toISOString();
  const sessionIds = await getChangedSessionIds(appUserId, fromWatermark);
  const sessions = await getSessionSnapshots(appUserId, sessionIds);

  // 如果是自动备份且没有变化的会话，也跳过
  if (source === "auto" && sessions.length === 0) {
    console.log("[Chat Backup] ⏭️ 无变化的会话，跳过本次自动备份");
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

  const backupId = await withPgTransaction(async (client) => {
    const runResult = await client.query<{ id: string }>(
      `insert into chat_backup_runs (
         user_id,
         source,
         mode,
         from_watermark,
         to_watermark,
         session_count,
         message_count,
         checksum
       ) values (
         $1::uuid, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8
       ) returning id::text`,
      [
        appUserId,
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
        `insert into chat_backup_conversation_snapshots (
           backup_id,
           user_id,
           external_session_id,
           title,
           message_count,
           session_payload,
           checksum,
           updated_at_snapshot
         ) values (
           $1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7, $8::timestamptz
         )`,
        [
          id,
          appUserId,
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

  console.log("[Chat Backup] ✅ 对话备份已创建", {
    备份ID: backupId,
    来源: source,
    会话数量: sessions.length,
    消息数量: messageCount,
  });

  return {
    created: true,
    id: backupId,
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
  await ensureSyncStorageSchema();
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
         from chat_backup_conversation_snapshots s
          join chat_backup_runs sr on sr.id = s.backup_id
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
  const result = await pgQuery<{
    id: string;
    user_id: string;
    external_id: string | null;
    username: string | null;
    display_name: string | null;
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
            u.external_id,
            u.username,
            u.display_name,
            r.source,
            r.mode,
            r.from_watermark::text,
            r.to_watermark::text,
            coalesce(full_stats.session_count, 0)::int as session_count,
            coalesce(full_stats.message_count, 0)::int as message_count,
            r.created_at::text
       from chat_backup_runs r
       left join app_users u on u.id = r.user_id
       left join lateral (
         select count(*) as session_count,
                coalesce(sum(latest.message_count), 0) as message_count
           from (
             select distinct on (s.external_session_id)
                    s.external_session_id,
                    s.message_count
               from chat_backup_conversation_snapshots s
               join chat_backup_runs sr on sr.id = s.backup_id
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

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    externalId: row.external_id,
    username: row.username,
    displayName: row.display_name,
    source: row.source,
    mode: row.mode,
    fromWatermark: row.from_watermark,
    toWatermark: row.to_watermark,
    sessionCount: row.session_count,
    messageCount: row.message_count,
    createdAt: row.created_at,
  }));
}

export async function listChatBackupSummaries(userIds?: string[]) {
  await ensureSyncStorageSchema();
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

  const result = await pgQuery<{
    user_id: string;
    external_id: string | null;
    username: string | null;
    display_name: string | null;
    backup_count: string;
    conversation_count: string;
    last_backup_at: string | null;
  }>(
    `select
       u.id::text as user_id,
       u.external_id,
       u.username,
       u.display_name,
       coalesce(r.backup_count, 0)::text as backup_count,
       coalesce(s.conversation_count, 0)::text as conversation_count,
       r.last_backup_at::text as last_backup_at
     from app_users u
     left join (
       select
         user_id,
         count(*) as backup_count,
         max(created_at) as last_backup_at
       from chat_backup_runs
       group by user_id
     ) r on r.user_id = u.id
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

  const users = result.rows.map((row) => ({
    userId: row.user_id,
    externalId: row.external_id,
    username: row.username,
    displayName: row.display_name,
    backupCount: Number(row.backup_count || 0) || 0,
    conversationCount: Number(row.conversation_count || 0) || 0,
    lastBackupAt: row.last_backup_at,
  }));

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
  await ensureSyncStorageSchema();
  const appUserId = externalUserId
    ? await getOrCreateSyncAppUserId(externalUserId)
    : "";
  const params: unknown[] = [backupId];
  const userFilter = appUserId ? `and r.user_id = $2::uuid` : "";
  if (appUserId) {
    params.push(appUserId);
  }
  const runResult = await pgQuery<{
    id: string;
    user_id: string;
    external_id: string | null;
    username: string | null;
    display_name: string | null;
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
            u.external_id,
            u.username,
            u.display_name,
            r.source,
            r.mode,
            r.from_watermark::text,
            r.to_watermark::text,
            r.session_count,
            r.message_count,
            r.created_at::text
       from chat_backup_runs r
       left join app_users u on u.id = r.user_id
      where r.id = $1::uuid
        ${userFilter}
      limit 1`,
    params,
  );
  const run = runResult.rows[0];
  if (!run) return null;

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

  const snapshots = await pgQuery<{
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
       from chat_backup_conversation_snapshots s
       join chat_backup_runs r on r.id = s.backup_id
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
    externalId: run.external_id,
    username: run.username,
    displayName: run.display_name,
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
  await ensureSyncStorageSchema();
  const appUserId = externalUserId
    ? await getOrCreateSyncAppUserId(externalUserId)
    : "";
  const params: unknown[] = [backupId];
  const userFilter = appUserId ? `and user_id = $2::uuid` : "";
  if (appUserId) {
    params.push(appUserId);
  }
  const result = await pgQuery<{ id: string }>(
    `delete from chat_backup_runs
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
  await ensureSyncStorageSchema();
  const appUserId = params.externalUserId
    ? await getOrCreateSyncAppUserId(params.externalUserId)
    : "";

  return withPgTransaction(async (client) => {
    const ownerResult = await client.query<{ user_id: string }>(
      `select user_id::text
         from chat_backup_runs
        where id = $1::uuid
          ${appUserId ? "and user_id = $2::uuid" : ""}
        limit 1`,
      appUserId ? [params.backupId, appUserId] : [params.backupId],
    );
    const ownerUserId = ownerResult.rows[0]?.user_id || "";
    if (!ownerUserId) return false;

    const deleteResult = await client.query<{ id: string }>(
      `delete from chat_backup_conversation_snapshots
        where backup_id = $1::uuid
          and user_id = $2::uuid
          and external_session_id = $3
        returning id::text`,
      [params.backupId, ownerUserId, params.externalSessionId],
    );
    if (!deleteResult.rows[0]?.id) return false;

    await client.query(
      `update chat_backup_runs r
          set session_count = coalesce(s.session_count, 0),
              message_count = coalesce(s.message_count, 0),
              checksum = $3
         from (
           select
             count(*)::int as session_count,
             coalesce(sum(message_count), 0)::int as message_count
           from chat_backup_conversation_snapshots
           where backup_id = $1::uuid
             and user_id = $2::uuid
         ) s
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
  await ensureSyncStorageSchema();
  const appUserId = params.externalUserId
    ? await getOrCreateSyncAppUserId(params.externalUserId)
    : "";
  const restoreUserFilter = appUserId ? `and s.user_id = $3::uuid` : "";
  const restoreParams = appUserId
    ? [params.backupId, params.externalSessionId, appUserId]
    : [params.backupId, params.externalSessionId];
  const snapshot = await pgQuery<{
    user_id: string;
    external_id: string | null;
    username: string | null;
    display_name: string | null;
    session_payload: JsonObject;
  }>(
    `select u.id::text as user_id,
            u.external_id,
            u.username,
            u.display_name,
            s.session_payload
       from chat_backup_conversation_snapshots s
       join app_users u on u.id = s.user_id
      where s.backup_id = $1::uuid
        and s.external_session_id = $2
        ${restoreUserFilter}
      limit 1`,
    restoreParams,
  );
  const row = snapshot.rows[0];
  const session = row?.session_payload;
  const externalUserId = row?.external_id || params.externalUserId || "";
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
    username: row.username,
    displayName: row.display_name,
    externalSessionId: params.externalSessionId,
    title: getSessionTitle(restoredSession),
    messageCount: getSessionMessages(restoredSession).length,
    restoredAt: restoreTime,
    session: restoredSession,
    sessionAlreadyExistsAndSame,
  };
}
