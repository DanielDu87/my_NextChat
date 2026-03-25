import { NextRequest, NextResponse } from "next/server";
import {
  applyChatDelta,
  getChatIndexSnapshot,
  getStoreSnapshotMeta,
} from "@/app/utils/server/sync-store-repository";
import { StoreKey } from "@/app/constant";
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

    const expectedUpdatedAt = req.headers.get("x-expected-updated-at") || "";
    const expectedChecksum = req.headers.get("x-expected-checksum") || "";
    const expectedMissing = req.headers.get("x-expected-missing") === "1";
    const currentMeta = await withRetryablePostgresOperation(() =>
      getStoreSnapshotMeta(StoreKey.Chat, userId),
    );
    const hasExpectation =
      expectedMissing ||
      expectedUpdatedAt.length > 0 ||
      expectedChecksum.length > 0;
    if (hasExpectation) {
      const currentUpdatedAt = currentMeta?.updatedAt || "";
      const currentChecksum = currentMeta?.checksum || "";
      const currentExists = !!currentMeta;
      const revisionMatches = expectedMissing
        ? !currentExists
        : currentExists &&
          currentUpdatedAt === expectedUpdatedAt &&
          currentChecksum === expectedChecksum;

      if (!revisionMatches) {
        return NextResponse.json(
          {
            ok: false,
            error: "snapshot_conflict",
            current: currentMeta ?? null,
          },
          { status: 409 },
        );
      }
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
