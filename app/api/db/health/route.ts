import { NextResponse } from "next/server";
import { pgHealthcheck } from "../../../utils/server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const health = await pgHealthcheck();

    return NextResponse.json({
      ok: true,
      postgres: health,
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
