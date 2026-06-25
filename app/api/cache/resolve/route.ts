import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import { AuthError } from "@/app/utils/server/auth";
import { requireWritableStoreSyncUserId } from "@/app/utils/server/sync-user";
import {
  isPostgresTemporarilyUnavailableError,
  withRetryablePostgresOperation,
} from "@/app/utils/server/postgres";
import {
  purgeExpiredCacheFiles,
  resolveExistingCacheFileByHash,
} from "@/app/utils/server/cache-file-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const fileName = String(body?.fileName || "file");
    const contentType = String(
      body?.contentType || "application/octet-stream",
    ).trim();
    const contentMd5 = String(body?.contentMd5 || "")
      .trim()
      .toLowerCase();

    if (!/^[a-f0-9]{32}$/.test(contentMd5)) {
      return NextResponse.json(
        { code: 1, msg: "invalid_content_md5" },
        { status: 400 },
      );
    }

    const externalUserId = await requireWritableStoreSyncUserId(
      StoreKey.Chat,
      req,
    );
    await withRetryablePostgresOperation(() =>
      purgeExpiredCacheFiles(externalUserId),
    );
    const resolved = await withRetryablePostgresOperation(() =>
      resolveExistingCacheFileByHash(externalUserId, {
        fileName,
        contentType,
        contentMd5,
      }),
    );

    if (!resolved) {
      return NextResponse.json({
        code: 0,
        data: { hit: false, url: "" },
      });
    }

    return NextResponse.json({
      code: 0,
      data: {
        hit: true,
        url: `/api/cache/${resolved.id}${resolved.fileExt || ""}`,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { code: 1, msg: error.message },
        { status: error.status },
      );
    }
    if (isPostgresTemporarilyUnavailableError(error)) {
      return NextResponse.json(
        { code: 1, msg: "postgres_temporarily_unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { code: 1, msg: String(error || "unknown_error") },
      { status: 500 },
    );
  }
}
