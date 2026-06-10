import { NextResponse } from "next/server";
import { pgHealthcheck, pgQuery } from "../../../utils/server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getModelCatalogCount() {
  try {
    const modelCount = await pgQuery<{ count: string }>(
      "select count(*)::text as count from model_catalog",
    );
    return Number(modelCount.rows[0]?.count ?? 0);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
    ) {
      return 0;
    }
    throw error;
  }
}

export async function GET() {
  try {
    const [health, modelCatalogCount] = await Promise.all([
      pgHealthcheck(),
      getModelCatalogCount(),
    ]);

    return NextResponse.json({
      ok: true,
      postgres: health,
      modelCatalogCount,
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
