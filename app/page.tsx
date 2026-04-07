import { Analytics } from "@vercel/analytics/react";
import HomeEntry from "./components/home-entry";
import { getServerSideConfig } from "./config/server";
import { cookies } from "next/headers";
import SitePasswordGate from "./components/site-password-gate";

const serverConfig = getServerSideConfig();
const AUTH_SESSION_COOKIE_NAME = "nextchat_auth_session";
const EFFECTIVE_USER_COOKIE_NAME = "nextchat_effective_user";
const AUTH_BYPASS_ENABLED = true; // 临时关闭登录限制，方便测试

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
  let authError = "";

  try {
    authContext = await getAuthContextFromCookies({
      sessionToken,
      effectiveUserId,
    });
  } catch (error) {
    console.error("[Auth] 页面鉴权失败:", error);
    authError =
      error instanceof Error && /timeout|connect|postgres/i.test(error.message)
        ? "数据库连接超时，请稍后重试"
        : "认证服务暂不可用";
  }
  return (
    <>
      {authContext ? (
        <HomeEntry />
      ) : (
        <SitePasswordGate initialError={loginError || authError} />
      )}
      {serverConfig?.isVercel && (
        <>
          <Analytics />
        </>
      )}
    </>
  );
}
