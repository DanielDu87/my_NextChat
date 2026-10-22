import type { NextRequest } from "next/server";
import { StoreKey } from "@/app/constant";
import {
  AuthError,
  isAuthBypassEnabled,
  resolveSyncUserContext,
  requireWritableAuthContext,
} from "./auth";

const SHARED_STORE_KEYS = new Set<string>([
  StoreKey.Access,
  StoreKey.Config,
  StoreKey.ModelCache,
  StoreKey.Plugin,
  StoreKey.Prompt,
  StoreKey.Update,
  StoreKey.DrawList,
  "sd-list",
]);

// 插件内容会在所有用户的插件编辑器中渲染，且插件可向任意地址发请求；
// 共享插件库只允许管理员（及本地免登录开发模式）写入。
const ADMIN_ONLY_WRITE_STORE_KEYS = new Set<string>([StoreKey.Plugin]);

export function getDefaultSyncUserId() {
  const configuredUserId = (
    process.env.NEXTCHAT_DEFAULT_USER_ID || process.env.DEFAULT_SYNC_USER_ID
  )?.trim();

  if (configuredUserId) {
    return configuredUserId;
  }

  return "user:admin";
}

export function isSharedSyncStoreKey(storeKey: string) {
  return SHARED_STORE_KEYS.has(storeKey);
}

export async function resolveSyncUserId(
  source?:
    | NextRequest
    | Request
    | Headers
    | {
        headers?: Headers;
      }
    | null,
) {
  const context = await resolveSyncUserContext(source);
  return context.effectiveExternalUserId;
}

export async function resolveSharedSyncUserId(
  source?:
    | NextRequest
    | Request
    | Headers
    | {
        headers?: Headers;
      }
    | null,
) {
  await resolveSyncUserContext(source);
  return getDefaultSyncUserId();
}

export async function resolveStoreSyncUserId(
  storeKey: string,
  source?:
    | NextRequest
    | Request
    | Headers
    | {
        headers?: Headers;
      }
    | null,
) {
  if (isSharedSyncStoreKey(storeKey)) {
    return resolveSharedSyncUserId(source);
  }

  return resolveSyncUserId(source);
}

export async function requireWritableSyncUserId(
  source?:
    | NextRequest
    | Request
    | Headers
    | {
        headers?: Headers;
      }
    | null,
) {
  const context = await requireWritableAuthContext(source);
  return context.effective.externalId;
}

export async function requireWritableSharedSyncUserId(
  source?:
    | NextRequest
    | Request
    | Headers
    | {
        headers?: Headers;
      }
    | null,
) {
  await requireWritableAuthContext(source);
  return getDefaultSyncUserId();
}

export async function requireWritableStoreSyncUserId(
  storeKey: string,
  source?:
    | NextRequest
    | Request
    | Headers
    | {
        headers?: Headers;
      }
    | null,
) {
  if (ADMIN_ONLY_WRITE_STORE_KEYS.has(storeKey)) {
    const context = await requireWritableAuthContext(source);
    if (!isAuthBypassEnabled() && context.actor.role !== "admin") {
      throw new AuthError("admin_only_store", 403);
    }
    return isSharedSyncStoreKey(storeKey)
      ? getDefaultSyncUserId()
      : context.effective.externalId;
  }

  if (isSharedSyncStoreKey(storeKey)) {
    return requireWritableSharedSyncUserId(source);
  }

  return requireWritableSyncUserId(source);
}

export { resolveSyncUserContext };
