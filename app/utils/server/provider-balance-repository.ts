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
      cached_path text,
      cached_base_url text,
      cached_auth_type text,
      custom_balance_url text,
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
      END $$;
    `).then(() => {});
  });
  await balanceSchemaPromise;
}

export type ProviderBalanceConfig = {
  profileId: string;
  profileName: string;
  hasManagementKey: boolean;
  maskedManagementKey: string;
  managementKey: string;
  balance: { value: number; currency: string; queriedAt: number } | null;
  lastError: string;
  cachedPath?: string;
  cachedBaseUrl?: string;
  cachedAuthType?: string;
  customBalanceUrl?: string;
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

export async function listProviderBalanceConfigs(userId: string) {
  await ensureBalanceSchema();
  const result = await pgQuery<any>(
    `select pc.provider_code, pc.provider_name, pbc.encrypted_management_key,
            pbc.masked_management_key, pbc.balance_snapshot, pbc.last_error,
            pbc.cached_path, pbc.cached_base_url, pbc.cached_auth_type,
            pbc.custom_balance_url
       from provider_configs pc
       left join provider_balance_configs pbc on pbc.provider_config_id = pc.id
      where pc.user_id = $1::uuid
      order by pc.is_enabled desc, pc.provider_name`,
    [userId],
  );
  return result.rows.map(
    (row: any): ProviderBalanceConfig => ({
      profileId: row.provider_code,
      profileName: row.provider_name,
      hasManagementKey: Boolean(row.encrypted_management_key),
      maskedManagementKey: row.masked_management_key || "",
      managementKey: decryptManagementKey(row.encrypted_management_key),
      balance: row.balance_snapshot || null,
      lastError: row.last_error || "",
      cachedPath: row.cached_path || undefined,
      cachedBaseUrl: row.cached_base_url || undefined,
      cachedAuthType: row.cached_auth_type || undefined,
      customBalanceUrl: row.custom_balance_url || undefined,
    }),
  );
}

export async function getProviderManagementKey(
  userId: string,
  profileId: string,
) {
  await ensureBalanceSchema();
  const result = await pgQuery<any>(
    `select pbc.encrypted_management_key
       from provider_configs pc
       join provider_balance_configs pbc on pbc.provider_config_id = pc.id
      where pc.user_id = $1::uuid and pc.provider_code = $2 limit 1`,
    [userId, profileId],
  );
  const encrypted = result.rows[0]?.encrypted_management_key;
  return encrypted ? String(decryptSyncSecretPayload(encrypted) || "") : "";
}

export async function saveProviderManagementKey(
  userId: string,
  profileId: string,
  key: string,
) {
  await ensureBalanceSchema();
  const secret = key.trim();
  await pgQuery(
    `insert into provider_balance_configs (provider_config_id, encrypted_management_key, masked_management_key)
     select id, $3, $4 from provider_configs where user_id = $1::uuid and provider_code = $2
     on conflict (provider_config_id) do update set
       encrypted_management_key = excluded.encrypted_management_key,
       masked_management_key = excluded.masked_management_key,
       updated_at = now()`,
    [
      userId,
      profileId,
      secret ? encryptSyncSecretPayload(secret) : null,
      secret ? `${secret.slice(0, 4)}***${secret.slice(-4)}` : null,
    ],
  );
}

export async function saveProviderBalanceResult(
  userId: string,
  profileId: string,
  balance: unknown,
  lastError = "",
  options?: {
    keepExistingBalance?: boolean;
    cachedPath?: string;
    cachedBaseUrl?: string;
    cachedAuthType?: string;
  },
) {
  await ensureBalanceSchema();

  if (options?.keepExistingBalance && balance === null) {
    // 保留现有余额，只更新错误信息和查询时间
    await pgQuery(
      `insert into provider_balance_configs (provider_config_id, balance_snapshot, last_error, queried_at, cached_path, cached_base_url, cached_auth_type)
       select id, null, $3, now(), $4, $5, $6 from provider_configs where user_id = $1::uuid and provider_code = $2
       on conflict (provider_config_id) do update set
         last_error = excluded.last_error,
         queried_at = now(),
         cached_path = coalesce(excluded.cached_path, provider_balance_configs.cached_path),
         cached_base_url = coalesce(excluded.cached_base_url, provider_balance_configs.cached_base_url),
         cached_auth_type = coalesce(excluded.cached_auth_type, provider_balance_configs.cached_auth_type),
         updated_at = now()`,
      [
        userId,
        profileId,
        lastError,
        options?.cachedPath || null,
        options?.cachedBaseUrl || null,
        options?.cachedAuthType || null,
      ],
    );
  } else {
    // 正常更新余额和错误信息
    await pgQuery(
      `insert into provider_balance_configs (provider_config_id, balance_snapshot, last_error, queried_at, cached_path, cached_base_url, cached_auth_type)
       select id, $3::jsonb, $4, now(), $5, $6, $7 from provider_configs where user_id = $1::uuid and provider_code = $2
       on conflict (provider_config_id) do update set
         balance_snapshot = excluded.balance_snapshot,
         last_error = excluded.last_error,
         queried_at = now(),
         cached_path = coalesce(excluded.cached_path, provider_balance_configs.cached_path),
         cached_base_url = coalesce(excluded.cached_base_url, provider_balance_configs.cached_base_url),
         cached_auth_type = coalesce(excluded.cached_auth_type, provider_balance_configs.cached_auth_type),
         updated_at = now()`,
      [
        userId,
        profileId,
        JSON.stringify(balance),
        lastError,
        options?.cachedPath || null,
        options?.cachedBaseUrl || null,
        options?.cachedAuthType || null,
      ],
    );
  }
}

export async function getProviderBalanceCachedPath(
  userId: string,
  profileId: string,
) {
  await ensureBalanceSchema();
  const result = await pgQuery<any>(
    `select pbc.cached_path, pbc.cached_base_url, pbc.cached_auth_type
       from provider_configs pc
       join provider_balance_configs pbc on pbc.provider_config_id = pc.id
      where pc.user_id = $1::uuid and pc.provider_code = $2 limit 1`,
    [userId, profileId],
  );
  const row = result.rows[0];
  return row
    ? {
        cachedPath: row.cached_path || undefined,
        cachedBaseUrl: row.cached_base_url || undefined,
        cachedAuthType: row.cached_auth_type || undefined,
      }
    : null;
}

export async function saveProviderBalanceCustomUrl(
  userId: string,
  profileId: string,
  customUrl: string,
) {
  await ensureBalanceSchema();
  await pgQuery(
    `insert into provider_balance_configs (provider_config_id, custom_balance_url)
     select id, $3 from provider_configs where user_id = $1::uuid and provider_code = $2
     on conflict (provider_config_id) do update set
       custom_balance_url = excluded.custom_balance_url,
       updated_at = now()`,
    [userId, profileId, customUrl.trim() || null],
  );
}
