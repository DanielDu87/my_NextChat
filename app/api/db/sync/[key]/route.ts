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
import {
  buildApiConfigBackupPayload,
  createApiConfigBackup,
} from "@/app/utils/server/api-config-backup-repository";
import { StoreKey } from "@/app/constant";

function sanitizeErrorMessage(error: unknown): string {
  // 仅返回稳定的错误码，不透传 error.message（可能含表名/UUID/IP 等敏感信息）
  if (error instanceof AuthError) {
    return error.message;
  }
  if (isPostgresTemporarilyUnavailableError(error)) {
    return "postgres_temporarily_unavailable";
  }
  return "internal_error";
}

// 防止单次 PUT 请求占用过多内存/数据库。Access（含 apiProfiles）+ Prompt 等
// 大 store 单条 backup 可能 30+MB，限制 16MB 既能容纳正常备份又能挡住 DoS。
const MAX_PUT_BODY_BYTES = 16 * 1024 * 1024;

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
    // 数据库暂不可用时必须返回 503：空 200 会被客户端当作「远端无数据」，
    // 新设备会以默认状态初始化，存在后续覆盖真实数据的风险。客户端对 5xx 会重试。
    if (isPostgresTemporarilyUnavailableError(error)) {
      return NextResponse.json(
        { ok: false, error: "postgres_temporarily_unavailable" },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "5",
          },
        },
      );
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

    // 先鉴权并按 Content-Length 预检，再读取请求体，避免匿名请求让服务端缓冲大包。
    const userId = await requireWritableStoreSyncUserId(params.key, req);
    const declaredBytes = Number(req.headers.get("content-length") || 0);
    if (declaredBytes > MAX_PUT_BODY_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `payload_too_large_${declaredBytes}_max_${MAX_PUT_BODY_BYTES}`,
        },
        { status: 413 },
      );
    }

    const rawBody = await req.text();
    const bodyBytes = Buffer.byteLength(rawBody, "utf8");
    if (bodyBytes > MAX_PUT_BODY_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `payload_too_large_${bodyBytes}_max_${MAX_PUT_BODY_BYTES}`,
        },
        { status: 413 },
      );
    }
    console.log("[DB Sync PUT] start", {
      key: params.key,
      bytes: bodyBytes,
    });
    const payload = JSON.parse(rawBody);
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
      const backupPayload = await buildApiConfigBackupPayload(userId, payload);
      await createApiConfigBackup(userId, backupPayload, "auto").catch(
        (error) => {
          console.error("[API Config Backup] 自动备份失败", error);
        },
      );
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
        error: sanitizeErrorMessage(error),
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
