import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { StoreKey } from "@/app/constant";
import {
  getSafeAttachmentContentType,
  isSafeImageAttachment,
} from "@/app/utils/attachment-file";
import { AuthError } from "@/app/utils/server/auth";
import {
  getCacheFile,
  getCacheFileById,
} from "@/app/utils/server/cache-file-repository";
import {
  isPostgresTemporarilyUnavailableError,
  withRetryablePostgresOperation,
} from "@/app/utils/server/postgres";
import { requireWritableStoreSyncUserId } from "@/app/utils/server/sync-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_FILES_PER_REQUEST = 3;
const MAX_PDF_PAGES = 9;
const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;
const TOTAL_RENDER_TIMEOUT_MS = 45_000;

type VisualizedFile = {
  id: string;
  pages: string[];
  totalPages: number;
  renderedPages: number;
  truncated: boolean;
  reason?:
    "page_limit" | "time_limit" | "render_failed" | "not_found" | "unsupported";
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isPdf(fileName: string) {
  return String(fileName || "")
    .trim()
    .toLowerCase()
    .endsWith(".pdf");
}

async function getReadableCacheFile(externalUserId: string, id: string) {
  return (
    (await withRetryablePostgresOperation(() =>
      getCacheFile(externalUserId, id),
    )) ||
    (await withRetryablePostgresOperation(() =>
      getCacheFileById(externalUserId, id),
    ))
  );
}

async function getPdfPageCount(data: Buffer) {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ]);
  (
    globalThis as typeof globalThis & {
      pdfjsWorker?: typeof worker;
    }
  ).pdfjsWorker = worker;
  const document = await pdfjs.getDocument({
    data: new Uint8Array(data),
  }).promise;
  try {
    return document.numPages;
  } finally {
    await document.destroy();
  }
}

async function renderPdfPage(data: Buffer, pageNumber: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      "gs",
      [
        "-q",
        "-dSAFER",
        "-dBATCH",
        "-dNOPAUSE",
        "-r150",
        "-sDEVICE=jpeg",
        "-dJPEGQ=85",
        `-dFirstPage=${pageNumber}`,
        `-dLastPage=${pageNumber}`,
        "-sOutputFile=-",
        "-",
      ],
      { cwd: "/tmp", stdio: ["pipe", "pipe", "pipe"] },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (error?: Error, output?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(output || Buffer.alloc(0));
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error("pdf_visual_render_timeout"));
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      const output = Buffer.from(chunk);
      outputBytes += output.length;
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        child.kill();
        finish(new Error("pdf_visual_render_output_too_large"));
        return;
      }
      stdout.push(output);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) {
        finish(undefined, Buffer.concat(stdout));
        return;
      }
      finish(
        new Error(
          `pdf_visual_render_failed:${Buffer.concat(stderr).toString("utf8").slice(0, 160)}`,
        ),
      );
    });
    child.stdin.end(data);
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const rawIds: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
    const ids = Array.from(
      new Set(
        rawIds
          .map((value: unknown) => String(value || "").trim())
          .filter(isUuid),
      ),
    ).slice(0, MAX_FILES_PER_REQUEST);
    if (ids.length === 0) {
      return NextResponse.json(
        { code: 1, msg: "invalid_file_ids" },
        { status: 400 },
      );
    }

    const externalUserId = await requireWritableStoreSyncUserId(
      StoreKey.Chat,
      req,
    );
    const files: VisualizedFile[] = [];
    const startedAt = Date.now();

    for (const id of ids) {
      if (Date.now() - startedAt >= TOTAL_RENDER_TIMEOUT_MS) {
        files.push({
          id,
          pages: [],
          totalPages: 0,
          renderedPages: 0,
          truncated: true,
          reason: "time_limit",
        });
        continue;
      }
      const file = await getReadableCacheFile(externalUserId, id);
      if (!file || file.data.length > MAX_INPUT_BYTES) {
        files.push({
          id,
          pages: [],
          totalPages: 0,
          renderedPages: 0,
          truncated: false,
          reason: file ? "render_failed" : "not_found",
        });
        continue;
      }

      if (isSafeImageAttachment(file.fileName)) {
        files.push({
          id,
          pages: [
            `data:${getSafeAttachmentContentType(file.fileName)};base64,${file.data.toString("base64")}`,
          ],
          totalPages: 1,
          renderedPages: 1,
          truncated: false,
        });
        continue;
      }

      if (!isPdf(file.fileName)) {
        files.push({
          id,
          pages: [],
          totalPages: 0,
          renderedPages: 0,
          truncated: false,
          reason: "unsupported",
        });
        continue;
      }

      try {
        const pageCount = await getPdfPageCount(file.data);
        const pages: string[] = [];
        let truncated = pageCount > MAX_PDF_PAGES;
        let reason: VisualizedFile["reason"] = truncated
          ? "page_limit"
          : undefined;
        for (
          let pageNumber = 1;
          pageNumber <= Math.min(pageCount, MAX_PDF_PAGES);
          pageNumber += 1
        ) {
          if (Date.now() - startedAt >= TOTAL_RENDER_TIMEOUT_MS) {
            truncated = true;
            reason = "time_limit";
            break;
          }
          try {
            const image = await renderPdfPage(file.data, pageNumber);
            if (image.length > 0) {
              pages.push(`data:image/jpeg;base64,${image.toString("base64")}`);
            }
          } catch {
            truncated = true;
            reason = "render_failed";
            break;
          }
        }
        if (pages.length === 0 && pageCount > 0) {
          truncated = true;
          reason ||= "render_failed";
        }
        files.push({
          id,
          pages,
          totalPages: pageCount,
          renderedPages: pages.length,
          truncated,
          ...(reason ? { reason } : {}),
        });
      } catch {
        files.push({
          id,
          pages: [],
          totalPages: 0,
          renderedPages: 0,
          truncated: false,
          reason: "render_failed",
        });
      }
    }

    return NextResponse.json({ code: 0, data: { files } });
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
      { code: 1, msg: "visualize_failed" },
      { status: 500 },
    );
  }
}
