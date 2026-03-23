import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_BROWSER_USER_AGENT } from "@/app/api/user-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  console.log("[ToAPIs Route] start", {
    hasAuth: !!authHeader,
    authPrefix: authHeader ? authHeader.slice(0, 20) + "..." : "none",
  });

  try {
    const response = await fetch("https://toapis.com/api/pricing", {
      method: "GET",
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
        "User-Agent": DEFAULT_BROWSER_USER_AGENT,
        Accept: "application/json",
      },
      redirect: "manual",
    });

    console.log("[ToAPIs Route] upstream", {
      status: response.status,
      statusText: response.statusText,
    });

    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.delete("www-authenticate");
    headers.set("X-Accel-Buffering", "no");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error("[ToAPIs Route] failed", error);
    return NextResponse.json(
      {
        error: "toapis_pricing_fetch_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 502 },
    );
  }
}
