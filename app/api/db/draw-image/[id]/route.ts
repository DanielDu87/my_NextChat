import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import {
  getDrawImageWithThumb,
  removeDrawImage,
  updateDrawImageThumb,
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
    // 检查是否是缩略图请求
    const isThumb = req.nextUrl.searchParams.get("thumb") === "1";

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

    if (isThumb) {
      // 缩略图请求：如果有缓存缩略图直接返回，否则生成
      if (record.thumbData) {
        return new Response(record.thumbData, {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "private, max-age=31536000, immutable",
          },
        });
      }

      // 没有缓存缩略图：直接返回原图（浏览器缩放，无需等待生成），
      // 同时在后台异步生成缩略图存入数据库，下次请求直接命中缓存
      const thumbBufferPromise = generateThumbnail(record.data).then(
        (thumbBuffer) =>
          withRetryablePostgresOperation(() =>
            updateDrawImageThumb(externalUserId, params.id, thumbBuffer),
          ),
      );
      // 不 await，让缩略图生成在后台异步完成
      thumbBufferPromise.catch(() => {});

      return new Response(record.data, {
        status: 200,
        headers: {
          "Content-Type": record.contentType,
          "Cache-Control": "private, max-age=3600",
        },
      });
    }

    // 原始图片请求
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
