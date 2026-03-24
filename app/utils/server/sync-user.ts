import type { NextRequest } from "next/server";

const SYNC_USER_HEADER_KEYS = [
  "x-nextchat-user-id",
  "x-user-id",
  "x-forwarded-user",
] as const;

export function getDefaultSyncUserId() {
  const configuredUserId = (
    process.env.NEXTCHAT_DEFAULT_USER_ID || process.env.DEFAULT_SYNC_USER_ID
  )?.trim();

  if (configuredUserId) {
    return configuredUserId;
  }

  throw new Error(
    "[SyncUser] 缺少用户标识，请传 x-nextchat-user-id 请求头或配置 NEXTCHAT_DEFAULT_USER_ID / DEFAULT_SYNC_USER_ID",
  );
}

export function resolveSyncUserId(
  source?:
    | NextRequest
    | Headers
    | {
        headers?: Headers;
      }
    | null,
) {
  const headers =
    source instanceof Headers
      ? source
      : source && "headers" in source
      ? source.headers
      : undefined;

  for (const key of SYNC_USER_HEADER_KEYS) {
    const value = headers?.get(key)?.trim();
    if (value) {
      return value;
    }
  }

  return getDefaultSyncUserId();
}
