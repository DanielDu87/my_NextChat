import type { PoolClient } from "pg";
import {
  ensureSyncStorageSchema,
  withPgTransaction,
} from "../app/utils/server/postgres";
import { getOrCreateSyncAppUserId } from "../app/utils/server/sync-app-user";
import { getDefaultSyncUserId } from "../app/utils/server/sync-user";

type UserRow = {
  id: string;
  external_id: string | null;
};

type AppSettingsRow = {
  user_id: string;
  ui_settings: Record<string, unknown> | null;
  chat_settings: Record<string, unknown> | null;
  model_settings: Record<string, unknown> | null;
  plugin_settings: Record<string, unknown> | null;
  sync_settings: Record<string, unknown> | null;
  security_settings: Record<string, unknown> | null;
  extra_settings: Record<string, unknown> | null;
  updated_at: string;
};

type NamedRow = {
  id: string;
  user_id: string;
  value: string;
};

type ConversationRow = {
  id: string;
  user_id: string;
  external_session_id: string | null;
};

function parseTargetExternalUserId() {
  const fromArg = process.argv[2]?.trim();
  if (fromArg) {
    return fromArg;
  }

  return getDefaultSyncUserId();
}

function asObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

async function tableExists(client: PoolClient, tableName: string) {
  const result = await client.query<{ exists: boolean }>(
    `select to_regclass($1) is not null as exists`,
    [tableName],
  );
  return Boolean(result.rows[0]?.exists);
}

async function columnExists(
  client: PoolClient,
  tableName: string,
  columnName: string,
) {
  const result = await client.query<{ exists: boolean }>(
    `select exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = $1
         and column_name = $2
     ) as exists`,
    [tableName, columnName],
  );
  return Boolean(result.rows[0]?.exists);
}

function buildUniqueSuffix(sourceUserId: string, rowId: string) {
  return `${sourceUserId.slice(0, 8)}-${rowId.slice(0, 8)}`;
}

async function mergeAppSettings(
  client: PoolClient,
  targetUserId: string,
  sourceUserIds: string[],
) {
  if (!(await tableExists(client, "app_settings"))) {
    return 0;
  }

  const allUserIds = [targetUserId, ...sourceUserIds];
  const result = await client.query<AppSettingsRow>(
    `select
       user_id::text as user_id,
       ui_settings,
       chat_settings,
       model_settings,
       plugin_settings,
       sync_settings,
       security_settings,
       extra_settings,
       updated_at::text as updated_at
     from app_settings
     where user_id = any($1::uuid[])
     order by updated_at asc`,
    [allUserIds],
  );

  if (result.rows.length === 0) {
    return 0;
  }

  const merged = {
    ui_settings: {} as Record<string, unknown>,
    chat_settings: {} as Record<string, unknown>,
    model_settings: {} as Record<string, unknown>,
    plugin_settings: {} as Record<string, unknown>,
    sync_settings: {} as Record<string, unknown>,
    security_settings: {} as Record<string, unknown>,
    extra_settings: {} as Record<string, unknown>,
  };

  for (const row of result.rows) {
    merged.ui_settings = {
      ...merged.ui_settings,
      ...asObject(row.ui_settings),
    };
    merged.chat_settings = {
      ...merged.chat_settings,
      ...asObject(row.chat_settings),
    };
    merged.model_settings = {
      ...merged.model_settings,
      ...asObject(row.model_settings),
    };
    merged.plugin_settings = {
      ...merged.plugin_settings,
      ...asObject(row.plugin_settings),
    };
    merged.sync_settings = {
      ...merged.sync_settings,
      ...asObject(row.sync_settings),
    };
    merged.security_settings = {
      ...merged.security_settings,
      ...asObject(row.security_settings),
    };
    merged.extra_settings = {
      ...merged.extra_settings,
      ...asObject(row.extra_settings),
    };
  }

  await client.query(
    `insert into app_settings (
       user_id,
       ui_settings,
       chat_settings,
       model_settings,
       plugin_settings,
       sync_settings,
       security_settings,
       extra_settings
     ) values (
       $1::uuid,
       $2::jsonb,
       $3::jsonb,
       $4::jsonb,
       $5::jsonb,
       $6::jsonb,
       $7::jsonb,
       $8::jsonb
     )
     on conflict (user_id) do update set
       ui_settings = excluded.ui_settings,
       chat_settings = excluded.chat_settings,
       model_settings = excluded.model_settings,
       plugin_settings = excluded.plugin_settings,
       sync_settings = excluded.sync_settings,
       security_settings = excluded.security_settings,
       extra_settings = excluded.extra_settings,
       updated_at = now()`,
    [
      targetUserId,
      JSON.stringify(merged.ui_settings),
      JSON.stringify(merged.chat_settings),
      JSON.stringify(merged.model_settings),
      JSON.stringify(merged.plugin_settings),
      JSON.stringify(merged.sync_settings),
      JSON.stringify(merged.security_settings),
      JSON.stringify(merged.extra_settings),
    ],
  );

  await client.query(
    `delete from app_settings
     where user_id = any($1::uuid[])`,
    [sourceUserIds],
  );

  return result.rows.length;
}

