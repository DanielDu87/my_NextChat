import { NextRequest, NextResponse } from "next/server";
import {
  getStoreSnapshotMeta,
  getStoreSnapshot,
  isSupportedStoreKey,
  removeStoreSnapshot,
  setStoreSnapshot,
} from "@/app/utils/server/sync-store-repository";
import { withRetryablePostgresOperation } from "@/app/utils/server/postgres";
import { resolveSyncUserId } from "@/app/utils/server/sync-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = {
  params: {
    key: string;
  };
};

export async function GET(_: NextRequest, { params }: Params) {
  try {
    if (!isSupportedStoreKey(params.key)) {
      return NextResponse.json(
        { ok: false, error: "unsupported_store_key" },
        { status: 400 },
      );
    }

    const userId = resolveSyncUserId(_);
    const payload = await withRetryablePostgresOperation(() =>
      getStoreSnapshot(params.key, userId),
    );
    if (payload === undefined) {
      return new Response("", {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
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

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    if (!isSupportedStoreKey(params.key)) {
      return NextResponse.json(
        { ok: false, error: "unsupported_store_key" },
        { status: 400 },
      );
    }

    const rawBody = await req.text();
    console.log("[DB Sync PUT] start", {
      key: params.key,
      bytes: Buffer.byteLength(rawBody, "utf8"),
    });
    const payload = JSON.parse(rawBody);
    const userId = resolveSyncUserId(req);
    const expectedUpdatedAt = req.headers.get("x-expected-updated-at") || "";
    const expectedChecksum = req.headers.get("x-expected-checksum") || "";
    const expectedMissing = req.headers.get("x-expected-missing") === "1";
    const currentMeta = await withRetryablePostgresOperation(() =>
      getStoreSnapshotMeta(params.key, userId),
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
      setStoreSnapshot(params.key, payload, userId),
    );
    console.log("[DB Sync PUT] done", {
      key: params.key,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DB Sync PUT] failed", {
      key: params.key,
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

export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    if (!isSupportedStoreKey(params.key)) {
      return NextResponse.json(
        { ok: false, error: "unsupported_store_key" },
        { status: 400 },
      );
    }

    const userId = resolveSyncUserId(_);
    await withRetryablePostgresOperation(() =>
      removeStoreSnapshot(params.key, userId),
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
