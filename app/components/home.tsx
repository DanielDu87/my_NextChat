"use client";

require("../polyfill");

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styles from "./home.module.scss";

import {
  getCSSVar,
  getMessageImages,
  getMessageTextContent,
  useMobileScreen,
} from "../utils";

import dynamic from "next/dynamic";
import { Path, SlotID, StoreKey } from "../constant";
import { ErrorBoundary } from "./error";

import { getISOLang, getLang } from "../locales";

import {
  BrowserRouter as Router,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { SideBar } from "./sidebar";
import { Chat } from "./chat";
import { useAppConfig } from "../store/config";
import { AuthPage } from "./auth";
import { getClientConfig } from "../config/client";
import {
  selectChatSessionById,
  useAccessStore,
  useChatIndexStore,
  useChatStore,
} from "../store";
import clsx from "clsx";
import { initializeMcpSystem } from "../mcp/actions";
import { useAuthStore } from "../store/auth";
import { useCurrentSession } from "../store/chat-session";
import { isPerfDebugEnabled, logPerfSummary, nowMs } from "../utils/perf";
import { LoadingView } from "./loading-view";
import {
  getCurrentAutoSyncScope,
  getCurrentHashPath,
  isHomepageOrChatPage,
} from "../utils/startup-sync-scope";
import {
  markRouteSyncStart,
  prepareRouteEntryForSync,
} from "../utils/route-sync-entry";
import {
  isChatListStartupLoading,
  publishStartupChatSyncStatus,
  useStartupChatSyncStatus,
} from "../utils/chat-startup-loading";
import { isChatSessionRoutePath } from "../utils/sidebar-route-state";
import { logPageOpenUsageSummary } from "../utils/usage-summary-log";

export function Loading(props: { noLogo?: boolean; splash?: boolean }) {
  // 最早期就同步设置主题，确保背景色正确
  if (typeof window !== "undefined") {
    try {
      const config = useAppConfig.getState();
      if (config?.theme) {
        const effective = resolveEffectiveTheme(
          config.theme,
          config._hasHydrated,
        );
        applyDocumentTheme(effective);
      }
    } catch {
      // 忽略错误
    }
  }

  if (props.noLogo) {
    return <LoadingView fullscreen size="splash" className="no-dark" />;
  }

  return <LoadingView fullscreen size="splash" className="no-dark" />;
}

const Artifacts = dynamic(async () => (await import("./artifacts")).Artifacts, {
  loading: () => <LoadingView size="splash" className="no-dark" />,
});

const ApiConfigPage = dynamic(
  async () => (await import("./api-config")).ApiConfigPage,
  {
    loading: () => <LoadingView size="splash" className="no-dark" />,
  },
);

const ApiConfigBackupsPage = dynamic(
  async () => (await import("./api-config-backups")).ApiConfigBackupsPage,
  { loading: () => <LoadingView size="splash" className="no-dark" /> },
);
const ChatBackupsPage = dynamic(
  async () => (await import("./chat-backups")).ChatBackupsPage,
  { loading: () => <LoadingView size="splash" className="no-dark" /> },
);
const ProviderBalancesPage = dynamic(
  async () => (await import("./provider-balances")).ProviderBalancesPage,
  { loading: () => <LoadingView size="splash" className="no-dark" /> },
);
const ProviderModelFetchPage = dynamic(
  async () => (await import("./provider-model-fetch")).ProviderModelFetchPage,
  { loading: () => <LoadingView size="splash" className="no-dark" /> },
);

const NewChat = dynamic(async () => (await import("./new-chat")).NewChat, {
  loading: () => <LoadingView size="splash" className="no-dark" />,
});

const PluginPage = dynamic(async () => (await import("./plugin")).PluginPage, {
  loading: () => <LoadingView size="splash" className="no-dark" />,
});

const SearchChat = dynamic(
  async () => (await import("./search-chat")).SearchChatPage,
  {
    loading: () => <LoadingView size="splash" className="no-dark" />,
  },
);

const Draw = dynamic(async () => (await import("./draw")).Draw, {
  loading: () => <LoadingView size="splash" className="no-dark" />,
});

const McpMarketPage = dynamic(
  async () => (await import("./mcp-market")).McpMarketPage,
  {
    loading: () => <LoadingView size="splash" className="no-dark" />,
  },
);

const PromptManagerPage = dynamic(
  async () => (await import("./prompt-manager")).PromptManagerPage,
  {
    loading: () => <LoadingView size="splash" className="no-dark" />,
  },
);

function resolvePreloadTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "light";
  return (window as any).__NEXTCHAT_PRELOAD_THEME__ === "light"
    ? "light"
    : "light";
}