async function renameDuplicateTags(
  client: PoolClient,
  targetUserId: string,
  sourceUserIds: string[],
) {
  if (!(await tableExists(client, "tags"))) {
    return 0;
  }

  const result = await client.query<NamedRow>(
    `select
       id::text as id,
       user_id::text as user_id,
       name as value
     from tags
     where user_id = any($1::uuid[])
     order by created_at asc, id asc`,
    [sourceUserIds],
  );

  const existingNames = new Set<string>();
  const targetRows = await client.query<{ name: string }>(
    `select name
     from tags
     where user_id = $1::uuid`,
    [targetUserId],
  );
  targetRows.rows.forEach((row) => existingNames.add(row.name));

  let renamedCount = 0;
  for (const row of result.rows) {
    let nextName = row.value;
    if (existingNames.has(nextName)) {
      const baseName = `${row.value}-merged`;
      let attempt = 1;
      nextName = `${baseName}-${attempt}`;
      while (existingNames.has(nextName)) {
        attempt += 1;
        nextName = `${baseName}-${attempt}`;
      }

      await client.query(`update tags set name = $2 where id = $1::uuid`, [
        row.id,
        nextName,
      ]);
      renamedCount += 1;
    }

    existingNames.add(nextName);
  }

  await client.query(
    `update tags
     set user_id = $2::uuid
     where user_id = any($1::uuid[])`,
    [sourceUserIds, targetUserId],
  );

  return renamedCount;
}

async function renameDuplicateConversationSessionIds(
  client: PoolClient,
  targetUserId: string,
  sourceUserIds: string[],
) {
  if (!(await tableExists(client, "conversations"))) {
    return {
      renamedCount: 0,
      updatedCount: 0,
    };
  }

  const targetResult = await client.query<{ external_session_id: string | null }>(
    `select external_session_id
     from conversations
     where user_id = $1::uuid
       and external_session_id is not null`,
    [targetUserId],
  );
  const occupiedSessionIds = new Set<string>();
  targetResult.rows.forEach((row) => {
    if (row.external_session_id) {
      occupiedSessionIds.add(row.external_session_id);
    }
  });

  const sourceResult = await client.query<ConversationRow>(
    `select
       id::text as id,
       user_id::text as user_id,
       external_session_id
     from conversations
     where user_id = any($1::uuid[])
     order by created_at asc, id asc`,
    [sourceUserIds],
  );

  let renamedCount = 0;
  for (const row of sourceResult.rows) {
    if (!row.external_session_id) {
      continue;
    }

    let nextSessionId = row.external_session_id;
    if (occupiedSessionIds.has(nextSessionId)) {
      nextSessionId = `${row.external_session_id}__merged__${buildUniqueSuffix(
        row.user_id,
        row.id,
      )}`;
      while (occupiedSessionIds.has(nextSessionId)) {
        nextSessionId = `${nextSessionId}-1`;
      }

      await client.query(
        `update conversations
         set external_session_id = $2
         where id = $1::uuid`,
        [row.id, nextSessionId],
      );
      renamedCount += 1;
    }

    occupiedSessionIds.add(nextSessionId);
  }

  const updateResult = await client.query<{ count: string }>(
    `with updated as (
       update conversations
       set user_id = $2::uuid
       where user_id = any($1::uuid[])
       returning 1
     )
     select count(*)::text as count from updated`,
    [sourceUserIds, targetUserId],
  );

  return {
    renamedCount,
    updatedCount: Number(updateResult.rows[0]?.count || 0),
  };
}

