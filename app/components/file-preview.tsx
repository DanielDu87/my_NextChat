// 文件预览 Modal 与所有配套 helper。
//
// 单独抽出是为了让 markdown 链接卡片、聊天附件都能复用同一个 FilePreviewContent。
// SCSS 仍由 chat.module.scss 提供（CSS Modules 类名哈希与 importer 无关，
// 因此本文件可以直接 import，与 mask.tsx 复用 chat.module.scss 同理）。
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import previewStyles from "./chat.module.scss";
import CloseIcon from "../icons/close.svg";
import DownloadIcon from "../icons/download.svg";
import { ChatMessageAttachedFile } from "../store/chat";
import {
  getSafeAttachmentContentType,
  isSafeImageAttachment,
  formatAttachmentSize,
  isFetchableAttachmentUrl,
} from "../utils/attachment-file";

export const EXCEL_PREVIEW_MAX_ROWS = 500;
export const EXCEL_PREVIEW_MAX_COLUMNS = 80;

const FILE_PREVIEW_CACHE_MAX_ENTRIES = 24;
const PREVIEW_DOWNLOAD_CHUNK_SIZE = 256 * 1024;

export type PreviewFileKind =
  "pdf" | "document" | "spreadsheet" | "text" | "generic";

const filePreviewObjectUrlCache = new Map<
  string,
  { blob: Blob; objectUrl: string; updatedAt: number }
>();

function getCachedPreviewBlob(previewUrl: string) {
  const cacheKey = String(previewUrl || "").trim();
  if (!cacheKey) return null;
  const cached = filePreviewObjectUrlCache.get(cacheKey);
  if (!cached) return null;
  cached.updatedAt = Date.now();
  return cached;
}

function setCachedPreviewBlob(previewUrl: string, blob: Blob) {
  const cacheKey = String(previewUrl || "").trim();
  if (!cacheKey) return null;
  const existing = filePreviewObjectUrlCache.get(cacheKey);
  if (existing) {
    existing.blob = blob;
    existing.updatedAt = Date.now();
    return existing;
  }

  const cached = {
    blob,
    objectUrl: URL.createObjectURL(blob),
    updatedAt: Date.now(),
  };
  filePreviewObjectUrlCache.set(cacheKey, cached);

  while (filePreviewObjectUrlCache.size > FILE_PREVIEW_CACHE_MAX_ENTRIES) {
    const oldestEntry = [...filePreviewObjectUrlCache.entries()].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt,
    )[0];
    if (!oldestEntry) break;
    filePreviewObjectUrlCache.delete(oldestEntry[0]);
    URL.revokeObjectURL(oldestEntry[1].objectUrl);
  }

  return cached;
}

// docx-preview 内联渲染出的 section.docx 默认按页面宽度排版。短文档至少铺满
// 预览正文区，长文档继续由内容撑高，再依赖 docx-preview-root 的
// overflow-y: auto 完成纵向滚动。
function applyDocxSectionSizing(
  host: HTMLElement | null,
  root: HTMLElement | null,
) {
  if (!host) return;
  const section = host.querySelector("section.docx") as HTMLElement | null;
  if (!section) return;
  const rootStyle = root ? window.getComputedStyle(root) : null;
  const availableHeight = root
    ? Math.max(
        0,
        root.clientHeight -
          parseFloat(rootStyle?.paddingTop || "0") -
          parseFloat(rootStyle?.paddingBottom || "0"),
      )
    : 0;
  const scale = Math.max(0.01, parseFloat(section.style.zoom || "1") || 1);
  section.style.width = "100%";
  section.style.maxWidth = "100%";
  section.style.boxSizing = "border-box";
  section.style.padding = "clamp(20px, 4vw, 36px) clamp(16px, 5vw, 48px)";
  section.style.height = "auto";
  section.style.minHeight =
    availableHeight > 0 ? `${availableHeight / scale}px` : "100%";
  section.style.maxHeight = "none";
  section.style.flex = "0 0 auto";
}

export function getPreviewContentType(file: Pick<File, "name" | "type">) {
  return getSafeAttachmentContentType(file.name);
}

export function getPreviewFileKind(
  file: Pick<ChatMessageAttachedFile, "type" | "name">,
): PreviewFileKind {
  const normalizedType = getPreviewContentType(file);
  const normalizedName = String(file.name || "").toLowerCase();
  if (normalizedType === "application/pdf" || normalizedName.endsWith(".pdf")) {
    return "pdf";
  }
  if (
    normalizedType.includes("spreadsheet") ||
    normalizedType.includes("excel") ||
    /\.(xlsx?|csv|tsv)$/i.test(normalizedName)
  ) {
    return "spreadsheet";
  }
  if (normalizedType.includes("word") || /\.(docx?)$/i.test(normalizedName)) {
    return "document";
  }
  if (
    normalizedType.startsWith("text/") ||
    /\.(txt|md|json|csv|tsv|log|xml|yaml|yml)$/i.test(normalizedName)
  ) {
    return "text";
  }
  return "generic";
}