function resolveEffectiveTheme(
  theme: string,
  hasHydrated = true,
): "dark" | "light" {
  if (theme === "dark" || theme === "light") return theme;
  if (typeof window === "undefined") return "light";
  if (!hasHydrated) return resolvePreloadTheme();
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

const PRELOAD_STYLE_ID = "theme-preload-style";

function applyDocumentTheme(effective: "dark" | "light") {
  const bgColor = effective === "dark" ? "#151515" : "#fafafa";
  const targets = [document.documentElement, document.body].filter(Boolean);

  targets.forEach((target) => {
    target.classList.remove("light", "dark");
    target.classList.add(effective);
    target.style.setProperty("background-color", bgColor, "important");
    target.style.setProperty("color-scheme", effective);
  });
}

function updatePreloadStyle(isDark: boolean) {
  try {
    const styleEl = document.getElementById(PRELOAD_STYLE_ID);
    if (styleEl) {
      const bgColor = isDark ? "#151515" : "#fafafa";
      styleEl.textContent =
        "html, body { background-color: " +
        bgColor +
        " !important; color-scheme: " +
        (isDark ? "dark" : "light") +
        "; transition: none !important; } " +
        'html.light [class*="loading-view"] { background-color: #fafafa !important; } ' +
        'html.dark [class*="loading-view"], html:not(.light):not(.dark) [class*="loading-view"] { background-color: #151515 !important; }';
    }
  } catch {
    // 忽略错误
  }
}

function signalThemeReady() {
  try {
    window.dispatchEvent(new Event("nextchat:theme-ready"));
  } catch {
    // 忽略错误
  }
}

export function useSwitchTheme() {
  const config = useAppConfig();
  const prevThemeClass = useRef<string | null>(null);
  const hasHydrated = config._hasHydrated;

  // 同步阶段立即设置正确的主题 class
  if (typeof window !== "undefined") {
    const effective = resolveEffectiveTheme(config.theme, hasHydrated);
    if (prevThemeClass.current !== effective) {
      applyDocumentTheme(effective);
      prevThemeClass.current = effective;
      updatePreloadStyle(effective === "dark");
    }
  }

  useLayoutEffect(() => {
    const effective = resolveEffectiveTheme(config.theme, hasHydrated);

    applyDocumentTheme(effective);
    prevThemeClass.current = effective;
    updatePreloadStyle(effective === "dark");
    if (hasHydrated) {
      signalThemeReady();
    }

    const metaDescriptionDark = document.querySelector(
      'meta[name="theme-color"][media*="dark"]',
    );
    const metaDescriptionLight = document.querySelector(
      'meta[name="theme-color"][media*="light"]',
    );

    if (config.theme === "auto") {
      metaDescriptionDark?.setAttribute("content", "#151515");
      metaDescriptionLight?.setAttribute("content", "#fafafa");
    } else {
      const themeColor = getCSSVar("--theme-color");
      metaDescriptionDark?.setAttribute("content", themeColor);
      metaDescriptionLight?.setAttribute("content", themeColor);
    }
  }, [config.theme, hasHydrated]);

  // auto 模式下监听系统主题变化
  useEffect(() => {
    if (config.theme !== "auto") return;

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const effective = media.matches ? "dark" : "light";
      applyDocumentTheme(effective);
      prevThemeClass.current = effective;
      updatePreloadStyle(effective === "dark");
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [config.theme]);
}

function useHtmlLang() {
  useEffect(() => {
    const lang = getISOLang();
    const htmlLang = document.documentElement.lang;

    if (lang !== htmlLang) {
      document.documentElement.lang = lang;
    }
  }, []);
}

const useHasHydrated = () => {
  const [hasHydrated, setHasHydrated] = useState<boolean>(false);

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  return hasHydrated;
};

const loadAsyncGoogleFont = () => {
  if (!getClientConfig()?.enableGoogleFonts) {
    return;
  }

  const linkEl = document.createElement("link");
  const remoteFontUrl = "/google-fonts";
  linkEl.rel = "stylesheet";
  linkEl.href =
    remoteFontUrl +
    "/css2?family=" +
    encodeURIComponent("Noto Sans:wght@300;400;700;900") +
    "&display=swap";
  document.head.appendChild(linkEl);
};

function isEmptyHistoryPlaceholderMessage(message: any) {
  if (!message || message.preview || message.streaming) {
    return false;
  }
  if (getMessageTextContent(message).trim().length > 0) {
    return false;
  }
  if (getMessageImages(message).length > 0) {
    return false;
  }
  if (Array.isArray(message.tools) && message.tools.length > 0) {
    return false;
  }
  return true;
}

const CHAT_BOOTSTRAP_READY_KEY = "nextchat_chat_bootstrap_ready";
const CHAT_BOOTSTRAP_SYNC_TIMEOUT_MS = 20000;
const SCROLLBAR_VISIBLE_CLASS = "scrollbar-visible";
const SCROLLBAR_HIDE_DELAY_MS = 700;

export function WindowContent(props: { children: React.ReactNode }) {
  return (
    <div className={styles["window-content"]} id={SlotID.AppBody}>
      {props?.children}
    </div>
  );
}

function Screen({ chatBootstrapped }: { chatBootstrapped: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();

  const switchingUser = useAuthStore((state) => state.switchingUser);
  const isArtifact = location.pathname.includes(Path.Artifacts);
  const isHome = location.pathname === Path.Home;
  const isAuth = location.pathname === Path.Auth;
  const isDraw = location.pathname === Path.Draw;
  const isDrawHistory = location.pathname === Path.DrawHistory;
  const isLegacySd = location.pathname === "/sd";
  const isLegacySdHistory = location.pathname === "/sd/history";
  const isLegacySdNew = location.pathname === "/sd-new";
  const isChatSessionRoute = isChatSessionRoutePath(location.pathname);
  const isChatRoute =
    isHome ||
    location.pathname === Path.Chat ||
    location.pathname === Path.NewChat ||
    isChatSessionRoute;
  const urlSessionId = isChatSessionRoute
    ? decodeURIComponent(location.pathname.slice(Path.Chat.length + 1))
    : "";
  const selectedSessionId = useChatStore((state) => state.selectedSessionId);
  const targetUrlSession = useChatStore((state) =>
    urlSessionId
      ? state.sessions.find((session) => session.id === urlSessionId)
      : undefined,
  );
  const targetUrlSessionSummary = useChatStore((state) =>
    urlSessionId
      ? state.sessionSummaries.find((summary) => summary.id === urlSessionId)
      : undefined,
  );
  const hydratingSessionId = useChatStore((state) => state.hydratingSessionId);
  const chatStoreHydrated = useChatStore((state) =>
    Boolean((state as any)._hasHydrated),
  );
  const chatIndexInitialized = useChatIndexStore((state) => state.initialized);
  const chatIndexAllSessionCount = useChatIndexStore(
    (state) => state.allOrderedSessionIds.length,
  );
  const chatIndexSessionSummaries = useChatIndexStore(
    (state) => state.sessionSummaries,
  );
  const targetUrlIndexSummary = urlSessionId
    ? chatIndexSessionSummaries[urlSessionId]
    : undefined;
  const expectedUrlMessageCount = Number(
    targetUrlSessionSummary?.messageCount ||
      targetUrlIndexSummary?.messageCount ||
      0,
  );
  const { session: currentSession, loading: currentSessionLoading } =
    useCurrentSession();
  const startupChatSyncStatus = useStartupChatSyncStatus();
  const [initialEmptyListGuard, setInitialEmptyListGuard] = useState(true);
  const totalChatCount = useMemo(
    () =>
      Object.values(chatIndexSessionSummaries).filter(
        (session) => session && session.messageCount > 0,
      ).length,
    [chatIndexSessionSummaries],
  );
  const isTargetUrlSessionPlaceholder = useMemo(() => {
    if (!urlSessionId || expectedUrlMessageCount <= 0) {
      return false;
    }
    const messages = targetUrlSession?.messages || [];
    if (messages.length < expectedUrlMessageCount) {
      return true;
    }
    return messages.every(isEmptyHistoryPlaceholderMessage);
  }, [expectedUrlMessageCount, targetUrlSession?.messages, urlSessionId]);
  const routeSession = urlSessionId ? targetUrlSession : currentSession;
  const hasOnlyEmptyHistoryPlaceholders = useMemo(() => {
    if (currentSessionLoading) {
      return false;
    }
    const messages = routeSession?.messages || [];
    if (messages.length === 0) {
      return false;
    }
    return messages.every(isEmptyHistoryPlaceholderMessage);
  }, [routeSession?.messages, currentSessionLoading]);
  const isUrlSessionPending =
    !!urlSessionId &&
    (selectedSessionId !== urlSessionId ||
      hydratingSessionId === urlSessionId ||
      isTargetUrlSessionPlaceholder);
  const isChatListLoadingForShell = isChatListStartupLoading({
    initialized: chatIndexInitialized,
    chatStoreHydrated,
    totalChatCount,
    allSessionCount: chatIndexAllSessionCount,
    initialEmptyListGuard,
    startupChatSyncStatus,
  });

  useEffect(() => {
    if (!urlSessionId) {
      return;
    }

    // The chat list updates the selected session immediately so switching
    // remains responsive while another session is streaming. Only reconcile
    // from the URL when the URL itself changes; otherwise the previous route
    // can momentarily switch the selection back during a deferred navigation.
    selectChatSessionById(urlSessionId);
  }, [urlSessionId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setInitialEmptyListGuard(false);
    }, 2500);

    return () => window.clearTimeout(timer);
  }, []);

  const isMobileScreen = useMobileScreen();
  const isInitialEntry = location.key === "default";

  // 移动端默认进入聊天界面而非对话列表
  useEffect(() => {
    if (isInitialEntry && isMobileScreen && isHome) {
      navigate(Path.Chat, { replace: true });
    }
  }, [isHome, isInitialEntry, isMobileScreen, navigate]);

  useEffect(() => {
    loadAsyncGoogleFont();
  }, []);

  useEffect(() => {
    prepareRouteEntryForSync(location.pathname, {
      source: "page-lifecycle",
    });
  }, [location.pathname]);

  useEffect(() => {
    if (isLegacySd) {
      navigate(Path.Draw, { replace: true });
    } else if (isLegacySdHistory || isLegacySdNew) {
      navigate(Path.DrawHistory, { replace: true });
    }
  }, [isLegacySd, isLegacySdHistory, isLegacySdNew, navigate]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.pointerEvents = "none";
    const timer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.style.pointerEvents = "";
      });
    });
    return () => {
      cancelAnimationFrame(timer);
      root.style.pointerEvents = "";
    };
  }, [location]);

  if (isArtifact) {
    return (
      <Routes>
        <Route path="/artifacts/:id" element={<Artifacts />} />
      </Routes>
    );
  }

  // 非聊天路径不等待对话初始化，立即显示侧边栏
  if (!chatBootstrapped && isChatRoute) {
    return <Loading splash />;
  }

  if (
    isChatRoute &&
    (switchingUser ||
      isUrlSessionPending ||
      isChatListLoadingForShell ||
      hasOnlyEmptyHistoryPlaceholders)
  ) {
    return (
      <div
        className={clsx(styles.container, styles["container-loading"], {
          [styles["rtl-screen"]]: getLang() === "ar",
        })}
      >
        <SideBar
          loading={switchingUser}
          className={clsx({
            [styles["sidebar-show"]]: isHome,
          })}
        />
        <WindowContent>
          <LoadingView size="splash" className="no-dark" />
        </WindowContent>
      </div>
    );
  }

  const renderContent = () => {
    if (isAuth) return <AuthPage />;
    if (isDraw || isLegacySd) return <Draw />;
    if (isDrawHistory || isLegacySdHistory || isLegacySdNew) return <Draw />;
    return (
      <>
        <SideBar
          className={clsx({
            [styles["sidebar-show"]]: isHome,
          })}
        />
        <WindowContent>
          <Routes>
            <Route path={Path.Home} element={<Chat />} />
            <Route path={Path.NewChat} element={<NewChat />} />
            <Route path={Path.Plugins} element={<PluginPage />} />
            <Route path={Path.SearchChat} element={<SearchChat />} />
            <Route path={Path.ChatBackups} element={<ChatBackupsPage />} />
            <Route
              path={Path.LegacyChatBackups}
              element={<Navigate to={Path.ChatBackups} replace />}
            />
            <Route
              path="/info/chat/bakcup"
              element={<Navigate to={Path.ChatBackups} replace />}
            />
            <Route path={Path.ChatWithId} element={<Chat />} />
            <Route path={Path.Chat} element={<Chat />} />
            <Route path={Path.ApiConfig} element={<ApiConfigPage />} />
            <Route
              path={Path.LegacyApiConfig}
              element={<Navigate to={Path.ApiConfig} replace />}
            />
            <Route
              path={Path.ApiConfigBackups}
              element={<ApiConfigBackupsPage />}
            />
            <Route
              path={Path.LegacyApiConfigBackups}
              element={<Navigate to={Path.ApiConfigBackups} replace />}
            />
            <Route
              path="/info/api-config/bakcup"
              element={<Navigate to={Path.ApiConfigBackups} replace />}
            />
            <Route
              path={Path.ProviderBalances}
              element={<ProviderBalancesPage />}
            />
            <Route
              path={Path.ProviderModelFetch}
              element={<ProviderModelFetchPage />}
            />
            <Route
              path={Path.LegacyProviderBalances}
              element={<Navigate to={Path.ProviderBalances} replace />}
            />
            <Route
              path="/info/balances"
              element={<Navigate to={Path.ProviderBalances} replace />}
            />
            <Route path={Path.McpMarket} element={<McpMarketPage />} />
            <Route path={Path.PromptManager} element={<PromptManagerPage />} />
          </Routes>
        </WindowContent>
      </>
    );
  };

  return (
    <div
      className={clsx(styles.container, {
        [styles["rtl-screen"]]: getLang() === "ar",
      })}
    >
      {renderContent()}
    </div>
  );
}

