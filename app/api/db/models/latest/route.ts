import { NextResponse } from "next/server";
import { pgQuery } from "@/app/utils/server/postgres";

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

export async function GET() {
  try {
    const result = await pgQuery<LatestModelRefreshRow>(
      `select payload_json, updated_at::text as updated_at
       from sync_artifacts
       where artifact_type = $1 and artifact_path = $2
       limit 1`,
      ["provider_model_refresh", "latest"],
    );

    const row = result.rows[0];
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

export async function DELETE() {
  try {
    await pgQuery(
      `delete from sync_artifacts
       where artifact_type = $1 and artifact_path = $2`,
      ["provider_model_refresh", "latest"],
    );

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
