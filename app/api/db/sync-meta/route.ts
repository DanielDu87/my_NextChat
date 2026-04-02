import { NextRequest, NextResponse } from "next/server";
import { getStoreSnapshotMetas } from "@/app/utils/server/sync-store-repository";
import { PERSIST_STORE_KEYS } from "@/app/utils/sync-store-keys";
import {
  isSharedSyncStoreKey,
  resolveSharedSyncUserId,
  resolveSyncUserId,
} from "@/app/utils/server/sync-user";
import { AuthError } from "@/app/utils/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const rawKeys = req.nextUrl.searchParams.getAll("key");
    const keys = rawKeys.length > 0 ? rawKeys : [...PERSIST_STORE_KEYS];
    const sharedKeys = keys.filter(isSharedSyncStoreKey);
    const userKeys = keys.filter((key) => !isSharedSyncStoreKey(key));
    const metas = [
      ...(userKeys.length > 0
        ? await getStoreSnapshotMetas(userKeys, await resolveSyncUserId(req))
        : []),
      ...(sharedKeys.length > 0
        ? await getStoreSnapshotMetas(
            sharedKeys,
            await resolveSharedSyncUserId(req),
          )
        : []),
    ];

    return NextResponse.json({
      ok: true,
      metas,
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
