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

export async function preloadManagedUsers(options?: {
  force?: boolean;
  source?: "page-init" | "user-menu" | "user-refresh";
}) {
  const source = options?.source ?? "user-menu";
  const sourceLabel =
    source === "page-init"
      ? "页面初始化"
      : source === "user-refresh"
      ? "用户数据刷新"
      : "用户切换弹窗";

  if (!options?.force && managedUsersCache) {
    console.log(
      `[Users] ⚡ ${sourceLabel}命中用户缓存，共 ${managedUsersCache.length} 个用户`,
    );
    return managedUsersCache;
  }

  if (!options?.force && managedUsersRequest) {
    console.log(`[Users] ⏳ ${sourceLabel}复用正在进行的用户获取请求`);
    return managedUsersRequest;
  }

  console.log(`[Users] 🔄 ${sourceLabel}开始获取用户列表`);

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
      console.log(
        `[Users] ✅ ${sourceLabel}获取用户列表完成，共 ${users.length} 个用户`,
      );
      return users;
    })
    .catch((error) => {
      console.error(`[Users] ❌ ${sourceLabel}获取用户列表失败:`, error);
      throw error;
    })
    .finally(() => {
      if (managedUsersRequest === request) {
        managedUsersRequest = null;
      }
    });

  managedUsersRequest = request;
  return request;
}
