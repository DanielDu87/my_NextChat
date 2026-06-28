export type GenericAccessProfile = Record<string, any> & {
  id?: string;
  name?: string;
  provider?: string;
  baseUrl?: string;
  enabled?: boolean;
  apiKey?: string;
  multiKeyEnabled?: boolean;
  multiKeyGroupOrder?: string[];
  modelFetchApiKey?: string;
  apiKeyGroups?: Record<string, string>;
};

const GENERATED_PROFILE_ID_PREFIX = "profile_";
const SECRET_KEYS = ["apiKey", "modelFetchApiKey"];
const LEGACY_GENERATED_CUSTOM_NAME_RE =
  /^custom\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?$/i;
const PLACEHOLDER_BASE_URL_RE = /^xxx(?:-\d+)?$/i;

function normalizeBaseUrl(baseUrl: unknown) {
  return String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase();
}

function isGeneratedProfileId(profile: GenericAccessProfile) {
  return String(profile?.id || "").startsWith(GENERATED_PROFILE_ID_PREFIX);
}

function isLegacyGeneratedCustomName(name: unknown) {
  return LEGACY_GENERATED_CUSTOM_NAME_RE.test(String(name || "").trim());
}

function isPlaceholderBaseUrl(baseUrl: unknown) {
  const value = String(baseUrl || "").trim();
  return !value || PLACEHOLDER_BASE_URL_RE.test(value);
}

function isGeneratedCustomDraftProfile(profile: GenericAccessProfile) {
  const provider = String(profile?.provider || "")
    .trim()
    .toLowerCase();

  if (provider !== "custom" || !isGeneratedProfileId(profile)) {
    return false;
  }

  const name = String(profile?.name || "").trim();
  const isDraftName =
    name === "默认新增配置" || isLegacyGeneratedCustomName(name);

  return isDraftName && isPlaceholderBaseUrl(profile?.baseUrl);
}

export function isLegacyGeneratedCustomProviderId(providerId: unknown) {
  const value = String(providerId || "")
    .trim()
    .toLowerCase();
  return /^custom_custom\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?$/.test(value);
}

export function pruneLegacyGeneratedCustomModels(customModels: unknown) {
  return String(customModels || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const modelWithProvider = item.replace(/^[+-]/, "");
      const atIdx = modelWithProvider.lastIndexOf("@");
      if (atIdx <= 0) {
        return true;
      }
      return !isLegacyGeneratedCustomProviderId(
        modelWithProvider.substring(atIdx + 1),
      );
    })
    .join(",");
}

function profileRank(profile: GenericAccessProfile) {
  let rank = 0;
  if (!isGeneratedProfileId(profile)) rank += 100;
  if (profile?.enabled) rank += 10;
  if (String(profile?.apiKey || "").trim()) rank += 2;
  if (profile?.apiKeyGroups && Object.keys(profile.apiKeyGroups).length > 0) {
    rank += 1;
  }
  if (profile?.multiKeyEnabled) rank += 1;
  return rank;
}

export function normalizeAccessProfileIdentity<T extends GenericAccessProfile>(
  profile: T,
): T {
  const provider = String(profile?.provider || "")
    .trim()
    .toLowerCase();
  void provider;
  return profile;
}

export function getAccessProfileDedupeKey(profile: GenericAccessProfile) {
  const provider = String(profile?.provider || "")
    .trim()
    .toLowerCase();
  const baseUrl = normalizeBaseUrl(profile?.baseUrl);

  if (!provider || !baseUrl) {
    return `${provider || "unknown"}::id:${String(profile?.id || "")}`;
  }

  return `${provider}::${baseUrl}`;
}

function mergeDuplicateProfile(
  preferred: GenericAccessProfile,
  fallback: GenericAccessProfile,
) {
  const merged: GenericAccessProfile = { ...fallback, ...preferred };

  for (const key of SECRET_KEYS) {
    if (
      !String(merged[key] || "").trim() &&
      String(fallback[key] || "").trim()
    ) {
      merged[key] = fallback[key];
    }
  }

  const fallbackGroups =
    fallback.apiKeyGroups && typeof fallback.apiKeyGroups === "object"
      ? fallback.apiKeyGroups
      : {};
  const preferredGroups =
    preferred.apiKeyGroups && typeof preferred.apiKeyGroups === "object"
      ? preferred.apiKeyGroups
      : {};
  const mergedGroups = { ...fallbackGroups, ...preferredGroups };
  if (Object.keys(mergedGroups).length > 0) {
    merged.apiKeyGroups = mergedGroups;
  }

  merged.enabled = Boolean(preferred.enabled || fallback.enabled);
  return merged;
}

export function dedupeAccessProfiles<T extends GenericAccessProfile>(
  profiles: T[] | undefined,
): T[] {
  if (!Array.isArray(profiles)) return [];

  const byKey = new Map<string, GenericAccessProfile>();
  const order: string[] = [];

  for (const profile of profiles) {
    if (!profile || typeof profile !== "object") continue;
    const normalizedProfile = normalizeAccessProfileIdentity(profile);
    const key = getAccessProfileDedupeKey(normalizedProfile);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { ...normalizedProfile });
      order.push(key);
      continue;
    }

    const incomingWins = profileRank(normalizedProfile) > profileRank(existing);
    byKey.set(
      key,
      incomingWins
        ? mergeDuplicateProfile(normalizedProfile, existing)
        : mergeDuplicateProfile(existing, normalizedProfile),
    );
  }

  return order.map((key) => byKey.get(key) as T).filter(Boolean);
}
