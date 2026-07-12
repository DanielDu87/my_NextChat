import { NextRequest, NextResponse } from "next/server";
import { refreshConfiguredProviderModels } from "@/app/utils/server/provider-model-sync";
import { requireWritableSharedSyncUserId } from "@/app/utils/server/sync-user";
import { AuthError } from "@/app/utils/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isAuthorized(req: NextRequest) {
  const token = process.env.MODEL_SYNC_TOKEN;
  if (!token) {
    return process.env.NEXTCHAT_DISABLE_AUTH === "true";
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

    const body = await req.json().catch(() => ({}));
    const profileId =
      typeof body?.profileId === "string" ? body.profileId.trim() : "";
    const result = await refreshConfiguredProviderModels(
      "api",
      await requireWritableSharedSyncUserId(req),
      profileId || undefined,
    );
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status },
    );
  }
}
