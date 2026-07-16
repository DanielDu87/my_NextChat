import { ensureSyncStorageSchema, pgQuery } from "./postgres";
import {
  decryptSyncSecretPayload,
  encryptSyncSecretPayload,
} from "./sync-secrets";

let balanceSchemaPromise: Promise<void> | null = null;
async function ensureBalanceSchema() {
  await ensureSyncStorageSchema();
  balanceSchemaPromise ??= pgQuery(`
    create table if not exists provider_balance_configs (
      provider_config_id uuid primary key references provider_configs(id) on delete cascade,
      encrypted_management_key text,
      masked_management_key text,
      balance_snapshot jsonb,
      last_error text,
      queried_at timestamptz,
      query_started_at timestamptz,
      cached_path text,
      cached_base_url text,
      cached_auth_type text,
      custom_balance_url text,
      use_new_api_user_format boolean default false,
      new_api_user_id text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `).then(() => {
    // 添加新列（如果表已存在但缺少这些列）
    return pgQuery(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_balance_configs' AND column_name = 'cached_path') THEN
          ALTER TABLE provider_balance_configs ADD COLUMN cached_path text;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_balance_configs' AND column_name = 'cached_base_url') THEN
          ALTER TABLE provider_balance_configs ADD COLUMN cached_base_url text;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_balance_configs' AND column_name = 'cached_auth_type') THEN
          ALTER TABLE provider_balance_configs ADD COLUMN cached_auth_type text;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_balance_configs' AND column_name = 'custom_balance_url') THEN
          ALTER TABLE provider_balance_configs ADD COLUMN custom_balance_url text;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_balance_configs' AND column_name = 'use_new_api_user_format') THEN
          ALTER TABLE provider_balance_configs ADD COLUMN use_new_api_user_format boolean default false;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_balance_configs' AND column_name = 'new_api_user_id') THEN
          ALTER TABLE provider_balance_configs ADD COLUMN new_api_user_id text;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_balance_configs' AND column_name = 'query_started_at') THEN
          ALTER TABLE provider_balance_configs ADD COLUMN query_started_at timestamptz;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_balance_configs' AND column_name = 'use_uuid_query_format') THEN
          ALTER TABLE provider_balance_configs ADD COLUMN use_uuid_query_format boolean default false;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'provider_balance_configs' AND column_name = 'uuid_query_value') THEN
          ALTER TABLE provider_balance_configs ADD COLUMN uuid_query_value text;
        END IF;
      END $$;
    `).then(() => {});
  });
  await balanceSchemaPromise;
}

export type ProviderBalanceConfig = {
  profileId: string;
  profileName: string;
  baseUrl: string;
  hasManagementKey: boolean;
  maskedManagementKey: string;
  managementKey: string;
  balance: { value: number; currency: string; queriedAt: number } | null;
  lastError: string;
  cachedPath?: string;
  cachedBaseUrl?: string;
  cachedAuthType?: string;
  customBalanceUrl?: string;
  useNewApiUserFormat?: boolean;
  newApiUserId?: string;
  useUuidQueryFormat?: boolean;
  uuidQueryValue?: string;
};

function decryptManagementKey(value: string | null) {
  if (!value) return "";
  try {
    const decrypted = decryptSyncSecretPayload(value);
    return typeof decrypted === "string" ? decrypted : "";
  } catch {
    return "";
  }
}

function splitStoredManagementKey(key: string, newApiUserId?: string) {
  const suffix = newApiUserId ? `|${newApiUserId}` : "";
  if (suffix && key.endsWith(suffix)) {
    return key.slice(0, -suffix.length);
  }
  return key;
}

export async function listProviderBalanceConfigs(_userId?: string) {
  await ensureBalanceSchema();
  const result = await pgQuery<any>(
    `select pc.provider_code, pc.provider_name, pc.base_url, pbc.encrypted_management_key,
            pbc.masked_management_key, pbc.balance_snapshot, pbc.last_error,
            pbc.cached_path, pbc.cached_base_url, pbc.cached_auth_type,
            pbc.custom_balance_url, pbc.use_new_api_user_format, pbc.new_api_user_id,
            pbc.use_uuid_query_format, pbc.uuid_query_value
       from provider_configs pc
       left join provider_balance_configs pbc on pbc.provider_config_id = pc.id
       -- 全局共享模式：不再按 user_id 过滤
      order by pc.is_enabled desc, pc.provider_name`,
  );
  return result.rows.map((row: any): ProviderBalanceConfig => {
    const newApiUserId = row.new_api_user_id || undefined;
    const managementKey = splitStoredManagementKey(
      decryptManagementKey(row.encrypted_management_key),
      newApiUserId,
    );
    return {
      profileId: row.provider_code,
      profileName: row.provider_name,
      baseUrl: row.base_url || "",
      hasManagementKey: Boolean(row.encrypted_management_key),
      maskedManagementKey: managementKey
        ? `${managementKey.slice(0, 4)}***${managementKey.slice(-4)}`
        : "",
      managementKey,
      balance: row.balance_snapshot || null,
      lastError: row.last_error || "",
      cachedPath: row.cached_path || undefined,
      cachedBaseUrl: row.cached_base_url || undefined,
      cachedAuthType: row.cached_auth_type || undefined,
      customBalanceUrl: row.custom_balance_url || undefined,
      useNewApiUserFormat: row.use_new_api_user_format || false,
      newApiUserId,
      useUuidQueryFormat: row.use_uuid_query_format || false,
      uuidQueryValue: row.uuid_query_value || undefined,
    };
  });
}

export async function getProviderBalanceConfig(profileId: string) {
  await ensureBalanceSchema();
  const result = await pgQuery<any>(
    `select pbc.encrypted_management_key, pbc.custom_balance_url,
            pbc.use_new_api_user_format, pbc.new_api_user_id,
            pbc.cached_path, pbc.cached_base_url, pbc.cached_auth_type,
            pbc.use_uuid_query_format, pbc.uuid_query_value
       from provider_configs pc
       left join provider_balance_configs pbc on pbc.provider_config_id = pc.id
      where pc.provider_code = $1 limit 1`,
    [profileId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const newApiUserId = String(row.new_api_user_id || "").trim();
  return {
    managementKey: splitStoredManagementKey(
      decryptManagementKey(row.encrypted_management_key),
      newApiUserId,
    ),
    customBalanceUrl: String(row.custom_balance_url || "").trim(),
    useNewApiUserFormat: Boolean(row.use_new_api_user_format),
    newApiUserId,
    cachedPath: row.cached_path || undefined,
    cachedBaseUrl: row.cached_base_url || undefined,
    cachedAuthType: row.cached_auth_type || undefined,
    useUuidQueryFormat: Boolean(row.use_uuid_query_format),
    uuidQueryValue: String(row.uuid_query_value || "").trim(),
  };
}

export async function saveProviderBalanceConfig(
  profileId: string,
  config: {
    managementKey: string;
    customBalanceUrl: string;
    useNewApiUserFormat: boolean;
    newApiUserId: string;
    useUuidQueryFormat: boolean;
    uuidQueryValue: string;
  },
) {
  await ensureBalanceSchema();
  const secret = config.managementKey.trim();
  const result = await pgQuery(
    `insert into provider_balance_configs (
       provider_config_id, encrypted_management_key, masked_management_key,
       custom_balance_url, use_new_api_user_format, new_api_user_id,
       use_uuid_query_format, uuid_query_value
     )
     select id, $2, $3, $4, $5, $6, $7, $8
       from provider_configs where provider_code = $1
     on conflict (provider_config_id) do update set
       encrypted_management_key = excluded.encrypted_management_key,
       masked_management_key = excluded.masked_management_key,
       custom_balance_url = excluded.custom_balance_url,
       use_new_api_user_format = excluded.use_new_api_user_format,
       new_api_user_id = excluded.new_api_user_id,
       use_uuid_query_format = excluded.use_uuid_query_format,
       uuid_query_value = excluded.uuid_query_value,
       updated_at = now()
     returning provider_config_id`,
    [
      profileId,
      secret ? encryptSyncSecretPayload(secret) : null,
      secret ? `${secret.slice(0, 4)}***${secret.slice(-4)}` : null,
      config.customBalanceUrl.trim() || null,
      config.useNewApiUserFormat,
      config.newApiUserId.trim() || null,
      config.useUuidQueryFormat,
      config.uuidQueryValue.trim() || null,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error("provider_not_found");
  }
}

export async function saveProviderBalanceResult(
  _userId: string,
  profileId: string,
  balance: unknown,
  lastError = "",
  options?: {
    keepExistingBalance?: boolean;
    cachedPath?: string;
    cachedBaseUrl?: string;
    cachedAuthType?: string;
    queryStartedAt?: number;
  },
) {
  await ensureBalanceSchema();

  if (options?.keepExistingBalance && balance === null) {
    // 保留现有余额，只更新错误信息和查询时间
    await pgQuery(
      `insert into provider_balance_configs (provider_config_id, balance_snapshot, last_error, queried_at, query_started_at, cached_path, cached_base_url, cached_auth_type)
       select id, null, $2, now(), to_timestamp($3 / 1000.0), $4, $5, $6 from provider_configs where provider_code = $1
       on conflict (provider_config_id) do update set
         last_error = excluded.last_error,
         queried_at = now(),
         query_started_at = excluded.query_started_at,
         cached_path = coalesce(excluded.cached_path, provider_balance_configs.cached_path),
         cached_base_url = coalesce(excluded.cached_base_url, provider_balance_configs.cached_base_url),
         cached_auth_type = coalesce(excluded.cached_auth_type, provider_balance_configs.cached_auth_type),
         updated_at = now()
       where provider_balance_configs.query_started_at is null
          or excluded.query_started_at >= provider_balance_configs.query_started_at`,
      [
        profileId,
        lastError,
        options?.queryStartedAt || Date.now(),
        options?.cachedPath || null,
        options?.cachedBaseUrl || null,
        options?.cachedAuthType || null,
      ],
    );
  } else {
    // 正常更新余额和错误信息
    await pgQuery(
      `insert into provider_balance_configs (provider_config_id, balance_snapshot, last_error, queried_at, query_started_at, cached_path, cached_base_url, cached_auth_type)
       select id, $2::jsonb, $3, now(), to_timestamp($4 / 1000.0), $5, $6, $7 from provider_configs where provider_code = $1
       on conflict (provider_config_id) do update set
         balance_snapshot = excluded.balance_snapshot,
         last_error = excluded.last_error,
         queried_at = now(),
         query_started_at = excluded.query_started_at,
         cached_path = coalesce(excluded.cached_path, provider_balance_configs.cached_path),
         cached_base_url = coalesce(excluded.cached_base_url, provider_balance_configs.cached_base_url),
         cached_auth_type = coalesce(excluded.cached_auth_type, provider_balance_configs.cached_auth_type),
         updated_at = now()
       where provider_balance_configs.query_started_at is null
          or excluded.query_started_at >= provider_balance_configs.query_started_at`,
      [
        profileId,
        JSON.stringify(balance),
        lastError,
        options?.queryStartedAt || Date.now(),
        options?.cachedPath || null,
        options?.cachedBaseUrl || null,
        options?.cachedAuthType || null,
      ],
    );
  }
}
