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
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `).then(() => undefined);
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
            pbc.masked_management_key, pbc.balance_snapshot, pbc.last_error
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
) {
  await ensureBalanceSchema();
  await pgQuery(
    `insert into provider_balance_configs (provider_config_id, balance_snapshot, last_error, queried_at)
     select id, $3::jsonb, $4, now() from provider_configs where user_id = $1::uuid and provider_code = $2
     on conflict (provider_config_id) do update set
       balance_snapshot = excluded.balance_snapshot,
       last_error = excluded.last_error,
       queried_at = excluded.queried_at,
       updated_at = now()`,
    [userId, profileId, JSON.stringify(balance), lastError],
  );
}
