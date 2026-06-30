import { NextRequest, NextResponse } from "next/server";
import { PERSIST_STORE_KEYS } from "@/app/utils/sync-store-keys";
import {
  isSharedSyncStoreKey,
  resolveSharedSyncUserId,
  resolveSyncUserId,
} from "@/app/utils/server/sync-user";
import { AuthError } from "@/app/utils/server/auth";
import { loadStoreSnapshotMetasSafely } from "@/app/utils/server/sync-meta-loader";
import { isPostgresTemporarilyUnavailableError } from "@/app/utils/server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SYNC_META_READ_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.DB_SYNC_META_READ_TIMEOUT_MS ?? "4500"),
);

function readMetasWithStartupTimeout(keys: string[], userId: string) {
  if (keys.length === 0) {
    return Promise.resolve([]);
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<[]>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(
        `[DB Sync Meta] 元数据读取超过 ${SYNC_META_READ_TIMEOUT_MS}ms，启动阶段先返回空结果: ${keys.join(
          ", ",
        )}`,
      );
      resolve([]);
    }, SYNC_META_READ_TIMEOUT_MS);
  });

  return Promise.race([
    loadStoreSnapshotMetasSafely(keys, userId).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }),
    timeoutPromise,
  ]);
}

export async function GET(req: NextRequest) {
  try {
    const rawKeys = req.nextUrl.searchParams.getAll("key");
    const keys = rawKeys.length > 0 ? rawKeys : [...PERSIST_STORE_KEYS];
    const sharedKeys = keys.filter(isSharedSyncStoreKey);
    const userKeys = keys.filter((key) => !isSharedSyncStoreKey(key));
    const [userMetas, sharedMetas] = await Promise.all([
      userKeys.length > 0
        ? readMetasWithStartupTimeout(userKeys, await resolveSyncUserId(req))
        : Promise.resolve([]),
      sharedKeys.length > 0
        ? readMetasWithStartupTimeout(
            sharedKeys,
            await resolveSharedSyncUserId(req),
          )
        : Promise.resolve([]),
    ]);
    const metas = [...userMetas, ...sharedMetas];

    return NextResponse.json({
      ok: true,
      metas,
    });
  } catch (error) {
    if (isPostgresTemporarilyUnavailableError(error)) {
      return NextResponse.json(
        {
          ok: true,
          metas: [],
          degraded: true,
        },
        {
          headers: {
            "Cache-Control": "no-store",
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
