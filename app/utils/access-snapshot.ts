import { StoreKey } from "../constant";

const ACCESS_SNAPSHOT_KEY = `${StoreKey.Access}-snapshot`;

export type AccessSnapshot = {
  useCustomConfig: boolean;
  provider: string;
  apiProfiles: Array<{
    id: string;
    name: string;
    provider: string;
    baseUrl: string;
    apiKey: string;
    apiKeyGroups?: Record<string, string>;
    multiKeyGroupOrder?: string[];
    multiKeyEnabled?: boolean;
    enabled: boolean;
    openAICompatible?: boolean;
    cachedModels?: string;
  }>;
  customModels: string;
  customUrl: string;
  customApiKey: string;
  customOpenAICompatible: boolean;
};

export function readAccessSnapshot(): AccessSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(ACCESS_SNAPSHOT_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed as AccessSnapshot;
  } catch {
    return null;
  }
}

export function writeAccessSnapshot(snapshot: AccessSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(ACCESS_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {}
}
