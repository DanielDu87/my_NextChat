import React, { Fragment, useEffect, useMemo, useRef, useState } from "react";

import styles from "./home.module.scss";

import { IconButton } from "./button";
import SettingsIcon from "../icons/settings.svg";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";
import LightIcon from "../icons/light.svg";
import DarkIcon from "../icons/dark.svg";
import AutoIcon from "../icons/auto.svg";
import ChatGptIcon from "../icons/chatgpt.svg";
import AddIcon from "../icons/add.svg";
import DeleteIcon from "../icons/trash.svg";
import MaskIcon from "../icons/mask.svg";
import McpIcon from "../icons/mcp.svg";
import DiscoveryIcon from "../icons/brain.svg";

import Locale from "../locales";

import { useAppConfig, useChatStore } from "../store";
import { useSyncStore } from "../store/sync";
import { Theme } from "../store/config";

import { DEFAULT_SIDEBAR_WIDTH, Path, StoreKey } from "../constant";

import { Link, useNavigate } from "react-router-dom";
import { isIOS, useMobileScreen } from "../utils";
import dynamic from "next/dynamic";
import { Selector, showConfirm, showToast } from "./ui-lib";
import clsx from "clsx";
import { isMcpEnabled } from "../mcp/actions";
import { useAuthStore } from "../store/auth";

const DISCOVERY = [
  { name: Locale.Plugin.Name, path: Path.Plugins },
  { name: "Stable Diffusion", path: Path.Sd },
  { name: Locale.SearchChat.Page.Title, path: Path.SearchChat },
];

const ChatList = dynamic(async () => (await import("./chat-list")).ChatList, {
  loading: () => null,
});

