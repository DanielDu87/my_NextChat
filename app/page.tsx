import { Analytics } from "@vercel/analytics/react";
import HomeEntry from "./components/home-entry";
import { getServerSideConfig } from "./config/server";
import { cookies } from "next/headers";
import SitePasswordGate from "./components/site-password-gate";

const serverConfig = getServerSideConfig();
const AUTH_SESSION_COOKIE_NAME = "nextchat_auth_session";
const EFFECTIVE_USER_COOKIE_NAME = "nextchat_effective_user";
const AUTH_BYPASS_ENABLED =
  process.env.NEXTCHAT_DISABLE_AUTH === "1" ||
  process.env.NEXTCHAT_DISABLE_AUTH === "true";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function App({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  if (AUTH_BYPASS_ENABLED) {
    return (
      <>
        <HomeEntry />
        {serverConfig?.isVercel && (
          <>
            <Analytics />
          </>
        )}
      </>
    );
  }

  const cookieStore = cookies();
  const sessionToken = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;
  const effectiveUserId = cookieStore.get(EFFECTIVE_USER_COOKIE_NAME)?.value;

  const loginError = Array.isArray(searchParams?.["login-error"])
    ? searchParams?.["login-error"]?.[0]
    : searchParams?.["login-error"];

  if (!sessionToken) {
    return (
      <>
        <SitePasswordGate initialError={loginError} />
        {serverConfig?.isVercel && (
          <>
            <Analytics />
          </>
        )}
      </>
    );
  }

  const { getAuthContextFromCookies } = await import("./utils/server/auth");
  let authContext = null;

  try {
    authContext = await getAuthContextFromCookies({
      sessionToken,
      effectiveUserId,
    });
  } catch (error) {
    console.error("[Auth] 页面鉴权失败:", error);
  }

  // 有 sessionToken 时一律放行进入应用，由客户端 fetchMe 做最终鉴权
  // 避免因 DB 暂时不可用、连接超时等导致用户反复看到登录页
  return (
    <>
      {authContext || sessionToken ? (
        <HomeEntry />
      ) : (
        <SitePasswordGate initialError={loginError} />
      )}
      {serverConfig?.isVercel && (
        <>
          <Analytics />
        </>
      )}
    </>
  );
}
