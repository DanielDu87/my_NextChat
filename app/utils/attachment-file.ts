const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  log: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};

export type ExtractableAttachmentKind = "pdf" | "docx" | "spreadsheet";

export function getAttachmentFileExtension(fileName: string) {
  const normalized = String(fileName || "")
    .trim()
    .toLowerCase();
  const lastDot = normalized.lastIndexOf(".");
  if (lastDot < 0 || lastDot === normalized.length - 1) return "";
  return normalized.slice(lastDot + 1);
}

// Never reflect an upload-provided MIME type. Cache files are same-origin and
// may be rendered by the browser, so their response type must be derived from
// a small allowlist instead.
export function getSafeAttachmentContentType(fileName: string) {
  return (
    MIME_BY_EXTENSION[getAttachmentFileExtension(fileName)] ||
    "application/octet-stream"
  );
}

export function isSafeInlineAttachment(fileName: string) {
  const contentType = getSafeAttachmentContentType(fileName);
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

export function isSafeImageAttachment(fileName: string) {
  return getSafeAttachmentContentType(fileName).startsWith("image/");
}

export function getExtractableAttachmentKind(
  fileName: string,
): ExtractableAttachmentKind | null {
  switch (getAttachmentFileExtension(fileName)) {
    case "pdf":
      return "pdf";
    case "docx":
      return "docx";
    case "xlsx":
    case "xls":
    case "csv":
    case "tsv":
      return "spreadsheet";
    default:
      return null;
  }
}
