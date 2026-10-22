import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import { AuthError } from "@/app/utils/server/auth";
import { requireWritableStoreSyncUserId } from "@/app/utils/server/sync-user";
import {
  isPostgresTemporarilyUnavailableError,
  withRetryablePostgresOperation,
} from "@/app/utils/server/postgres";
import {
  createCacheFile,
  purgeExpiredCacheFiles,
} from "@/app/utils/server/cache-file-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
// multipart 边界与字段头会让 Content-Length 略大于文件本身，预检时留出余量。
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  try {
    // 先鉴权并按 Content-Length 预检，再解析表单，避免匿名请求让服务端缓冲大文件。
    const externalUserId = await requireWritableStoreSyncUserId(
      StoreKey.Chat,
      req,
    );
    const declaredBytes = Number(req.headers.get("content-length") || 0);
    if (declaredBytes > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
      return NextResponse.json(
        { code: 1, msg: "payload_too_large" },
        { status: 413 },
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json(
        { code: 1, msg: "missing_file" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { code: 1, msg: "payload_too_large" },
        { status: 413 },
      );
    }

    await withRetryablePostgresOperation(() =>
      purgeExpiredCacheFiles(externalUserId),
    );

    const created = await withRetryablePostgresOperation(() =>
      createCacheFile(externalUserId, {
        fileName: (file as File).name || "file",
        contentType: (file as File).type || "application/octet-stream",
        data: buffer,
      }),
    );

    if (!created) {
      return NextResponse.json(
        { code: 1, msg: "upload_failed" },
        { status: 500 },
      );
    }

    const url = `/api/cache/${created.id}${created.fileExt || ""}`;
    return NextResponse.json({ code: 0, data: url });
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
    console.error("[Cache Upload] 上传失败", error);
    return NextResponse.json(
      { code: 1, msg: "upload_failed" },
      { status: 500 },
    );
  }
}
