import type { LLMModel } from "../client/api";

const AIHUBMIX_CATALOG_METADATA_STORAGE_KEY =
  "nextchat:aihubmix-catalog-metadata";

const TRAILING_RELEASE_DATE_PATTERN =
  /(?:[-_.](?:20\d{2}[-_.]?(?:0[1-9]|1[0-2])[-_.]?(?:0[1-9]|[12]\d|3[01])|\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])|(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])|(?:0[1-9]|1[0-2])[-_.](?:0[1-9]|[12]\d|3[01])))$/i;
const EMBEDDED_RELEASE_DATE_PATTERN =
  /(?:^|[-_.])(20\d{2}[-_.]?(?:0[1-9]|1[0-2])[-_.]?(?:0[1-9]|[12]\d|3[01])|\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])|(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])|(?:0[1-9]|1[0-2])[-_.](?:0[1-9]|[12]\d|3[01]))(?=$|[-_.])/gi;

function normalizeAiHubMixCandidate(candidate: string) {
  return String(candidate || "")
    .trim()
    .toLowerCase()
    .replace(/^(?:net|network)[-_.]+/g, "")
    .replace(/\b03(?=[-_.])/g, "o3")
    .replace(/\b04(?=[-_.])/g, "o4")
    .replace(/\b01(?=[-_.])/g, "o1")
    .replace(/\bgpt-40\b/g, "gpt-4o")
    .replace(/\bgpt-40(?=[-_.])/g, "gpt-4o")
    .replace(/\bchatgpt-40\b/g, "chatgpt-4o")
    .replace(/\bchatgpt-40(?=[-_.])/g, "chatgpt-4o");
}

function stripTrailingDate(candidate: string) {
  return candidate
    .replace(TRAILING_RELEASE_DATE_PATTERN, "")
    .replace(/[-_.]+$/, "");
}

