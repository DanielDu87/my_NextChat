import { NextRequest, NextResponse } from "next/server";
import { ensureSyncStorageSchema } from "@/app/utils/server/postgres";
import { setLatestModelRefreshState } from "@/app/utils/server/model-refresh-state-repository";
import { resolveSyncUserId } from "@/app/utils/server/sync-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * POST /api/db/models/count
 * 更新云端保存的模型总数
 *
 * 请求体: { count: number, providers: Array<{profileName: string, fetchedCount: number}> }
 */
export async function POST(req: NextRequest) {
  try {
    await ensureSyncStorageSchema();
    const userId = resolveSyncUserId(req);
    const body = await req.json();
    const { count, providers } = body;

    if (typeof count !== "number" || count < 0) {
      return NextResponse.json(
        { ok: false, error: "invalid_count" },
        { status: 400 },
      );
    }

    await setLatestModelRefreshState(userId, {
      modelCount: count,
      providers: providers || [],
      finishedAt: new Date().toISOString(),
      triggerSource: "manual_sync",
    });

    return NextResponse.json(
      { ok: true, count },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
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
