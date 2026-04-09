/* eslint-disable @next/next/no-page-custom-font */
import "./styles/globals.scss";
import "./styles/markdown.scss";
import "./styles/highlight.scss";
import AutoSyncEntry from "./components/auto-sync-entry";
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
        <meta name="config" content={JSON.stringify(buildConfig)} />
        <meta httpEquiv="Content-Language" content="zh-CN" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content"
        />
        <meta name="mobile-web-app-capable" content="yes" />
        <link
          rel="manifest"
          href="/site.webmanifest"
          crossOrigin="use-credentials"
        ></link>
        <script src="/serviceWorkerRegister.js" defer></script>
      </head>
      <body suppressHydrationWarning>
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
