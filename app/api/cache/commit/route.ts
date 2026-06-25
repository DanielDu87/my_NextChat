import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import { AuthError } from "@/app/utils/server/auth";
import { requireWritableStoreSyncUserId } from "@/app/utils/server/sync-user";
import {
  isPostgresTemporarilyUnavailableError,
  withRetryablePostgresOperation,
} from "@/app/utils/server/postgres";
import {
  commitCacheFiles,
  purgeExpiredCacheFiles,
} from "@/app/utils/server/cache-file-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function extractUuid(id: string) {
  const base = String(id || "")
    .split("?")[0]
    .split("#")[0];
  return base.split(".")[0];
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const ids = Array.isArray(body?.ids) ? (body.ids as string[]) : [];
    const cleaned = ids
      .map((item) => extractUuid(String(item || "")))
      .filter(Boolean)
      .slice(0, 200);
    if (cleaned.length === 0) {
      return NextResponse.json({ code: 0, data: { committed: 0 } });
    }

    const externalUserId = await requireWritableStoreSyncUserId(
      StoreKey.Chat,
      req,
    );
    await withRetryablePostgresOperation(() =>
      purgeExpiredCacheFiles(externalUserId),
    );
    await withRetryablePostgresOperation(() =>
      commitCacheFiles(externalUserId, cleaned),
    );
    return NextResponse.json({ code: 0, data: { committed: cleaned.length } });
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
