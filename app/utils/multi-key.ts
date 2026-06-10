export const MULTI_KEY_GROUP_IDS = [
  "group1",
  "group2",
  "group3",
  "group4",
  "group5",
  "group6",
] as const;

export type MultiKeyGroupId = (typeof MULTI_KEY_GROUP_IDS)[number];
export type MultiKeyGroups = Record<MultiKeyGroupId, string>;

const LEGACY_YUTO_GROUP_ORDER = [
  "enterprise",
  "discount",
  "user",
  "anthropic",
  "default",
] as const;

const LEGACY_OCOOL_GROUP_ORDER = [
  "default",
  "official",
  "open_source_cn",
  "cn",
  "cc",
] as const;

export function createEmptyMultiKeyGroups(): MultiKeyGroups {
  return Object.fromEntries(
    MULTI_KEY_GROUP_IDS.map((groupId) => [groupId, ""]),
  ) as MultiKeyGroups;
}

export function isYutoProfileLike(profile: {
  name?: string;
  baseUrl?: string;
}) {
  return (
    String(profile.name || "")
      .toLowerCase()
      .includes("yuto") || String(profile.baseUrl || "").includes("gptapi.asia")
  );
}

export function isOcoolProfileLike(profile: {
  name?: string;
  baseUrl?: string;
}) {
  const name = String(profile.name || "").toLowerCase();
  const baseUrl = String(profile.baseUrl || "");
  return (
    name.includes("ocool") ||
    baseUrl.includes("ooo.cool") ||
    baseUrl.includes("ocoolai") ||
    baseUrl.includes("ocoolai.com")
  );
}

export function normalizeMultiKeyGroups(
  groups?: Record<string, string>,
  profile?: { name?: string; baseUrl?: string },
): MultiKeyGroups {
  const normalized = createEmptyMultiKeyGroups();
  const source = groups || {};
  const hasGenericGroups = MULTI_KEY_GROUP_IDS.some((groupId) =>
    Object.prototype.hasOwnProperty.call(source, groupId),
  );

  if (hasGenericGroups) {
    MULTI_KEY_GROUP_IDS.forEach((groupId) => {
      normalized[groupId] = String(source[groupId] || "");
    });
    return normalized;
  }

  const legacyOrder = isOcoolProfileLike(profile || {})
    ? LEGACY_OCOOL_GROUP_ORDER
    : isYutoProfileLike(profile || {})
    ? LEGACY_YUTO_GROUP_ORDER
    : [];

  legacyOrder.forEach((legacyGroup, index) => {
    const targetGroup = MULTI_KEY_GROUP_IDS[index];
    if (targetGroup) {
      normalized[targetGroup] = String(source[legacyGroup] || "");
    }
  });

  return normalized;
}

function hasMultiKeyGroupValue(
  groups: Record<string, string> | undefined,
  group: string,
) {
  return Boolean(String(groups?.[group] || "").trim());
}

export function normalizeMultiKeyGroupOrder(
  order?: string[],
  groups?: Record<string, string>,
) {
  const seen = new Set<string>();
  const normalized = Array.isArray(order)
    ? order.filter((group) => {
        if (!(MULTI_KEY_GROUP_IDS as readonly string[]).includes(group)) {
          return false;
        }
        if (seen.has(group)) {
          return false;
        }
        seen.add(group);
        return true;
      })
    : [];

  const orderedGroups = [
    ...normalized,
    ...MULTI_KEY_GROUP_IDS.filter((group) => !seen.has(group)),
  ] as MultiKeyGroupId[];

  if (!groups) {
    return orderedGroups;
  }

  return [
    ...orderedGroups.filter((group) => hasMultiKeyGroupValue(groups, group)),
    ...orderedGroups.filter((group) => !hasMultiKeyGroupValue(groups, group)),
  ] as MultiKeyGroupId[];
}

export function shouldAutoEnableMultiKey(profile: {
  multiKeyEnabled?: boolean;
  apiKeyGroups?: Record<string, string>;
  name?: string;
  baseUrl?: string;
}) {
  if (typeof profile.multiKeyEnabled === "boolean") {
    return profile.multiKeyEnabled;
  }

  return (
    Boolean(profile.apiKeyGroups) &&
    (isYutoProfileLike(profile) || isOcoolProfileLike(profile))
  );
}
