import { NextRequest, NextResponse } from "next/server";
import { refreshConfiguredProviderModels } from "@/app/utils/server/provider-model-sync";
import { resolveSyncUserId } from "@/app/utils/server/sync-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isAuthorized(req: NextRequest) {
  const token = process.env.MODEL_SYNC_TOKEN;
  if (!token) {
    return true;
  }

  const authHeader = req.headers.get("authorization") || "";
  return authHeader === `Bearer ${token}`;
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }

    const result = await refreshConfiguredProviderModels(
      "api",
      resolveSyncUserId(req),
    );
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
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