async function mergeProviderConfigs(
  client: PoolClient,
  targetUserId: string,
  sourceUserIds: string[],
) {
  if (!(await tableExists(client, "provider_configs"))) {
    return { mergedConfigs: 0, mergedKeys: 0 };
  }

  const configRows = await client.query<{
    id: string;
    user_id: string;
    provider_code: string;
    provider_name: string;
    provider_type: string;
    base_url: string | null;
    api_path: string | null;
    api_format: string | null;
    is_enabled: boolean;
    is_default: boolean;
    request_config: Record<string, unknown> | null;
    raw_payload: Record<string, unknown> | null;
    updated_at: string;
    created_at: string;
  }>(
    `select
       id::text as id,
       user_id::text as user_id,
       provider_code,
       provider_name,
       provider_type,
       base_url,
       api_path,
       api_format,
       is_enabled,
       is_default,
       request_config,
       raw_payload,
       updated_at::text as updated_at,
       created_at::text as created_at
     from provider_configs
     where user_id = any($1::uuid[])
     order by updated_at desc, created_at desc, id desc`,
    [[targetUserId, ...sourceUserIds]],
  );

  if (configRows.rows.length === 0) {
    return { mergedConfigs: 0, mergedKeys: 0 };
  }

  const canonicalByCode = new Map<string, (typeof configRows.rows)[number]>();
  const configIdsToDelete: string[] = [];
  const configIdToCanonicalId = new Map<string, string>();

  for (const row of configRows.rows) {
    const existing = canonicalByCode.get(row.provider_code);
    if (!existing) {
      canonicalByCode.set(row.provider_code, row);
      configIdToCanonicalId.set(row.id, row.id);
      continue;
    }

    configIdsToDelete.push(row.id);
    configIdToCanonicalId.set(row.id, existing.id);
  }

  const allConfigIds = configRows.rows.map((row) => row.id);
  let mergedKeys = 0;

  if (allConfigIds.length > 0 && (await tableExists(client, "provider_api_keys"))) {
    const keyRows = await client.query<{
      id: string;
      provider_config_id: string;
      key_name: string;
      key_scope: string | null;
      api_key_group: string | null;
      encrypted_secret: string | null;
      masked_secret: string | null;
      metadata_json: Record<string, unknown> | null;
      is_enabled: boolean;
      last_verified_at: string | null;
      expires_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `select
         id::text as id,
         provider_config_id::text as provider_config_id,
         key_name,
         key_scope,
         api_key_group,
         encrypted_secret,
         masked_secret,
         metadata_json,
         is_enabled,
         last_verified_at::text as last_verified_at,
         expires_at::text as expires_at,
         created_at::text as created_at,
         updated_at::text as updated_at
       from provider_api_keys
       where provider_config_id = any($1::uuid[])
       order by updated_at desc, created_at desc, id desc`,
      [allConfigIds],
    );

    const seenKeys = new Set<string>();
    for (const row of keyRows.rows) {
      const canonicalConfigId =
        configIdToCanonicalId.get(row.provider_config_id) || row.provider_config_id;
      const uniqueKey = `${canonicalConfigId}::${row.key_name}`;
      if (seenKeys.has(uniqueKey)) {
        continue;
      }

      seenKeys.add(uniqueKey);
      await client.query(
        `insert into provider_api_keys (
           provider_config_id,
           key_name,
           key_scope,
           api_key_group,
           encrypted_secret,
           masked_secret,
           metadata_json,
           is_enabled,
           last_verified_at,
           expires_at
         ) values (
           $1::uuid,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7::jsonb,
           $8,
           $9::timestamptz,
           $10::timestamptz
         )
         on conflict (provider_config_id, key_name) do update set
           key_scope = excluded.key_scope,
           api_key_group = excluded.api_key_group,
           encrypted_secret = excluded.encrypted_secret,
           masked_secret = excluded.masked_secret,
           metadata_json = excluded.metadata_json,
           is_enabled = excluded.is_enabled,
           last_verified_at = excluded.last_verified_at,
           expires_at = excluded.expires_at,
           updated_at = now()`,
        [
          canonicalConfigId,
          row.key_name,
          row.key_scope,
          row.api_key_group,
          row.encrypted_secret,
          row.masked_secret,
          JSON.stringify(asObject(row.metadata_json)),
          row.is_enabled,
          row.last_verified_at,
          row.expires_at,
        ],
      );
      mergedKeys += 1;
    }
  }

  const hasConversations = await tableExists(client, "conversations");
  const hasUsageLogs = await tableExists(client, "usage_logs");

  if (configIdsToDelete.length > 0) {
    for (const duplicateConfigId of configIdsToDelete) {
      const canonicalConfigId =
        configIdToCanonicalId.get(duplicateConfigId) || duplicateConfigId;
      if (hasConversations) {
        await client.query(
          `update conversations
           set provider_config_id = $2::uuid
           where provider_config_id = $1::uuid`,
          [duplicateConfigId, canonicalConfigId],
        );
      }

      if (hasUsageLogs) {
        await client.query(
          `update usage_logs
           set provider_config_id = $2::uuid
           where provider_config_id = $1::uuid`,
          [duplicateConfigId, canonicalConfigId],
        );
      }
    }
  }

  if (configIdsToDelete.length > 0) {
    await client.query(
      `delete from provider_configs
       where id = any($1::uuid[])`,
      [configIdsToDelete],
    );
  }

  for (const row of Array.from(canonicalByCode.values())) {
    await client.query(
      `update provider_configs
       set user_id = $2::uuid
       where id = $1::uuid`,
      [row.id, targetUserId],
    );
  }

  return {
    mergedConfigs: canonicalByCode.size,
    mergedKeys,
  };
}

