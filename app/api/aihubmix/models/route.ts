import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_BROWSER_USER_AGENT } from "@/app/api/user-agent";
import { requestUpstream } from "@/app/api/upstream";
import { AIHUBMIX_APP_CODE } from "@/app/utils/aihubmix";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const { searchParams } = new URL(req.url);
  const source = searchParams.get("source");
  const page = searchParams.get("p") ?? "0";
  const num = searchParams.get("num") ?? "1000";

  try {
    if (source === "page") {
      return await requestUpstream(
        `https://aihubmix.com/call/mdl_info_pagination?p=${encodeURIComponent(
          page,
        )}&num=${encodeURIComponent(num)}`,
        {
          method: "GET",
          dnsServers: ["1.1.1.1", "8.8.8.8"],
          headers: {
            ...(authHeader ? { Authorization: authHeader } : {}),
            "APP-Code": AIHUBMIX_APP_CODE,
            Accept: "application/json",
            "User-Agent": DEFAULT_BROWSER_USER_AGENT,
          },
        },
      );
    }

    return await requestUpstream("https://aihubmix.com/api/v1/models", {
      method: "GET",
      dnsServers: ["1.1.1.1", "8.8.8.8"],
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
        "APP-Code": AIHUBMIX_APP_CODE,
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
