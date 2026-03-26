import { ServiceProvider } from "@/app/constant";
import {
  ensureSyncStorageSchema,
  pgQuery,
  withPgTransaction,
} from "./postgres";
import {
  decryptSyncSecretPayload,
  encryptSyncSecretPayload,
} from "./sync-secrets";
import { getOrCreateSyncAppUserId } from "./sync-app-user";

type QueryClient = {
  query: (text: string, params?: unknown[]) => Promise<any>;
};

type AccessProfile = {
  id: string;
  name: string;
  provider: ServiceProvider | string;
  baseUrl: string;
  apiKey?: string;
  balanceQueryApiKey?: string;
  balanceQueryUrl?: string;
  balanceQueryField?: string;
  apiKeyGroups?: Record<string, string>;
  enabled: boolean;
  openAICompatible?: boolean;
  cachedModels?: string;
  modelCount?: number;
  modelFetchApiKey?: string;
  [key: string]: unknown;
};

type AccessState = {
  apiProfiles?: AccessProfile[];
  [key: string]: unknown;
};
const ENCRYPTED_SECRET_PLACEHOLDER = "__encrypted__";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapState(payload: unknown) {
  if (isObject(payload) && isObject(payload.state)) {
    return payload.state as AccessState;
  }
  return (payload || {}) as AccessState;
}

function maskSecret(secret: string) {
  if (!secret) return "";
  if (secret.length <= 8) {
    return `${secret.slice(0, 2)}***${secret.slice(-2)}`;
  }
  return `${secret.slice(0, 4)}***${secret.slice(-4)}`;
}

function buildProfileRequestConfig(profile: AccessProfile) {
  return {
    openAICompatible: Boolean(profile.openAICompatible),
    modelCount:
      typeof profile.modelCount === "number" ? profile.modelCount : undefined,
    cachedModels:
      typeof profile.cachedModels === "string"
        ? profile.cachedModels
        : undefined,
    modelFetchApiKey:
      typeof profile.modelFetchApiKey === "string" && profile.modelFetchApiKey
        ? "__encrypted__"
        : undefined,
    balanceQueryApiKey:
      typeof profile.balanceQueryApiKey === "string" &&
      profile.balanceQueryApiKey
        ? "__encrypted__"
        : undefined,
    balanceQueryUrl:
      typeof profile.balanceQueryUrl === "string"
        ? profile.balanceQueryUrl
        : undefined,
    balanceQueryField:
      typeof profile.balanceQueryField === "string"
        ? profile.balanceQueryField
        : undefined,
  };
}

function sanitizeProviderProfile(profile: AccessProfile) {
  const nextProfile = { ...profile };
  delete nextProfile.apiKey;
  delete nextProfile.apiKeyGroups;
  delete nextProfile.modelFetchApiKey;
  delete nextProfile.balanceQueryApiKey;
  return nextProfile;
}

function toPrimaryKeyRows(providerConfigId: string, profile: AccessProfile) {
  const rows: Array<{
    keyName: string;
    keyScope: string;
    apiKeyGroup: string | null;
    secret: string;
  }> = [];

  if (profile.apiKey) {
    if (profile.apiKey !== ENCRYPTED_SECRET_PLACEHOLDER) {
      rows.push({
        keyName: "default",
        keyScope: "api",
        apiKeyGroup: null,
        secret: profile.apiKey,
      });
    }
  }

  if (profile.modelFetchApiKey) {
    if (profile.modelFetchApiKey !== ENCRYPTED_SECRET_PLACEHOLDER) {
      rows.push({
        keyName: "model-fetch",
        keyScope: "model_fetch",
        apiKeyGroup: null,
        secret: profile.modelFetchApiKey,
      });
    }
  }

  if (profile.balanceQueryApiKey) {
    if (profile.balanceQueryApiKey !== ENCRYPTED_SECRET_PLACEHOLDER) {
      rows.push({
        keyName: "balance-query",
        keyScope: "balance_query",
        apiKeyGroup: null,
        secret: profile.balanceQueryApiKey,
      });
    }
  }

  Object.entries(profile.apiKeyGroups || {}).forEach(([groupName, value]) => {
    if (!value || value === ENCRYPTED_SECRET_PLACEHOLDER) return;
    rows.push({
      keyName: `group:${groupName}`,
      keyScope: "group",
      apiKeyGroup: groupName,
      secret: value,
    });
  });

  return rows.map((row) => ({
    providerConfigId,
    ...row,
  }));
}

