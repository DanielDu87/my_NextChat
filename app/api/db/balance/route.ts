import { NextRequest, NextResponse } from "next/server";
import { isPostgresEnabled, pgQuery } from "@/app/utils/server/postgres";

const BALANCE_ARTIFACT_TYPE = "provider_balance";

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
    const result = await pgQuery<{ payload_json: unknown }>(
      `select payload_json
       from sync_artifacts
       where artifact_type = $1 and artifact_path = $2
       limit 1`,
      [BALANCE_ARTIFACT_TYPE, key],
    );

    return NextResponse.json({
      ok: true,
      snapshot: result.rows[0]?.payload_json ?? null,
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

    await pgQuery(
      `insert into sync_artifacts (artifact_type, artifact_path, payload_json)
       values ($1, $2, $3::jsonb)
       on conflict (artifact_type, artifact_path) do update set
         payload_json = excluded.payload_json,
         updated_at = now()`,
      [BALANCE_ARTIFACT_TYPE, key, JSON.stringify(payload?.snapshot ?? {})],
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
