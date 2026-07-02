import { safeLocalStorage } from "./safe-local-storage";
import {
  bootstrapStaleRevalidate,
  runStaleRevalidate,
} from "./stale-revalidate";

export type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  isActive: boolean;
  lastChatAt: string | null;
  createdAt?: string | null;
  conversationCount?: number;
  lastConversationAt?: string | null;
};

const MANAGED_USERS_CACHE_STORAGE_PREFIX = "nextchat:managed-users-cache:v1:";
const managedUsersStorage = safeLocalStorage();

type ManagedUsersCacheEntry = {
  ownerUserId: string;
  users: ManagedUser[];
  fetchedAt: number;
  generation: number;
};

let managedUsersCache: ManagedUsersCacheEntry | null = null;
let managedUsersGeneration = 0;

async function fetchManagedUsers(ownerUserId: string, signal?: AbortSignal) {
  const response = await fetch("/api/admin/users", {
    method: "GET",
    cache: "no-store",
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok !== true) {
    throw new Error(String(payload?.error || "获取用户列表失败"));
  }
  if (!Array.isArray(payload.users)) {
    throw new Error("用户列表响应格式错误");
  }

  const users = payload.users as ManagedUser[];
  managedUsersCache = {
    ownerUserId,
    users,
    fetchedAt: Date.now(),
    generation: ++managedUsersGeneration,
  };
  managedUsersStorage.setItem(
    `${MANAGED_USERS_CACHE_STORAGE_PREFIX}${ownerUserId}`,
    JSON.stringify(managedUsersCache),
  );
  return users;
}

export function getCachedManagedUsers(ownerUserId: string) {
  if (managedUsersCache?.ownerUserId === ownerUserId) {
    return managedUsersCache.users;
  }

  try {
    const cachedText = managedUsersStorage.getItem(
      `${MANAGED_USERS_CACHE_STORAGE_PREFIX}${ownerUserId}`,
    );
    if (!cachedText) return null;
    const cached = JSON.parse(cachedText) as ManagedUsersCacheEntry;
    if (cached.ownerUserId !== ownerUserId || !Array.isArray(cached.users)) {
      return null;
    }
    managedUsersCache = cached;
    return cached.users;
  } catch {
    return null;
  }
}

export function invalidateManagedUsersCache(ownerUserId?: string) {
  if (!ownerUserId || managedUsersCache?.ownerUserId === ownerUserId) {
    managedUsersCache = null;
  }
  managedUsersGeneration += 1;
}

export async function preloadManagedUsers(options?: {
  ownerUserId: string;
  force?: boolean;
  revalidate?: boolean;
  source?: "page-init" | "user-menu" | "user-refresh";
  signal?: AbortSignal;
}) {
  const ownerUserId = String(options?.ownerUserId || "").trim();
  if (!ownerUserId) {
    throw new Error("缺少管理员身份");
  }

  if (!options?.force && !options?.revalidate) {
    const cachedUsers = getCachedManagedUsers(ownerUserId);
    if (cachedUsers) {
      return cachedUsers;
    }
  }

  const revalidateKey = `managed-users:${ownerUserId}`;

  if (options?.force) {
    invalidateManagedUsersCache(ownerUserId);
  }

  return runStaleRevalidate({
    key: revalidateKey,
    forceRestart: options?.force,
    signal: options?.signal,
    task: (signal) => fetchManagedUsers(ownerUserId, signal),
  });
}

export function bootstrapManagedUsers(options: {
  ownerUserId: string;
  forceRestart?: boolean;
  signal?: AbortSignal;
}) {
  const ownerUserId = String(options.ownerUserId || "").trim();
  return bootstrapStaleRevalidate({
    key: `managed-users:${ownerUserId}`,
    cachedData: getCachedManagedUsers(ownerUserId),
    forceRestart: options.forceRestart,
    signal: options.signal,
    revalidate: (signal) => fetchManagedUsers(ownerUserId, signal),
  });
}
