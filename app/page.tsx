import { Analytics } from "@vercel/analytics/react";
import HomeEntry from "./components/home-entry";
import { getServerSideConfig } from "./config/server";
import { cookies } from "next/headers";
import SitePasswordGate from "./components/site-password-gate";
import {
  ensureSitePasswordConfigured,
  getSiteAccessCookieName,
  verifySiteAccessCookie,
} from "./utils/server/site-password";

const serverConfig = getServerSideConfig();
const DEFAULT_SITE_PASSWORD = "dyxchat123";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function App() {
  await ensureSitePasswordConfigured(DEFAULT_SITE_PASSWORD);
  const cookieStore = cookies();
  const isUnlocked = await verifySiteAccessCookie(
    cookieStore.get(getSiteAccessCookieName())?.value,
  );

  return (
    <>
      {isUnlocked ? <HomeEntry /> : <SitePasswordGate />}
      {serverConfig?.isVercel && (
        <>
          <Analytics />
        </>
      )}
    </>
  );
}
