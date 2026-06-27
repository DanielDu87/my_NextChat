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

let managedUsersCache: ManagedUser[] | null = null;
let managedUsersRequest: Promise<ManagedUser[]> | null = null;

export function getCachedManagedUsers() {
  return managedUsersCache;
}

export async function preloadManagedUsers(options?: { force?: boolean }) {
  if (!options?.force && managedUsersCache) {
    return managedUsersCache;
  }

  if (!options?.force && managedUsersRequest) {
    return managedUsersRequest;
  }

  const request = fetch("/api/admin/users", {
    method: "GET",
    cache: "no-store",
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) {
        throw new Error(String(payload?.error || "获取用户列表失败"));
      }

      const users = Array.isArray(payload?.users) ? payload.users : [];
      managedUsersCache = users;
      return users;
    })
    .finally(() => {
      if (managedUsersRequest === request) {
        managedUsersRequest = null;
      }
    });

  managedUsersRequest = request;
  return request;
}
