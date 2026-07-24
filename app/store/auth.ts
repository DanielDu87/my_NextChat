import { create } from "zustand";
import { clearUserScopedPersistedStateStorage } from "@/app/utils/indexeddb-state-storage";
import { Path, StoreKey } from "@/app/constant";
import { publishStartupChatSyncStatus } from "@/app/utils/chat-startup-loading";
import { isPerfDebugEnabled } from "@/app/utils/perf";
import { hasPersistedChatCache } from "@/app/utils/chat-persist-storage";

const AUTH_CACHE_MARKER_KEY = "nextchat_auth_cache_marker";
const AUTH_STATE_KEY = "nextchat_auth_state";
let activeSwitchGeneration = 0;
let activeSwitchAbortController: AbortController | null = null;

function beginUserSwitch() {
  activeSwitchAbortController?.abort();
  activeSwitchAbortController = new AbortController();
  activeSwitchGeneration += 1;
  return {
    generation: activeSwitchGeneration,
    signal: activeSwitchAbortController.signal,
  };
}

function isCurrentUserSwitch(generation: number) {
  return generation === activeSwitchGeneration;
}

/**
 * 获取当前活跃的用户切换 generation。
 */
export function getActiveSwitchGeneration(): number {
  return activeSwitchGeneration;
}

/**
 * 获取当前 cache marker 指向的用户 ID（通过 cache marker，不依赖 auth store）。
 */
export function getCurrentCacheMarkerUserId(): string {
  return String(localStorage?.getItem(AUTH_CACHE_MARKER_KEY) || "").trim();
}

function logSwitchPerf(message: string) {
  if (isPerfDebugEnabled()) {
    console.info(message);
  }
}
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
  switchingUser: boolean;
  initialized: boolean;
  fetchMe: () => Promise<AuthUserInfo | null>;
  logout: () => Promise<void>;
  switchUser: (
    userId: string,
    userPreview?: { username?: string; displayName?: string },
  ) => Promise<void>;
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
    await clearUserScopedPersistedStateStorage();
  }
  if (nextUserId) {
    setCacheMarker(nextUserId);
  } else {
    getLocalStorage()?.removeItem(AUTH_CACHE_MARKER_KEY);
  }
}

// 启动时从 localStorage 恢复登录状态
const cachedAuthState = loadAuthState();
const cachedEffectiveUserId = String(cachedAuthState?.effectiveUser?.id || "");

