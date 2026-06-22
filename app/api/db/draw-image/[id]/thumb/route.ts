import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import {
  getDrawImageWithThumb,
  updateDrawImageThumb,
} from "@/app/utils/server/draw-image-repository";
import {
  isPostgresTemporarilyUnavailableError,
  withRetryablePostgresOperation,
} from "@/app/utils/server/postgres";
import { AuthError } from "@/app/utils/server/auth";
import { resolveStoreSyncUserId } from "@/app/utils/server/sync-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DRAW_THUMB_MAX_SIZE = 80 * 1024;

async function generateThumbnail(buffer: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;

  let result = await sharp(buffer)
    .resize(400, undefined, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  if (result.length <= DRAW_THUMB_MAX_SIZE) {
    return result;
  }

  let quality = 80;
  let width = 400;
  let thumb = result;

  while (thumb.length > DRAW_THUMB_MAX_SIZE && quality > 10) {
    quality -= 10;
    thumb = await sharp(buffer)
      .resize(width, undefined, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();

    if (thumb.length > DRAW_THUMB_MAX_SIZE && width > 100) {
      width = Math.round(width * 0.7);
      quality = 80;
    }
  }

  return thumb;
}

type Params = {
  params: {
    id: string;
  };
};

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const externalUserId = await resolveStoreSyncUserId(StoreKey.DrawList, req);
    const record = await withRetryablePostgresOperation(() =>
      getDrawImageWithThumb(externalUserId, params.id),
    );
    if (!record) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 },
      );
    }

    // 如果已有缩略图，直接返回
    if (record.thumbData) {
      return new Response(record.thumbData, {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      });
    }

    // 没有缩略图，从原图生成
    const thumbBuffer = await generateThumbnail(record.data);

    // 异步保存缩略图到数据库（不阻塞响应）
    withRetryablePostgresOperation(() =>
      updateDrawImageThumb(externalUserId, params.id, thumbBuffer),
    ).catch(() => {
      // 保存失败不影响预览响应
    });

    return new Response(thumbBuffer, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
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
