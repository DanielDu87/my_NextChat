import { NextRequest, NextResponse } from "next/server";

const ALLOWED_TARGET_PREFIXES = [
  "/api/proxy/",
  "/api/yuto/pricing",
  "/api/toapis/pricing",
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

export async function GET(req: NextRequest) {
  const target =
    req.headers.get("x-model-probe-url") ||
    req.nextUrl.searchParams.get("target") ||
    "";

  if (!target.startsWith("/api/") || !isAllowedTarget(target)) {
    return NextResponse.json({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      contentType: "application/json",
      bodyText: jsonBody({ error: "model_probe_target_not_allowed" }),
    });
  }

  try {
    const targetUrl = new URL(target, req.url);
    const headers = new Headers();
    const authorization = req.headers.get("authorization");
    const baseUrl = req.headers.get("x-base-url");
    const accept = req.headers.get("accept");

    if (authorization) headers.set("authorization", authorization);
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
