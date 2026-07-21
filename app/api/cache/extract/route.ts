import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import {
  getExtractableAttachmentKind,
  isPlainTextAttachment,
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

const MAX_FILES_PER_REQUEST = 9;
const MAX_EXTRACTED_CHARS_PER_FILE = 24_000;
const MAX_PDF_PAGES = 80;
const MIN_PDF_TEXT_CHARS_FOR_TEXT_MODE = 120;
const MAX_SPREADSHEET_SHEETS = 10;
const MAX_SPREADSHEET_ROWS = 1_000;

type ExtractionResult = {
  id: string;
  status: "ready" | "partial" | "metadata" | "failed";
  text: string;
  truncated: boolean;
  mode: "document" | "text" | "binary" | "metadata";
  summary: string;
  visualFallback?: boolean;
  reason?: string;
};

type ExtractedFileText = {
  text: string;
  truncated: boolean;
  mode?: ExtractionResult["mode"];
  visualFallback?: boolean;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizeExtractedText(value: unknown) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function limitText(value: string) {
  const text = normalizeExtractedText(value);
  if (text.length <= MAX_EXTRACTED_CHARS_PER_FILE) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(0, MAX_EXTRACTED_CHARS_PER_FILE).trimEnd(),
    truncated: true,
  };
}

function buildFileSummary(
  fileName: string,
  contentType: string,
  sizeBytes: number,
) {
  return [
    `文件名：${fileName || "未命名文件"}`,
    `类型：${contentType || "application/octet-stream"}`,
    `大小：${Math.max(0, Number(sizeBytes) || 0)} 字节`,
  ].join("；");
}

function decodePlainText(data: Buffer) {
  const utf16Encoding =
    data[0] === 0xff && data[1] === 0xfe
      ? "utf-16le"
      : data[0] === 0xfe && data[1] === 0xff
        ? "utf-16be"
        : "utf-8";
  try {
    return new TextDecoder(utf16Encoding, { fatal: true }).decode(data);
  } catch {
    // Some legacy logs/configs are not valid UTF-8. Decode lossily rather
    // than rejecting an otherwise readable user-provided text file.
    return new TextDecoder(utf16Encoding).decode(data);
  }
}

function extractPrintableBinaryText(data: Buffer) {
  const snippets =
    data
      .toString("latin1")
      .match(/[\x20-\x7e]{4,}/g)
      ?.slice(0, 300) || [];
  return limitText(snippets.join("\n"));
}

async function extractPdfText(data: Buffer) {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ]);
  // Next bundles the main PDF.js module separately, so its default relative
  // fake-worker import cannot find the worker chunk at runtime.
  (
    globalThis as typeof globalThis & {
      pdfjsWorker?: typeof worker;
    }
  ).pdfjsWorker = worker;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
  });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  let truncated = pageCount > MAX_PDF_PAGES;
  let output = "";

  try {
    for (
      let pageNumber = 1;
      pageNumber <= Math.min(pageCount, MAX_PDF_PAGES);
      pageNumber += 1
    ) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      const limited = limitText(
        `${output}\n\n[第 ${pageNumber} 页]\n${pageText}`,
      );
      output = limited.text;
      truncated ||= limited.truncated;
      if (truncated) break;
    }
  } finally {
    await document.destroy();
  }

  if (output.trim().length < MIN_PDF_TEXT_CHARS_FOR_TEXT_MODE) {
    // Keep the usable short text for text-only models while also requesting
    // visual pages for models that can interpret the PDF layout.
    return {
      text: output,
      truncated,
      visualFallback: true,
    };
  }

  return { text: output, truncated };
}

async function extractDocxText(data: Buffer) {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: data });
  return limitText(result.value);
}

async function extractSpreadsheetText(data: Buffer) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(data, {
    type: "buffer",
    sheetRows: MAX_SPREADSHEET_ROWS,
    raw: false,
  });
  let truncated = workbook.SheetNames.length > MAX_SPREADSHEET_SHEETS;
  let output = "";

  for (const sheetName of workbook.SheetNames.slice(
    0,
    MAX_SPREADSHEET_SHEETS,
  )) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const fullRange = sheet["!fullref"] || sheet["!ref"] || "";
    try {
      truncated ||=
        XLSX.utils.decode_range(fullRange).e.r + 1 > MAX_SPREADSHEET_ROWS;
    } catch {
      // A malformed range is handled by SheetJS while converting the sheet.
    }
    const tableText = XLSX.utils.sheet_to_csv(sheet, {
      FS: "\t",
      RS: "\n",
      blankrows: false,
    });
    const limited = limitText(
      `${output}\n\n[工作表：${sheetName}]\n${tableText}`,
    );
    output = limited.text;
    truncated ||= limited.truncated;
    if (truncated) break;
  }

  return { text: output, truncated };
}

async function extractFileText(
  fileName: string,
  data: Buffer,
): Promise<ExtractedFileText | null> {
  switch (getExtractableAttachmentKind(fileName)) {
    case "pdf":
      return extractPdfText(data);
    case "docx":
      return extractDocxText(data);
    case "spreadsheet":
      return extractSpreadsheetText(data);
    default:
      if (isSafeImageAttachment(fileName)) {
        // Images are passed to the selected model as visual input, not OCR text.
        return { text: "", truncated: false, mode: "metadata" as const };
      }
      if (isPlainTextAttachment(fileName)) {
        return { ...limitText(decodePlainText(data)), mode: "text" as const };
      }
      return null;
  }
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
    const results: ExtractionResult[] = [];

    for (const id of ids) {
      const file = await getReadableCacheFile(externalUserId, id);
      if (!file) {
        results.push({
          id,
          status: "failed",
          text: "",
          truncated: false,
          mode: "metadata",
          summary: "文件不存在、已过期，或当前用户无权读取。",
          reason: "not_found",
        });
        continue;
      }

      try {
        const summary = buildFileSummary(
          file.fileName,
          file.contentType,
          file.sizeBytes,
        );
        const extracted = await extractFileText(file.fileName, file.data);
        if (!extracted) {
          const binaryText = extractPrintableBinaryText(file.data);
          results.push({
            id,
            status: binaryText.text ? "partial" : "metadata",
            text: binaryText.text,
            truncated: binaryText.truncated,
            mode: binaryText.text ? "binary" : "metadata",
            summary,
            reason: binaryText.text
              ? "printable_binary_strings"
              : "metadata_only",
          });
          continue;
        }
        const extractionMode = extracted.mode || "document";
        results.push({
          id,
          status:
            extracted.text.trim() ||
            extractionMode === "document" ||
            extractionMode === "text"
              ? "ready"
              : "metadata",
          ...extracted,
          mode: extractionMode,
          summary,
        });
      } catch (error) {
        results.push({
          id,
          status: "failed",
          text: "",
          truncated: false,
          mode: "metadata",
          summary: buildFileSummary(
            file.fileName,
            file.contentType,
            file.sizeBytes,
          ),
          reason: String((error as Error)?.message || "extract_failed").slice(
            0,
            160,
          ),
        });
      }
    }

    return NextResponse.json({ code: 0, data: { results } });
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
      { code: 1, msg: "extract_failed" },
      { status: 500 },
    );
  }
}