export function isDocxPreviewFile(
  file: Pick<ChatMessageAttachedFile, "name" | "type">,
) {
  const normalizedType = getPreviewContentType(file);
  const normalizedName = String(file.name || "").toLowerCase();
  return (
    normalizedType.includes(
      "vnd.openxmlformats-officedocument.wordprocessingml.document",
    ) || normalizedName.endsWith(".docx")
  );
}

export function isImageAttachmentFile(
  file: Pick<ChatMessageAttachedFile, "type" | "name">,
) {
  return isSafeImageAttachment(file.name);
}

export function getFilePreviewErrorMessage(error: unknown) {
  const raw = String((error as Error)?.message || error || "").trim();
  if (!raw) return "文件预览失败，请稍后重试。";
  if (raw.includes("download_timeout")) {
    return "文件下载超时，请检查网络后重试。";
  }
  if (raw.includes("download_network_error")) {
    return "文件下载失败，请检查网络后重试。";
  }
  if (raw.includes("AbortError") || raw.includes("aborted")) {
    return "文件加载超时，请检查网络后重试。";
  }
  if (raw.includes("401") || raw.includes("403")) {
    return "没有权限读取该文件，请重新登录后再试。";
  }
  if (raw.includes("404") || raw.includes("not_found")) {
    return "文件缓存已失效或不存在，请重新发送文件。";
  }
  if (raw.includes("503") || raw.includes("postgres_temporarily_unavailable")) {
    return "文件服务暂时不可用，请稍后重试。";
  }
  return raw;
}

