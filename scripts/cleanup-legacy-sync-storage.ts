import { closePostgresPool, pgQuery } from "../app/utils/server/postgres";

type AppSettingsRow = {
  user_id: string;
  chat_settings: unknown;
  sync_settings: unknown;
  security_settings: unknown;
};

type CleanupSummary = {
  updatedUsers: number;
  removedChatSettingKeys: number;
  removedSyncFields: number;
  removedAccessFields: number;
  droppedTables: string[];
  deletedLegacyRows: Record<string, number>;
};

const CHAT_INDEX_STATE_KEY = "__chat-index-state__";
const LEGACY_SYNC_FIELDS = [
  "useProxy",
  "proxyUrl",
  "webdav",
  "upstash",
];
const LEGACY_ACCESS_FIELDS = [
  "allowedWebDavEndpoints",
  "webdavUsername",
  "webdavPassword",
];
const LEGACY_TABLES = [
  "sync_artifacts",
  "user_chat_state_sessions",
  "user_chat_state_indexes",
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneObject(value: unknown) {
  return isObject(value) ? { ...value } : {};
}

function cleanupChatSettings(input: unknown) {
  const current = cloneObject(input);
  const next: Record<string, unknown> = {};
  let removedKeys = 0;

  if (CHAT_INDEX_STATE_KEY in current) {
    next[CHAT_INDEX_STATE_KEY] = current[CHAT_INDEX_STATE_KEY];
  }

  Object.keys(current).forEach((key) => {
    if (key !== CHAT_INDEX_STATE_KEY) {
      removedKeys += 1;
    }
  });

  return {
    changed: removedKeys > 0,
    value: next,
    removedKeys,
  };
}

function cleanupSyncSettings(input: unknown) {
  const root = cloneObject(input);
  const hasState = isObject(root.state);
  const target = hasState ? { ...(root.state as Record<string, unknown>) } : root;
  let removedFields = 0;

  LEGACY_SYNC_FIELDS.forEach((field) => {
    if (field in target) {
      delete target[field];
      removedFields += 1;
    }
  });

  if (target.provider !== "database") {
    target.provider = "database";
    removedFields += 1;
  }

  if (target.lastProvider !== "database") {
    target.lastProvider = "database";
    removedFields += 1;
  }

  const next = hasState ? { ...root, state: target } : target;
  return {
    changed: removedFields > 0,
    value: next,
    removedFields,
  };
}

function cleanupAccessSettings(input: unknown) {
  const root = cloneObject(input);
  const hasState = isObject(root.state);
  const target = hasState ? { ...(root.state as Record<string, unknown>) } : root;
  let removedFields = 0;

  LEGACY_ACCESS_FIELDS.forEach((field) => {
    if (field in target) {
      delete target[field];
      removedFields += 1;
    }
  });

  const next = hasState ? { ...root, state: target } : target;
  return {
    changed: removedFields > 0,
    value: next,
    removedFields,
  };
}

async function cleanupAppSettings(summary: CleanupSummary) {
  const result = await pgQuery<AppSettingsRow>(
    `select
       user_id::text as user_id,
       chat_settings,
       sync_settings,
       security_settings
     from app_settings`,
  );

  for (const row of result.rows) {
    const chat = cleanupChatSettings(row.chat_settings);
    const sync = cleanupSyncSettings(row.sync_settings);
    const access = cleanupAccessSettings(row.security_settings);

    if (!chat.changed && !sync.changed && !access.changed) {
      continue;
    }

    await pgQuery(
      `update app_settings
       set chat_settings = $2::jsonb,
           sync_settings = $3::jsonb,
           security_settings = $4::jsonb,
           updated_at = now()
       where user_id = $1::uuid`,
      [
        row.user_id,
        JSON.stringify(chat.value),
        JSON.stringify(sync.value),
        JSON.stringify(access.value),
      ],
    );

    summary.updatedUsers += 1;
    summary.removedChatSettingKeys += chat.removedKeys;
    summary.removedSyncFields += sync.removedFields;
    summary.removedAccessFields += access.removedFields;
  }
}

async function cleanupLegacyTables(summary: CleanupSummary) {
  for (const tableName of LEGACY_TABLES) {
    const existsResult = await pgQuery<{ exists: boolean }>(
      `select exists (
         select 1
         from information_schema.tables
         where table_schema = 'public'
           and table_name = $1
       ) as exists`,
      [tableName],
    );

    if (existsResult.rows[0]?.exists !== true) {
      continue;
    }

    const countResult = await pgQuery<{ count: string }>(
      `select count(*)::text as count from ${tableName}`,
    );
    summary.deletedLegacyRows[tableName] = Number(
      countResult.rows[0]?.count || 0,
    );

    await pgQuery(`drop table if exists ${tableName}`);
    summary.droppedTables.push(tableName);
  }
}

async function main() {
  const summary: CleanupSummary = {
    updatedUsers: 0,
    removedChatSettingKeys: 0,
    removedSyncFields: 0,
    removedAccessFields: 0,
    droppedTables: [],
    deletedLegacyRows: {},
  };

  await cleanupAppSettings(summary);
  await cleanupLegacyTables(summary);

  console.log(
    JSON.stringify(
      {
        ok: true,
        ...summary,
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
          error:
            error instanceof Error ? error.stack || error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool().catch(() => {});
  });