// Chat Store 会在页面启动时立即水合。先让 marker 与已缓存的登录态一致，
// 防止 cookie 尚未复核前短暂读取上一个用户的聊天缓存。
if (cachedEffectiveUserId && getCacheMarker() !== cachedEffectiveUserId) {
  setCacheMarker(cachedEffectiveUserId);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: cachedAuthState?.user || null,
  effectiveUser: cachedAuthState?.effectiveUser || null,
  isImpersonating: cachedAuthState?.isImpersonating || false,
  readOnly: cachedAuthState?.readOnly || false,
  switchingUser: false,
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
        const { useChatIndexStore } = await import("./chat-index");
        const hasCache = await hasPersistedChatCache(effectiveUserId);
        if (hasCache) {
          await (useChatStore as any).persist?.rehydrate?.();
        } else {
          await useChatStore.getState().resetForUserSwitch({ sync: false });
        }
        // 同步初始化 chat-index，确保侧边栏显示正确的会话列表
        await useChatIndexStore
          .getState()
          .initialize({ forceFromIndexedDB: true });
      } catch (error) {
        console.error(
          "[Auth] fetchMe 用户切换时初始化 chat-index 失败:",
          error,
        );
      }
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
    const { generation, signal } = beginUserSwitch();
    const isCurrent = () => isCurrentUserSwitch(generation);

    // 必须在任何异步导入和缓存读取之前发布，立即遮住原用户的聊天内容。
    set({ switchingUser: true });
    publishStartupChatSyncStatus("syncing");

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

    // 清除旧用户的同步状态，防止切换期间旧同步继续执行并污染新用户数据
    // 使用动态 import 避免循环依赖
    void import("./sync").then(({ clearSyncStateForUserSwitch }) => {
      clearSyncStateForUserSwitch();
    });

    // 立即重置 UI，避免 API 等待期间保留旧数据
    const chatStoreModule = import("./chat");
    const chatIndexModule = import("./chat-index");
    const { useChatStore: chatStore } = await chatStoreModule;
    const { useChatIndexStore } = await chatIndexModule;
    if (!isCurrent()) return;

    // 先进入无会话 ID 的聊天壳并显示同步状态。这里不能提前进入 /new-chat：
    // 目标缓存尚未恢复时，新对话页面会基于原用户内存创建会话，并可能写入
    // 已切换 marker 的目标用户缓存，造成用户数据和会话数量串线。
    try {
      window.history.replaceState(null, "", Path.Chat);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {}

    // 先确认目标用户是否已有独立缓存，避免空状态覆盖其历史缓存。
    const switchStartAt = Date.now();
    logSwitchPerf(`[Auth] switchUser 开始 | hasCache: 加载中...`);
    const hasCache = await hasPersistedChatCache(userId);
    if (!isCurrent()) return;
    logSwitchPerf(
      `[Auth] switchUser hasCache 检查完成 | hasCache: ${hasCache} | 耗时: ${
        Date.now() - switchStartAt
      }ms`,
    );

    // 立即切换到目标用户缓存；无缓存时才创建空状态，绝不沿用旧用户数据。
    const rehydrateStartAt = Date.now();
    if (hasCache) {
      await (chatStore as any).persist?.rehydrate?.();
      if (!isCurrent()) return;
      logSwitchPerf(
        `[Auth] switchUser rehydrate 完成 | 耗时: ${
          Date.now() - rehydrateStartAt
        }ms`,
      );
    } else {
      await chatStore.getState().resetForUserSwitch({ sync: false });
      if (!isCurrent()) return;
      logSwitchPerf(
        `[Auth] switchUser resetForUserSwitch 完成 | 耗时: ${
          Date.now() - rehydrateStartAt
        }ms`,
      );
    }

    // 有缓存时，chat store 刚 rehydrate，只有部分会话占位符。
    // syncFromChatStore 会用不完整的内存状态覆盖 index，导致旧会话丢失。
    // 所以有缓存时跳过 syncFromChatStore，交给后续 initialize() 从 IndexedDB 读取完整 index。
    if (!hasCache) {
      useChatIndexStore.getState().syncFromChatStore();
    }

    let response: Response;
    try {
      response = await fetch("/api/admin/switch-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ userId }),
        signal,
      });
    } catch (error) {
      if (isCurrent() && (error as Error)?.name !== "AbortError") {
        console.error("[Auth] 切换用户请求失败", error);
        set({ switchingUser: false });
        publishStartupChatSyncStatus("error");
      }
      return;
    }
    const payload = await response.json().catch(() => null);
    if (!isCurrent()) return;
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
            "admin" | "user",
        }
      : null;

    // 确保最终状态是正确的
    set({
      effectiveUser,
      isImpersonating: true,
      readOnly: false,
    });

    // 持久化登录态：刷新后能从 localStorage 恢复正确 effectiveUser / isImpersonating，
    // 避免先回到旧用户（ccc）再被 fetchMe 纠正时短暂闪旧数据。
    saveAuthState({
      user: get().user,
      effectiveUser,
      isImpersonating: true,
      readOnly: false,
    });

    // 再次确认 cache marker 设置正确
    setCacheMarker(String(effectiveUser?.id || ""));

    const { useSyncStore } = await import("./sync");
    if (!isCurrent()) return;

    // 目标用户已有缓存时，优先从该用户自己的持久化 index 完整恢复会话列表，
    // 而不是仅依赖当前已水合到内存的少量 sessions（那会导致「只剩一个对话」）。
    const initStartAt = Date.now();
    if (hasCache) {
      await useChatIndexStore
        .getState()
        .initialize({ forceFromIndexedDB: true });
      if (!isCurrent()) return;
      logSwitchPerf(
        `[Auth] switchUser initialize 完成 | 耗时: ${
          Date.now() - initStartAt
        }ms | 总耗时: ${Date.now() - switchStartAt}ms`,
      );

      // 本地缓存就绪后立即解锁 UI，不需要等待慢速网络同步，实现极速响应。
      set({ switchingUser: false });
      publishStartupChatSyncStatus("done");

      // 远端同步作为后台任务执行，不阻塞返回，实现真正的秒级响应。
      // 使用 force: true 避免被旧用户的冷却时间跳过，确保新用户数据能正确同步。
      void (async () => {
        try {
          await useSyncStore.getState().sync([StoreKey.Chat], {
            isolateQueue: true,
            force: true,
            downloadOnlyChat: true,
          });
          if (!isCurrent()) return;
          logSwitchPerf(`[Auth] 后台同步完成`);
          // 同步完成后再次初始化，确保 index 与远端最新状态一致
          await useChatIndexStore
            .getState()
            .initialize({ forceFromIndexedDB: true });
        } catch (error) {
          if (isCurrent() && (error as Error)?.name !== "AbortError") {
            console.error("[Auth] 后台同步失败", error);
            publishStartupChatSyncStatus("error");
          }
        }
      })();
    } else {
      // 空态场景：初始化空状态后立即解锁 UI
      chatStore.getState().initializeForNewPage?.();
      useChatIndexStore.getState().syncFromChatStore();
      set({ switchingUser: false });
      publishStartupChatSyncStatus("done");

      // 远端同步作为后台任务执行，使用 force: true 避免冷却跳过
      void (async () => {
        try {
          await useSyncStore.getState().sync([StoreKey.Chat], {
            isolateQueue: true,
            force: true,
            downloadOnlyChat: true,
          });
          if (!isCurrent()) return;
          useChatIndexStore.getState().syncFromChatStore();
        } catch (error) {
          if (isCurrent() && (error as Error)?.name !== "AbortError") {
            console.error("[Auth] 后台同步失败", error);
            publishStartupChatSyncStatus("error");
          }
        }
      })();
    }
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
