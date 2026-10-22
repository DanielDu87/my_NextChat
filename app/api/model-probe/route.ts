import { NextRequest, NextResponse } from "next/server";
import { getProviderProfilesForAccessState } from "@/app/utils/server/provider-config-repository";
import { resolveSharedSyncUserId } from "@/app/utils/server/sync-user";
import { AuthError, requireAuthContext } from "@/app/utils/server/auth";

const ALLOWED_TARGET_PREFIXES = [
  "/api/proxy/",
  "/api/yuto/pricing",
  "/api/toapis/pricing",
  "/api/aihubmix/models",
  "/api/ocoolai/available-model",
  "/api/ocoolai/available-models-by-groups",
];

function isAllowedTarget(target: string) {
  return ALLOWED_TARGET_PREFIXES.some(
    (prefix) => target === prefix || target.startsWith(prefix),
  );
}

function jsonBody(payload: unknown) {
  return JSON.stringify(payload);
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
}

async function resolveModelAuthorization(req: NextRequest, baseUrl: string) {
  if (req.headers.get("authorization")) {
    return req.headers.get("authorization");
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) return null;

  try {
    const profiles = await getProviderProfilesForAccessState(
      await resolveSharedSyncUserId(req),
    );
    const profile = profiles.find(
      (item) => normalizeBaseUrl(item.baseUrl || "") === normalizedBaseUrl,
    );
    const apiKey = String(
      profile?.modelFetchApiKey || profile?.apiKey || "",
    ).trim();
    if (!apiKey) return null;

    const authType = profile?.authType || "bearer";
    if (authType === "x-api-key") return apiKey;
    if (authType === "api-key") return apiKey;
    if (authType === "x-goog-api-key") return apiKey;
    if (authType === "none" || authType === "query-key") return null;
    return `Bearer ${apiKey}`;
  } catch (error) {
    // 明确记录获取失败，不要静默返回 null 而误认为"未配置"。
    console.error("[ModelProbe] 获取 API 配置失败，将尝试无认证请求", {
      baseUrl: normalizedBaseUrl,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

export async function GET(req: NextRequest) {
  const target =
    req.headers.get("x-model-probe-url") ||
    req.nextUrl.searchParams.get("target") ||
    "";

  try {
    await requireAuthContext(req);
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return NextResponse.json({
      ok: false,
      status,
      statusText: "Unauthorized",
      contentType: "application/json",
      bodyText: jsonBody({ error: "unauthorized" }),
    });
  }

  // 用解析后的 pathname 校验，防止 /api/proxy/../ 之类的路径穿越绕过白名单。
  const targetPathname = target.startsWith("/api/")
    ? new URL(target, "http://127.0.0.1:3000").pathname
    : "";
  if (!targetPathname || !isAllowedTarget(targetPathname)) {
    return NextResponse.json({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      contentType: "application/json",
      bodyText: jsonBody({ error: "model_probe_target_not_allowed" }),
    });
  }

  try {
    // Avoid calling the public HTTPS hostname from inside the container.
    // Baota/Nginx may not support that hairpin path, while the local app port
    // reaches the proxy route directly.
    const targetUrl = new URL(target, "http://127.0.0.1:3000");
    const headers = new Headers();
    const baseUrl = req.headers.get("x-base-url");
    const authorization = await resolveModelAuthorization(req, baseUrl || "");
    const accept = req.headers.get("accept");

    if (authorization) headers.set("authorization", authorization);
    // 内部转发到 /api/proxy 等需要登录的路由，需带上当前会话 cookie。
    const cookie = req.headers.get("cookie");
    if (cookie) headers.set("cookie", cookie);
    if (baseUrl) headers.set("x-base-url", baseUrl);
    headers.set("accept", accept || "application/json");

    const response = await fetch(targetUrl, {
      method: "GET",
      headers,
      cache: "no-store",
    });
    const bodyText = await response.text();

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type") || "",
      bodyText,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      contentType: "application/json",
      bodyText: jsonBody({
        error: "model_probe_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      }),
    });
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
