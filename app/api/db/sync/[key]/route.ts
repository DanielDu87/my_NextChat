import { NextRequest, NextResponse } from "next/server";
import {
  getStoreSnapshotMeta,
  getStoreSnapshot,
  isSupportedStoreKey,
  removeStoreSnapshot,
  setStoreSnapshot,
} from "@/app/utils/server/sync-store-repository";
import {
  isPostgresTemporarilyUnavailableError,
  withRetryablePostgresOperation,
} from "@/app/utils/server/postgres";
import {
  requireWritableStoreSyncUserId,
  resolveStoreSyncUserId,
} from "@/app/utils/server/sync-user";
import { AuthError } from "@/app/utils/server/auth";
import { createApiConfigBackup } from "@/app/utils/server/api-config-backup-repository";
import { StoreKey } from "@/app/constant";

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

    const userId = await resolveStoreSyncUserId(params.key, _);
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
    if (isPostgresTemporarilyUnavailableError(error)) {
      return new Response("", {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "X-NextChat-Degraded": "1",
        },
      });
    }
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
    const userId = await requireWritableStoreSyncUserId(params.key, req);
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
          { status: 200 },
        );
      }
    }

    await withRetryablePostgresOperation(() =>
      setStoreSnapshot(params.key, payload, userId),
    );
    if (params.key === StoreKey.Access) {
      await createApiConfigBackup(userId, payload, "auto").catch((error) => {
        console.error("[API Config Backup] 自动备份失败", error);
      });
    }
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
    const status =
      error instanceof AuthError
        ? error.status
        : isPostgresTemporarilyUnavailableError(error)
        ? 503
        : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status },
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

    const userId = await requireWritableStoreSyncUserId(params.key, _);
    await withRetryablePostgresOperation(() =>
      removeStoreSnapshot(params.key, userId),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status =
      error instanceof AuthError
        ? error.status
        : isPostgresTemporarilyUnavailableError(error)
        ? 503
        : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status },
    );
  }
}
