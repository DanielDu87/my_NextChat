/* eslint-disable @next/next/no-page-custom-font */
import "./styles/globals.scss";
import "./styles/markdown.scss";
import "./styles/highlight.scss";
import AutoSyncEntry from "./components/auto-sync-entry";
import { ThemeBootScreen } from "./components/theme-boot-screen";
import { getBuildConfig } from "./config/build";
import type { Metadata, Viewport } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { GoogleTagManager, GoogleAnalytics } from "@next/third-parties/google";
import { getServerSideConfig } from "./config/server";
import { cookies } from "next/headers";
import { getAuthSessionCookieName } from "./utils/server/auth";

const AUTH_BYPASS_ENABLED =
  process.env.NEXTCHAT_DISABLE_AUTH === "1" ||
  process.env.NEXTCHAT_DISABLE_AUTH === "true";
const THEME_BOOT_SCREEN_ID = "theme-boot-screen";

export const metadata: Metadata = {
  title: "NextChat",
  description: "你的个人 AI 对话助手。",
  appleWebApp: {
    title: "NextChat",
    statusBarStyle: "default",
    capable: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#151515" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const serverConfig = getServerSideConfig();
  const buildConfig = getBuildConfig();
  const hasAuthSession = Boolean(
    cookies().get(getAuthSessionCookieName())?.value,
  );
  const shouldMountAutoSync = AUTH_BYPASS_ENABLED || hasAuthSession;

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 首帧默认浅色，随后由本地保存的主题在 head 阶段立即接管。 */}
        <style>{`
          html,body{background-color:#fafafa;color-scheme:light}
          #${THEME_BOOT_SCREEN_ID}{position:fixed;inset:0;z-index:2147483647;background:#fafafa;color-scheme:light;pointer-events:none}
          @media(prefers-color-scheme:dark){
            html,body{background-color:#151515;color-scheme:dark}
            #${THEME_BOOT_SCREEN_ID}{background:#151515;color-scheme:dark}
          }
        `}</style>
        <meta name="config" content={JSON.stringify(buildConfig)} />
        <meta httpEquiv="Content-Language" content="zh-CN" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content"
        />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link
          rel="manifest"
          href="/site.webmanifest"
          crossOrigin="use-credentials"
        ></link>
        <script src="/serviceWorkerRegister.js" defer></script>
        {/* 最早期设置主题和背景色，彻底避免首屏加载闪烁 */}
        {/* style 标签由脚本动态创建 + inline style 双保险 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('appConfig.theme');
                  var html = document.documentElement;
                  var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var hasStoredTheme = theme === 'dark' || theme === 'light' || theme === 'auto';
                  var isDark = theme === 'dark' || (theme === 'auto' && systemDark);
                  var preloadDark = isDark;
                  var bgColor = preloadDark ? '#151515' : '#fafafa';
                  window.__NEXTCHAT_PRELOAD_THEME__ = preloadDark ? 'dark' : 'light';

                  // 方案1: 动态 style 标签覆盖 html,body（不依赖 class）
                  var style = document.createElement('style');
                  style.id = 'theme-preload-style';
                  style.textContent = 'html, body { background-color: ' + bgColor + ' !important; color-scheme: ' + (preloadDark ? 'dark' : 'light') + '; transition: none !important; } #' + '${THEME_BOOT_SCREEN_ID}' + ' { background: ' + bgColor + ' !important; color-scheme: ' + (preloadDark ? 'dark' : 'light') + '; } html.light [class*="loading-view"] { background-color: #fafafa !important; } html.dark [class*="loading-view"], html:not(.light):not(.dark) [class*="loading-view"] { background-color: #151515 !important; }';
                  document.head.appendChild(style);

                  // 方案2: html inline style 直接设置（不管 class 如何变化都生效）
                  html.style.setProperty('background-color', bgColor, 'important');
                  html.style.setProperty('color-scheme', preloadDark ? 'dark' : 'light');

                  html.classList.remove('light', 'dark');
                  if (preloadDark) {
                    html.classList.add('dark');
                  } else {
                    html.classList.add('light');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = window.__NEXTCHAT_PRELOAD_THEME__ || 'light';
                  var isDark = theme !== 'light';
                  var bgColor = isDark ? '#151515' : '#fafafa';
                  document.body.classList.remove('light', 'dark');
                  document.body.classList.add(isDark ? 'dark' : 'light');
                  document.body.style.setProperty('background-color', bgColor, 'important');
                  document.body.style.setProperty('color-scheme', isDark ? 'dark' : 'light');
                } catch(e) {}
              })();
            `,
          }}
        />
        <div
          id={THEME_BOOT_SCREEN_ID}
          aria-hidden="true"
          suppressHydrationWarning
        />
        <ThemeBootScreen id={THEME_BOOT_SCREEN_ID} />
        {shouldMountAutoSync && <AutoSyncEntry />}
        {children}
        {serverConfig?.isVercel && (
          <>
            <SpeedInsights />
          </>
        )}
        {serverConfig?.gtmId && (
          <>
            <GoogleTagManager gtmId={serverConfig.gtmId} />
          </>
        )}
        {serverConfig?.gaId && (
          <>
            <GoogleAnalytics gaId={serverConfig.gaId} />
          </>
        )}
      </body>
    </html>
  );
}