export function useLoadData() {
  useEffect(() => {
    // 不再自动获取内置模型，使用自定义供应商配置的模型
  }, []);
}

function useTransientScrollbars() {
  useEffect(() => {
    let hideTimer: number | undefined;

    const showScrollbar = () => {
      document.documentElement.classList.add(SCROLLBAR_VISIBLE_CLASS);

      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer);
      }

      hideTimer = window.setTimeout(() => {
        document.documentElement.classList.remove(SCROLLBAR_VISIBLE_CLASS);
        hideTimer = undefined;
      }, SCROLLBAR_HIDE_DELAY_MS);
    };

    window.addEventListener("scroll", showScrollbar, {
      capture: true,
      passive: true,
    });

    return () => {
      if (hideTimer !== undefined) {
        window.clearTimeout(hideTimer);
      }
      document.documentElement.classList.remove(SCROLLBAR_VISIBLE_CLASS);
      window.removeEventListener("scroll", showScrollbar, { capture: true });
    };
  }, []);
}

function useWindowHeaderScrollToTop() {
  useEffect(() => {
    const handleHeaderClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const header = target.closest(".window-header");
      if (!header) return;

      // Ignore interactive element clicks
      if (
        target.closest("button") ||
        target.closest("a") ||
        target.closest("input") ||
        target.closest("select") ||
        target.closest("[role='button']")
      ) {
        return;
      }

      let pageContainer: HTMLElement | null = header.parentElement;
      while (pageContainer && pageContainer !== document.body) {
        if (
          pageContainer.classList.contains("window") ||
          pageContainer.classList.contains("modal-mask") ||
          pageContainer.classList.contains("modal") ||
          pageContainer.getAttribute("id") === "app-body"
        ) {
          break;
        }
        pageContainer = pageContainer.parentElement;
      }
      if (!pageContainer) {
        pageContainer = header.parentElement || document.body;
      }

      const elements = pageContainer.querySelectorAll("*");
      let scrollableEl: HTMLElement | null = null;
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i] as HTMLElement;
        if (header.contains(el)) continue;

        const style = window.getComputedStyle(el);
        if (style.overflowY === "auto" || style.overflowY === "scroll") {
          if (el.scrollHeight > el.clientHeight || el.offsetHeight > 0) {
            scrollableEl = el;
            break;
          }
        }
      }

      if (scrollableEl) {
        scrollableEl.scrollTo({
          top: 0,
          behavior: "smooth",
        });
      }
    };

    window.addEventListener("click", handleHeaderClick, { capture: true });
    return () => {
      window.removeEventListener("click", handleHeaderClick, { capture: true });
    };
  }, []);
}

