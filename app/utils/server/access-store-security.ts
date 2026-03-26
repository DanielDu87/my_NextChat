type JsonObject = Record<string, unknown>;
const ENCRYPTED_SECRET_PLACEHOLDER = "__encrypted__";

const ACCESS_SECRET_FIELDS = new Set([
  "apiKey",
  "modelFetchApiKey",
  "customApiKey",
  "openaiApiKey",
  "azureApiKey",
  "googleApiKey",
  "anthropicApiKey",
  "baiduApiKey",
  "baiduSecretKey",
  "bytedanceApiKey",
  "alibabaApiKey",
  "moonshotApiKey",
  "stabilityApiKey",
  "tencentSecretKey",
  "tencentSecretId",
  "iflytekApiKey",
  "iflytekApiSecret",
  "deepseekApiKey",
  "xaiApiKey",
  "chatglmApiKey",
  "siliconflowApiKey",
  "ai302ApiKey",
]);

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickSecretsFromObject(input: JsonObject) {
  const publicState: JsonObject = {};
  const secretState: JsonObject = {};

  Object.entries(input).forEach(([key, value]) => {
    if (ACCESS_SECRET_FIELDS.has(key)) {
      const isSupportedSecretValue =
        typeof value === "string" ||
        Array.isArray(value) ||
        isObject(value) ||
        typeof value === "number" ||
        typeof value === "boolean";
      if (isSupportedSecretValue && value !== ENCRYPTED_SECRET_PLACEHOLDER) {
        secretState[key] = value;
      }
      return;
    }

    publicState[key] = value;
  });

  return { publicState, secretState };
}

export function splitAccessStorePayload(payload: unknown) {
  if (!isObject(payload)) {
    return {
      publicPayload: payload,
      secretPayload: {},
    };
  }

  const root = { ...payload };
  const state = isObject(root.state) ? { ...root.state } : null;
  const targetState = state ?? root;
  const { publicState, secretState } = pickSecretsFromObject(targetState);

  if (Array.isArray(targetState.apiProfiles)) {
    const publicProfiles: JsonObject[] = [];
    const secretProfiles: JsonObject[] = [];

    targetState.apiProfiles.forEach((profile) => {
      if (!isObject(profile)) {
        publicProfiles.push({});
        return;
      }

      const { publicState: publicProfile, secretState: secretProfile } =
        pickSecretsFromObject(profile);
      publicProfiles.push(publicProfile);

      if (Object.keys(secretProfile).length > 0) {
        secretProfiles.push({
          id: String(profile.id || ""),
          ...secretProfile,
        });
      }
    });

    publicState.apiProfiles = publicProfiles;
    if (secretProfiles.length > 0) {
      secretState.apiProfiles = secretProfiles;
    }
  }

  return {
    publicPayload: state ? { ...root, state: publicState } : publicState,
    secretPayload: secretState,
  };
}

export function mergeAccessStorePayload(
  publicPayload: unknown,
  secretPayload: unknown,
) {
  if (!isObject(publicPayload)) {
    return publicPayload;
  }

  if (!isObject(secretPayload) || Object.keys(secretPayload).length === 0) {
    return publicPayload;
  }

  const root = { ...publicPayload };
  const state = isObject(root.state) ? { ...root.state } : null;
  const targetState = state ?? root;

  Object.entries(secretPayload).forEach(([key, value]) => {
    if (key === "apiProfiles" || value === undefined) {
      return;
    }
    targetState[key] = value;
  });

  const secretProfiles = Array.isArray(secretPayload.apiProfiles)
    ? secretPayload.apiProfiles
    : [];

  if (Array.isArray(targetState.apiProfiles) && secretProfiles.length > 0) {
    const secretProfileMap = new Map<string, JsonObject>();
    secretProfiles.forEach((profile) => {
      if (!isObject(profile) || !profile.id) return;
      secretProfileMap.set(String(profile.id), profile);
    });

    targetState.apiProfiles = targetState.apiProfiles.map((profile) => {
      if (!isObject(profile) || !profile.id) {
        return profile;
      }
      const secretProfile = secretProfileMap.get(String(profile.id));
      if (!secretProfile) {
        return profile;
      }
      return {
        ...profile,
        ...secretProfile,
      };
    });
  }

  return state ? { ...root, state: targetState } : targetState;
}

export function stripAccessStoreProfiles(payload: unknown) {
  if (!isObject(payload)) {
    return payload;
  }

  const root = { ...payload };
  const state = isObject(root.state) ? { ...root.state } : null;
  const targetState = state ?? root;

  delete targetState.apiProfiles;

  return state ? { ...root, state: targetState } : targetState;
}
