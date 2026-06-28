import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import {
  getDrawImage,
  getDrawImageThumb,
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

function getImageExtFromContentType(contentType: string) {
  const normalized = String(contentType || "")
    .toLowerCase()
    .split(";")[0];
  switch (normalized) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/png":
    default:
      return "png";
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    // 检查是否是缩略图请求
    const isThumb = req.nextUrl.searchParams.get("thumb") === "1";

    const externalUserId = await resolveStoreSyncUserId(StoreKey.DrawList, req);
    if (isThumb) {
      const thumbRecord = await withRetryablePostgresOperation(() =>
        getDrawImageThumb(externalUserId, params.id),
      );
      if (!thumbRecord) {
        return NextResponse.json(
          { ok: false, error: "not_found" },
          { status: 404 },
        );
      }

      // 缩略图已缓存时不读取原图 bytea，减少 draw 页面打开时的数据库 I/O 和内存占用。
      if (thumbRecord.thumbData) {
        return new Response(thumbRecord.thumbData, {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "private, max-age=31536000, immutable",
          },
        });
      }

      const record = await withRetryablePostgresOperation(() =>
        getDrawImage(externalUserId, params.id),
      );
      if (!record) {
        return NextResponse.json(
          { ok: false, error: "not_found" },
          { status: 404 },
        );
      }

      // 首次缩略图请求同步生成并返回缩略图，避免画廊把完整原图当缩略图下载。
      const thumbBuffer = await generateThumbnail(record.data);
      await withRetryablePostgresOperation(() =>
        updateDrawImageThumb(externalUserId, params.id, thumbBuffer),
      );

      return new Response(thumbBuffer, {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, max-age=31536000, immutable",
        },
      });
    }

    const record = await withRetryablePostgresOperation(() =>
      getDrawImage(externalUserId, params.id),
    );
    if (!record) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 },
      );
    }

    const isDownload = req.nextUrl.searchParams.get("download") === "1";
    const headers: Record<string, string> = {
      "Content-Type": record.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
    };
    if (isDownload) {
      const ext = getImageExtFromContentType(record.contentType);
      headers[
        "Content-Disposition"
      ] = `attachment; filename="nextchat-draw-${params.id}.${ext}"`;
    }

    // 原始图片请求
    return new Response(record.data, {
      status: 200,
      headers,
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
