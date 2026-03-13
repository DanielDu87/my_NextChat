import { StoreKey } from "../constant";
import { safeLocalStorage } from "../utils";

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
  if (typeof window === "undefined") return null;
  try {
    const raw = safeLocalStorage().getItem(ACCESS_SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as AccessSnapshot) : null;
  } catch {
    return null;
  }
}

export function writeAccessSnapshot(snapshot: AccessSnapshot) {
  if (typeof window === "undefined") return;
  safeLocalStorage().setItem(ACCESS_SNAPSHOT_KEY, JSON.stringify(snapshot));
}
