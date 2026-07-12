import { ensureSyncStorageSchema, pgQuery } from "./postgres";
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

function getModelFetchSecretKey(profileId: string) {
  return `provider-model-fetch:${profileId}`;
}

export async function getProviderModelCachedPath(
  userId: string,
  profileId: string,
): Promise<ProviderModelCachedPath | null> {
  await ensureSyncStorageSchema();
  const result = await pgQuery<any>(
    `select cached_model_path, cached_model_base_url, cached_model_auth_type
       from provider_configs
      where user_id = $1::uuid and provider_code = $2 limit 1`,
    [userId, profileId],
  );
  const row = result.rows[0];
  if (!row) return null;

  const cachedSecret = await getEncryptedSyncSecret<{
    apiKey?: string;
  }>({
    userId,
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
  userId: string,
  profileId: string,
  options: ProviderModelCachedPath,
) {
  await ensureSyncStorageSchema();
  await pgQuery(
    `update provider_configs
        set cached_model_path = $3,
            cached_model_base_url = $4,
            cached_model_auth_type = $5,
            updated_at = now()
      where user_id = $1::uuid and provider_code = $2`,
    [
      userId,
      profileId,
      options.cachedModelPath || null,
      options.cachedModelBaseUrl || null,
      options.cachedModelAuthType || null,
    ],
  );

  const apiKey = String(options.cachedModelApiKey || "").trim();
  if (apiKey) {
    await setEncryptedSyncSecret({
      userId,
      secretKey: getModelFetchSecretKey(profileId),
      payload: { apiKey },
    });
  } else {
    await deleteEncryptedSyncSecret({
      userId,
      secretKey: getModelFetchSecretKey(profileId),
    });
  }
}
