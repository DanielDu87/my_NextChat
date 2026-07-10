import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import {
  createDrawImageWithThumb,
  updateDrawImageThumb,
} from "@/app/utils/server/draw-image-repository";
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

async function compressImageToThumbWithBuffer(buffer: Buffer): Promise<{
  data: string;
  raw: Buffer;
}> {
  const sharp = (await import("sharp")).default;

  let result = await sharp(buffer)
    .resize(400, undefined, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  if (result.length <= DRAW_THUMB_MAX_SIZE) {
    return {
      data: `data:image/jpeg;base64,${result.toString("base64")}`,
      raw: result,
    };
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

  return {
    data: `data:image/jpeg;base64,${thumb.toString("base64")}`,
    raw: thumb,
  };
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

// 仅允许 http/https scheme，并拒绝私有 IP 段、loopback、链路本地地址、云元数据，
// 防止外部 URL 触发 SSRF 攻击内网 PostgreSQL / 169.254.169.254 等敏感端点。
function isSafeExternalImageUrl(rawUrl: string): {
  ok: boolean;
  reason?: string;
} {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "scheme_not_allowed" };
  }
  const hostname = url.hostname.toLowerCase();
  // 显式拒名单：loopback / 私有网段 / 链路本地 / 云元数据 / 多播 / 未指定
  const deniedHosts = new Set([
    "localhost",
    "metadata.google.internal",
    "metadata",
  ]);
  if (deniedHosts.has(hostname)) {
    return { ok: false, reason: "host_denied" };
  }
  // IPv4 字面量检查
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(
    hostname,
  );
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    const isPrivate =
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0 ||
      a >= 224;
    if (isPrivate) {
      return { ok: false, reason: "private_ip_denied" };
    }
  }
  // IPv6 字面量或 ::1、fc00::/7、fe80::/10
  if (hostname === "::1" || hostname === "[::1]") {
    return { ok: false, reason: "loopback_denied" };
  }
  if (
    /^fc[0-9a-f]{2}:/i.test(hostname) ||
    /^fe[89ab][0-9a-f]:/i.test(hostname)
  ) {
    return { ok: false, reason: "private_ip_denied" };
  }
  return { ok: true };
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
      // 生成缩略图
      let thumbData = "";
      let thumbRaw: Buffer | null = null;
      try {
        const thumbResult = await compressImageToThumbWithBuffer(parsed.data);
        thumbData = thumbResult.data;
        thumbRaw = thumbResult.raw;
      } catch (e) {
        // 缩略图生成失败不阻塞主流程
      }

      const id = await withRetryablePostgresOperation(() =>
        createDrawImageWithThumb(externalUserId, {
          contentType: parsed.contentType,
          data: parsed.data,
          thumbData: thumbRaw,
        }),
      );
      if (!id) {
        return NextResponse.json(
          { ok: false, error: "upload_failed" },
          { status: 500 },
        );
      }
      // 上传时缩略图生成失败，后台异步重试补全
      if (!thumbRaw) {
        compressImageToThumbWithBuffer(parsed.data)
          .then(async (thumbResult) => {
            await withRetryablePostgresOperation(() =>
              updateDrawImageThumb(externalUserId, id, thumbResult.raw),
            );
          })
          .catch(() => {
            // 后台重试也失败，等 ?thumb=1 请求时兜底
          });
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
      // SSRF 防护：拒绝 loopback / 私网 / 云元数据
      const ssrfCheck = isSafeExternalImageUrl(externalUrl);
      if (!ssrfCheck.ok) {
        return NextResponse.json(
          { ok: false, error: `unsafe_url_${ssrfCheck.reason}` },
          { status: 400 },
        );
      }
      const response = await fetch(externalUrl, {
        signal: AbortSignal.timeout(30_000),
        redirect: "follow",
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
      // 生成缩略图
      let thumbData = "";
      let thumbRaw: Buffer | null = null;
      try {
        const thumbResult = await compressImageToThumbWithBuffer(data);
        thumbData = thumbResult.data;
        thumbRaw = thumbResult.raw;
      } catch (e) {
        // 缩略图生成失败不阻塞主流程
      }

      const id = await withRetryablePostgresOperation(() =>
        createDrawImageWithThumb(externalUserId, {
          contentType,
          data,
          thumbData: thumbRaw,
        }),
      );
      if (!id) {
        return NextResponse.json(
          { ok: false, error: "upload_failed" },
          { status: 500 },
        );
      }
      // 上传时缩略图生成失败，后台异步重试补全
      if (!thumbRaw) {
        compressImageToThumbWithBuffer(data)
          .then(async (thumbResult) => {
            await withRetryablePostgresOperation(() =>
              updateDrawImageThumb(externalUserId, id, thumbResult.raw),
            );
          })
          .catch(() => {
            // 后台重试也失败，等 ?thumb=1 请求时兜底
          });
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
