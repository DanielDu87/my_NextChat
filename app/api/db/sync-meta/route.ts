import { NextRequest, NextResponse } from "next/server";
import { getStoreSnapshotMetas } from "@/app/utils/server/sync-store-repository";
import { PERSIST_STORE_KEYS } from "@/app/utils/sync-store-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const rawKeys = req.nextUrl.searchParams.getAll("key");
    const keys = rawKeys.length > 0 ? rawKeys : [...PERSIST_STORE_KEYS];
    const metas = await getStoreSnapshotMetas(keys);

    return NextResponse.json({
      ok: true,
      metas,
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
