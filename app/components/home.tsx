"use client";

require("../polyfill");

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./home.module.scss";

import {
  getCSSVar,
  getMessageImages,
  getMessageTextContent,
  useMobileScreen,
} from "../utils";

import dynamic from "next/dynamic";
import { Path, SlotID } from "../constant";
import { ErrorBoundary } from "./error";

import { getISOLang, getLang } from "../locales";

import {
  BrowserRouter as Router,
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
import { initializeMcpSystem, isMcpEnabled } from "../mcp/actions";
import { useAuthStore } from "../store/auth";
import { useCurrentSession } from "../store/chat-session";
import { isPerfDebugEnabled, logPerfSummary, nowMs } from "../utils/perf";
import { LoadingView } from "./loading-view";
import {
  getCurrentAutoSyncScope,
  getCurrentHashPath,
} from "../utils/startup-sync-scope";
import {
  markRouteSyncStart,
  prepareRouteEntryForSync,
} from "../utils/route-sync-entry";
import {
  isChatListStartupLoading,
  useStartupChatSyncStatus,
} from "../utils/chat-startup-loading";

export function Loading(props: { noLogo?: boolean; splash?: boolean }) {
  if (props.noLogo) {
    return (
      <LoadingView fullscreen size={props.splash ? "splash" : "default"} />
    );
  }

  return (
    <LoadingView
      fullscreen
      size={props.splash ? "splash" : "default"}
      className="no-dark"
    />
  );
}

const Artifacts = dynamic(async () => (await import("./artifacts")).Artifacts, {
  loading: () => <Loading />,
});

const ApiConfigPage = dynamic(
  async () => (await import("./api-config")).ApiConfigPage,
  {
    loading: () => <LoadingView size="default" className="no-dark" />,
  },
);

const NewChat = dynamic(async () => (await import("./new-chat")).NewChat, {
  loading: () => <Loading />,
});

const PluginPage = dynamic(async () => (await import("./plugin")).PluginPage, {
  loading: () => <LoadingView size="default" className="no-dark" />,
});

const SearchChat = dynamic(
  async () => (await import("./search-chat")).SearchChatPage,
  {
    loading: () => <Loading />,
  },
);

const Draw = dynamic(async () => (await import("./draw")).Draw, {
  loading: () => <Loading />,
});

const McpMarketPage = dynamic(
  async () => (await import("./mcp-market")).McpMarketPage,
  {
    loading: () => <Loading />,
  },
);

export function useSwitchTheme() {
  const config = useAppConfig();

  useEffect(() => {
    document.body.classList.remove("light");
    document.body.classList.remove("dark");

    if (config.theme === "dark") {
      document.body.classList.add("dark");
    } else if (config.theme === "light") {
      document.body.classList.add("light");
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
const CHAT_BOOTSTRAP_SYNC_TIMEOUT_MS = 6000;
const SCROLLBAR_VISIBLE_CLASS = "scrollbar-visible";
const SCROLLBAR_HIDE_DELAY_MS = 700;

export function WindowContent(props: { children: React.ReactNode }) {
  return (
    <div className={styles["window-content"]} id={SlotID.AppBody}>
      {props?.children}
    </div>
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`timeout_${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function Screen({ chatBootstrapped }: { chatBootstrapped: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isArtifact = location.pathname.includes(Path.Artifacts);
  const isHome = location.pathname === Path.Home;
  const isAuth = location.pathname === Path.Auth;
  const isDraw = location.pathname === Path.Draw;
  const isDrawHistory = location.pathname === Path.DrawHistory;
  const isLegacySd = location.pathname === "/sd";
  const isLegacySdHistory = location.pathname === "/sd/history";
  const isLegacySdNew = location.pathname === "/sd-new";
  const isChatRoute =
    isHome ||
    location.pathname === Path.Chat ||
    location.pathname.startsWith(`${Path.Chat}/`);
  const urlSessionId = location.pathname.startsWith(`${Path.Chat}/`)
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
    if (!urlSessionId || selectedSessionId === urlSessionId) {
      return;
    }
    selectChatSessionById(urlSessionId);
  }, [selectedSessionId, urlSessionId]);

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
    (isUrlSessionPending ||
      isChatListLoadingForShell ||
      currentSessionLoading ||
      hasOnlyEmptyHistoryPlaceholders)
  ) {
    return <Loading splash />;
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
            <Route path={Path.ChatWithId} element={<Chat />} />
            <Route path={Path.Chat} element={<Chat />} />
            <Route path={Path.ApiConfig} element={<ApiConfigPage />} />
            <Route path={Path.McpMarket} element={<McpMarketPage />} />
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

export function Home() {
  useSwitchTheme();
  useLoadData();
  useHtmlLang();
  useTransientScrollbars();
  const hasHydrated = useHasHydrated();
  const authInitialized = useAuthStore((state) => state.initialized);
  const [chatBootstrapped, setChatBootstrapped] = useState(false);
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
      try {
        const enabled = await isMcpEnabled();
        if (enabled) {
          // console.log("[MCP] initializing...");
          await initializeMcpSystem();
          // console.log("[MCP] initialized");
        }
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
    const entryPath = getCurrentHashPath();
    prepareRouteEntryForSync(entryPath, {
      source: "home-bootstrap",
    });
    try {
      window.sessionStorage.setItem(CHAT_BOOTSTRAP_READY_KEY, "0");
    } catch {}

    const bootstrapChat = async () => {
      try {
        await useChatIndexStore.getState().initialize();
      } catch (error) {
        console.error("[Home] 初始化 chat-index 失败:", error);
      }

      try {
        useChatStore.getState().initializeForNewPage();
        useChatIndexStore.getState().syncFromChatStore();

        // 启动时检查远端变更（删除、新增等），确保多端数据一致
        const scope = getCurrentAutoSyncScope();
        if (scope === "chat" || scope === "home") {
          try {
            const { useSyncStore } = await import("../store/sync");
            markRouteSyncStart(entryPath, "home-bootstrap");
            await withTimeout(
              Promise.resolve(
                useSyncStore.getState().syncChatIfRemoteChanged?.({
                  source: "page-init",
                  minIntervalMs: 0,
                }),
              ),
              CHAT_BOOTSTRAP_SYNC_TIMEOUT_MS,
            );
          } catch (error) {
            console.error("[Home] 远端变更同步失败:", error);
          }
          useChatIndexStore.getState().syncFromChatStore();
        }
      } finally {
        if (!cancelled) {
          setChatBootstrapped(true);
        }
        try {
          window.sessionStorage.setItem(CHAT_BOOTSTRAP_READY_KEY, "1");
        } catch {}
      }
    };

    void bootstrapChat();

    return () => {
      cancelled = true;
    };
  }, [authInitialized, hasHydrated]);

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
      <Router>
        <Screen chatBootstrapped={chatBootstrapped} />
      </Router>
    </ErrorBoundary>
  );
}

export default Home;