function yieldToBrowserPaint() {
  return new Promise<void>((resolve) => {
    if (typeof window !== "undefined" && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

async function downloadPreviewBlobInChunks(options: {
  url: string;
  signal?: AbortSignal;
  fileContentType: string;
  onHeaders?: (contentType: string, total: number) => void;
  onProgress?: (loaded: number, total: number) => Promise<void> | void;
}) {
  // 只允许同源相对地址、http(s) 和受控 blob URL，避免 Fetch 处理 sandbox: 等协议
  if (!isFetchableAttachmentUrl(options.url, { allowBlob: true })) {
    throw new Error("文件预览地址无效，请使用聊天里的生成文件下载链接。");
  }
  if (options.url.startsWith("blob:")) {
    const response = await fetch(options.url, {
      credentials: "include",
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error(`预览文件读取失败（${response.status}）`);
    }
    const blob = await response.blob();
    const total = blob.size || 0;
    options.onHeaders?.(options.fileContentType, total);
    await options.onProgress?.(total, total);
    await yieldToBrowserPaint();
    return blob;
  }

  const headResponse = await fetch(options.url, {
    method: "HEAD",
    credentials: "include",
    signal: options.signal,
  });
  if (!headResponse.ok) {
    throw new Error(`预览文件读取失败（${headResponse.status}）`);
  }

  const responseType =
    String(headResponse.headers.get("content-type") || "").trim() ||
    options.fileContentType;
  const total = Number(headResponse.headers.get("content-length") || 0);
  options.onHeaders?.(responseType, total);

  if (!(total > 0)) {
    const response = await fetch(options.url, {
      credentials: "include",
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error(`预览文件读取失败（${response.status}）`);
    }
    const blob = await response.blob();
    await options.onProgress?.(blob.size || 0, blob.size || 0);
    return blob;
  }

  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (loaded < total) {
    const start = loaded;
    const end = Math.min(total - 1, start + PREVIEW_DOWNLOAD_CHUNK_SIZE - 1);
    const response = await fetch(options.url, {
      credentials: "include",
      signal: options.signal,
      headers: { Range: `bytes=${start}-${end}` },
    });
    if (!response.ok) {
      throw new Error(`预览文件读取失败（${response.status}）`);
    }

    const chunk = new Uint8Array(await response.arrayBuffer());
    if (chunk.byteLength === 0) {
      throw new Error("download_empty_chunk");
    }

    chunks.push(chunk);
    loaded += chunk.byteLength;
    await options.onProgress?.(loaded, total);
  }

  return new Blob(chunks, {
    type: responseType || options.fileContentType,
  });
}

export function AttachmentFileGlyph({ typeKind }: { typeKind: string }) {
  return (
    <span
      className={clsx(
        previewStyles["attach-file-glyph"],
        typeKind === "pdf" && previewStyles["attach-file-pdf-glyph"],
      )}
    ></span>
  );
}

function FilePreviewState(props: {
  file: ChatMessageAttachedFile;
  title: string;
  message: string;
  progress?: number;
  progressLabel?: string;
  actionLabel?: string;
  onAction?: () => void;
  cancelLabel?: string;
  onCancel?: () => void;
  metaItems?: string[];
}) {
  const progress =
    typeof props.progress === "number"
      ? Math.min(1, Math.max(0, props.progress))
      : undefined;

  return (
    <div className={previewStyles["file-preview-state"]}>
      <div className={previewStyles["file-preview-state-card"]}>
        <div className={previewStyles["file-preview-state-icon"]}>
          <div className={previewStyles[`attach-file-${props.file.typeKind}`]}>
            <div className={previewStyles["attach-file-icon"]}>
              <AttachmentFileGlyph typeKind={props.file.typeKind} />
            </div>
          </div>
        </div>
        <div className={previewStyles["file-preview-state-title"]}>
          {props.title}
        </div>
        {props.file.name && (
          <div className={previewStyles["file-preview-state-file-name"]}>
            {props.file.name}
          </div>
        )}
        {props.message && (
          <div className={previewStyles["file-preview-state-message"]}>
            {props.message}
          </div>
        )}
        {typeof progress === "number" && (
          <div className={previewStyles["file-preview-state-progress"]}>
            <div className={previewStyles["file-preview-state-progress-track"]}>
              <div
                className={previewStyles["file-preview-state-progress-bar"]}
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className={previewStyles["file-preview-state-progress-label"]}>
              {props.progressLabel || `${Math.round(progress * 100)}%`}
            </div>
          </div>
        )}
        {props.metaItems && props.metaItems.length > 0 && (
          <div className={previewStyles["file-preview-state-meta"]}>
            {props.metaItems.map((item) => (
              <span
                key={item}
                className={previewStyles["file-preview-state-meta-item"]}
              >
                {item}
              </span>
            ))}
          </div>
        )}
        {(props.onAction || props.onCancel) && (
          <div className={previewStyles["file-preview-state-actions"]}>
            {props.onAction && (
              <button
                type="button"
                className={previewStyles["file-preview-state-action-primary"]}
                onClick={props.onAction}
              >
                {props.actionLabel || "重试"}
              </button>
            )}
            {props.onCancel && (
              <button
                type="button"
                className={previewStyles["file-preview-state-action-secondary"]}
                onClick={props.onCancel}
              >
                {props.cancelLabel || "取消下载"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function FilePreviewContent(props: {
  file: ChatMessageAttachedFile;
  onClose?: () => void;
}) {
  const { file, onClose } = props;
  const previewUrl = String(file.previewUrl || "").trim();
  const fileKind = getPreviewFileKind(file);
  const hostRef = useRef<HTMLDivElement>(null);
  const docxRootRef = useRef<HTMLDivElement>(null);
  const [blobUrl, setBlobUrl] = useState("");
  const [textContent, setTextContent] = useState("");
  const [spreadsheetSheets, setSpreadsheetSheets] = useState<
    Array<{ name: string; totalRows: number; rows: string[][] }>
  >([]);
  const [activeSpreadsheetSheet, setActiveSpreadsheetSheet] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [downloadTotalBytes, setDownloadTotalBytes] = useState(0);
  const [downloadCancelled, setDownloadCancelled] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const downloadAbortRef = useRef<(() => void) | null>(null);
  const userCancelledDownloadRef = useRef(false);

  const restartPreview = useCallback(() => {
    userCancelledDownloadRef.current = false;
    setDownloadCancelled(false);
    setReloadKey((value) => value + 1);
  }, []);

  const applyDocxAutoScale = useCallback(() => {
    const host = hostRef.current;
    const root = docxRootRef.current;
    if (!host || !root) return;
    const section = host.querySelector("section.docx") as HTMLElement | null;
    if (!section) return;
    section.style.zoom = "1";
    const rootStyle = window.getComputedStyle(root);
    const paddingX =
      parseFloat(rootStyle.paddingLeft || "0") +
      parseFloat(rootStyle.paddingRight || "0");
    const available = root.clientWidth - paddingX;
    const pageWidth = section.offsetWidth;
    if (pageWidth > 0 && available > 0 && pageWidth > available) {
      section.style.zoom = String(available / pageWidth);
    } else {
      section.style.zoom = "";
    }
    applyDocxSectionSizing(host, root);
  }, []);

  useEffect(() => {
    if (fileKind !== "document" || loading) return;
    const root = docxRootRef.current;
    if (!root || typeof ResizeObserver === "undefined") {
      applyDocxAutoScale();
      return;
    }
    const observer = new ResizeObserver(() => applyDocxAutoScale());
    observer.observe(root);
    return () => observer.disconnect();
  }, [fileKind, loading, reloadKey, applyDocxAutoScale]);

  const cancelDownload = useCallback(() => {
    userCancelledDownloadRef.current = true;
    setDownloadCancelled(true);
    setError("");
    setLoading(false);
    downloadAbortRef.current?.();
  }, []);

  const downloadProgressLabel = useMemo(
    () => `${Math.round(downloadProgress * 100)}%`,
    [downloadProgress],
  );

  const downloadMetaItems = useMemo(() => {
    if (downloadTotalBytes > 0) {
      return [
        `${file.typeLabel || "文件"} · ${formatAttachmentSize(
          downloadedBytes,
        )} / ${formatAttachmentSize(downloadTotalBytes)}`,
      ];
    }

    if (downloadedBytes > 0) {
      return [
        `${file.typeLabel || "文件"} · 已下载 ${formatAttachmentSize(
          downloadedBytes,
        )}`,
      ];
    }

    return [`${file.typeLabel || "文件"} · ${formatAttachmentSize(file.size)}`];
  }, [downloadedBytes, downloadTotalBytes, file.size, file.typeLabel]);

  const objectPreview = (url: string) => (
    <div className={previewStyles["file-preview-frame-wrapper"]}>
      <object
        data={url}
        type={getPreviewContentType(file)}
        className={previewStyles["file-preview-frame"]}
      >
        <iframe
          src={url}
          title={file.name || "文件预览"}
          className={previewStyles["file-preview-frame"]}
        />
      </object>
    </div>
  );

  useEffect(() => {
    let cancelled = false;
    let shouldRevokeObjectUrl = false;
    let abortController: AbortController | null = null;
    let localObjectUrl = "";
    let lastProgressPaintAt = 0;
    let lastProgressPaintBytes = 0;

    const load = async () => {
      if (!previewUrl) {
        setLoading(false);
        setError("该文件暂时无法预览");
        return;
      }

      setLoading(true);
      setError("");
      setTextContent("");
      setSpreadsheetSheets([]);
      setActiveSpreadsheetSheet("");
      setBlobUrl("");
      setDownloadProgress(0);
      setDownloadedBytes(0);
      setDownloadTotalBytes(0);
      setDownloadCancelled(false);
      userCancelledDownloadRef.current = false;
      if (hostRef.current) {
        hostRef.current.innerHTML = "";
      }

      try {
        if (fileKind === "document" && !isDocxPreviewFile(file)) {
          throw new Error(
            "暂不支持直接预览该 Word 格式，请转换为 docx 后再试。",
          );
        }

        const cachedPreview = getCachedPreviewBlob(previewUrl);
        if (cachedPreview) {
          setBlobUrl(cachedPreview.objectUrl);
          setDownloadedBytes(cachedPreview.blob.size || 0);
          setDownloadTotalBytes(cachedPreview.blob.size || 0);
          setDownloadProgress(1);

          if (fileKind === "text") {
            setTextContent(await cachedPreview.blob.text());
            return;
          }

          if (fileKind === "spreadsheet") {
            const buffer = await cachedPreview.blob.arrayBuffer();
            if (cancelled) return;
            const XLSX = await import("xlsx");
            const workbook = XLSX.read(buffer, {
              type: "array",
              sheetRows: EXCEL_PREVIEW_MAX_ROWS,
            });
            const originalRangeRef = new Map<string, string>();
            for (const sheetName of workbook.SheetNames) {
              originalRangeRef.set(
                sheetName,
                workbook.Sheets[sheetName]?.["!fullref"] ||
                  workbook.Sheets[sheetName]?.["!ref"] ||
                  "",
              );
            }
            const nextSheets = workbook.SheetNames.map((sheetName) => {
              const sheet = workbook.Sheets[sheetName];
              if (!sheet) return null;
              const originalRange = originalRangeRef.get(sheetName) || "";
              const totalRows = (() => {
                try {
                  return XLSX.utils.decode_range(originalRange).e.r + 1;
                } catch {
                  return EXCEL_PREVIEW_MAX_ROWS;
                }
              })();
              return {
                name: sheetName,
                totalRows,
                rows: (
                  XLSX.utils.sheet_to_json(sheet, {
                    header: 1,
                    defval: "",
                    blankrows: false,
                    raw: false,
                  }) as unknown[][]
                ).map((row) =>
                  row
                    .slice(0, EXCEL_PREVIEW_MAX_COLUMNS)
                    .map((cell) => String(cell ?? "")),
                ),
              };
            }).filter(
              (
                sheet,
              ): sheet is {
                name: string;
                totalRows: number;
                rows: string[][];
              } => sheet !== null,
            );
            if (nextSheets.length === 0) {
              setTextContent("表格文件没有可预览的工作表。");
              return;
            }
            setSpreadsheetSheets(nextSheets);
            setActiveSpreadsheetSheet((prev) =>
              nextSheets.some((sheet) => sheet.name === prev)
                ? prev
                : nextSheets[0].name,
            );
            return;
          }

          if (fileKind === "document") {
            const buffer = await cachedPreview.blob.arrayBuffer();
            if (cancelled) return;
            const docxPreview = await import("docx-preview");
            if (cancelled || !hostRef.current) return;
            hostRef.current.innerHTML = "";
            await docxPreview.renderAsync(buffer, hostRef.current, undefined, {
              inWrapper: false,
              ignoreWidth: false,
              ignoreHeight: true,
            });
            applyDocxSectionSizing(hostRef.current, docxRootRef.current);
            // 监听渲染完成后再强制覆盖一次
            requestAnimationFrame(() =>
              applyDocxSectionSizing(hostRef.current, docxRootRef.current),
            );
            setTimeout(
              () =>
                applyDocxSectionSizing(hostRef.current, docxRootRef.current),
              100,
            );
          }
          return;
        }

        let contentLength = 0;

        abortController = new AbortController();
        downloadAbortRef.current = () => abortController?.abort();
        const responseBlob = await downloadPreviewBlobInChunks({
          url: previewUrl,
          signal: abortController.signal,
          fileContentType: getPreviewContentType(file),
          onHeaders: (_nextContentType, nextTotal) => {
            contentLength = nextTotal;
            if (!cancelled && nextTotal > 0) {
              setDownloadTotalBytes(nextTotal);
            }
          },
          onProgress: async (loaded, total) => {
            if (cancelled) return;

            const resolvedTotal = total > 0 ? total : contentLength;
            if (resolvedTotal > 0) {
              contentLength = resolvedTotal;
              setDownloadTotalBytes(resolvedTotal);
            }

            setDownloadedBytes(loaded);
            setDownloadProgress(
              resolvedTotal > 0
                ? Math.min(1, Math.max(0, loaded / resolvedTotal))
                : 0,
            );

            const now = Date.now();
            const shouldYieldForPaint =
              (resolvedTotal > 0 && loaded === resolvedTotal) ||
              now - lastProgressPaintAt >= 48 ||
              loaded - lastProgressPaintBytes >= 128 * 1024;
            if (shouldYieldForPaint) {
              lastProgressPaintAt = now;
              lastProgressPaintBytes = loaded;
              await yieldToBrowserPaint();
            }
          },
        });
        if (cancelled) return;

        setDownloadedBytes(
          contentLength > 0 ? contentLength : responseBlob.size || 0,
        );
        setDownloadTotalBytes(
          contentLength > 0 ? contentLength : responseBlob.size || 0,
        );
        setDownloadProgress(1);

        const cached = setCachedPreviewBlob(previewUrl, responseBlob) || {
          blob: responseBlob,
          objectUrl: URL.createObjectURL(responseBlob),
          updatedAt: Date.now(),
        };
        if (!filePreviewObjectUrlCache.has(previewUrl)) {
          shouldRevokeObjectUrl = true;
          localObjectUrl = cached.objectUrl;
        }
        setBlobUrl(cached.objectUrl);

        if (fileKind === "text") {
          setTextContent(await responseBlob.text());
          return;
        }

        if (fileKind === "spreadsheet") {
          const buffer = await responseBlob.arrayBuffer();
          if (cancelled) return;
          const XLSX = await import("xlsx");
          const workbook = XLSX.read(buffer, {
            type: "array",
            sheetRows: EXCEL_PREVIEW_MAX_ROWS,
          });
          const originalRangeRef = new Map<string, string>();
          for (const sheetName of workbook.SheetNames) {
            originalRangeRef.set(
              sheetName,
              workbook.Sheets[sheetName]?.["!fullref"] ||
                workbook.Sheets[sheetName]?.["!ref"] ||
                "",
            );
          }
          const nextSheets = workbook.SheetNames.map((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            if (!sheet) return null;
            const originalRange = originalRangeRef.get(sheetName) || "";
            const totalRows = (() => {
              try {
                return XLSX.utils.decode_range(originalRange).e.r + 1;
              } catch {
                return EXCEL_PREVIEW_MAX_ROWS;
              }
            })();
            return {
              name: sheetName,
              totalRows,
              rows: (
                XLSX.utils.sheet_to_json(sheet, {
                  header: 1,
                  defval: "",
                  blankrows: false,
                  raw: false,
                }) as unknown[][]
              ).map((row) =>
                row
                  .slice(0, EXCEL_PREVIEW_MAX_COLUMNS)
                  .map((cell) => String(cell ?? "")),
              ),
            };
          }).filter(
            (
              sheet,
            ): sheet is { name: string; totalRows: number; rows: string[][] } =>
              sheet !== null,
          );
          if (nextSheets.length === 0) {
            setTextContent("表格文件没有可预览的工作表。");
            return;
          }
          setSpreadsheetSheets(nextSheets);
          setActiveSpreadsheetSheet((prev) =>
            nextSheets.some((sheet) => sheet.name === prev)
              ? prev
              : nextSheets[0].name,
          );
          return;
        }

        if (fileKind === "document") {
          const buffer = await responseBlob.arrayBuffer();
          if (cancelled) return;
          const docxPreview = await import("docx-preview");
          if (cancelled || !hostRef.current) return;
          hostRef.current.innerHTML = "";
          await docxPreview.renderAsync(buffer, hostRef.current, undefined, {
            inWrapper: false,
            ignoreWidth: false,
            ignoreHeight: true,
          });
          applyDocxSectionSizing(hostRef.current, docxRootRef.current);
          // 监听渲染完成后再强制覆盖一次
          requestAnimationFrame(() =>
            applyDocxSectionSizing(hostRef.current, docxRootRef.current),
          );
          setTimeout(
            () => applyDocxSectionSizing(hostRef.current, docxRootRef.current),
            100,
          );
        }
      } catch (error) {
        if (!cancelled) {
          if (
            userCancelledDownloadRef.current ||
            (error instanceof DOMException && error.name === "AbortError")
          ) {
            setDownloadCancelled(true);
            setError("");
          } else {
            setError(getFilePreviewErrorMessage(error));
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
        downloadAbortRef.current = null;
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (abortController) {
        abortController.abort();
      }
      if (shouldRevokeObjectUrl && localObjectUrl) {
        URL.revokeObjectURL(localObjectUrl);
      }
    };
  }, [file, fileKind, previewUrl, reloadKey]);

  if (isImageAttachmentFile(file)) {
    const FileTypeIcon = () => (
      <div className={previewStyles["attach-file-file"]}>
        <div className={previewStyles["attach-file-icon"]}>
          <AttachmentFileGlyph typeKind="file" />
        </div>
      </div>
    );
    const MetaBadge = ({ children }: { children: React.ReactNode }) => (
      <span className={previewStyles["file-preview-meta-badge"]}>
        {children}
      </span>
    );

    const imgStyle: React.CSSProperties = {
      maxWidth: "100%",
      maxHeight: "calc(100vh - 180px)",
      objectFit: "contain",
      display: "block",
      margin: "0 auto",
    };

    return (
      <div className={previewStyles["file-preview-root"]}>
        <div className={previewStyles["file-preview-header"]}>
          <div className={previewStyles["file-preview-header-icon"]}>
            <FileTypeIcon />
          </div>
          <div className={previewStyles["file-preview-header-title"]}>
            {file.name}
          </div>
          <button
            type="button"
            aria-label="下载文件"
            title="下载文件"
            className={previewStyles["file-preview-header-download"]}
            onClick={() => {
              const a = document.createElement("a");
              a.href = previewUrl;
              a.download = file.name || "文件";
              a.rel = "noopener noreferrer";
              document.body.appendChild(a);
              a.click();
              a.remove();
            }}
          >
            <DownloadIcon />
          </button>
          <button
            type="button"
            aria-label="关闭"
            className="nextchat-close-button"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className={previewStyles["file-preview-meta-bar"]}>
          <MetaBadge>{file.typeLabel || "图片"}</MetaBadge>
          {file.size > 0 && (
            <MetaBadge>{formatAttachmentSize(file.size)}</MetaBadge>
          )}
        </div>
        <div className={previewStyles["file-preview-body"]}>
          <img
            src={previewUrl}
            alt={file.name || "图片预览"}
            style={imgStyle}
            onError={(e) => {
              // Fallback to object preview if img fails
              const target = e.currentTarget;
              target.style.display = "none";
              const parent = target.parentElement;
              if (parent) {
                parent.innerHTML = `<object data="${previewUrl}" type="image/png" style="width:100%;height:100%;border:none;" title="${file.name || ""}"><iframe src="${previewUrl}" style="width:100%;height:100%;border:none;"></iframe></object>`;
              }
            }}
          />
        </div>
      </div>
    );
  }

  if (fileKind === "generic") {
    const FileTypeIcon = () => (
      <div className={previewStyles["attach-file-file"]}>
        <div className={previewStyles["attach-file-icon"]}>
          <AttachmentFileGlyph typeKind="file" />
        </div>
      </div>
    );
    const MetaBadge = ({ children }: { children: React.ReactNode }) => (
      <span className={previewStyles["file-preview-meta-badge"]}>
        {children}
      </span>
    );
    return (
      <div className={previewStyles["file-preview-root"]}>
        <div className={previewStyles["file-preview-header"]}>
          <div className={previewStyles["file-preview-header-icon"]}>
            <FileTypeIcon />
          </div>
          <div className={previewStyles["file-preview-header-title"]}>
            {file.name}
          </div>
          <button
            type="button"
            aria-label="下载文件"
            title="下载文件"
            className={previewStyles["file-preview-header-download"]}
            onClick={() => {
              const a = document.createElement("a");
              a.href = previewUrl;
              a.download = file.name || "文件";
              a.rel = "noopener noreferrer";
              document.body.appendChild(a);
              a.click();
              a.remove();
            }}
          >
            <DownloadIcon />
          </button>
          <button
            type="button"
            aria-label="关闭"
            className="nextchat-close-button"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className={previewStyles["file-preview-meta-bar"]}>
          <MetaBadge>{file.typeLabel || "文件"}</MetaBadge>
          <MetaBadge>{formatAttachmentSize(file.size)}</MetaBadge>
        </div>
        <div className={previewStyles["file-preview-body"]}>
          <FilePreviewState
            file={file}
            title="该文件不支持内嵌预览"
            message="为保护账户安全，请下载后在本地打开。"
            actionLabel="下载文件"
            onAction={() =>
              window.open(previewUrl, "_blank", "noopener,noreferrer")
            }
          />
        </div>
      </div>
    );
  }

  if (fileKind === "pdf") {
    const FileTypeIcon = () => (
      <div className={previewStyles["attach-file-pdf"]}>
        <div className={previewStyles["attach-file-icon"]}>
          <AttachmentFileGlyph typeKind="pdf" />
        </div>
      </div>
    );
    const MetaBadge = ({ children }: { children: React.ReactNode }) => (
      <span className={previewStyles["file-preview-meta-badge"]}>
        {children}
      </span>
    );
    const pdfSourceUrl = blobUrl || previewUrl;
    const pdfUrl = pdfSourceUrl.includes("#")
      ? pdfSourceUrl
      : `${pdfSourceUrl}#toolbar=1&navpanes=0`;
    let pdfBody: React.ReactNode = null;
    if (loading) {
      pdfBody = (
        <FilePreviewState
          file={file}
          title="正在下载文件..."
          message="请稍候，文件下载完成后会自动预览。"
          progress={downloadProgress}
          progressLabel={downloadProgressLabel}
          metaItems={downloadMetaItems}
          onCancel={cancelDownload}
        />
      );
    } else if (downloadCancelled) {
      pdfBody = (
        <FilePreviewState
          file={file}
          title="已取消下载"
          message="下载已取消，重新开始后会继续预览这个文件。"
          actionLabel="重新下载"
          onAction={restartPreview}
          metaItems={downloadMetaItems}
        />
      );
    } else if (error) {
      pdfBody = (
        <FilePreviewState
          file={file}
          title="PDF 预览失败"
          message={error}
          onAction={restartPreview}
          metaItems={downloadMetaItems}
        />
      );
    } else if (pdfSourceUrl) {
      pdfBody = objectPreview(pdfUrl);
    } else {
      pdfBody = (
        <FilePreviewState
          file={file}
          title="PDF 预览失败"
          message="没有拿到可预览的文件内容，请重试。"
          onAction={restartPreview}
          metaItems={downloadMetaItems}
        />
      );
    }
    return (
      <div className={previewStyles["file-preview-root"]}>
        <div className={previewStyles["file-preview-header"]}>
          <div className={previewStyles["file-preview-header-icon"]}>
            <FileTypeIcon />
          </div>
          <div className={previewStyles["file-preview-header-title"]}>
            {file.name}
          </div>
          <button
            type="button"
            aria-label="下载文件"
            title="下载文件"
            className={previewStyles["file-preview-header-download"]}
            onClick={() => {
              const a = document.createElement("a");
              a.href = blobUrl || previewUrl;
              a.download = file.name || "文件";
              a.rel = "noopener noreferrer";
              document.body.appendChild(a);
              a.click();
              a.remove();
            }}
          >
            <DownloadIcon />
          </button>
          <button
            type="button"
            aria-label="关闭"
            className="nextchat-close-button"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className={previewStyles["file-preview-meta-bar"]}>
          <MetaBadge>{file.typeLabel || "PDF"}</MetaBadge>
          <MetaBadge>{formatAttachmentSize(file.size)}</MetaBadge>
        </div>
        <div className={previewStyles["file-preview-body"]}>{pdfBody}</div>
      </div>
    );
  }

  const activeSheet =
    spreadsheetSheets.find((sheet) => sheet.name === activeSpreadsheetSheet) ||
    spreadsheetSheets[0];

  let body: React.ReactNode = null;
  if (fileKind === "document") {
    body = downloadCancelled ? (
      <FilePreviewState
        file={file}
        title="已取消下载"
        message="下载已取消，重新开始后会继续预览这个文件。"
        actionLabel="重新下载"
        onAction={restartPreview}
        metaItems={downloadMetaItems}
      />
    ) : !loading && error ? (
      <FilePreviewState
        file={file}
        title="Word 预览失败"
        message={error}
        onAction={restartPreview}
        metaItems={downloadMetaItems}
      />
    ) : (
      <div
        ref={docxRootRef}
        className={clsx(previewStyles["docx-preview-root"], {
          [previewStyles["docx-preview-root-loading"]]: loading,
        })}
      >
        <div
          ref={hostRef}
          className={previewStyles["docx-preview-container"]}
        />
        {loading && (
          <FilePreviewState
            file={file}
            title="正在下载文件..."
            message="请稍候，文件下载完成后会自动预览。"
            progress={downloadProgress}
            progressLabel={downloadProgressLabel}
            metaItems={downloadMetaItems}
            onCancel={cancelDownload}
          />
        )}
      </div>
    );
  } else if (loading) {
    body = (
      <FilePreviewState
        file={file}
        title="正在下载文件..."
        message="请稍候，文件下载完成后会自动预览。"
        progress={downloadProgress}
        progressLabel={downloadProgressLabel}
        metaItems={downloadMetaItems}
        onCancel={cancelDownload}
      />
    );
  } else if (downloadCancelled) {
    body = (
      <FilePreviewState
        file={file}
        title="已取消下载"
        message="下载已取消，重新开始后会继续预览这个文件。"
        actionLabel="重新下载"
        onAction={restartPreview}
        metaItems={downloadMetaItems}
      />
    );
  } else if (error) {
    body = (
      <FilePreviewState
        file={file}
        title="文件预览失败"
        message={error}
        onAction={restartPreview}
        metaItems={downloadMetaItems}
      />
    );
  } else if (textContent) {
    body = (
      <pre className={previewStyles["file-preview-text"]}>{textContent}</pre>
    );
  } else if (fileKind === "spreadsheet") {
    body = (
      <div className={previewStyles["xlsx-preview-root"]}>
        {spreadsheetSheets.length > 0 && (
          <div className={previewStyles["xlsx-preview-tabs"]}>
            {spreadsheetSheets.map((sheet) => {
              const isActive = sheet.name === activeSheet?.name;
              return (
                <button
                  key={sheet.name}
                  type="button"
                  className={clsx(previewStyles["xlsx-preview-tab"], {
                    [previewStyles["xlsx-preview-tab-active"]]: isActive,
                  })}
                  onClick={() => setActiveSpreadsheetSheet(sheet.name)}
                >
                  {sheet.name}
                </button>
              );
            })}
          </div>
        )}
        {loading && (
          <FilePreviewState
            file={file}
            title="正在加载预览..."
            message="请稍候"
          />
        )}
        {!loading && error && (
          <FilePreviewState
            file={file}
            title="表格预览失败"
            message={error}
            onAction={restartPreview}
            metaItems={downloadMetaItems}
          />
        )}
        {!loading && !error && activeSheet && (
          <div className={previewStyles["xlsx-preview-sheet"]}>
            <table>
              <tbody>
                {activeSheet.rows.map((row, rowIndex) => (
                  <tr key={`${activeSheet.name}-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && !error && !activeSheet && (
          <FilePreviewState
            file={file}
            title="表格预览失败"
            message="表格文件没有可预览的工作表。"
          />
        )}
      </div>
    );
  } else {
    body = objectPreview(blobUrl || previewUrl);
  }

  const typeKind = file.typeKind || "file";

  const FileTypeIcon = () => (
    <div className={previewStyles[`attach-file-${typeKind}`]}>
      <div className={previewStyles["attach-file-icon"]}>
        <AttachmentFileGlyph typeKind={typeKind} />
      </div>
    </div>
  );

  const MetaBadge = ({
    children,
    warning,
  }: {
    children: React.ReactNode;
    warning?: boolean;
  }) => (
    <span
      className={previewStyles["file-preview-meta-badge"]}
      style={warning ? { color: "#d97706" } : undefined}
    >
      {children}
    </span>
  );

  return (
    <div className={previewStyles["file-preview-root"]}>
      <div className={previewStyles["file-preview-header"]}>
        <div className={previewStyles["file-preview-header-icon"]}>
          <FileTypeIcon />
        </div>
        <div className={previewStyles["file-preview-header-title"]}>
          {file.name}
        </div>
        <button
          type="button"
          aria-label="下载文件"
          title="下载文件"
          className={previewStyles["file-preview-header-download"]}
          onClick={() => {
            const a = document.createElement("a");
            a.href = blobUrl || previewUrl;
            a.download = file.name || "文件";
            a.rel = "noopener noreferrer";
            document.body.appendChild(a);
            a.click();
            a.remove();
          }}
        >
          <DownloadIcon />
        </button>
        <button
          type="button"
          aria-label="关闭"
          className="nextchat-close-button"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <div className={previewStyles["file-preview-meta-bar"]}>
        <MetaBadge>{file.typeLabel || "文件"}</MetaBadge>
        <MetaBadge>{formatAttachmentSize(file.size)}</MetaBadge>
        {spreadsheetSheets.length > 0 && (
          <MetaBadge>{spreadsheetSheets.length} 个工作表</MetaBadge>
        )}
        {activeSheet && activeSheet.totalRows > EXCEL_PREVIEW_MAX_ROWS && (
          <MetaBadge warning>
            前 {EXCEL_PREVIEW_MAX_ROWS} / 共 {activeSheet.totalRows} 行
          </MetaBadge>
        )}
      </div>
      <div className={previewStyles["file-preview-body"]}>{body}</div>
    </div>
  );
}
