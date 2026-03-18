import { NextRequest, NextResponse } from "next/server";
import { withRetryablePostgresOperation } from "@/app/utils/server/postgres";
import { getChatSessionSnapshots } from "@/app/utils/server/sync-store-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as {
      ids?: string[];
    };
    const ids = Array.isArray(payload?.ids) ? payload.ids : [];

    const sessions = await withRetryablePostgresOperation(() =>
      getChatSessionSnapshots(ids),
    );

    return NextResponse.json({
      ok: true,
      sessions,
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
