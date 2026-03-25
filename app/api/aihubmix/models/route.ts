import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_BROWSER_USER_AGENT } from "@/app/api/user-agent";
import { requestUpstream } from "@/app/api/upstream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");

  try {
    return await requestUpstream("https://aihubmix.com/api/v1/models", {
      method: "GET",
      dnsServers: ["1.1.1.1", "8.8.8.8"],
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
        Accept: "application/json",
        "User-Agent": DEFAULT_BROWSER_USER_AGENT,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "aihubmix_models_fetch_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 502 },
    );
  }
}
