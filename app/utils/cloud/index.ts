import { createDatabaseSyncClient } from "./database";
import { createWebDavClient } from "./webdav";
import { createUpstashClient } from "./upstash";

export enum ProviderType {
  Database = "database",
  WebDAV = "webdav",
  UpStash = "upstash",
}

export const SyncClients = {
  [ProviderType.Database]: createDatabaseSyncClient,
  [ProviderType.UpStash]: createUpstashClient,
  [ProviderType.WebDAV]: createWebDavClient,
} as const;

type SyncClientConfig = {
  [K in keyof typeof SyncClients]: (typeof SyncClients)[K] extends (
    _: infer C,
  ) => any
    ? C
    : never;
};

export type SyncClient = {
  get: (key: string) => Promise<string>;
  set: (key: string, value: string) => Promise<void>;
  check: () => Promise<boolean>;
  getMeta?: (keys?: string[]) => Promise<
    Array<{
      key: string;
      updatedAt: string;
      checksum: string;
      sizeBytes: number;
    }>
  >;
};

export function createSyncClient<T extends ProviderType>(
  provider: T,
  config: SyncClientConfig[T],
): SyncClient {
  return SyncClients[provider](config as any) as any;
}
