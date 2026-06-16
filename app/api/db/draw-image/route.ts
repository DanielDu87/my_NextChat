import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import { createDrawImage } from "@/app/utils/server/draw-image-repository";
import {
  isPostgresTemporarilyUnavailableError,
  withRetryablePostgresOperation,
} from "@/app/utils/server/postgres";
import { AuthError } from "@/app/utils/server/auth";
import { requireWritableStoreSyncUserId } from "@/app/utils/server/sync-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseDataUrl(dataUrl: string) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.*)$/i);
  if (!match) {
    return null;
  }
  const contentType = match[1];
  const base64 = match[2].replace(/\s/g, "");
  if (!base64) {
    return null;
  }
  const data = Buffer.from(base64, "base64");
  if (data.length === 0) {
    return null;
  }
  return { contentType, data };
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => null);
    const dataUrl = String(payload?.dataUrl || "");
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) {
      return NextResponse.json(
        { ok: false, error: "invalid_data_url" },
        { status: 400 },
      );
    }
    if (parsed.data.length > 15 * 1024 * 1024) {
      return NextResponse.json(
        { ok: false, error: "payload_too_large" },
        { status: 413 },
      );
    }

    const externalUserId = await requireWritableStoreSyncUserId(
      StoreKey.DrawList,
      req,
    );
    const id = await withRetryablePostgresOperation(() =>
      createDrawImage(externalUserId, parsed),
    );
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "upload_failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      id,
      url: `/api/db/draw-image/${id}`,
    });
  } catch (error) {
    const status =
      error instanceof AuthError
        ? error.status
        : isPostgresTemporarilyUnavailableError(error)
        ? 503
        : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status },
    );
  }
}
