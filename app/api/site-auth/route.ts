import { NextResponse } from "next/server";
import {
  createSiteAccessCookieValue,
  ensureSitePasswordConfigured,
  getSiteAccessCookieName,
  getSiteAccessMaxAgeSeconds,
  verifySitePassword,
} from "@/app/utils/server/site-password";

// 站点访问密码默认从环境变量读取，不硬编码到代码。
// 生产部署必须显式设置 NEXTCHAT_SITE_PASSWORD；仅在本地开发且未设置环境变量时
// 才使用占位符 "change-me-please"（启动日志会强提示），避免被部署到生产时静默使用弱口令。
const DEFAULT_SITE_PASSWORD =
  process.env.NEXTCHAT_SITE_PASSWORD?.trim() || "change-me-please";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function buildRelativeRedirectPath(request: Request, targetPath: string) {
  try {
    const redirectUrl = new URL(targetPath, request.url);
    return `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`;
  } catch {
    return targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
  }
}

function createHtmlRedirectResponse(location: string) {
  const escapedLocation = JSON.stringify(location);
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${location}"></head><body><script>window.location.replace(${escapedLocation});</script></body></html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

export async function POST(request: Request) {
  try {
    await ensureSitePasswordConfigured(DEFAULT_SITE_PASSWORD);

    const requestUrl = new URL(request.url);
    const contentType = request.headers.get("content-type") || "";
    const prefersRedirect =
      requestUrl.searchParams.get("redirect") === "1" ||
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data");

    let password = "";
    let redirectTo = "/";

    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => ({}))) as {
        password?: string;
        redirectTo?: string;
      };
      password = String(body.password || "");
      redirectTo = String(body.redirectTo || redirectTo);
    } else {
      const formData = await request.formData().catch(() => null);
      password = String(formData?.get("password") || "");
      redirectTo = String(formData?.get("redirectTo") || redirectTo);
    }

    const verified = await verifySitePassword(password);

    if (!verified) {
      if (prefersRedirect) {
        const failureUrl = new URL(
          buildRelativeRedirectPath(request, redirectTo || "/"),
          "http://localhost",
        );
        failureUrl.searchParams.set("site-auth-error", "密码错误");
        return createHtmlRedirectResponse(
          `${failureUrl.pathname}${failureUrl.search}${failureUrl.hash}`,
        );
      }

      return NextResponse.json(
        { ok: false, error: "密码错误" },
        { status: 401 },
      );
    }

    const isHttps =
      request.headers.get("x-forwarded-proto") === "https" ||
      new URL(request.url).protocol === "https:";
    const successUrl = new URL(
      buildRelativeRedirectPath(request, redirectTo || "/"),
      "http://localhost",
    );
    const response = prefersRedirect
      ? createHtmlRedirectResponse(`${successUrl.pathname}${successUrl.hash}`)
      : NextResponse.json({ ok: true });
    response.cookies.set({
      name: getSiteAccessCookieName(),
      value: await createSiteAccessCookieValue(),
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
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