function NextChatBrandIcon() {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 360 360"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g filter="url(#sidebar_logo_b)" clipPath="url(#sidebar_logo_a)">
        <path
          d="M0 180C0 80.589 80.589 0 180 0s180 80.589 180 180-80.589 180-180 180S0 279.411 0 180Z"
          fill="#315EF8"
        />
        <g filter="url(#sidebar_logo_c)">
          <g filter="url(#sidebar_logo_d)">
            <rect
              x="235.508"
              y="83.212"
              width="77.099"
              height="173.079"
              rx="38.55"
              transform="rotate(21.987 235.508 83.212)"
              fill="url(#sidebar_logo_e)"
            />
          </g>
          <g filter="url(#sidebar_logo_f)">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M102.234 136.443c.015-.587-1.004-.812-1.204-.261l-29.164 80.126c-7.281 20.007 3.034 42.128 23.04 49.41 20.007 7.282 42.128-3.034 49.41-23.04a57.396 57.396 0 0 0-12.924-59.786l-18.193-18.581a38.453 38.453 0 0 1-10.965-27.868Z"
              fill="url(#sidebar_logo_g)"
            />
          </g>
          <g filter="url(#sidebar_logo_h)">
            <path
              d="M249.598 195.489a38.857 38.857 0 0 1 10.652 28.746c-1.729 34.097-43.435 49.55-66.963 24.812l-80.228-84.353a38.856 38.856 0 0 1-10.651-28.746c1.728-34.096 43.434-49.55 66.963-24.812l80.227 84.353Z"
              fill="#fff"
              fillOpacity="0.85"
            />
          </g>
        </g>
      </g>
      <defs>
        <filter
          id="sidebar_logo_b"
          x="-15.027"
          y="-11.27"
          width="390.053"
          height="390.053"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix
            in="SourceAlpha"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="3.757" />
          <feGaussianBlur stdDeviation="7.513" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0" />
          <feBlend
            in2="BackgroundImageFix"
            result="effect1_dropShadow_29_689"
          />
          <feBlend
            in="SourceGraphic"
            in2="effect1_dropShadow_29_689"
            result="shape"
          />
        </filter>
        <filter
          id="sidebar_logo_c"
          x="62.038"
          y="91.568"
          width="240.837"
          height="188.208"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix
            in="SourceAlpha"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="4.23" />
          <feGaussianBlur stdDeviation="3.747" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix values="0 0 0 0 0.248635 0 0 0 0 0.245404 0 0 0 0 0.40694 0 0 0 0.15 0" />
          <feBlend
            in2="BackgroundImageFix"
            result="effect1_dropShadow_29_689"
          />
          <feBlend
            in="SourceGraphic"
            in2="effect1_dropShadow_29_689"
            result="shape"
          />
        </filter>
        <filter
          id="sidebar_logo_d"
          x="182.327"
          y="94.832"
          width="117.733"
          height="174.48"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feColorMatrix
            in="SourceAlpha"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dx="4.678" dy="9.356" />
          <feGaussianBlur stdDeviation="4.181" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.39 0" />
          <feBlend
            mode="darken"
            in2="shape"
            result="effect1_innerShadow_29_689"
          />
        </filter>
        <filter
          id="sidebar_logo_f"
          x="69.531"
          y="134.697"
          width="85.382"
          height="133.356"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feColorMatrix
            in="SourceAlpha"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dx="8.772" dy="-1.17" />
          <feGaussianBlur stdDeviation="3.567" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.51 0" />
          <feBlend in2="shape" result="effect1_innerShadow_29_689" />
        </filter>
        <filter
          id="sidebar_logo_h"
          x="101.149"
          y="97.138"
          width="159.15"
          height="165.621"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feColorMatrix
            in="SourceAlpha"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dx="-1.209" dy="-10.877" />
          <feGaussianBlur stdDeviation="0.928" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix values="0 0 0 0 0.103312 0 0 0 0 0.340187 0 0 0 0 0.949292 0 0 0 0.05 0" />
          <feBlend
            mode="multiply"
            in2="shape"
            result="effect1_innerShadow_29_689"
          />
          <feColorMatrix
            in="SourceAlpha"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dx="-1.209" dy="3.022" />
          <feGaussianBlur stdDeviation="0.786" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.94 0" />
          <feBlend
            in2="effect1_innerShadow_29_689"
            result="effect2_innerShadow_29_689"
          />
          <feColorMatrix
            in="SourceAlpha"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dx="-0.302" dy="0.604" />
          <feGaussianBlur stdDeviation="0.302" />
          <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
          <feColorMatrix values="0 0 0 0 0.729181 0 0 0 0 0.803822 0 0 0 0 0.995754 0 0 0 0.86 0" />
          <feBlend
            mode="hard-light"
            in2="effect2_innerShadow_29_689"
            result="effect3_innerShadow_29_689"
          />
        </filter>
        <linearGradient
          id="sidebar_logo_e"
          x1="289.153"
          y1="98.392"
          x2="200.569"
          y2="280.117"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.62" />
        </linearGradient>
        <linearGradient
          id="sidebar_logo_g"
          x1="106.933"
          y1="134.422"
          x2="109.673"
          y2="254.984"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#fff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#fff" />
        </linearGradient>
        <clipPath id="sidebar_logo_a">
          <path fill="#fff" d="M0 0h360v360H0z" />
        </clipPath>
      </defs>
    </svg>
  );
}

export function useHotKey() {
  const chatStore = useChatStore();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey) {
        if (e.key === "ArrowUp") {
          chatStore.nextSession(-1);
        } else if (e.key === "ArrowDown") {
          chatStore.nextSession(1);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
}

export function useFixedSideBar() {
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--sidebar-width",
      `${DEFAULT_SIDEBAR_WIDTH}px`,
    );
  }, []);

  return {
    shouldNarrow: false,
  };
}

export function SideBarContainer(props: {
  children: React.ReactNode;
  shouldNarrow: boolean;
  className?: string;
}) {
  const isMobileScreen = useMobileScreen();
  const isIOSMobile = useMemo(
    () => isIOS() && isMobileScreen,
    [isMobileScreen],
  );
  const { children, className, shouldNarrow } = props;

  return (
    <div
      className={clsx(styles.sidebar, className, {
        [styles["narrow-sidebar"]]: shouldNarrow,
      })}
      style={{
        // #3016 disable transition on ios mobile screen
        transition: isMobileScreen && isIOSMobile ? "none" : undefined,
      }}
    >
      {children}
    </div>
  );
}

