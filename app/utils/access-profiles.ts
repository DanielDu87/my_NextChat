export type GenericAccessProfile = Record<string, any> & {
  id?: string;
  name?: string;
  provider?: string;
  baseUrl?: string;
  enabled?: boolean;
  apiKey?: string;
  modelFetchApiKey?: string;
  balanceQueryApiKey?: string;
  apiKeyGroups?: Record<string, string>;
};

const GENERATED_PROFILE_ID_PREFIX = "profile_";
const SECRET_KEYS = ["apiKey", "modelFetchApiKey", "balanceQueryApiKey"];
const CANONICAL_CUSTOM_PROFILE_BY_BASE_URL: Record<
  string,
  { id: string; name: string }
> = {
  "https://aihubmix.com": {
    id: "default_aihubmix_profile",
    name: "AihubMix",
  },
  "https://cn.gptapi.asia": {
    id: "default_yuto_profile",
    name: "YutoAPI",
  },
  "https://one.ooo.cool": {
    id: "default_ocool_profile",
    name: "Ocoolai",
  },
  "https://toapis.com": {
    id: "default_toapis_profile",
    name: "ToAPIs",
  },
};

function normalizeBaseUrl(baseUrl: unknown) {
  return String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "")
    .toLowerCase();
}

function isGeneratedProfileId(profile: GenericAccessProfile) {
  return String(profile?.id || "").startsWith(GENERATED_PROFILE_ID_PREFIX);
}

function profileRank(profile: GenericAccessProfile) {
  let rank = 0;
  if (!isGeneratedProfileId(profile)) rank += 100;
  if (profile?.enabled) rank += 10;
  if (String(profile?.apiKey || "").trim()) rank += 2;
  if (profile?.apiKeyGroups && Object.keys(profile.apiKeyGroups).length > 0) {
    rank += 1;
  }
  return rank;
}

export function normalizeAccessProfileIdentity<T extends GenericAccessProfile>(
  profile: T,
): T {
  const provider = String(profile?.provider || "")
    .trim()
    .toLowerCase();
  const canonical =
    CANONICAL_CUSTOM_PROFILE_BY_BASE_URL[normalizeBaseUrl(profile?.baseUrl)];

  if (provider !== "custom" || !canonical) {
    return profile;
  }

  return {
    ...profile,
    id: canonical.id,
    name: canonical.name,
  };
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
