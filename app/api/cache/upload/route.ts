import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import { AuthError } from "@/app/utils/server/auth";
import { requireWritableStoreSyncUserId } from "@/app/utils/server/sync-user";
import fs from "node:fs";
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

export async function POST(req: NextRequest) {
  const traceId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // #region debug-point Z:reporter
  const report = (
    hypothesisId: string,
    msg: string,
    data?: Record<string, unknown>,
  ) => {
    try {
      const envPath = ".dbg/cache-upload-500.env";
      let debugServerUrl = process.env.DEBUG_SERVER_URL || "";
      let debugSessionId = process.env.DEBUG_SESSION_ID || "cache-upload-500";
      try {
        const envContent = fs.readFileSync(envPath, "utf8");
        debugServerUrl =
          envContent.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() ||
          debugServerUrl;
        debugSessionId =
          envContent.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() ||
          debugSessionId;
      } catch {}

      debugServerUrl = debugServerUrl
        .replace("http://127.0.0.1", "http://host.docker.internal")
        .replace("http://localhost", "http://host.docker.internal");

      if (!debugServerUrl) {
        return;
      }

      fetch(debugServerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: debugSessionId,
          runId: "pre-fix",
          hypothesisId,
          traceId,
          location: "app/api/cache/upload/route.ts",
          msg: `[DEBUG] ${msg}`,
          data: data ?? {},
          ts: Date.now(),
        }),
      }).catch(() => {});
    } catch {}
  };
  // #endregion

  try {
    report("A", "upload_request_start", {
      runtime: process.env.NEXT_RUNTIME || "",
    });

    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      report("D", "missing_file", {});
      return NextResponse.json(
        { code: 1, msg: "missing_file" },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > 30 * 1024 * 1024) {
      report("D", "payload_too_large", {
        sizeBytes: buffer.length,
      });
      return NextResponse.json(
        { code: 1, msg: "payload_too_large" },
        { status: 413 },
      );
    }

    report("D", "parsed_form_data", {
      sizeBytes: buffer.length,
      contentType: (file as File).type || "",
      hasName: Boolean((file as File).name),
    });

    const externalUserId = await requireWritableStoreSyncUserId(
      StoreKey.Chat,
      req,
    );

    report("A", "resolved_external_user", {
      externalUserIdPrefix: String(externalUserId).slice(0, 24),
    });

    const purgeStartAt = Date.now();
    await withRetryablePostgresOperation(() =>
      purgeExpiredCacheFiles(externalUserId),
    );
    report("E", "purge_expired_done", {
      elapsedMs: Date.now() - purgeStartAt,
    });

    const createStartAt = Date.now();
    const created = await withRetryablePostgresOperation(() =>
      createCacheFile(externalUserId, {
        fileName: (file as File).name || "file",
        contentType: (file as File).type || "application/octet-stream",
        data: buffer,
      }),
    );
    report("B", "create_cache_file_done", {
      elapsedMs: Date.now() - createStartAt,
      ok: Boolean(created),
    });

    if (!created) {
      return NextResponse.json(
        { code: 1, msg: "upload_failed" },
        { status: 500 },
      );
    }

    const url = `/api/cache/${created.id}${created.fileExt || ""}`;
    return NextResponse.json({ code: 0, data: url });
  } catch (error) {
    const maybePgError = error as any;
    report("B", "upload_error", {
      name: maybePgError?.name,
      message: String(maybePgError?.message || ""),
      code: maybePgError?.code,
      detail: maybePgError?.detail,
      routine: maybePgError?.routine,
      isAuthError: error instanceof AuthError,
      isPgTempUnavailable: isPostgresTemporarilyUnavailableError(error),
    });

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
      { code: 1, msg: String(error || "upload_failed") },
      { status: 500 },
    );
  }
}