export async function syncProviderConfigsFromAccessState(
  externalUserId: string,
  payload: unknown,
  existingClient?: QueryClient,
) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const state = unwrapState(payload);
  const profiles = Array.isArray(state.apiProfiles)
    ? state.apiProfiles.filter((profile) => profile?.id)
    : [];

  const syncWithClient = async (client: QueryClient) => {
    const keptProviderCodes = profiles.map((profile) => profile.id);

    if (keptProviderCodes.length > 0) {
      await client.query(
        `delete from provider_configs
         where user_id = $1::uuid
           and provider_code <> all($2::text[])`,
        [userId, keptProviderCodes],
      );
    } else {
      await client.query(
        `delete from provider_configs where user_id = $1::uuid`,
        [userId],
      );
    }

    for (const profile of profiles) {
      const configResult = (await client.query(
        `insert into provider_configs (
           user_id,
           provider_code,
           provider_name,
           provider_type,
           base_url,
           is_enabled,
           request_config,
           raw_payload
         ) values (
           $1::uuid, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb
         )
         on conflict (user_id, provider_code) do update set
           provider_name = excluded.provider_name,
           provider_type = excluded.provider_type,
           base_url = excluded.base_url,
           is_enabled = excluded.is_enabled,
           request_config = excluded.request_config,
           raw_payload = excluded.raw_payload,
           updated_at = now()
         returning id::text as id`,
        [
          userId,
          profile.id,
          profile.name,
          String(profile.provider || ServiceProvider.Custom),
          profile.baseUrl || null,
          Boolean(profile.enabled),
          JSON.stringify(buildProfileRequestConfig(profile)),
          JSON.stringify(sanitizeProviderProfile(profile)),
        ],
      )) as { rows?: Array<{ id: string }> };

      const providerConfigId = (configResult.rows ?? [])[0]?.id;
      if (!providerConfigId) {
        continue;
      }

      const keyRows = toPrimaryKeyRows(providerConfigId, profile);
      const keptKeyNames = keyRows.map((row) => row.keyName);

      if (keptKeyNames.length > 0) {
        await client.query(
          `delete from provider_api_keys
           where provider_config_id = $1::uuid
             and key_name <> all($2::text[])`,
          [providerConfigId, keptKeyNames],
        );
      } else {
        await client.query(
          `delete from provider_api_keys where provider_config_id = $1::uuid`,
          [providerConfigId],
        );
      }

      for (const row of keyRows) {
        await client.query(
          `insert into provider_api_keys (
             provider_config_id,
             key_name,
             key_scope,
             api_key_group,
             encrypted_secret,
             masked_secret,
             metadata_json,
             is_enabled
           ) values (
             $1::uuid, $2, $3, $4, $5, $6, $7::jsonb, true
           )
           on conflict (provider_config_id, key_name) do update set
             key_scope = excluded.key_scope,
             api_key_group = excluded.api_key_group,
             encrypted_secret = excluded.encrypted_secret,
             masked_secret = excluded.masked_secret,
             metadata_json = excluded.metadata_json,
             is_enabled = true,
             updated_at = now()`,
          [
            row.providerConfigId,
            row.keyName,
            row.keyScope,
            row.apiKeyGroup,
            encryptSyncSecretPayload(row.secret),
            maskSecret(row.secret),
            JSON.stringify({ syncedFrom: "access-control" }),
          ],
        );
      }
    }
  };

  if (existingClient) {
    await syncWithClient(existingClient);
    return;
  }

  await withPgTransaction(async (client) => {
    await syncWithClient(client);
  });
}

export async function getProviderProfilesForAccessState(
  externalUserId: string,
) {
  await ensureSyncStorageSchema();
  const userId = await getOrCreateSyncAppUserId(externalUserId);
  const result = await pgQuery<{
    provider_code: string;
    provider_name: string;
    provider_type: string;
    base_url: string | null;
    is_enabled: boolean;
    request_config: Record<string, unknown> | null;
    encrypted_secret: string | null;
    key_name: string | null;
    api_key_group: string | null;
  }>(
    `select
       pc.provider_code,
       pc.provider_name,
       pc.provider_type,
       pc.base_url,
       pc.is_enabled,
       pc.request_config,
       pak.encrypted_secret,
       pak.key_name,
       pak.api_key_group
     from provider_configs pc
     left join provider_api_keys pak
       on pak.provider_config_id = pc.id
     where pc.user_id = $1::uuid
     order by pc.provider_code, pak.key_name nulls last`,
    [userId],
  );

  const profileMap = new Map<string, AccessProfile>();

  result.rows.forEach((row) => {
    const existing = profileMap.get(row.provider_code) || {
      id: row.provider_code,
      name: row.provider_name,
      provider: row.provider_type,
      baseUrl: row.base_url || "",
      enabled: row.is_enabled,
    };

    const requestConfig = isObject(row.request_config)
      ? row.request_config
      : {};
    if (typeof requestConfig.openAICompatible === "boolean") {
      existing.openAICompatible = requestConfig.openAICompatible;
    }
    if (typeof requestConfig.cachedModels === "string") {
      existing.cachedModels = requestConfig.cachedModels;
    }
    if (typeof requestConfig.modelCount === "number") {
      existing.modelCount = requestConfig.modelCount;
    }
    if (typeof requestConfig.balanceQueryUrl === "string") {
      existing.balanceQueryUrl = requestConfig.balanceQueryUrl;
    }
    if (typeof requestConfig.balanceQueryField === "string") {
      existing.balanceQueryField = requestConfig.balanceQueryField;
    }

    const decryptedSecret = row.encrypted_secret
      ? decryptSyncSecretPayload(row.encrypted_secret)
      : null;
    const secretValue =
      typeof decryptedSecret === "string" ? decryptedSecret : "";

    if (row.key_name === "default" && secretValue) {
      existing.apiKey = secretValue;
    } else if (row.key_name === "model-fetch" && secretValue) {
      existing.modelFetchApiKey = secretValue;
    } else if (row.key_name === "balance-query" && secretValue) {
      existing.balanceQueryApiKey = secretValue;
    } else if (
      row.key_name?.startsWith("group:") &&
      row.api_key_group &&
      secretValue
    ) {
      existing.apiKeyGroups = {
        ...(existing.apiKeyGroups || {}),
        [row.api_key_group]: secretValue,
      };
    }

    profileMap.set(row.provider_code, existing);
  });

  return [...profileMap.values()];
}
