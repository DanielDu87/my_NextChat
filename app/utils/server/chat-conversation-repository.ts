import type { PoolClient } from "pg";
import { buildChatIndexPayload, type ChatIndexPayload } from "../chat-sync";
import { getOrCreateSyncAppUserId } from "./sync-app-user";
import { ensureSyncStorageSchema, pgQuery } from "./postgres";

type JsonObject = Record<string, unknown>;

type ChatSessionRecord = JsonObject & {
  id?: string;
  topic?: string;
  createdAt?: number;
  lastUpdate?: number;
  messages?: unknown[];
};

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

function normalizeMessageRole(role: unknown) {
  const normalizedRole = String(role || "").toLowerCase();
  if (
    normalizedRole === "system" ||
    normalizedRole === "assistant" ||
    normalizedRole === "tool"
  ) {
    return normalizedRole;
  }

  return "user";
}

function getMessageContentText(message: JsonObject) {
  const content = message.content;
  return typeof content === "string" ? content : null;
}

function getMessageReasoningText(message: JsonObject) {
  const reasoning = message.reasoning;
  if (typeof reasoning === "string" && reasoning.length > 0) {
    return reasoning;
  }

  const reasoningDetails = message.reasoning_details;
  if (
    reasoningDetails &&
    typeof reasoningDetails === "object" &&
    !Array.isArray(reasoningDetails)
  ) {
    return JSON.stringify(reasoningDetails);
  }

  return null;
}

function getMessageToolCalls(message: JsonObject) {
  return Array.isArray(message.tools) ? message.tools : [];
}

function getExternalMessageId(message: JsonObject) {
  const messageId = message.id;
  return typeof messageId === "string" && messageId.length > 0
    ? messageId
    : null;
}

function buildConversationMetadata(
  session: ChatSessionRecord,
  indexOrder?: number,
): JsonObject {
  const sanitizedSession = sanitizeJsonPayload(session) as ChatSessionRecord;
  const metadata = { ...sanitizedSession };
  delete metadata.messages;

  return {
    ...metadata,
    _syncIndexOrder: Number.isFinite(indexOrder) ? indexOrder : null,
    _syncMessageCount: Array.isArray(sanitizedSession.messages)
      ? sanitizedSession.messages.length
      : 0,
  };
}

function getSessionMessages(session: ChatSessionRecord) {
  return Array.isArray(session.messages) ? session.messages : [];
}

function getSessionModelName(session: ChatSessionRecord) {
  const model = (session.mask as JsonObject | undefined)?.modelConfig;
  if (model && typeof model === "object") {
    const modelName = (model as JsonObject).model;
    return typeof modelName === "string" && modelName.length > 0
      ? modelName
      : null;
  }

  return null;
}

function getSessionProviderName(session: ChatSessionRecord) {
  const model = (session.mask as JsonObject | undefined)?.modelConfig;
  if (model && typeof model === "object") {
    const providerName = (model as JsonObject).providerName;
    return typeof providerName === "string" && providerName.length > 0
      ? providerName
      : null;
  }

  return null;
}

async function upsertConversation(
  client: PoolClient,
  params: {
    appUserId: string;
    session: ChatSessionRecord;
    indexOrder?: number;
  },
) {
  const metadataJson = buildConversationMetadata(
    params.session,
    params.indexOrder,
  );
  const sessionId = String(params.session.id || "");
  const result = await client.query<{ id: string }>(
    `with updated as (
       update conversations
       set title = $3,
           model_name = $4,
           provider_name = $5,
           metadata_json = $6::jsonb,
           is_deleted = false,
           updated_at = now()
       where user_id = $1::uuid
         and external_session_id = $2
       returning id::text as id
     ),
     inserted as (
       insert into conversations (
         user_id,
         external_session_id,
         title,
         model_name,
         provider_name,
         metadata_json
       )
       select
         $1::uuid,
         $2,
         $3,
         $4,
         $5,
         $6::jsonb
       where not exists (select 1 from updated)
       returning id::text as id
     )
     select id from updated
     union all
     select id from inserted
     limit 1`,
    [
      params.appUserId,
      sessionId,
      String(params.session.topic || ""),
      getSessionModelName(params.session),
      getSessionProviderName(params.session),
      JSON.stringify(metadataJson),
    ],
  );

  return result.rows[0]?.id ?? "";
}

