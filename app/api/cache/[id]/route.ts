import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import { AuthError } from "@/app/utils/server/auth";
import {
  isPostgresTemporarilyUnavailableError,
  withRetryablePostgresOperation,
} from "@/app/utils/server/postgres";
import { resolveStoreSyncUserId } from "@/app/utils/server/sync-user";
import {
  getCacheFileById,
  getCacheFile,
  getCacheFileChunk,
  getCacheFileChunkById,
  getCacheFileMeta,
  getCacheFileMetaById,
  removeOwnedCacheFile,
  removeCacheFile,
  purgeExpiredCacheFiles,
} from "@/app/utils/server/cache-file-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function extractUuid(id: string) {
  const base = String(id || "")
    .split("?")[0]
    .split("#")[0];
  return base.split(".")[0];
}

function getInlineContentType(
  fileName: string,
  fileExt: string,
  contentType: string,
) {
  const normalizedType = String(contentType || "").toLowerCase();
  if (normalizedType && normalizedType !== "application/octet-stream") {
    return normalizedType;
  }

  const normalizedName = `${fileName || ""}${fileExt || ""}`.toLowerCase();
  if (normalizedName.endsWith(".pdf")) return "application/pdf";
  if (/\.(png)$/i.test(normalizedName)) return "image/png";
  if (/\.(jpe?g)$/i.test(normalizedName)) return "image/jpeg";
  if (/\.(webp)$/i.test(normalizedName)) return "image/webp";
  if (/\.(gif)$/i.test(normalizedName)) return "image/gif";
  if (/\.(svg)$/i.test(normalizedName)) return "image/svg+xml";
  if (/\.(txt|md|log)$/i.test(normalizedName))
    return "text/plain; charset=utf-8";
  if (/\.(json)$/i.test(normalizedName))
    return "application/json; charset=utf-8";
  if (/\.(csv)$/i.test(normalizedName)) return "text/csv; charset=utf-8";
  if (/\.(tsv)$/i.test(normalizedName)) {
    return "text/tab-separated-values; charset=utf-8";
  }
  if (/\.(docx)$/i.test(normalizedName)) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (/\.(xlsx)$/i.test(normalizedName)) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "application/octet-stream";
}

function parseRangeHeader(rangeHeader: string | null, sizeBytes: number) {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    return null;
  }

  const [rawStart, rawEnd] = rangeHeader.replace(/^bytes=/, "").split("-", 2);
  const hasStart = rawStart !== undefined && rawStart.trim() !== "";
  const hasEnd = rawEnd !== undefined && rawEnd.trim() !== "";

  if (!hasStart && !hasEnd) {
    return null;
  }

  let start = hasStart ? Number(rawStart) : 0;
  let end = hasEnd ? Number(rawEnd) : sizeBytes - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }

  if (!hasStart && hasEnd) {
    const suffixLength = Math.max(0, Math.floor(end));
    if (suffixLength <= 0) {
      return null;
    }
    start = Math.max(0, sizeBytes - suffixLength);
    end = sizeBytes - 1;
  }

  start = Math.max(0, Math.floor(start));
  end = Math.min(sizeBytes - 1, Math.floor(end));

  if (start > end || start >= sizeBytes) {
    return { invalid: true as const, start, end };
  }

  return { start, end, invalid: false as const };
}

