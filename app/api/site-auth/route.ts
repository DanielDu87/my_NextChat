import { NextResponse } from "next/server";
import {
  createSiteAccessCookieValue,
  ensureSitePasswordConfigured,
  getSiteAccessCookieName,
  getSiteAccessMaxAgeSeconds,
  verifySitePassword,
} from "@/app/utils/server/site-password";

const DEFAULT_SITE_PASSWORD = "dyxchat123";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    await ensureSitePasswordConfigured(DEFAULT_SITE_PASSWORD);

    const body = (await request.json().catch(() => ({}))) as {
      password?: string;
    };
    const password = String(body.password || "");
    const verified = await verifySitePassword(password);

    if (!verified) {
      return NextResponse.json(
        { ok: false, error: "密码错误" },
        { status: 401 },
      );
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: getSiteAccessCookieName(),
      value: await createSiteAccessCookieValue(),
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: getSiteAccessMaxAgeSeconds(),
      path: "/",
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