async function replaceConversationMessages(
  client: PoolClient,
  conversationId: string,
  session: ChatSessionRecord,
  options?: {
    pruneExtraMessages?: boolean;
  },
) {
  const messages = getSessionMessages(session);
  for (let index = 0; index < messages.length; index += 1) {
    const rawMessage = sanitizeJsonPayload(messages[index]) as JsonObject;
    await client.query(
      `insert into messages (
         conversation_id,
         external_message_id,
         seq,
         role,
         content_text,
         content_json,
         reasoning_text,
         tool_calls,
         metadata_json
       ) values (
         $1::uuid,
         $2,
         $3,
         $4,
         $5,
         $6::jsonb,
         $7,
         $8::jsonb,
         '{}'::jsonb
       )
       on conflict (conversation_id, seq) do update set
         external_message_id = excluded.external_message_id,
         role = excluded.role,
         content_text = excluded.content_text,
         content_json = excluded.content_json,
         reasoning_text = excluded.reasoning_text,
         tool_calls = excluded.tool_calls,
         metadata_json = excluded.metadata_json,
         updated_at = now()`,
      [
        conversationId,
        getExternalMessageId(rawMessage),
        index,
        normalizeMessageRole(rawMessage.role),
        getMessageContentText(rawMessage),
        JSON.stringify(rawMessage),
        getMessageReasoningText(rawMessage),
        JSON.stringify(getMessageToolCalls(rawMessage)),
      ],
    );
  }

  if (options?.pruneExtraMessages !== false) {
    await client.query(
      `delete from messages
       where conversation_id = $1::uuid
         and seq >= $2`,
      [conversationId, messages.length],
    );
  }
}

export async function syncNormalizedChatSessions(
  client: PoolClient,
  params: {
    externalUserId: string;
    index?: ChatIndexPayload;
    upsertSessions: Array<Record<string, unknown>>;
    deleteSessionIds?: string[];
    pruneExtraMessages?: boolean;
  },
) {
  await ensureSyncStorageSchema();
  const appUserId = await getOrCreateSyncAppUserId(params.externalUserId);
  const indexOrderMap = new Map<string, number>();

  (params.index?.sessions || []).forEach((entry, index) => {
    if (!entry?.id) {
      return;
    }

    indexOrderMap.set(String(entry.id), index);
  });

  for (const rawSession of params.upsertSessions) {
    const session = sanitizeJsonPayload(rawSession) as ChatSessionRecord;
    const sessionId = String(session.id || "");
    if (!sessionId) {
      continue;
    }

    const conversationId = await upsertConversation(client, {
      appUserId,
      session,
      indexOrder: indexOrderMap.get(sessionId),
    });
    if (!conversationId) {
      continue;
    }

    // 只有上传的 session 包含消息时才替换远端消息，避免占位符（空 messages）覆盖远端完整数据
    if (getSessionMessages(session).length > 0) {
      await replaceConversationMessages(client, conversationId, session, {
        pruneExtraMessages: params.pruneExtraMessages,
      });
    }
  }

  // 更新用户最后对话时间
  if (params.upsertSessions.length > 0) {
    await client.query(
      `update app_users set last_chat_at = now() where id = $1::uuid`,
      [appUserId],
    );
  }

  const deleteSessionIds = Array.from(
    new Set((params.deleteSessionIds || []).filter(Boolean)),
  );
  if (deleteSessionIds.length > 0) {
    await client.query(
      `delete from conversations
       where user_id = $1::uuid
         and external_session_id = any($2::text[])`,
      [appUserId, deleteSessionIds],
    );
  }
}

export async function getNormalizedChatSessionSnapshots(
  sessionIds: string[],
  externalUserId: string,
) {
  await ensureSyncStorageSchema();
  const normalizedIds = Array.from(new Set(sessionIds.filter(Boolean)));
  if (normalizedIds.length === 0) {
    return {} as Record<string, unknown>;
  }

  const appUserId = await getOrCreateSyncAppUserId(externalUserId);
  const conversations = await pgQuery<{
    id: string;
    external_session_id: string;
    metadata_json: JsonObject;
  }>(
    `select
       id::text as id,
       external_session_id,
       metadata_json
     from conversations
     where user_id = $1::uuid
       and external_session_id = any($2::text[])
       and is_deleted = false
     order by external_session_id`,
    [appUserId, normalizedIds],
  );

  if (conversations.rows.length === 0) {
    return {} as Record<string, unknown>;
  }

  const conversationIds = conversations.rows.map((row) => row.id);
  const messages = await pgQuery<{
    conversation_id: string;
    seq: number;
    content_json: JsonObject;
  }>(
    `select
       conversation_id::text as conversation_id,
       seq,
       content_json
     from messages
     where conversation_id = any($1::uuid[])
     order by conversation_id, seq asc`,
    [conversationIds],
  );

  const messageMap = new Map<string, JsonObject[]>();
  messages.rows.forEach((row) => {
    const currentMessages = messageMap.get(row.conversation_id) || [];
    currentMessages.push(row.content_json);
    messageMap.set(row.conversation_id, currentMessages);
  });

  const sessionMap: Record<string, unknown> = {};
  conversations.rows.forEach((row) => {
    sessionMap[row.external_session_id] = {
      ...(row.metadata_json || {}),
      id: row.external_session_id,
      messages: messageMap.get(row.id) || [],
    };
  });

  return sessionMap;
}

