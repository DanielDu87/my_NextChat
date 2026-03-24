import { NextRequest, NextResponse } from "next/server";
import { isPostgresEnabled } from "@/app/utils/server/postgres";
import {
  getProviderBalanceSnapshot,
  setProviderBalanceSnapshot,
} from "@/app/utils/server/provider-balance-repository";
import { resolveSyncUserId } from "@/app/utils/server/sync-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const key = String(req.nextUrl.searchParams.get("key") || "").trim();

  if (!key) {
    return NextResponse.json(
      { ok: false, error: "missing_balance_key" },
      { status: 400 },
    );
  }

  if (!isPostgresEnabled()) {
    return NextResponse.json({ ok: true, snapshot: null });
  }

  try {
    return NextResponse.json({
      ok: true,
      snapshot: await getProviderBalanceSnapshot(resolveSyncUserId(req), key),
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

export async function PUT(req: NextRequest) {
  if (!isPostgresEnabled()) {
    return NextResponse.json({ ok: true, persisted: false });
  }

  try {
    const payload = (await req.json()) as {
      key?: string;
      snapshot?: unknown;
    };

    const key = String(payload?.key || "").trim();
    if (!key) {
      return NextResponse.json(
        { ok: false, error: "missing_balance_key" },
        { status: 400 },
      );
    }

    await setProviderBalanceSnapshot(
      resolveSyncUserId(req),
      key,
      payload?.snapshot ?? {},
    );

    return NextResponse.json({ ok: true, persisted: true });
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
