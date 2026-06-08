import { create } from "zustand";
import { clearPersistedStateStorage } from "@/app/utils/indexeddb-state-storage";
import { StoreKey } from "@/app/constant";

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
  async switchUser(userId: string) {
    const response = await fetch("/api/admin/switch-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ userId }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      throw new Error(String(payload?.error || "切换用户失败"));
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

    set({
      effectiveUser,
      isImpersonating: true,
      readOnly: false,
    });

    setCacheMarker(String(effectiveUser?.id || ""));

    const [{ useChatStore }, { useChatIndexStore }, { useSyncStore }] =
      await Promise.all([
        import("./chat"),
        import("./chat-index"),
        import("./sync"),
      ]);
    await useChatStore.getState().resetForUserSwitch({ sync: false });
    await (useChatStore as any).persist?.rehydrate?.();
    useChatStore.getState().initializeForNewPage?.();
    useChatIndexStore.getState().syncFromChatStore();
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