function buildSessionSummaryFromMetadata(row: {
  external_session_id: string;
  metadata_json: JsonObject;
  updated_at: string;
  actual_message_count: string;
}) {
  const metadata = row.metadata_json || {};
  const mask = metadata.mask as JsonObject | undefined;
  const modelConfig = mask?.modelConfig as JsonObject | undefined;
  const restoredAt = Number(metadata._backupRestoredAt || 0);
  const lastUpdate = Number(metadata.lastUpdate || 0);
  const createdAt = Number(metadata.createdAt || 0);

  const messageCount =
    Number(row.actual_message_count || 0) ||
    Number(metadata._syncMessageCount || 0) ||
    0;

  // 使用恢复时间（如果有）作为优先显示时间，否则使用 lastUpdate 或 createdAt
  const displayTime = restoredAt || lastUpdate || createdAt || 0;

  return {
    id: row.external_session_id,
    topic: String(metadata.topic || metadata.title || ""),
    messageCount,
    createdAt: createdAt || 0,
    displayTime,
    avatar: String(mask?.avatar || ""),
    model: String(modelConfig?.model || ""),
    searchText: "", // 搜索文本在前端构建
  };
}

export async function buildNormalizedChatIndexSnapshot(
  externalUserId: string,
  state?: Record<string, unknown>,
) {
  await ensureSyncStorageSchema();
  const appUserId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery<{
    external_session_id: string;
    metadata_json: JsonObject;
    updated_at: string;
    actual_message_count: string;
  }>(
    `select
       c.external_session_id,
       c.metadata_json,
       c.updated_at::text as updated_at,
       (select count(*)::text from messages m where m.conversation_id = c.id) as actual_message_count
     from conversations c
     where c.user_id = $1::uuid
       and c.is_deleted = false
       and exists (select 1 from messages m where m.conversation_id = c.id)
     order by
       coalesce((c.metadata_json ->> '_syncIndexOrder')::integer, 2147483647),
       c.updated_at desc`,
    [appUserId],
  );

  if (result.rows.length === 0) {
    return undefined;
  }

  const sessions = result.rows.map(buildSessionSummaryFromMetadata);

  const statePayload =
    state && typeof state === "object" && !Array.isArray(state) ? state : {};
  const currentSessionId = String(statePayload.currentSessionId || "");
  const currentSessionIndex = currentSessionId
    ? Math.max(
        0,
        sessions.findIndex((session) => session.id === currentSessionId),
      )
    : 0;

  return buildChatIndexPayload({
    ...statePayload,
    sessions,
    currentSessionIndex,
  });
}

// 获取单个会话的完整内容
export async function getChatSessionById(
  externalUserId: string,
  externalSessionId: string,
): Promise<JsonObject | null> {
  await ensureSyncStorageSchema();
  const appUserId = await getOrCreateSyncAppUserId(externalUserId);

  const result = await pgQuery<{
    metadata_json: JsonObject;
    messages: JsonObject[];
  }>(
    `select 
       c.metadata_json,
       array_agg(
         m.content_json 
         order by m.seq 
       ) as messages
     from conversations c
     left join messages m on m.conversation_id = c.id
     where c.user_id = $1::uuid
       and c.external_session_id = $2
       and c.is_deleted = false
     group by c.id
     limit 1`,
    [appUserId, externalSessionId],
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const metadata = row.metadata_json || {};
  const messages = Array.isArray(row.messages)
    ? row.messages.filter(Boolean)
    : [];

  return {
    ...metadata,
    id: externalSessionId,
    messages: messages,
  };
}