export function Home() {
  useSwitchTheme();
  useLoadData();
  useHtmlLang();
  useTransientScrollbars();
  useWindowHeaderScrollToTop();
  const hasHydrated = useHasHydrated();
  const authInitialized = useAuthStore((state) => state.initialized);
  const authUser = useAuthStore((state) => state.user);
  const [chatBootstrapped, setChatBootstrapped] = useState(false);
  const pageOpenSummaryLoggedRef = useRef(false);
  const bootStartedAtRef = useRef(nowMs());
  const bootLongTaskCountRef = useRef(0);
  const bootPerfObserverRef = useRef<PerformanceObserver | null>(null);

  useEffect(() => {
    if (
      !isPerfDebugEnabled() ||
      typeof PerformanceObserver === "undefined" ||
      bootPerfObserverRef.current
    ) {
      return;
    }

    try {
      const observer = new PerformanceObserver((list) => {
        bootLongTaskCountRef.current += list.getEntries().length;
      });
      observer.observe({ entryTypes: ["longtask"] });
      bootPerfObserverRef.current = observer;
    } catch {
      bootPerfObserverRef.current = null;
    }

    return () => {
      bootPerfObserverRef.current?.disconnect();
      bootPerfObserverRef.current = null;
    };
  }, []);

  useEffect(() => {
    // console.log("[Config] got config from build time", getClientConfig());
    (useAccessStore.getState() as any).fetch();
    void useAuthStore
      .getState()
      .fetchMe()
      .catch((error) => {
        console.error("[Auth] failed to fetch current user", error);
      });

    const initMcp = async () => {
      if (!getClientConfig()?.enableMcp) {
        return;
      }

      try {
        // console.log("[MCP] initializing...");
        await initializeMcpSystem();
        // console.log("[MCP] initialized");
      } catch (e) {
        console.error("[MCP] initialization failed", e);
      }
    };
    initMcp();
  }, []);

  useEffect(() => {
    if (!hasHydrated || !authInitialized) {
      return;
    }

    let cancelled = false;
    const bootstrapSyncController = new AbortController();
    const entryPath = getCurrentHashPath();
    prepareRouteEntryForSync(entryPath, {
      source: "home-bootstrap",
    });
    try {
      window.sessionStorage.setItem(CHAT_BOOTSTRAP_READY_KEY, "0");
    } catch {}

    // 首页汇总必须在全部关联 store 同步完成后才读取，不能在聊天首屏就绪时
    // 抢先读取本地缓存，否则 API 配置会只显示已水合的一部分。

    const markChatBootstrapped = () => {
      if (!cancelled) {
        setChatBootstrapped(true);
      }
      try {
        window.sessionStorage.setItem(CHAT_BOOTSTRAP_READY_KEY, "1");
      } catch {}
    };

    const bootstrapChat = async () => {
      try {
        await useChatIndexStore.getState().initialize();
      } catch (error) {
        console.error("[Home] 初始化 chat-index 失败:", error);
      }

      try {
        useChatStore.getState().initializeForNewPage();
        useChatIndexStore.getState().syncFromChatStore();
        markChatBootstrapped();

        // 远端变更同步放到首屏之后执行，避免弱网或超时拖慢首页打开。
        // 确保主页的同步进程在直接打开其他页面时也保持运行
        if (true) {
          try {
            const { useSyncStore } = await import("../store/sync");
            markRouteSyncStart(entryPath, "home-bootstrap");
            const timeoutId = window.setTimeout(() => {
              bootstrapSyncController.abort();
            }, CHAT_BOOTSTRAP_SYNC_TIMEOUT_MS);
            try {
              publishStartupChatSyncStatus("syncing");
              await useSyncStore.getState().syncChatOnStartup?.({
                source: "page-init",
                minIntervalMs: 0,
                abortSignal: bootstrapSyncController.signal,
                // Home bootstrap 静默：当前页面是主页或对话页时仍打印汇总，其他子路由打开或切换后静默
                silentSummary: !isHomepageOrChatPage(),
              });
              if (!bootstrapSyncController.signal.aborted) {
                publishStartupChatSyncStatus("done");
              }

              // 汇总涉及 API 配置、模型和插件；与聊天同步一起完成后才允许打印。
              await useSyncStore
                .getState()
                .sync?.([StoreKey.Access, StoreKey.Config, StoreKey.Plugin], {
                  force: true,
                  abortSignal: bootstrapSyncController.signal,
                  silentSummary: true,
                });
            } catch (error) {
              if (!bootstrapSyncController.signal.aborted) {
                publishStartupChatSyncStatus("error");
              }
              throw error;
            } finally {
              window.clearTimeout(timeoutId);
            }
          } catch (error) {
            console.log("[Home] sync catch block caught error:", error);
            if (
              error instanceof Error &&
              /^\[(DB Sync|Sync)\] aborted\b/.test(error.message)
            ) {
              console.log("[Home] sync aborted, returning early");
              return;
            }
            console.error("[Home] 远端变更同步失败:", error);
          }
          if (!cancelled) {
            useChatIndexStore.getState().syncFromChatStore();
          }

          const isCurrentlyChat = isHomepageOrChatPage();
          if (isCurrentlyChat && !pageOpenSummaryLoggedRef.current) {
            pageOpenSummaryLoggedRef.current = true;
            void logPageOpenUsageSummary();
          }
        }
      } finally {
        markChatBootstrapped();
      }
    };

    void bootstrapChat();

    return () => {
      // 不再 abort bootstrapSyncController：useEffect 依赖 [authInitialized, hasHydrated] 在
      // 切换用户（auth 状态翻转）时会重跑，旧的 abort 会掐断目标用户的首次同步，
      // 导致「切换用户后看不到新对话」「同步状态卡在 syncing」等问题。
      // 这里仅保留 React 状态保护 `cancelled`，让 bootstrapChat 自身的早返逻辑生效。
      cancelled = true;
    };
  }, [authInitialized, hasHydrated]);

  useEffect(() => {
    if (!chatBootstrapped || !authUser?.id) {
      return;
    }

    const controller = new AbortController();
    let idleCallbackId: number | null = null;
    const preload = () => {
      // 不再打印「[ManagedUsers] 页面启动后自动更新用户数据 / 完成」两条启动日志，
      // 它们与「页面打开数据汇总」段落重复，且每跳页 / 切用户都打一遍。
      // managedUsers 自身已有 inFlight / 失败 / abort 状态输出，错误路径保留。
      void import("../utils/managed-users")
        .then(
          ({ bootstrapManagedUsers }) =>
            bootstrapManagedUsers({
              ownerUserId: authUser.id,
              signal: controller.signal,
            }).revalidatePromise,
        )
        .catch((error) => {
          if (
            controller.signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError")
          ) {
            return;
          }
          const message =
            error instanceof Error ? error.message : "unknown_error";
          if (message.includes("权限") || message.includes("登录")) {
            console.log("[ManagedUsers] 当前用户无用户列表权限，跳过启动更新");
            return;
          }
          console.error("[Home] 预取用户列表失败:", message);
        });
    };

    const delayId = window.setTimeout(() => {
      if ("requestIdleCallback" in window) {
        idleCallbackId = window.requestIdleCallback(preload, {
          timeout: 10_000,
        });
      } else {
        preload();
      }
    }, 1_200);

    return () => {
      window.clearTimeout(delayId);
      controller.abort();
      if (idleCallbackId !== null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleCallbackId);
      }
    };
  }, [authUser?.id, authUser?.role, chatBootstrapped]);

  useEffect(() => {
    if (!hasHydrated || !authInitialized) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      logPerfSummary("Boot", {
        firstInteractiveAt: Number(
          (nowMs() - bootStartedAtRef.current).toFixed(2),
        ),
        longTaskCountDuringBoot: bootLongTaskCountRef.current,
      });
      bootPerfObserverRef.current?.disconnect();
      bootPerfObserverRef.current = null;
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [authInitialized, hasHydrated]);

  if (!hasHydrated || !authInitialized) {
    return <Loading splash />;
  }

  return (
    <ErrorBoundary>
      <Router
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Screen chatBootstrapped={chatBootstrapped} />
      </Router>
    </ErrorBoundary>
  );
}

export default Home;