async function mergeTextKeyTable(
  client: PoolClient,
  tableName: string,
  keyColumn: string,
  targetExternalUserId: string,
  sourceTextUserIds: string[],
) {
  if (!(await tableExists(client, tableName))) {
    return 0;
  }

  const result = await client.query<{
    key_name: string;
    payload_json: unknown;
  }>(
    `with ranked as (
       select
         ${keyColumn}::text as key_name,
         payload_json,
         row_number() over (
           partition by ${keyColumn}
           order by updated_at desc, created_at desc
         ) as rn
       from ${tableName}
       where user_id = any($1::text[])
     )
     select key_name, payload_json
     from ranked
     where rn = 1`,
    [[targetExternalUserId, ...sourceTextUserIds]],
  );

  for (const row of result.rows) {
    await client.query(
      `insert into ${tableName} (user_id, ${keyColumn}, payload_json)
       values ($1, $2, $3::jsonb)
       on conflict (user_id, ${keyColumn}) do update set
         payload_json = excluded.payload_json,
         updated_at = now()`,
      [targetExternalUserId, row.key_name, JSON.stringify(row.payload_json ?? {})],
    );
  }

  await client.query(
    `delete from ${tableName}
     where user_id = any($1::text[])
       and user_id <> $2`,
    [sourceTextUserIds, targetExternalUserId],
  );

  return result.rows.length;
}

