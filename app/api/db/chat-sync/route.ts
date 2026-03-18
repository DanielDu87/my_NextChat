import { NextRequest, NextResponse } from "next/server";
import {
  applyChatDelta,
  getChatIndexSnapshot,
} from "@/app/utils/server/sync-store-repository";
import { withRetryablePostgresOperation } from "@/app/utils/server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const index = await withRetryablePostgresOperation(() =>
      getChatIndexSnapshot(),
    );

    return NextResponse.json({
      ok: true,
      index: index ?? null,
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

export async function PUT(req: NextRequest) {
  try {
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
        index: payload.index,
        upsertSessions: payload.upsertSessions || [],
        deleteSessionIds: Array.isArray(payload.deleteSessionIds)
          ? payload.deleteSessionIds
          : [],
      }),
    );

    return NextResponse.json({ ok: true });
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
