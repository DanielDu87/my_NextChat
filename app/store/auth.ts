import { create } from "zustand";
import { clearPersistedStateStorage } from "@/app/utils/indexeddb-state-storage";

const AUTH_CACHE_MARKER_KEY = "nextchat_auth_cache_marker";

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

async function resetClientCache(nextUserId = "") {
  await clearPersistedStateStorage();
  if (nextUserId) {
    setCacheMarker(nextUserId);
  } else {
    getLocalStorage()?.removeItem(AUTH_CACHE_MARKER_KEY);
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  effectiveUser: null,
  isImpersonating: false,
  readOnly: false,
  initialized: false,
  async fetchMe() {
    const response = await fetch("/api/auth/me", {
      method: "GET",
      cache: "no-store",
    });

    if (response.status === 401) {
      await resetClientCache();
      set({
        user: null,
        effectiveUser: null,
        isImpersonating: false,
        readOnly: false,
        initialized: true,
      });
      return null;
    }

    if (!response.ok) {
      throw new Error(`[Auth] ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    const effectiveUser = payload?.effectiveUser || null;
    const user = payload?.user || null;
    const effectiveUserId = String(effectiveUser?.id || "");
    const cacheMarker = getCacheMarker();

    if (effectiveUserId && cacheMarker !== effectiveUserId) {
      await resetClientCache(effectiveUserId);
      window.location.reload();
      return null;
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

    return user;
  },
  async logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
    }).catch(() => null);
    await resetClientCache();
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

    await resetClientCache(String(payload?.effectiveUser?.id || ""));
    window.location.reload();
  },
  async exitSwitch() {
    const response = await fetch("/api/admin/switch-user", {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      throw new Error(String(payload?.error || "退出查看失败"));
    }

    await resetClientCache(String(payload?.effectiveUser?.id || ""));
    window.location.reload();
  },
}));
