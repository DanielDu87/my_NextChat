import { NextResponse } from "next/server";
import { ensureSyncStorageSchema } from "@/app/utils/server/postgres";
import {
  getLatestModelRefreshState,
  removeLatestModelRefreshState,
} from "@/app/utils/server/model-refresh-state-repository";
import { resolveSyncUserId } from "@/app/utils/server/sync-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type LatestModelRefreshRow = {
  payload_json: {
    finishedAt?: string;
    providers?: Array<{
      profileId?: string;
      profileName?: string;
      provider?: string;
      providerId?: string;
      fetchedCount?: number;
      updatedAt?: string;
    }>;
    [key: string]: unknown;
  } | null;
  updated_at: string;
};

export async function GET(request: Request) {
  try {
    await ensureSyncStorageSchema();
    const userId = resolveSyncUserId(new Headers(request.headers));
    const row = (await getLatestModelRefreshState(
      userId,
    )) as LatestModelRefreshRow | null;
    const payload = row?.payload_json ?? null;

    return NextResponse.json(
      {
        ok: true,
        latest: payload
          ? {
              ...payload,
              updatedAt: row?.updated_at,
            }
          : null,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: true,
        latest: null,
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

export async function DELETE(request: Request) {
  try {
    await ensureSyncStorageSchema();
    const userId = resolveSyncUserId(new Headers(request.headers));
    await removeLatestModelRefreshState(userId);

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
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
