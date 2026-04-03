import { Analytics } from "@vercel/analytics/react";
import HomeEntry from "./components/home-entry";
import { getServerSideConfig } from "./config/server";
import { cookies } from "next/headers";
import SitePasswordGate from "./components/site-password-gate";
import {
  getAuthContextFromCookies,
  getAuthSessionCookieName,
  getEffectiveUserCookieName,
} from "./utils/server/auth";

const serverConfig = getServerSideConfig();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function App({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const cookieStore = cookies();
  const authContext = await getAuthContextFromCookies({
    sessionToken: cookieStore.get(getAuthSessionCookieName())?.value,
    effectiveUserId: cookieStore.get(getEffectiveUserCookieName())?.value,
  });
  const loginError = Array.isArray(searchParams?.["login-error"])
    ? searchParams?.["login-error"]?.[0]
    : searchParams?.["login-error"];

  return (
    <>
      {authContext ? (
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