async function mergeSyncSecrets(
  client: PoolClient,
  targetExternalUserId: string,
  sourceTextUserIds: string[],
) {
  if (!(await tableExists(client, "sync_secrets"))) {
    return 0;
  }

  const result = await client.query<{
    key_name: string;
    encrypted_payload: string;
  }>(
    `with ranked as (
       select
         secret_key::text as key_name,
         encrypted_payload,
         row_number() over (
           partition by secret_key
           order by updated_at desc, created_at desc
         ) as rn
       from sync_secrets
       where user_id = any($1::text[])
     )
     select key_name, encrypted_payload
     from ranked
     where rn = 1`,
    [[targetExternalUserId, ...sourceTextUserIds]],
  );

  for (const row of result.rows) {
    await client.query(
      `insert into sync_secrets (user_id, secret_key, encrypted_payload)
       values ($1, $2, $3)
       on conflict (user_id, secret_key) do update set
         encrypted_payload = excluded.encrypted_payload,
         updated_at = now()`,
      [targetExternalUserId, row.key_name, row.encrypted_payload],
    );
  }

  await client.query(
    `delete from sync_secrets
     where user_id = any($1::text[])
       and user_id <> $2`,
    [sourceTextUserIds, targetExternalUserId],
  );

  return result.rows.length;
}

async function collectResidualTextUserIds(
  client: PoolClient,
  targetExternalUserId: string,
) {
  const values = new Set<string>();
  const tableNames = [
    "user_model_refresh_states",
    "sync_secrets",
  ] as const;

  for (const tableName of tableNames) {
    if (!(await tableExists(client, tableName))) {
      continue;
    }

    const result = await client.query<{ user_id: string }>(
      `select distinct user_id
       from ${tableName}
       where user_id <> $1`,
      [targetExternalUserId],
    );

    for (const row of result.rows) {
      const normalized = String(row.user_id || "").trim();
      if (normalized) {
        values.add(normalized);
      }
    }
  }

  return Array.from(values);
}

async function updateUuidUserIdTable(
  client: PoolClient,
  tableName: string,
  targetUserId: string,
  sourceUserIds: string[],
) {
  if (!(await tableExists(client, tableName))) {
    return 0;
  }

  const result = await client.query<{ count: string }>(
    `with updated as (
       update ${tableName}
       set user_id = $2::uuid
       where user_id = any($1::uuid[])
       returning 1
     )
     select count(*)::text as count from updated`,
    [sourceUserIds, targetUserId],
  );

  return Number(result.rows[0]?.count || 0);
}

async function updateNullableUuidUserIdTable(
  client: PoolClient,
  tableName: string,
  targetUserId: string,
  sourceUserIds: string[],
) {
  if (!(await tableExists(client, tableName))) {
    return 0;
  }

  const result = await client.query<{ count: string }>(
    `with updated as (
       update ${tableName}
       set user_id = $2::uuid
       where user_id = any($1::uuid[])
       returning 1
     )
     select count(*)::text as count from updated`,
    [sourceUserIds, targetUserId],
  );

  return Number(result.rows[0]?.count || 0);
}

async function updateShareLinksCreatedBy(
  client: PoolClient,
  targetUserId: string,
  sourceUserIds: string[],
) {
  if (
    !(await tableExists(client, "share_links")) ||
    !(await columnExists(client, "share_links", "created_by"))
  ) {
    return 0;
  }

  const result = await client.query<{ count: string }>(
    `with updated as (
       update share_links
       set created_by = $2::uuid
       where created_by = any($1::uuid[])
       returning 1
     )
     select count(*)::text as count from updated`,
    [sourceUserIds, targetUserId],
  );

  return Number(result.rows[0]?.count || 0);
}

