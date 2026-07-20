import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import { getExtractableAttachmentKind } from "@/app/utils/attachment-file";
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
const MAX_SPREADSHEET_SHEETS = 10;
const MAX_SPREADSHEET_ROWS = 1_000;

type ExtractionResult = {
  id: string;
  status: "ready" | "unsupported" | "failed";
  text: string;
  truncated: boolean;
  reason?: string;
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
  let truncated = document.numPages > MAX_PDF_PAGES;
  let output = "";

  try {
    for (
      let pageNumber = 1;
      pageNumber <= Math.min(document.numPages, MAX_PDF_PAGES);
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

async function extractFileText(fileName: string, data: Buffer) {
  switch (getExtractableAttachmentKind(fileName)) {
    case "pdf":
      return extractPdfText(data);
    case "docx":
      return extractDocxText(data);
    case "spreadsheet":
      return extractSpreadsheetText(data);
    default:
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
          reason: "not_found",
        });
        continue;
      }

      try {
        const extracted = await extractFileText(file.fileName, file.data);
        if (!extracted) {
          results.push({
            id,
            status: "unsupported",
            text: "",
            truncated: false,
            reason: "unsupported_format",
          });
          continue;
        }
        results.push({
          id,
          status: "ready",
          ...extracted,
        });
      } catch (error) {
        results.push({
          id,
          status: "failed",
          text: "",
          truncated: false,
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