function stripEmbeddedDates(candidate: string) {
  return candidate
    .replace(EMBEDDED_RELEASE_DATE_PATTERN, "")
    .replace(/[-_.]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
}

function getSlashSuffixCandidates(candidate: string) {
  const slashSegments = candidate
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (slashSegments.length <= 1) {
    return [];
  }

  return [
    slashSegments[slashSegments.length - 1],
    slashSegments.slice(1).join("/"),
  ].filter(Boolean);
}

function stripKnownAihubMixVariantSuffixes(candidate: string) {
  return candidate
    .replace(/(gpt-[a-z0-9.]+-codex)-(?:high|medium|low)$/i, "$1")
    .replace(/(gpt-[a-z0-9.]+)-(?:chat-latest|latest|official)$/i, "$1")
    .replace(/(gpt-[a-z0-9.]+-codex)-(?:official)$/i, "$1")
    .replace(/(gpt-audio-[a-z0-9.]+)-(?:official)$/i, "$1")
    .replace(/(o[1345]-[a-z0-9.]+)-(?:official)$/i, "$1");
}

export function getAiHubMixLookupKeys(name: string) {
  const normalizedName = normalizeAiHubMixCandidate(name);
  if (!normalizedName) {
    return [];
  }

  const level1Candidates = [
    normalizedName,
    ...getSlashSuffixCandidates(normalizedName),
  ]
    .map(normalizeAiHubMixCandidate)
    .filter(Boolean);
  const level2Candidates = level1Candidates
    .map(stripTrailingDate)
    .filter(Boolean);
  const level3Candidates = [...level1Candidates, ...level2Candidates]
    .map(stripEmbeddedDates)
    .filter(Boolean);
  const level4Candidates = [
    ...level1Candidates,
    ...level2Candidates,
    ...level3Candidates,
  ]
    .map(stripKnownAihubMixVariantSuffixes)
    .filter(Boolean);

  return [
    ...new Set(
      [
        ...level1Candidates,
        ...level2Candidates,
        ...level3Candidates,
        ...level4Candidates,
      ].filter(Boolean),
    ),
  ];
}

function toComparableModelName(name: string) {
  return normalizeAiHubMixCandidate(name)
    .replace(TRAILING_RELEASE_DATE_PATTERN, "")
    .replace(EMBEDDED_RELEASE_DATE_PATTERN, "")
    .replace(/^[^/]+\//, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function getComparableModelParts(name: string) {
  return getAiHubMixLookupKeys(name)
    .map((candidate) => toComparableModelName(candidate))
    .filter(Boolean);
}

export function resolveAiHubMixMetadataByName<T>(
  name: string,
  metadataMap?: Map<string, T>,
) {
  if (!metadataMap || metadataMap.size === 0) {
    return undefined;
  }

  const exactMatched = getAiHubMixLookupKeys(name)
    .map((key) => metadataMap.get(key))
    .find(Boolean);
  if (exactMatched) {
    return exactMatched;
  }

  const comparableTargetSet = new Set(getComparableModelParts(name));
  if (comparableTargetSet.size === 0) {
    return undefined;
  }

  for (const [key, value] of metadataMap.entries()) {
    const comparableKeys = getComparableModelParts(key);
    if (
      comparableKeys.some((candidate) => comparableTargetSet.has(candidate))
    ) {
      return value;
    }
  }

  return undefined;
}

export function resolveAiHubMixCatalogRank(
  name: string,
  metadataMap?: Map<
    string,
    { rank: number; vendor?: { id: number; name: string; icon?: string } }
  >,
) {
  return resolveAiHubMixMetadataByName(name, metadataMap)?.rank;
}

export function readAiHubMixCatalogMetadataCache() {
  if (typeof localStorage === "undefined") {
    return new Map<
      string,
      { rank: number; vendor?: { id: number; name: string; icon?: string } }
    >();
  }

  try {
    const raw = localStorage.getItem(AIHUBMIX_CATALOG_METADATA_STORAGE_KEY);
    const entries = raw ? JSON.parse(raw) : [];
    return new Map<
      string,
      { rank: number; vendor?: { id: number; name: string; icon?: string } }
    >(Array.isArray(entries) ? entries : []);
  } catch {
    return new Map();
  }
}

export function persistAiHubMixCatalogMetadataCache(
  metadataMap: Map<
    string,
    { rank: number; vendor?: { id: number; name: string; icon?: string } }
  >,
) {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(
    AIHUBMIX_CATALOG_METADATA_STORAGE_KEY,
    JSON.stringify([...metadataMap.entries()]),
  );
}

export function seedAiHubMixMetadataCacheFromModels(models: LLMModel[]) {
  const catalogMetadataMap = readAiHubMixCatalogMetadataCache();
  let catalogChanged = false;

  for (const model of models || []) {
    const name = String(model?.name || "").trim();
    if (!name) {
      continue;
    }

    const lookupKeys = getAiHubMixLookupKeys(name);
    if (lookupKeys.length === 0) {
      continue;
    }

    const cachedRank = Number(
      (model as any).remoteRank ?? (model as any).catalogRank,
    );
    if (Number.isFinite(cachedRank)) {
      for (const key of lookupKeys) {
        if (catalogMetadataMap.has(key)) {
          continue;
        }
        catalogMetadataMap.set(key, {
          rank: cachedRank,
          vendor: model.vendor,
        });
        catalogChanged = true;
      }
    }
  }

  if (catalogChanged) {
    persistAiHubMixCatalogMetadataCache(catalogMetadataMap);
  }
}

export function hydrateModelsWithAiHubMixMetadata(models: LLMModel[]) {
  const catalogMetadataMap = readAiHubMixCatalogMetadataCache();

  if (catalogMetadataMap.size === 0) {
    return models;
  }

  return models.map((model) => {
    const normalizedName = String(model?.name || "")
      .trim()
      .toLowerCase();
    if (!normalizedName) {
      return model;
    }

    const catalogMetadata = resolveAiHubMixMetadataByName(
      normalizedName,
      catalogMetadataMap,
    );
    if (!catalogMetadata) {
      return model;
    }

    return {
      ...model,
      catalogRank: catalogMetadata?.rank ?? (model as any).catalogRank,
      remoteRank:
        catalogMetadata?.rank ??
        (model as any).remoteRank ??
        (model as any).catalogRank,
      remoteRankSource: catalogMetadata
        ? "aihubmix_catalog"
        : (model as any).remoteRankSource,
      vendor: catalogMetadata?.vendor ?? model.vendor,
    };
  });
}