export function SideBarHeader(props: {
  title?: string | React.ReactNode;
  subTitle?: string | React.ReactNode;
  logo?: React.ReactNode;
  children?: React.ReactNode;
  shouldNarrow?: boolean;
  linkHref?: string;
}) {
  const { title, subTitle, logo, children, shouldNarrow, linkHref } = props;

  const logoNode = linkHref ? (
    <a
      href={linkHref}
      target="_blank"
      rel="noopener noreferrer"
      className={styles["sidebar-header-link"]}
    >
      <div className={clsx(styles["sidebar-logo"], "no-dark")}>{logo}</div>
    </a>
  ) : (
    <div className={clsx(styles["sidebar-logo"], "no-dark")}>{logo}</div>
  );

  const titleNode = linkHref ? (
    <a
      href={linkHref}
      target="_blank"
      rel="noopener noreferrer"
      className={styles["sidebar-header-link"]}
    >
      <div className={styles["sidebar-title-container"]}>
        <div className={styles["sidebar-title"]} data-tauri-drag-region>
          {title}
        </div>
        <div className={styles["sidebar-sub-title"]}>{subTitle}</div>
      </div>
    </a>
  ) : (
    <div className={styles["sidebar-title-container"]}>
      <div className={styles["sidebar-title"]} data-tauri-drag-region>
        {title}
      </div>
      <div className={styles["sidebar-sub-title"]}>{subTitle}</div>
    </div>
  );

  return (
    <Fragment>
      <div
        className={clsx(styles["sidebar-header"], {
          [styles["sidebar-header-narrow"]]: shouldNarrow,
        })}
        data-tauri-drag-region
      >
        {logoNode}
        {!shouldNarrow && titleNode}
      </div>
      {children}
    </Fragment>
  );
}

export function SideBarBody(props: {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
}) {
  const { onClick, children } = props;
  return (
    <div className={styles["sidebar-body"]} onClick={onClick}>
      {children}
    </div>
  );
}

export function SideBarTail(props: {
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
}) {
  const { primaryAction, secondaryAction } = props;

  return (
    <div className={styles["sidebar-tail"]}>
      <div className={styles["sidebar-actions"]}>{primaryAction}</div>
      <div className={styles["sidebar-actions"]}>{secondaryAction}</div>
    </div>
  );
}

