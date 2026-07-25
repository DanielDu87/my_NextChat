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

export function isFetchableAttachmentUrl(
  value: string,
  options: { allowBlob?: boolean } = {},
) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  if (/^https?:\/\//i.test(normalized)) return true;
  if (normalized.startsWith("/") && !normalized.startsWith("//")) return true;
  return options.allowBlob === true && /^blob:/i.test(normalized);
}

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

export type AttachmentTypeKind =
  "document" | "spreadsheet" | "pdf" | "archive" | "file";

export type AttachmentLike = {
  name?: string;
  type?: string;
  size?: number;
};

export function getAttachmentTypeKind(
  file: Pick<AttachmentLike, "name" | "type">,
): AttachmentTypeKind {
  const normalizedType = String(file.type || "").toLowerCase();
  const normalizedName = String(file.name || "").toLowerCase();

  if (normalizedType.includes("pdf") || normalizedName.endsWith(".pdf")) {
    return "pdf";
  }

  if (
    normalizedType.includes("sheet") ||
    normalizedType.includes("excel") ||
    normalizedType.includes("csv") ||
    /\.(xlsx?|csv|tsv|numbers)$/i.test(normalizedName)
  ) {
    return "spreadsheet";
  }

  if (
    normalizedType.includes("word") ||
    normalizedType.includes("document") ||
    normalizedType.startsWith("text/") ||
    /\.(docx?|txt|md|rtf|pages|pptx?|key)$/i.test(normalizedName)
  ) {
    return "document";
  }

  if (
    normalizedType.includes("zip") ||
    normalizedType.includes("tar") ||
    normalizedType.includes("rar") ||
    normalizedType.includes("7z") ||
    /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i.test(normalizedName)
  ) {
    return "archive";
  }

  return "file";
}

export function getAttachmentTypeLabel(
  file: Pick<AttachmentLike, "name" | "type">,
) {
  const normalizedName = String(file.name || "").toLowerCase();

  // 根据扩展名精确判断类型
  if (normalizedName.endsWith(".pdf")) {
    return "PDF文件";
  }
  if (/\.(docx?|docm|dotx?|odt)$/i.test(normalizedName)) {
    return "Word文件";
  }
  if (/\.(xlsx?|xlsm|xlsb|ods)$/i.test(normalizedName)) {
    return "Excel文件";
  }
  if (/\.(pptx?|pptm|odp)$/i.test(normalizedName)) {
    return "PPT文件";
  }
  if (/\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i.test(normalizedName)) {
    return "压缩文件";
  }
  if (/\.(txt|md|log|cfg|conf|ini)$/i.test(normalizedName)) {
    return "文本文件";
  }
  if (/\.(json|xml|yaml|yml|toml)$/i.test(normalizedName)) {
    return "配置文件";
  }
  if (/\.(csv|tsv)$/i.test(normalizedName)) {
    return "CSV数据";
  }
  if (
    /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico|avif|heic|heif)$/i.test(
      normalizedName,
    )
  ) {
    return "图片文件";
  }
  if (/\.(mp4|avi|mov|mkv|wmv|flv|webm)$/i.test(normalizedName)) {
    return "视频文件";
  }
  if (/\.(mp3|wav|ogg|flac|aac|opus|m4a)$/i.test(normalizedName)) {
    return "音频文件";
  }

  const typeKind = getAttachmentTypeKind(file);
  switch (typeKind) {
    case "pdf":
      return "PDF文件";
    case "spreadsheet":
      return "Excel文件";
    case "document":
      return "Word文件";
    case "archive":
      return "压缩文件";
    default:
      return "文件";
  }
}

export function formatAttachmentSize(size: number) {
  const safeSize = Number.isFinite(size) ? Math.max(0, size) : 0;
  if (safeSize < 1024) return `${safeSize} B`;
  if (safeSize < 1024 * 1024) return `${(safeSize / 1024).toFixed(1)} KB`;
  if (safeSize < 1024 * 1024 * 1024) {
    return `${(safeSize / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(safeSize / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
