import { NextRequest, NextResponse } from "next/server";
import {
  applyChatDelta,
  getChatIndexSnapshot,
} from "@/app/utils/server/sync-store-repository";
import { withRetryablePostgresOperation } from "@/app/utils/server/postgres";
import { resolveSyncUserId } from "@/app/utils/server/sync-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const userId = resolveSyncUserId(req);
    const index = await withRetryablePostgresOperation(() =>
      getChatIndexSnapshot(userId),
    );

    return NextResponse.json({
      ok: true,
      index: index ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: true,
        index: null,
        degraded: true,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const userId = resolveSyncUserId(req);
    const payload = (await req.json()) as {
      index?: any;
      upsertSessions?: Array<Record<string, unknown>>;
      deleteSessionIds?: string[];
    };

    if (!payload?.index || !Array.isArray(payload.upsertSessions)) {
      return NextResponse.json(
        { ok: false, error: "invalid_chat_delta_payload" },
        { status: 400 },
      );
    }

    await withRetryablePostgresOperation(() =>
      applyChatDelta({
        userId,
        index: payload.index,
        upsertSessions: payload.upsertSessions || [],
        deleteSessionIds: Array.isArray(payload.deleteSessionIds)
          ? payload.deleteSessionIds
          : [],
      }),
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DB Chat Sync PUT] failed", {
      error:
        error instanceof Error ? error.stack || error.message : String(error),
    });
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
