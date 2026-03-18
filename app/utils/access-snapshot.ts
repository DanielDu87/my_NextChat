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
  return null;
}

export function writeAccessSnapshot(snapshot: AccessSnapshot) {
  void snapshot;
}