export function SideBar(props: { className?: string }) {
  useHotKey();
  const { shouldNarrow } = useFixedSideBar();
  const [showDiscoverySelector, setshowDiscoverySelector] = useState(false);
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  const navigate = useNavigate();
  const config = useAppConfig();
  const chatStore = useChatStore();
  const syncStore = useSyncStore();
  const readOnly = useAuthStore((state) => state.readOnly);
  const [mcpEnabled, setMcpEnabled] = useState(false);

  const themeSelectorRef = useRef<HTMLDivElement>(null);
  const themeTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 延迟关闭主题选择器
  const handleMouseLeave = () => {
    themeTimerRef.current = setTimeout(() => {
      setShowThemeSelector(false);
    }, 300); // 300ms延迟
  };

  const handleMouseEnter = () => {
    // 清除关闭定时器
    if (themeTimerRef.current) {
      clearTimeout(themeTimerRef.current);
      themeTimerRef.current = null;
    }
    setShowThemeSelector(true);
  };

  useEffect(() => {
    // 检查 MCP 是否启用
    const checkMcpStatus = async () => {
      const enabled = await isMcpEnabled();
      setMcpEnabled(enabled);
      // console.log("[SideBar] MCP enabled:", enabled);
    };
    checkMcpStatus();
  }, []);

  return (
    <SideBarContainer shouldNarrow={shouldNarrow} {...props}>
      <SideBarHeader
        title="NextChat"
        subTitle="Build your own AI assistant."
        logo={<NextChatBrandIcon />}
        shouldNarrow={shouldNarrow}
        linkHref="https://gitee.com/hudongtop/NextChat"
      >
        <div className={styles["sidebar-header-bar"]}>
          <IconButton
            icon={<MaskIcon />}
            text={shouldNarrow ? undefined : Locale.Mask.Name}
            className={`${styles["sidebar-bar-button"]} ${styles["sidebar-icon-button"]}`}
            onClick={() => {
              if (config.dontShowMaskSplashScreen !== true) {
                navigate(Path.NewChat, { state: { fromHome: true } });
              } else {
                navigate(Path.Masks, { state: { fromHome: true } });
              }
            }}
            shadow
          />
          {mcpEnabled && (
            <IconButton
              icon={<McpIcon />}
              text={shouldNarrow ? undefined : Locale.Mcp.Name}
              className={`${styles["sidebar-bar-button"]} ${styles["sidebar-icon-button"]}`}
              onClick={() => {
                navigate(Path.McpMarket, { state: { fromHome: true } });
              }}
              shadow
            />
          )}
          <IconButton
            icon={<DiscoveryIcon />}
            text={shouldNarrow ? undefined : Locale.Discovery.Name}
            className={`${styles["sidebar-bar-button"]} ${styles["sidebar-icon-button"]}`}
            onClick={() => setshowDiscoverySelector(true)}
            shadow
          />
        </div>
        {showDiscoverySelector && (
          <Selector
            items={[
              ...DISCOVERY.map((item) => {
                return {
                  title: item.name,
                  value: item.path,
                };
              }),
            ]}
            onClose={() => setshowDiscoverySelector(false)}
            onSelection={(s) => {
              navigate(s[0], { state: { fromHome: true } });
            }}
          />
        )}
      </SideBarHeader>
      <SideBarBody
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            navigate(Path.Home);
          }
        }}
      >
        <ChatList narrow={shouldNarrow} />
      </SideBarBody>
      <SideBarTail
        primaryAction={
          <>
            <div className={styles["sidebar-action"]}>
              <Link to={Path.Settings}>
                <IconButton
                  aria={Locale.Settings.Title}
                  icon={<SettingsIcon />}
                  className={styles["sidebar-icon-button"]}
                  shadow
                />
              </Link>
            </div>
            <div className={styles["sidebar-action"]}>
              <div
                className={styles["theme-selector"]}
                ref={themeSelectorRef}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                <IconButton
                  aria="切换主题"
                  icon={
                    config.theme === Theme.Dark ? <DarkIcon /> : <LightIcon />
                  }
                  className={styles["sidebar-icon-button"]}
                  shadow
                />
                {showThemeSelector && (
                  <div
                    className={styles["theme-dropdown"]}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                  >
                    <div
                      className={styles["theme-option"]}
                      onClick={() => {
                        config.setTheme(Theme.Light);
                        setShowThemeSelector(false);
                      }}
                    >
                      <LightIcon />
                      <span>Light</span>
                    </div>
                    <div
                      className={styles["theme-option"]}
                      onClick={() => {
                        config.setTheme(Theme.Dark);
                        setShowThemeSelector(false);
                      }}
                    >
                      <DarkIcon />
                      <span>Dark</span>
                    </div>
                    <div
                      className={styles["theme-option"]}
                      onClick={() => {
                        config.setTheme(Theme.Auto);
                        setShowThemeSelector(false);
                      }}
                    >
                      <AutoIcon />
                      <span>Auto</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        }
        secondaryAction={
          <>
            <div className={clsx(styles["sidebar-action"], styles.mobile)}>
              <IconButton
                icon={<DeleteIcon />}
                className={styles["sidebar-icon-button"]}
                onClick={async () => {
                  if (readOnly) {
                    showToast("管理员查看他人数据时为只读模式，不能删除会话");
                    return;
                  }
                  if (await showConfirm(Locale.Home.DeleteChat)) {
                    chatStore.deleteCurrentSession();
                  }
                }}
              />
            </div>
            <IconButton
              icon={<AddIcon />}
              className={styles["sidebar-icon-button"]}
              text={shouldNarrow ? undefined : Locale.Home.NewChat}
              onClick={() => {
                if (readOnly) {
                  showToast("管理员查看他人数据时为只读模式，不能新建会话");
                  return;
                }
                const startNewChat = () => {
                  if (config.dontShowMaskSplashScreen) {
                    const createdNewSession = chatStore.newSession();
                    navigate(Path.Chat);
                    if (createdNewSession && syncStore.cloudSync?.()) {
                      useSyncStore.setState({
                        criticalSyncReady: false,
                        criticalSyncInProgress: true,
                      } as any);
                      void syncStore
                        .sync([StoreKey.Config, StoreKey.Access], {
                          isolateQueue: true,
                          broadcastChatHint: false,
                        })
                        .catch((error) => {
                          console.error(
                            "[Sync] 新建对话模型选择同步失败:",
                            error,
                          );
                        })
                        .finally(() => {
                          useSyncStore.setState({
                            criticalSyncReady: true,
                            criticalSyncInProgress: false,
                          } as any);
                        });
                    }
                  } else {
                    navigate(Path.NewChat);
                  }
                };
                startNewChat();
              }}
              shadow
            />
          </>
        }
      />
    </SideBarContainer>
  );
}
