import type { NextRequest } from "next/server";

export function getDefaultSyncUserId() {
  const configuredUserId = (
    process.env.NEXTCHAT_DEFAULT_USER_ID || process.env.DEFAULT_SYNC_USER_ID
  )?.trim();

  if (configuredUserId) {
    return configuredUserId;
  }

  throw new Error(
    "[SyncUser] 缺少固定用户标识，请配置 NEXTCHAT_DEFAULT_USER_ID 或 DEFAULT_SYNC_USER_ID",
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
  return getDefaultSyncUserId();
}