async function main() {
  const targetExternalUserId = parseTargetExternalUserId();
  await ensureSyncStorageSchema();
  const targetUserId = await getOrCreateSyncAppUserId(targetExternalUserId);

  const summary = await withPgTransaction(async (client) => {
    const usersResult = await client.query<UserRow>(
      `select id::text as id, external_id
       from app_users
       where external_id is not null
       order by created_at asc`,
    );

    const sourceUsers = usersResult.rows.filter(
      (row) => row.id !== targetUserId && row.external_id?.trim(),
    );
    const sourceUserIds = sourceUsers.map((row) => row.id);
    const sourceExternalUserIds = sourceUsers
      .map((row) => String(row.external_id || "").trim())
      .filter(Boolean);
    const sourceTextUserIds = Array.from(
      new Set([
        ...sourceExternalUserIds,
        ...sourceUserIds,
        ...(await collectResidualTextUserIds(client, targetExternalUserId)),
      ]),
    ).filter((value) => value && value !== targetExternalUserId);

    if (sourceUserIds.length === 0 && sourceTextUserIds.length === 0) {
      return {
        targetExternalUserId,
        targetUserId,
        sourceUsers: 0,
        appSettingsMerged: 0,
        renamedTags: 0,
        renamedConversations: 0,
        mergedConfigs: 0,
        mergedConfigKeys: 0,
        authAccountsUpdated: 0,
        authSessionsUpdated: 0,
        conversationsUpdated: 0,
        shareLinksUpdated: 0,
        usageLogsUpdated: 0,
        auditLogsUpdated: 0,
        tagsUpdated: 0,
        refreshStatesMerged: 0,
        syncSecretsMerged: 0,
        deletedUsers: 0,
      };
    }

    const appSettingsMerged = await mergeAppSettings(
      client,
      targetUserId,
      sourceUserIds,
    );
    const renamedTags = await renameDuplicateTags(
      client,
      targetUserId,
      sourceUserIds,
    );
    const {
      renamedCount: renamedConversations,
      updatedCount: conversationsUpdated,
    } = await renameDuplicateConversationSessionIds(
      client,
      targetUserId,
      sourceUserIds,
    );
    const { mergedConfigs, mergedKeys: mergedConfigKeys } =
      await mergeProviderConfigs(client, targetUserId, sourceUserIds);

    const authAccountsUpdated = await updateUuidUserIdTable(
      client,
      "auth_accounts",
      targetUserId,
      sourceUserIds,
    );
    const authSessionsUpdated = await updateUuidUserIdTable(
      client,
      "auth_sessions",
      targetUserId,
      sourceUserIds,
    );
    const tagsUpdated = await updateUuidUserIdTable(
      client,
      "tags",
      targetUserId,
      sourceUserIds,
    );
    const usageLogsUpdated = await updateNullableUuidUserIdTable(
      client,
      "usage_logs",
      targetUserId,
      sourceUserIds,
    );
    const auditLogsUpdated = await updateNullableUuidUserIdTable(
      client,
      "audit_logs",
      targetUserId,
      sourceUserIds,
    );
    const shareLinksUpdated = await updateShareLinksCreatedBy(
      client,
      targetUserId,
      sourceUserIds,
    );

    const refreshStatesMerged = await mergeTextKeyTable(
      client,
      "user_model_refresh_states",
      "refresh_key",
      targetExternalUserId,
      sourceTextUserIds,
    );
    const syncSecretsMerged = await mergeSyncSecrets(
      client,
      targetExternalUserId,
      sourceTextUserIds,
    );

    if (sourceUserIds.length > 0) {
      await client.query(
        `delete from app_users
         where id = any($1::uuid[])`,
        [sourceUserIds],
      );
    }

    return {
      targetExternalUserId,
      targetUserId,
      sourceUsers: sourceUserIds.length,
      appSettingsMerged,
      renamedTags,
      renamedConversations,
      mergedConfigs,
      mergedConfigKeys,
      authAccountsUpdated,
      authSessionsUpdated,
      conversationsUpdated,
      shareLinksUpdated,
      usageLogsUpdated,
      auditLogsUpdated,
      tagsUpdated,
      refreshStatesMerged,
      syncSecretsMerged,
      deletedUsers: sourceUserIds.length,
    };
  });

  console.log("[db:unify-user-id] done");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(
    "[db:unify-user-id] failed",
    error instanceof Error ? error.stack || error.message : String(error),
  );
  process.exit(1);
});
