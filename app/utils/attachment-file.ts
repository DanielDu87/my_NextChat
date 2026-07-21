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

// These formats are safe to decode locally. Keeping this list separate from
// preview MIME types lets every upload enter the analysis pipeline without
// treating arbitrary binaries as text.
const PLAIN_TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "log",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "less",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "py",
  "java",
  "go",
  "rs",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "cs",
  "php",
  "rb",
  "sh",
  "bash",
  "zsh",
  "sql",
  "graphql",
  "gql",
  "vue",
  "svelte",
  "dockerfile",
  "env",
]);

// File inputs accepted by the native OpenAI Responses API. PDF gains visual
// understanding; the remaining document formats are still useful as native
// files instead of being flattened into the local text fallback.
const OPENAI_FILE_INPUT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "csv",
  "tsv",
  "txt",
  "md",
  "rtf",
  "odt",
  "ods",
  "odp",
  "epub",
  ...PLAIN_TEXT_EXTENSIONS,
]);

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

export function isPlainTextAttachment(fileName: string) {
  const extension = getAttachmentFileExtension(fileName);
  return (
    PLAIN_TEXT_EXTENSIONS.has(extension) ||
    String(fileName || "")
      .trim()
      .toLowerCase() === "dockerfile"
  );
}

export function isOpenAIFileInputSupported(fileName: string) {
  return OPENAI_FILE_INPUT_EXTENSIONS.has(getAttachmentFileExtension(fileName));
}
