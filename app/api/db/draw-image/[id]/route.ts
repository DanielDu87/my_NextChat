import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import {
  getDrawImage,
  removeDrawImage,
} from "@/app/utils/server/draw-image-repository";
import {
  isPostgresTemporarilyUnavailableError,
  withRetryablePostgresOperation,
} from "@/app/utils/server/postgres";
import { AuthError } from "@/app/utils/server/auth";
import {
  requireWritableStoreSyncUserId,
  resolveStoreSyncUserId,
} from "@/app/utils/server/sync-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = {
  params: {
    id: string;
  };
};

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const externalUserId = await resolveStoreSyncUserId(StoreKey.DrawList, req);
    const record = await withRetryablePostgresOperation(() =>
      getDrawImage(externalUserId, params.id),
    );
    if (!record) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 },
      );
    }

    return new Response(record.data, {
      status: 200,
      headers: {
        "Content-Type": record.contentType,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
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

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const externalUserId = await requireWritableStoreSyncUserId(
      StoreKey.DrawList,
      req,
    );
    await withRetryablePostgresOperation(() =>
      removeDrawImage(externalUserId, params.id),
    );
    return NextResponse.json({ ok: true });
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
