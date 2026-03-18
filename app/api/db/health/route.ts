import { NextResponse } from "next/server";
import { pgHealthcheck, pgQuery } from "../../../utils/server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const [health, modelCount] = await Promise.all([
      pgHealthcheck(),
      pgQuery<{ count: string }>(
        "select count(*)::text as count from model_catalog",
      ),
    ]);

    return NextResponse.json({
      ok: true,
      postgres: health,
      modelCatalogCount: Number(modelCount.rows[0]?.count ?? 0),
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
