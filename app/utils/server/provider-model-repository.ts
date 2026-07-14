import { ensureSyncStorageSchema, pgQuery } from "./postgres";
import { createHash } from "crypto";
import {
  getEncryptedSyncSecret,
  setEncryptedSyncSecret,
  deleteEncryptedSyncSecret,
} from "./sync-secrets";

export type ProviderModelCachedPath = {
  cachedModelPath?: string;
  cachedModelBaseUrl?: string;
  cachedModelAuthType?: string;
  cachedModelApiKey?: string;
};

export type ProviderModelKeyCachedPath = Omit<
  ProviderModelCachedPath,
  "cachedModelApiKey"
> & {
  modelCount?: number;
};

function getApiKeyFingerprint(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

export async function getProviderModelKeyCachedPath(
  profileId: string,
  apiKey: string,
): Promise<ProviderModelKeyCachedPath | null> {
  const normalizedKey = String(apiKey || "").trim();
  if (!normalizedKey) return null;
  await ensureSyncStorageSchema();
  const result = await pgQuery<any>(
    `select r.cached_model_path, r.cached_model_base_url,
            r.cached_model_auth_type, r.model_count
       from provider_model_key_routes r
       join provider_configs pc on pc.id = r.provider_config_id
      where pc.provider_code = $1 and r.key_fingerprint = $2
      limit 1`,
    [profileId, getApiKeyFingerprint(normalizedKey)],
  );
  const row = result.rows[0];
  return row
    ? {
        cachedModelPath: row.cached_model_path || undefined,
        cachedModelBaseUrl: row.cached_model_base_url || undefined,
        cachedModelAuthType: row.cached_model_auth_type || undefined,
        modelCount: Number(row.model_count || 0),
      }
    : null;
}

export async function saveProviderModelKeyCachedPath(
  profileId: string,
  apiKey: string,
  options: ProviderModelKeyCachedPath,
) {
  const normalizedKey = String(apiKey || "").trim();
  const path = String(options.cachedModelPath || "").trim();
  if (!normalizedKey || !path) return;
  await ensureSyncStorageSchema();
  await pgQuery(
    `insert into provider_model_key_routes (
       provider_config_id, key_fingerprint, cached_model_path,
       cached_model_base_url, cached_model_auth_type, model_count
     )
     select id, $2, $3, $4, $5, $6 from provider_configs
      where provider_code = $1
     on conflict (provider_config_id, key_fingerprint) do update set
       cached_model_path = excluded.cached_model_path,
       cached_model_base_url = excluded.cached_model_base_url,
       cached_model_auth_type = excluded.cached_model_auth_type,
       model_count = excluded.model_count,
       updated_at = now()`,
    [
      profileId,
      getApiKeyFingerprint(normalizedKey),
      path,
      options.cachedModelBaseUrl || null,
      options.cachedModelAuthType || null,
      Math.max(0, Number(options.modelCount || 0)),
    ],
  );
}

function getModelFetchSecretKey(profileId: string) {
  return `provider-model-fetch:${profileId}`;
}

export async function getProviderModelCachedPath(
  profileId: string,
): Promise<ProviderModelCachedPath | null> {
  await ensureSyncStorageSchema();
  const result = await pgQuery<any>(
    `select cached_model_path, cached_model_base_url, cached_model_auth_type
       from provider_configs
      where provider_code = $1 limit 1`,
    [profileId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const cachedSecret = await getEncryptedSyncSecret<{
    apiKey?: string;
  }>({
    userId: "global",
    secretKey: getModelFetchSecretKey(profileId),
  });

  return {
    cachedModelPath: row.cached_model_path || undefined,
    cachedModelBaseUrl: row.cached_model_base_url || undefined,
    cachedModelAuthType: row.cached_model_auth_type || undefined,
    cachedModelApiKey: String(cachedSecret?.apiKey || "").trim() || undefined,
  };
}

export async function saveProviderModelCachedPath(
  profileId: string,
  options: ProviderModelCachedPath,
) {
  await ensureSyncStorageSchema();
  await pgQuery(
    `update provider_configs
        set cached_model_path = $2,
            cached_model_base_url = $3,
            cached_model_auth_type = $4,
            updated_at = now()
      where provider_code = $1`,
    [
      profileId,
      options.cachedModelPath || null,
      options.cachedModelBaseUrl || null,
      options.cachedModelAuthType || null,
    ],
  );

  const apiKey = String(options.cachedModelApiKey || "").trim();
  if (apiKey) {
    await setEncryptedSyncSecret({
      userId: "global",
      secretKey: getModelFetchSecretKey(profileId),
      payload: { apiKey },
    });
  } else {
    await deleteEncryptedSyncSecret({
      userId: "global",
      secretKey: getModelFetchSecretKey(profileId),
    });
  }
}
