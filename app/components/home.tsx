"use client";

require("../polyfill");

import { useEffect, useRef, useState } from "react";
import styles from "./home.module.scss";

import BotIcon from "../icons/bot.svg";
import LoadingIcon from "../icons/three-dots.svg";

import { getCSSVar, useMobileScreen } from "../utils";

import dynamic from "next/dynamic";
import { Path, SlotID } from "../constant";
import { ErrorBoundary } from "./error";

import { getISOLang, getLang } from "../locales";

import {
  HashRouter as Router,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { SideBar } from "./sidebar";
import { useAppConfig } from "../store/config";
import { AuthPage } from "./auth";
import { getClientConfig } from "../config/client";
import { useAccessStore, useChatIndexStore, useChatStore } from "../store";
import clsx from "clsx";
import { initializeMcpSystem, isMcpEnabled } from "../mcp/actions";
import { useAuthStore } from "../store/auth";
import { isPerfDebugEnabled, logPerfSummary, nowMs } from "../utils/perf";

export function Loading(props: { noLogo?: boolean }) {
  return (
    <div className={clsx("no-dark", styles["loading-content"])}>
      {!props.noLogo && <BotIcon />}
      <LoadingIcon />
    </div>
  );
}

const Artifacts = dynamic(async () => (await import("./artifacts")).Artifacts, {
  loading: () => <Loading noLogo />,
});

const ApiConfigPage = dynamic(
  async () => (await import("./api-config")).ApiConfigPage,
  {
    loading: () => <Loading noLogo />,
  },
);

const Chat = dynamic(async () => (await import("./chat")).Chat, {
  loading: () => <Loading noLogo />,
});

const NewChat = dynamic(async () => (await import("./new-chat")).NewChat, {
  loading: () => <Loading noLogo />,
});

const MaskPage = dynamic(async () => (await import("./mask")).MaskPage, {
  loading: () => <Loading noLogo />,
});

const PluginPage = dynamic(async () => (await import("./plugin")).PluginPage, {
  loading: () => <Loading noLogo />,
});

const SearchChat = dynamic(
  async () => (await import("./search-chat")).SearchChatPage,
  {
    loading: () => <Loading noLogo />,
  },
);

const Sd = dynamic(async () => (await import("./sd")).Sd, {
  loading: () => <Loading noLogo />,
});

const McpMarketPage = dynamic(
  async () => (await import("./mcp-market")).McpMarketPage,
  {
    loading: () => <Loading noLogo />,
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

const CHAT_BOOTSTRAP_READY_KEY = "nextchat_chat_bootstrap_ready";
const SCROLLBAR_VISIBLE_CLASS = "scrollbar-visible";
const SCROLLBAR_HIDE_DELAY_MS = 700;

export function WindowContent(props: { children: React.ReactNode }) {
  return (
    <div className={styles["window-content"]} id={SlotID.AppBody}>
      {props?.children}
    </div>
  );
}

function Screen() {
  const location = useLocation();
  const navigate = useNavigate();
  const isArtifact = location.pathname.includes(Path.Artifacts);
  const isHome = location.pathname === Path.Home;
  const isAuth = location.pathname === Path.Auth;
  const isSd = location.pathname === Path.Sd;
  const isSdNew = location.pathname === Path.SdNew;

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
  const renderContent = () => {
    if (isAuth) return <AuthPage />;
    if (isSd) return <Sd />;
    if (isSdNew) return <Sd />;
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
            <Route path={Path.Masks} element={<MaskPage />} />
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
    try {
      window.sessionStorage.setItem(CHAT_BOOTSTRAP_READY_KEY, "0");
    } catch {}

    void useChatIndexStore
      .getState()
      .initialize()
      .catch((error) => {
        console.error("[Home] 初始化 chat-index 失败:", error);
      })
      .finally(() => {
        useChatStore.getState().initializeForNewPage();
        useChatIndexStore.getState().syncFromChatStore();
        // 启动时检查远端变更（删除、新增等），确保多端数据一致
        import("../store/sync").then(({ useSyncStore }) => {
          useSyncStore
            .getState()
            .syncChatIfRemoteChanged?.({
              source: "page-init",
              minIntervalMs: 0,
            })
            .catch((error: unknown) => {
              console.error("[Home] 远端变更同步失败:", error);
            });
        });
        if (!cancelled) {
          setChatBootstrapped(true);
        }
        try {
          window.sessionStorage.setItem(CHAT_BOOTSTRAP_READY_KEY, "1");
        } catch {}
      });

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

  if (!hasHydrated || !authInitialized || !chatBootstrapped) {
    return <Loading />;
  }

  return (
    <ErrorBoundary>
      <Router>
        <Screen />
      </Router>
    </ErrorBoundary>
  );
}

export default Home;
