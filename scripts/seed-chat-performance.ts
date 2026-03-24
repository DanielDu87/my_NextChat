import { nanoid } from "nanoid";

import { StoreKey } from "../app/constant";
import { buildChatIndexPayload } from "../app/utils/chat-sync";
import { closePostgresPool, pgQuery } from "../app/utils/server/postgres";
import { applyChatDelta } from "../app/utils/server/sync-store-repository";

type SeedMode = "replace" | "append";

type CliOptions = {
  sessions: number;
  messages: number;
  mode: SeedMode;
};

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    sessions: 50,
    messages: 20,
    mode: "append",
  };

  for (const arg of argv) {
    if (arg.startsWith("--sessions=")) {
      options.sessions = parsePositiveInt(arg.split("=")[1], options.sessions);
      continue;
    }

    if (arg.startsWith("--messages=")) {
      options.messages = parsePositiveInt(arg.split("=")[1], options.messages);
      continue;
    }

    if (arg.startsWith("--mode=")) {
      const mode = arg.split("=")[1];
      if (mode === "replace" || mode === "append") {
        options.mode = mode;
      }
    }
  }

  return options;
}

function createMask(topic: string, createdAt: number) {
  return {
    id: nanoid(),
    createdAt,
    avatar: "gpt-bot",
    name: topic,
    hideContext: false,
    context: [],
    syncGlobalConfig: true,
    modelConfig: {
      model: "gpt-4o-mini",
      providerName: "OpenAI",
    },
    lang: "cn",
    builtin: false,
    plugin: [],
  };
}

function createStat(messages: Array<{ content: string }>) {
  const charCount = messages.reduce(
    (total, message) => total + String(message.content || "").length,
    0,
  );

  return {
    tokenCount: Math.ceil(charCount / 4),
    wordCount: charCount,
    charCount,
  };
}

function createSession(sessionIndex: number, messageCount: number) {
  const now = Date.now();
  const createdAt = now - sessionIndex * 10 * 60 * 1000;
  const topic = `测试对话-【${sessionIndex + 1}】`;
  const messages = Array.from({ length: messageCount }, (_, messageIndex) => {
    const isUser = messageIndex % 2 === 0;
    const round = Math.floor(messageIndex / 2) + 1;
    const date = new Date(createdAt + messageIndex * 30 * 1000).toISOString();
    return {
      id: nanoid(),
      date,
      role: isUser ? "user" : ("assistant" as const),
      content: isUser
        ? `第 ${sessionIndex + 1} 个性能测试会话，第 ${round} 轮提问。用于验证侧边栏索引、懒加载和搜索性能。`
        : `第 ${sessionIndex + 1} 个性能测试会话，第 ${round} 轮回复。当前消息序号 ${messageIndex + 1}，用于验证大体量会话正文恢复。`,
      model: "gpt-4o-mini",
    };
  });

  return {
    id: nanoid(),
    topic,
    memoryPrompt: "",
    messages,
    stat: createStat(messages),
    createdAt,
    lastUpdate: createdAt + messageCount * 30 * 1000,
    lastSummarizeIndex: 0,
    mask: createMask(topic, createdAt),
  };
}

async function clearExistingChatArtifacts() {
  await pgQuery(
    `delete from user_chat_state_indexes where user_id = $1`,
    ["single-user"],
  );
  await pgQuery(
    `delete from messages
     where conversation_id in (
       select id from conversations
       where external_session_id is not null
         and user_id = (select id from app_users where external_id = $1 limit 1)
     )`,
    ["single-user"],
  );
  await pgQuery(
    `delete from conversations
     where external_session_id is not null
       and user_id = (select id from app_users where external_id = $1 limit 1)`,
    ["single-user"],
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sessions = Array.from({ length: options.sessions }, (_, index) =>
    createSession(index, options.messages),
  );

  if (options.mode === "replace") {
    await clearExistingChatArtifacts();
  }

  const chatState = {
    sessions,
    currentSessionIndex: 0,
    // 直接构建 sessionSummaries，包含完整的 messageCount 和 searchText
    sessionSummaries: sessions.map((session) => ({
      id: session.id,
      topic: session.topic,
      messageCount: session.messages.length,
      createdAt: session.createdAt,
      displayTime: session.createdAt || session.lastUpdate || Date.now(),
      avatar: session.mask.avatar,
      model: session.mask.modelConfig.model,
      searchText: session.messages
        .map((m) => String(m.content || ""))
        .join("\n")
        .slice(0, 10000), // 限制搜索文本长度
    })),
    lastInput: "",
    globalClearAt: 0,
    deletedSessionTimestamps: {},
  };

  await applyChatDelta({
    index: buildChatIndexPayload(chatState),
    upsertSessions: sessions,
    deleteSessionIds: [],
  });

  const indexCountResult = await pgQuery<{ count: string }>(
    `select count(*)::text as count
     from conversations
     where external_session_id is not null
       and user_id = (select id from app_users where external_id = $1 limit 1)`,
    ["single-user"],
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: options.mode,
        sessions: options.sessions,
        messagesPerSession: options.messages,
        totalMessages: options.sessions * options.messages,
        remoteChatConversationRows: Number(indexCountResult.rows[0]?.count ?? 0),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
