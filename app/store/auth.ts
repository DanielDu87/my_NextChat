import { create } from "zustand";
import { clearPersistedStateStorage } from "@/app/utils/indexeddb-state-storage";
import { Path, StoreKey } from "@/app/constant";

const AUTH_CACHE_MARKER_KEY = "nextchat_auth_cache_marker";
const AUTH_STATE_KEY = "nextchat_auth_state";
type AuthUserInfo = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
};

type AuthState = {
  user: AuthUserInfo | null;
  effectiveUser: AuthUserInfo | null;
  isImpersonating: boolean;
  readOnly: boolean;
  initialized: boolean;
  fetchMe: () => Promise<AuthUserInfo | null>;
  logout: () => Promise<void>;
  switchUser: (userId: string) => Promise<void>;
  exitSwitch: () => Promise<void>;
};

function getLocalStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function getCacheMarker() {
  return getLocalStorage()?.getItem(AUTH_CACHE_MARKER_KEY) || "";
}

function setCacheMarker(userId: string) {
  getLocalStorage()?.setItem(AUTH_CACHE_MARKER_KEY, userId);
}

// 持久化登录状态到 localStorage
function saveAuthState(state: {
  user: AuthUserInfo | null;
  effectiveUser: AuthUserInfo | null;
  isImpersonating: boolean;
  readOnly: boolean;
}) {
  try {
    getLocalStorage()?.setItem(AUTH_STATE_KEY, JSON.stringify(state));
  } catch {}
}

// 从 localStorage 恢复登录状态
function loadAuthState(): {
  user: AuthUserInfo | null;
  effectiveUser: AuthUserInfo | null;
  isImpersonating: boolean;
  readOnly: boolean;
} | null {
  try {
    const raw = getLocalStorage()?.getItem(AUTH_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.user?.id) return parsed;
  } catch {}
  return null;
}

function clearAuthState() {
  try {
    getLocalStorage()?.removeItem(AUTH_STATE_KEY);
  } catch {}
}

async function resetClientCache(nextUserId = "", clearPersistedState = true) {
  if (clearPersistedState) {
    await clearPersistedStateStorage();
  }
  if (nextUserId) {
    setCacheMarker(nextUserId);
  } else {
    getLocalStorage()?.removeItem(AUTH_CACHE_MARKER_KEY);
  }
}

// 启动时从 localStorage 恢复登录状态
const cachedAuthState = loadAuthState();

export const useAuthStore = create<AuthState>((set, get) => ({
  user: cachedAuthState?.user || null,
  effectiveUser: cachedAuthState?.effectiveUser || null,
  isImpersonating: cachedAuthState?.isImpersonating || false,
  readOnly: cachedAuthState?.readOnly || false,
  initialized: !!cachedAuthState?.user,
  async fetchMe() {
    // 首次请求失败时重试一次，避免 DB 暂时不可用导致误判未登录
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch("/api/auth/me", {
          method: "GET",
          cache: "no-store",
        });
        // 非 5xx 错误不重试
        if (response.status < 500) break;
      } catch {
        // 网络错误，重试
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    if (!response) {
      // 网络完全不可用，保持当前状态
      set((state) => ({ ...state, initialized: true }));
      return get().user;
    }

    if (response.status === 401) {
      clearAuthState();
      await resetClientCache();
      set({
        user: null,
        effectiveUser: null,
        isImpersonating: false,
        readOnly: false,
        initialized: true,
      });
      // session 已失效，刷新页面回到登录页
      window.location.reload();
      return null;
    }

    if (!response.ok) {
      console.error(`[Auth] ${response.status} ${response.statusText}`);
      set((state) => ({
        ...state,
        initialized: true,
      }));
      return get().user;
    }

    const payload = await response.json();
    const effectiveUser = payload?.effectiveUser || null;
    const user = payload?.user || null;
    const effectiveUserId = String(effectiveUser?.id || "");
    const cacheMarker = getCacheMarker();

    if (effectiveUserId && cacheMarker !== effectiveUserId) {
      await resetClientCache(effectiveUserId, false);
      try {
        const { useChatStore } = await import("./chat");
        await useChatStore.getState().resetForUserSwitch({ sync: false });
        await (useChatStore as any).persist?.rehydrate?.();
      } catch {}
    }

    if (effectiveUserId && !cacheMarker) {
      setCacheMarker(effectiveUserId);
    }

    set({
      user,
      effectiveUser,
      isImpersonating: payload?.isImpersonating === true,
      readOnly: payload?.readOnly === true,
      initialized: true,
    });

    // 持久化登录状态
    saveAuthState({
      user,
      effectiveUser,
      isImpersonating: payload?.isImpersonating === true,
      readOnly: payload?.readOnly === true,
    });

    return user;
  },
  async logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
    }).catch(() => null);
    clearAuthState();
    await resetClientCache("", true);
    window.location.reload();
  },
  async switchUser(
    userId: string,
    userPreview?: { username?: string; displayName?: string },
  ) {
    // 立即更新 UI，显示正在切换的用户信息（如果提供了预览数据）
    if (userPreview) {
      set({
        effectiveUser: {
          id: userId,
          username: userPreview.username || "",
          displayName: userPreview.displayName || userPreview.username || "",
          role: "user",
        },
        isImpersonating: true,
        readOnly: false,
      });
    }

    // 立即设置 cache marker，让持久化存储知道我们要切换到新用户
    setCacheMarker(userId);

    // 立即重置 UI，避免 API 等待期间保留旧数据
    const chatStoreModule = import("./chat");
    const chatIndexModule = import("./chat-index");
    const { useChatStore: chatStore } = await chatStoreModule;
    const { useChatIndexStore } = await chatIndexModule;

    // 立即重置 chat store 和 chat index store，确保不显示旧用户的历史对话
    chatStore.getState().resetForUserSwitch({ sync: false });

    // 立即同步 index store 到新状态
    useChatIndexStore.getState().syncFromChatStore();

    // 清除 URL 中的旧会话 ID，并通过 popstate 通知 React Router 更新内部状态
    try {
      window.history.replaceState(null, "", Path.Chat);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {}

    const response = await fetch("/api/admin/switch-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ userId }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      // API 失败，刷新页面恢复到切换前状态
      window.location.reload();
      return;
    }

    const effectiveUser = payload.effectiveUser
      ? {
          id: String(payload.effectiveUser.id || ""),
          username: String(payload.effectiveUser.username || ""),
          displayName: String(payload.effectiveUser.displayName || ""),
          role: (payload.effectiveUser.role === "admin" ? "admin" : "user") as
            | "admin"
            | "user",
        }
      : null;

    // 确保最终状态是正确的
    set({
      effectiveUser,
      isImpersonating: true,
      readOnly: false,
    });

    // 再次确认 cache marker 设置正确
    setCacheMarker(String(effectiveUser?.id || ""));

    const { useSyncStore } = await import("./sync");
    // 先 rehydrate 新用户的数据
    await (chatStore as any).persist?.rehydrate?.();
    // 然后初始化新页面，显示新空会话或加载新用户的已有会话
    chatStore.getState().initializeForNewPage?.();
    useChatIndexStore.getState().syncFromChatStore();
    // 最后同步新用户的远端对话
    useSyncStore.getState().sync([StoreKey.Chat], {
      isolateQueue: true,
      downloadOnlyChat: true,
    });
  },
  async exitSwitch() {
    const response = await fetch("/api/admin/switch-user", {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      throw new Error(String(payload?.error || "退出查看失败"));
    }

    const currentUser = get().user;
    await resetClientCache(String(currentUser?.id || ""), false);

    window.location.reload();
  },
}));