function buildInlineHeaders(file: {
  fileName: string;
  fileExt: string;
  contentType: string;
  sizeBytes: number;
}) {
  return {
    "Content-Type": getInlineContentType(
      file.fileName,
      file.fileExt,
      file.contentType,
    ),
    "Cache-Control": "no-store, no-transform",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(
      file.fileName || "file",
    )}`,
    "Accept-Ranges": "bytes",
    "Content-Length": String(file.sizeBytes),
  };
}

async function resolveCacheFileMetaForRequest(
  externalUserId: string,
  uuid: string,
) {
  return (
    (await withRetryablePostgresOperation(() =>
      getCacheFileMeta(externalUserId, uuid),
    )) ||
    (await withRetryablePostgresOperation(() => getCacheFileMetaById(uuid)))
  );
}

async function resolveCacheFileChunkForRequest(
  externalUserId: string,
  uuid: string,
  offset: number,
  length: number,
) {
  return (
    (await withRetryablePostgresOperation(() =>
      getCacheFileChunk(externalUserId, uuid, offset, length),
    )) ||
    (await withRetryablePostgresOperation(() =>
      getCacheFileChunkById(uuid, offset, length),
    ))
  );
}

export async function HEAD(
  req: NextRequest,
  context: { params: { id: string } },
) {
  try {
    const rawId = decodeURIComponent(context.params.id || "");
    const uuid = extractUuid(rawId);
    const externalUserId = await resolveStoreSyncUserId(StoreKey.Chat, req);

    await withRetryablePostgresOperation(() =>
      purgeExpiredCacheFiles(externalUserId),
    );
    const file = await resolveCacheFileMetaForRequest(externalUserId, uuid);
    if (!file) {
      return new NextResponse(null, { status: 404 });
    }

    return new NextResponse(null, {
      status: 200,
      headers: buildInlineHeaders(file),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return new NextResponse(null, { status: error.status });
    }
    if (isPostgresTemporarilyUnavailableError(error)) {
      return new NextResponse(null, { status: 503 });
    }
    return new NextResponse(null, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  context: { params: { id: string } },
) {
  try {
    const rawId = decodeURIComponent(context.params.id || "");
    const uuid = extractUuid(rawId);
    const externalUserId = await resolveStoreSyncUserId(StoreKey.Chat, req);

    await withRetryablePostgresOperation(() =>
      purgeExpiredCacheFiles(externalUserId),
    );
    const fileMeta = await resolveCacheFileMetaForRequest(externalUserId, uuid);
    if (!fileMeta) {
      return NextResponse.json({ code: 1, msg: "not_found" }, { status: 404 });
    }

    const range = parseRangeHeader(
      req.headers.get("range"),
      fileMeta.sizeBytes,
    );
    if (range?.invalid) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          ...buildInlineHeaders(fileMeta),
          "Content-Range": `bytes */${fileMeta.sizeBytes}`,
        },
      });
    }

    if (!range) {
      const file =
        (await withRetryablePostgresOperation(() =>
          getCacheFile(externalUserId, uuid),
        )) ||
        (await withRetryablePostgresOperation(() => getCacheFileById(uuid)));
      if (!file) {
        return NextResponse.json(
          { code: 1, msg: "not_found" },
          { status: 404 },
        );
      }

      return new NextResponse(file.data, {
        status: 200,
        headers: buildInlineHeaders(file),
      });
    }

    const length = range.end - range.start + 1;
    const fileChunk = await resolveCacheFileChunkForRequest(
      externalUserId,
      uuid,
      range.start,
      length,
    );
    if (!fileChunk) {
      return NextResponse.json({ code: 1, msg: "not_found" }, { status: 404 });
    }

    return new NextResponse(fileChunk.data, {
      status: 206,
      headers: {
        ...buildInlineHeaders(fileChunk),
        "Content-Length": String(fileChunk.data.length || length),
        "Content-Range": `bytes ${range.start}-${
          range.start + Math.max(fileChunk.data.length - 1, 0)
        }/${fileChunk.sizeBytes}`,
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { code: 1, msg: error.message },
        { status: error.status },
      );
    }
    if (isPostgresTemporarilyUnavailableError(error)) {
      return NextResponse.json(
        { code: 1, msg: "postgres_temporarily_unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { code: 1, msg: String(error || "unknown_error") },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: { id: string } },
) {
  try {
    const rawId = decodeURIComponent(context.params.id || "");
    const uuid = extractUuid(rawId);
    const externalUserId = await resolveStoreSyncUserId(StoreKey.Chat, req);
    const force = req.nextUrl.searchParams.get("force") === "1";
    const excludeExternalSessionIds = req.nextUrl.searchParams
      .getAll("excludeSessionId")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 200);
    await withRetryablePostgresOperation(() =>
      purgeExpiredCacheFiles(externalUserId),
    );
    await withRetryablePostgresOperation(() =>
      force
        ? removeOwnedCacheFile(externalUserId, uuid, {
            excludeExternalSessionIds,
          })
        : removeCacheFile(externalUserId, uuid),
    );
    return NextResponse.json({ code: 0 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { code: 1, msg: error.message },
        { status: error.status },
      );
    }
    if (isPostgresTemporarilyUnavailableError(error)) {
      return NextResponse.json(
        { code: 1, msg: "postgres_temporarily_unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { code: 1, msg: String(error || "unknown_error") },
      { status: 500 },
    );
  }
}
