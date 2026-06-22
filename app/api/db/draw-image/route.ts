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

const DRAW_THUMB_MAX_SIZE = 80 * 1024;

async function compressImageToThumb(buffer: Buffer): Promise<string> {
  const sharp = (await import("sharp")).default;

  let result = await sharp(buffer)
    .resize(400, undefined, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  if (result.length <= DRAW_THUMB_MAX_SIZE) {
    return `data:image/jpeg;base64,${result.toString("base64")}`;
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

  return `data:image/jpeg;base64,${thumb.toString("base64")}`;
}

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

    // 方式一：上传 base64 data URL
    const dataUrl = String(payload?.dataUrl || "");
    if (dataUrl) {
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
      // 生成缩略图
      let thumbData = "";
      try {
        thumbData = await compressImageToThumb(parsed.data);
      } catch (e) {
        // 缩略图生成失败不阻塞主流程
      }
      return NextResponse.json({
        ok: true,
        id,
        url: `/api/db/draw-image/${id}`,
        ...(thumbData ? { thumb_data: thumbData } : {}),
      });
    }

    // 方式二：从外部 URL 下载并存储
    const externalUrl = String(payload?.url || "");
    if (externalUrl) {
      const response = await fetch(externalUrl, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        return NextResponse.json(
          { ok: false, error: `download_failed_${response.status}` },
          { status: 502 },
        );
      }
      const contentType =
        response.headers.get("content-type") || "application/octet-stream";
      const arrayBuffer = await response.arrayBuffer();
      const data = Buffer.from(arrayBuffer);

      if (data.length > 15 * 1024 * 1024) {
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
        createDrawImage(externalUserId, { contentType, data }),
      );
      if (!id) {
        return NextResponse.json(
          { ok: false, error: "upload_failed" },
          { status: 500 },
        );
      }
      // 生成缩略图
      let thumbData = "";
      try {
        thumbData = await compressImageToThumb(data);
      } catch (e) {
        // 缩略图生成失败不阻塞主流程
      }
      return NextResponse.json({
        ok: true,
        id,
        url: `/api/db/draw-image/${id}`,
        ...(thumbData ? { thumb_data: thumbData } : {}),
      });
    }

    // 没有提供 dataUrl 也没有 url
    return NextResponse.json(
      { ok: false, error: "missing_data_url_or_url" },
      { status: 400 },
    );
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
