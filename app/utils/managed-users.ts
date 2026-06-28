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

const MANAGED_USERS_CACHE_TTL_MS = 60_000;

type ManagedUsersCacheEntry = {
  ownerUserId: string;
  users: ManagedUser[];
  fetchedAt: number;
  generation: number;
};

type ManagedUsersRequestEntry = {
  ownerUserId: string;
  generation: number;
  controller: AbortController;
  promise: Promise<ManagedUser[]>;
};

let managedUsersCache: ManagedUsersCacheEntry | null = null;
let managedUsersRequest: ManagedUsersRequestEntry | null = null;
let managedUsersGeneration = 0;

export function getCachedManagedUsers(ownerUserId: string) {
  if (
    !managedUsersCache ||
    managedUsersCache.ownerUserId !== ownerUserId ||
    Date.now() - managedUsersCache.fetchedAt > MANAGED_USERS_CACHE_TTL_MS
  ) {
    return null;
  }

  return managedUsersCache.users;
}

export function invalidateManagedUsersCache(ownerUserId?: string) {
  if (!ownerUserId || managedUsersCache?.ownerUserId === ownerUserId) {
    managedUsersCache = null;
  }
  if (!ownerUserId || managedUsersRequest?.ownerUserId === ownerUserId) {
    managedUsersRequest?.controller.abort();
    managedUsersRequest = null;
  }
  managedUsersGeneration += 1;
}

export async function preloadManagedUsers(options?: {
  ownerUserId: string;
  force?: boolean;
  source?: "page-init" | "user-menu" | "user-refresh";
  signal?: AbortSignal;
}) {
  const ownerUserId = String(options?.ownerUserId || "").trim();
  if (!ownerUserId) {
    throw new Error("缺少管理员身份");
  }

  if (!options?.force) {
    const cachedUsers = getCachedManagedUsers(ownerUserId);
    if (cachedUsers) {
      return cachedUsers;
    }
  }

  if (!options?.force && managedUsersRequest?.ownerUserId === ownerUserId) {
    return managedUsersRequest.promise;
  }

  if (options?.force) {
    invalidateManagedUsersCache(ownerUserId);
  }

  const generation = ++managedUsersGeneration;
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  options?.signal?.addEventListener("abort", abortRequest, { once: true });
  if (options?.signal?.aborted) {
    controller.abort();
  }

  const request = fetch("/api/admin/users", {
    method: "GET",
    cache: "no-store",
    signal: controller.signal,
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) {
        throw new Error(String(payload?.error || "获取用户列表失败"));
      }
      if (!Array.isArray(payload.users)) {
        throw new Error("用户列表响应格式错误");
      }

      const users = payload.users as ManagedUser[];
      if (generation === managedUsersGeneration) {
        managedUsersCache = {
          ownerUserId,
          users,
          fetchedAt: Date.now(),
          generation,
        };
      }
      return users;
    })
    .finally(() => {
      options?.signal?.removeEventListener("abort", abortRequest);
      if (managedUsersRequest?.generation === generation) {
        managedUsersRequest = null;
      }
    });

  managedUsersRequest = {
    ownerUserId,
    generation,
    controller,
    promise: request,
  };
  return request;
}
