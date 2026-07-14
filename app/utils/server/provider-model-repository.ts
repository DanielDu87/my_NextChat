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
