import { createDatabaseSyncClient } from "./database";
import type { ChatIndexPayload } from "@/app/utils/chat-sync";

export enum ProviderType {
  Database = "database",
}

export const SyncClients = {
  [ProviderType.Database]: createDatabaseSyncClient,
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
  getChatIndex?: () => Promise<ChatIndexPayload | null>;
  getChatSessions?: (ids: string[]) => Promise<Record<string, unknown>>;
  setChatDelta?: (params: {
    index: ChatIndexPayload;
    upsertSessions: Array<Record<string, unknown>>;
    deleteSessionIds?: string[];
  }) => Promise<void>;
};

export function createSyncClient<T extends ProviderType>(
  provider: T,
  config: SyncClientConfig[T],
): SyncClient {
  return SyncClients[provider](config as any) as any;
}
