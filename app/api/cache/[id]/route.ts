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
    const file =
      (await withRetryablePostgresOperation(() =>
        getCacheFile(externalUserId, uuid),
      )) ||
      (await withRetryablePostgresOperation(() => getCacheFileById(uuid)));
    if (!file) {
      return NextResponse.json({ code: 1, msg: "not_found" }, { status: 404 });
    }

    return new NextResponse(file.data, {
      status: 200,
      headers: {
        "Content-Type": getInlineContentType(
          file.fileName,
          file.fileExt,
          file.contentType,
        ),
        "Cache-Control": "no-store",
        "Content-Length": String(file.sizeBytes),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(
          file.fileName || "file",
        )}`,
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
