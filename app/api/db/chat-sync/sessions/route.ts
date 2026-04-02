import { NextRequest, NextResponse } from "next/server";
import { withRetryablePostgresOperation } from "@/app/utils/server/postgres";
import { getChatSessionSnapshots } from "@/app/utils/server/sync-store-repository";
import { resolveSyncUserId } from "@/app/utils/server/sync-user";
import { AuthError } from "@/app/utils/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveSyncUserId(req);
    const payload = (await req.json()) as {
      ids?: string[];
    };
    const ids = Array.isArray(payload?.ids) ? payload.ids : [];

    const sessions = await withRetryablePostgresOperation(() =>
      getChatSessionSnapshots(ids, userId),
    );

    return NextResponse.json({
      ok: true,
      sessions,
    });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return NextResponse.json(
      {
        ok: true,
        sessions: {},
        degraded: true,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
