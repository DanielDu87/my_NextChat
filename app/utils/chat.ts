import {
  CACHE_URL_PREFIX,
  UPLOAD_URL,
  REQUEST_TIMEOUT_MS,
} from "@/app/constant";
import type { ChatMessageAttachedFile } from "@/app/store/chat";
import type { MultimodalContent, RequestMessage } from "@/app/client/api";
import * as LocaleModule from "@/app/locales";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import * as FormatModule from "./format";
import * as StreamModule from "./stream";
import * as ModelApiKeyMemoryModule from "./model-api-key-memory";
import { replaceUrlQueryParam } from "./model-fetch-common";
import { logger } from "./logger";

/**
 * 检测响应是否为可重试的错误。
 * 提取为公共函数，供流式和非流式路径共用。
 */
export function getRetryableErrorReason(payload: any): string {
  const errorCode = String(payload?.error?.code || payload?.code || "").trim();
  const errorMessage = String(
    payload?.error?.message || payload?.message || "",
  ).trim();
  if (!errorCode && !errorMessage) return "";
  if (
    errorCode === "model_not_found" ||
    errorMessage.includes("无可用渠道") ||
    errorMessage.includes("no available distributor")
  ) {
    return errorMessage || errorCode;
  }
  return "";
}

const Locale = (LocaleModule as any).default ?? LocaleModule;
const prettyObject = FormatModule.prettyObject;
const tauriFetch = StreamModule.fetch;
const rememberSuccessfulCustomModelApiKeyGroup =
  ModelApiKeyMemoryModule.rememberSuccessfulCustomModelApiKeyGroup;

function isDebugLoggingEnabled() {
  if (process.env.NODE_ENV === "test") {
    return false;
  }

  try {
    return (
      globalThis.localStorage?.getItem("debug-chat-logs") === "1" ||
      process.env.NEXT_PUBLIC_DEBUG_CHAT_LOGS === "1"
    );
  } catch {
    return process.env.NEXT_PUBLIC_DEBUG_CHAT_LOGS === "1";
  }
}

function logChatDebug(message: string, payload?: unknown) {
  if (!isDebugLoggingEnabled()) {
    return;
  }
  if (payload === undefined) {
    console.log(message);
    return;
  }
  console.log(message, payload);
}

function logChatTrace(message: string) {
  if (!isDebugLoggingEnabled()) {
    return;
  }
  console.debug(message);
}

function getAuthHeaderName(headers: Record<string, string>) {
  return Object.keys(headers).find(
    (key) =>
      key.toLowerCase() === "authorization" ||
      key.toLowerCase() === "x-api-key",
  );
}

const INTERNAL_CHAT_HEADER_KEYS = new Set([
  "x-fallback-api-keys",
  "x-fallback-api-key-groups",
  "x-remembered-api-key-group",
  "x-api-key-profile-id",
  "x-api-key-provider-id",
  "x-api-key-auth-type",
  "x-api-key-auth-header",
  "x-api-key-auth-query-param",
  "x-api-key-query-value",
]);

export function stripInternalChatHeaders<T extends Record<string, any>>(
  headers: T,
) {
  const networkHeaders: Record<string, any> = {};
  Object.entries(headers || {}).forEach(([key, value]) => {
    if (INTERNAL_CHAT_HEADER_KEYS.has(key.toLowerCase())) {
      return;
    }
    networkHeaders[key] = value;
  });
  return networkHeaders as T;
}

export function stripHiddenThinkingTags(
  content: string,
  isInsideThinkingTag: boolean,
) {
  let remaining = content;
  let inside = isInsideThinkingTag;
  let visible = "";

  while (remaining.length > 0) {
    if (inside) {
      const closeIndex = remaining.indexOf("</think>");
      if (closeIndex < 0) {
        return { content: visible, isInsideThinkingTag: true };
      }
      remaining = remaining.slice(closeIndex + "</think>".length);
      inside = false;
      continue;
    }

    const openIndex = remaining.indexOf("<think>");
    if (openIndex < 0) {
      visible += remaining;
      break;
    }
    visible += remaining.slice(0, openIndex);
    remaining = remaining.slice(openIndex + "<think>".length);
    inside = true;
  }

  return { content: visible, isInsideThinkingTag: inside };
}

function getApiKeyGroupName(
  fallbackApiKeyGroups: string[],
  currentKeyIndex: number,
) {
  return fallbackApiKeyGroups[currentKeyIndex] || `index-${currentKeyIndex}`;
}

function formatApiKeyGroupFailureMessage(currentGroup: string, reason: string) {
  const normalizedReason = String(reason || "").trim();
  return [
    "[分组重试] 全部分组重试后仍失败",
    `最终分组: ${currentGroup}`,
    `错误信息: ${normalizedReason || "unknown error"}`,
  ].join("\n");
}

function rememberApiKeyGroupIfNeeded(
  chatPath: string,
  fallbackApiKeyGroups: string[],
  currentKeyIndex: number,
  headers: any,
  options: any,
  finalText: string,
) {
  if (fallbackApiKeyGroups.length === 0 || !finalText.trim()) {
    return;
  }

  const currentGroup = getApiKeyGroupName(
    fallbackApiKeyGroups,
    currentKeyIndex,
  );
  if (!currentGroup || currentGroup.startsWith("index-")) {
    return;
  }
  const providerName = options?.config?.providerName || "API";

  logger.chat.log(
    `[MultiKey] ✅ ${providerName} 分组请求成功（${currentGroup}，第 ${
      currentKeyIndex + 1
    }/${fallbackApiKeyGroups.length} 组）`,
  );

  rememberSuccessfulCustomModelApiKeyGroup({
    modelName: options?.config?.model,
    groupName: currentGroup,
    profileId: headers["x-api-key-profile-id"],
    providerId: headers["x-api-key-provider-id"],
  });
}

function logApiKeyGroupStart(
  chatPath: string,
  fallbackApiKeyGroups: string[],
  currentKeyIndex: number,
  headers: any,
  options: any,
) {
  if (fallbackApiKeyGroups.length === 0) {
    return;
  }

  const currentGroup = getApiKeyGroupName(
    fallbackApiKeyGroups,
    currentKeyIndex,
  );
  const providerName = options.config?.providerName || "API";
  const rememberedGroup = headers["x-remembered-api-key-group"];
  const isRememberedGroup =
    currentKeyIndex === 0 &&
    rememberedGroup &&
    rememberedGroup === currentGroup;

  if (isRememberedGroup) {
    logger.chat.log(
      `[MultiKey] 🔑 ${providerName} 命中已记忆分组 ${currentGroup}`,
    );
    return;
  }

  logger.chat.log(
    `[MultiKey] 🔄 ${providerName} 尝试分组 ${currentGroup}（${
      currentKeyIndex + 1
    }/${fallbackApiKeyGroups.length}）`,
  );
}

function getSafeRetryReason(reason: string, maxLength = 200) {
  return String(reason || "")
    .replace(/当前分组\s+[^"\s]+?\s+下/g, "当前分组 [provider-internal] 下")
    .replace(/\s*\(request id:[^)]+\)/gi, "")
    .replace(/"request_?id"\s*:\s*"[^"]+"/gi, '"requestId":"[hidden]"')
    .substring(0, maxLength);
}

function createApiKeyGroupRetryContext(params: {
  chatPath: string;
  headers: any;
  options: any;
  onRetry: () => void;
}) {
  const { chatPath, headers, options, onRetry } = params;
  const fallbackApiKeys: string[] = headers["x-fallback-api-keys"] || [];
  const fallbackApiKeyGroups: string[] =
    headers["x-fallback-api-key-groups"] || [];
  let currentKeyIndex = 0;
  let lastErrorText = "";
  let retryAttempt = 0; // 重试次数计数，用于退避延迟
  const providerName = options.config?.providerName || "API";
  const isMultiKeyRequest =
    fallbackApiKeys.length > 0 && fallbackApiKeyGroups.length > 0;

  if (isMultiKeyRequest) {
    logger.chat.log(
      `[MultiKey] 🔑 ${providerName} 已启用多 Key（${
        fallbackApiKeys.length
      } 个，分组: ${fallbackApiKeyGroups.join(" → ")}）`,
    );
  } else {
    console.debug(
      `[MultiKey] ${providerName} 未启用多 key（${fallbackApiKeys.length} keys, ${fallbackApiKeyGroups.length} groups）`,
    );
  }

  const getCurrentGroup = () =>
    getApiKeyGroupName(fallbackApiKeyGroups, currentKeyIndex);

  return {
    getCurrentIndex() {
      return currentKeyIndex;
    },
    getLastErrorText() {
      return lastErrorText;
    },
    setLastErrorText(reason: string) {
      lastErrorText = reason;
    },
    hasRemainingRetries() {
      if (!isMultiKeyRequest) {
        return false;
      }
      return currentKeyIndex < fallbackApiKeys.length - 1;
    },
    logAttemptStart() {
      if (!isMultiKeyRequest) {
        return;
      }
      logApiKeyGroupStart(
        chatPath,
        fallbackApiKeyGroups,
        currentKeyIndex,
        headers,
        options,
      );
    },
    resetLastError() {
      lastErrorText = "";
    },
    /**
     * 获取重试延迟（毫秒），使用指数退避 + 随机 jitter
     * 策略: delay = min(1000 * 2^attempt, 30000) * (0.8 ~ 1.2)
     */
    getRetryDelayMs(): number {
      if (!isMultiKeyRequest) return 0;
      const delay = Math.min(1000 * Math.pow(2, retryAttempt), 30000);
      const jitter = 0.8 + Math.random() * 0.4;
      retryAttempt++;
      return Math.round(delay * jitter);
    },
    resetRetryAttempt() {
      retryAttempt = 0;
    },
    rememberSuccess(finalText: string) {
      rememberApiKeyGroupIfNeeded(
        chatPath,
        fallbackApiKeyGroups,
        currentKeyIndex,
        headers,
        options,
        finalText,
      );
    },
    tryFallbackRetry(reason: string) {
      if (!isMultiKeyRequest) {
        return false;
      }

      const currentGroup = getCurrentGroup();
      const reasonSummary = getSafeRetryReason(reason);

      if (
        fallbackApiKeys.length === 0 ||
        currentKeyIndex >= fallbackApiKeys.length - 1
      ) {
        lastErrorText = formatApiKeyGroupFailureMessage(currentGroup, reason);
        logger.chat.log(
          `[MultiKey Retry] ❌ ${providerName} 所有分组重试失败（最后尝试: ${currentGroup}，原因: ${getSafeRetryReason(
            reason,
            100,
          )}）`,
        );
        return false;
      }

      const nextGroup = getApiKeyGroupName(
        fallbackApiKeyGroups,
        currentKeyIndex + 1,
      );

      logger.chat.log(
        `[MultiKey Retry] 🔄 ${providerName} 分组 ${currentGroup} 失败（${
          currentKeyIndex + 1
        }/${fallbackApiKeys.length}）：${reasonSummary}，切换到 ${nextGroup}`,
      );

      if (headers["x-remembered-api-key-group"] === currentGroup) {
        logger.chat.log(
          `[MultiKey Retry] 🔄 ${providerName} 已记忆分组 ${currentGroup} 失败，将继续尝试剩余分组（${fallbackApiKeyGroups
            .slice(currentKeyIndex + 1)
            .join(", ")}）`,
        );
      }

      currentKeyIndex++;
      lastErrorText = reason;

      const nextApiKey = fallbackApiKeys[currentKeyIndex];
      const authHeader =
        headers["x-api-key-auth-header"] || getAuthHeaderName(headers);
      const authType = String(headers["x-api-key-auth-type"] || "bearer");
      if (authType === "query-key") {
        headers["x-api-key-query-value"] = nextApiKey;
      } else if (authHeader) {
        headers[authHeader] =
          authType === "bearer" ? `Bearer ${nextApiKey}` : nextApiKey;
      }

      onRetry();
      return true;
    },
  };
}

function isHeicImage(file: Blob) {
  const name = String((file as Blob & { name?: string }).name || "");
  return /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(name);
}

export async function convertHeicImage(file: Blob): Promise<Blob> {
  if (!isHeicImage(file)) {
    return file;
  }

  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({
    blob: file,
    toType: "image/jpeg",
  });
  const convertedBlob = Array.isArray(converted) ? converted[0] : converted;
  if (!(convertedBlob instanceof Blob)) {
    throw new Error("HEIC 图片转换失败");
  }
  return convertedBlob;
}

export function compressImage(file: Blob, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (readerEvent: any) => {
      const image = new Image();
      image.onload = () => {
        let canvas = document.createElement("canvas");
        let ctx = canvas.getContext("2d");
        let width = image.width;
        let height = image.height;
        let quality = 0.9;
        let dataUrl;

        do {
          canvas.width = width;
          canvas.height = height;
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
          ctx?.drawImage(image, 0, 0, width, height);
          dataUrl = canvas.toDataURL("image/jpeg", quality);

          if (dataUrl.length < maxSize) break;

          if (quality > 0.5) {
            // Prioritize quality reduction
            quality -= 0.1;
          } else {
            // Then reduce the size
            width *= 0.9;
            height *= 0.9;
          }
        } while (dataUrl.length > maxSize);

        resolve(dataUrl);
      };
      image.onerror = reject;
      image.src = readerEvent.target.result;
    };
    reader.onerror = reject;

    void (async () => {
      const source = await convertHeicImage(file);
      reader.readAsDataURL(source);
    })().catch(reject);
  });
}

export async function preProcessImageContentBase(
  content: RequestMessage["content"],
  transformImageUrl: (url: string) => Promise<{ [key: string]: any }>,
) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const result = [];
  for (const part of content) {
    if (part?.type == "image_url" && part?.image_url?.url) {
      try {
        const url = await cacheImageToBase64Image(part?.image_url?.url);
        result.push(await transformImageUrl(url));
      } catch (error) {
        console.error("Error processing image URL:", error);
      }
    } else {
      result.push({ ...part });
    }
  }
  return result;
}

export async function preProcessImageContent(
  content: RequestMessage["content"],
) {
  return preProcessImageContentBase(content, async (url) => ({
    type: "image_url",
    image_url: { url },
  })) as Promise<MultimodalContent[] | string>;
}

export async function preProcessImageContentForAlibabaDashScope(
  content: RequestMessage["content"],
) {
  return preProcessImageContentBase(content, async (url) => ({
    image: url,
  }));
}

const imageCaches: Record<string, string> = {};
export function cacheImageToBase64Image(imageUrl: string) {
  if (imageUrl.includes(CACHE_URL_PREFIX)) {
    if (!imageCaches[imageUrl]) {
      const reader = new FileReader();
      return fetch(imageUrl, {
        method: "GET",
        mode: "cors",
        credentials: "include",
      })
        .then((res) => res.blob())
        .then(
          async (blob) =>
            (imageCaches[imageUrl] = await compressImage(blob, 256 * 1024)),
        ); // compressImage
    }
    return Promise.resolve(imageCaches[imageUrl]);
  }
  return Promise.resolve(imageUrl);
}

export function base64Image2Blob(base64Data: string, contentType: string) {
  const byteCharacters = atob(base64Data);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: contentType });
}

/**
 * 从 DOCX 文件提取纯文本内容
 * 使用 jszip 解析 DOCX 的 word/document.xml 并提取文本
 * @param blob DOCX 文件的 Blob 数据
 * @param maxLength 最大提取字符数，超过则截断
 * @returns 提取的纯文本
 */
export async function extractTextFromDocx(
  blob: Blob,
  maxLength: number = 50000,
): Promise<string> {
  try {
    const JSZip = (await import("jszip")).default;
    const arrayBuffer = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    const documentXml = await zip.file("word/document.xml")?.async("string");

    if (!documentXml) {
      return "[无法提取文本：文件格式异常，缺少 word/document.xml]";
    }

    // 提取 XML 中的所有 w:t 元素（Word 文本节点）
    const textMatches = documentXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
    let fullText = textMatches
      .map((match) => {
        const content = match.replace(/<[^>]+>/g, "");
        return content;
      })
      .join("")
      .replace(/\n{3,}/g, "\n\n") // 合并多余空行
      .trim();

    // 截断超长文本
    if (fullText.length > maxLength) {
      fullText = fullText.substring(0, maxLength) + "\n\n[... 内容已截断 ...]";
    }

    return fullText;
  } catch (error) {
    console.error("[extractTextFromDocx] 提取 DOCX 文本失败:", error);
    return `[提取文本失败: ${String(error)}]`;
  }
}

/**
 * 从 Blob 或 URL 获取文件内容
 * @param source Blob 或 URL 字符串
 * @returns 文件的 ArrayBuffer
 */
async function getFileArrayBuffer(source: Blob | string): Promise<ArrayBuffer> {
  if (source instanceof Blob) {
    return source.arrayBuffer();
  }

  // 如果是 URL，通过 fetch 获取
  const response = await fetch(source, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`文件读取失败（${response.status}）`);
  }
  return response.arrayBuffer();
}

/**
 * 从 PDF 文件提取文本内容
 * @param blob PDF 文件的 Blob 数据
 * @param maxLength 最大提取字符数
 * @returns 提取的纯文本
 */
export async function extractTextFromPdf(
  blob: Blob,
  maxLength: number = 50000,
): Promise<string> {
  try {
    const pdfjsLib = await import("pdfjs-dist");
    // 设置 worker 以避免跨域问题
    const pdfjsVersion = pdfjsLib.version;
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.min.js`;

    const arrayBuffer = await blob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const textParts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(" ");
      if (pageText.trim()) {
        textParts.push(pageText);
      }
    }

    let fullText = textParts.join("\n\n").trim();

    // 截断超长文本
    if (fullText.length > maxLength) {
      fullText = fullText.substring(0, maxLength) + "\n\n[... 内容已截断 ...]";
    }

    return fullText || "[PDF 文件未包含可提取的文本内容]";
  } catch (error) {
    console.error("[extractTextFromPdf] 提取 PDF 文本失败:", error);
    return `[提取 PDF 文本失败: ${String(error)}]`;
  }
}

/**
 * 从 Excel 文件提取表格内容
 * @param blob Excel 文件的 Blob 数据
 * @param maxLength 最大提取字符数
 * @returns 提取的纯文本
 */
export async function extractTextFromExcel(
  blob: Blob,
  maxLength: number = 50000,
): Promise<string> {
  try {
    const XLSX = await import("xlsx");
    const arrayBuffer = await blob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "array" });

    const sheetParts: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv.trim()) {
        sheetParts.push(`【工作表: ${sheetName}】\n${csv}`);
      }
    }

    let fullText = sheetParts.join("\n\n");
    if (fullText.length > maxLength) {
      fullText = fullText.substring(0, maxLength) + "\n\n[... 内容已截断 ...]";
    }

    return fullText || "[Excel 文件未包含可提取的表格内容]";
  } catch (error) {
    console.error("[extractTextFromExcel] 提取 Excel 文本失败:", error);
    return `[提取 Excel 文本失败: ${String(error)}]`;
  }
}

/**
 * 从附件提取可发送给 AI 的文本内容
 * 支持 DOCX、PDF、Excel 格式
 * @param file 附件对象（包含 file 对象或 previewUrl）
 * @returns 提取的文本，如果不支持则返回空字符串
 */
export async function extractAttachmentText(
  file: ChatMessageAttachedFile & { file?: Blob },
): Promise<string> {
  const fileName = String(file.name || "").toLowerCase();

  // 判断文件类型
  const isDocx = fileName.endsWith(".docx");
  const isPdf = fileName.endsWith(".pdf");
  const isExcel = /\.(xlsx|xls|csv)$/.test(fileName);

  if (!isDocx && !isPdf && !isExcel) {
    return "";
  }

  console.log(
    `[extractAttachmentText] 开始提取文件: ${fileName}, 类型: ${isDocx ? "docx" : isPdf ? "pdf" : "excel"}, hasFile: ${!!file.file}, hasPreviewUrl: ${!!file.previewUrl}`,
  );

  try {
    let blob: Blob;

    // 优先使用原始 file 对象
    if (file.file instanceof Blob) {
      blob = file.file;
    } else if (file.previewUrl) {
      // 通过 previewUrl 下载
      const mimeTypes: Record<string, string> = {
        ".docx":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".pdf": "application/pdf",
        ".xlsx":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xls": "application/vnd.ms-excel",
        ".csv": "text/csv",
      };
      const ext = fileName.match(/\.[^.]+$/)?.[0] || "";
      const mimeType = mimeTypes[ext] || "application/octet-stream";
      console.log(
        `[extractAttachmentText] 通过 previewUrl 下载: ${file.previewUrl}, mimeType: ${mimeType}`,
      );
      blob = new Blob([await getFileArrayBuffer(file.previewUrl)], {
        type: mimeType,
      });
    } else {
      console.log(`[extractAttachmentText] 没有 file 对象也没有 previewUrl`);
      return "";
    }

    console.log(
      `[extractAttachmentText] blob 大小: ${blob.size}, 类型: ${blob.type}`,
    );

    let text = "";
    if (isDocx) {
      text = await extractTextFromDocx(blob);
    } else if (isPdf) {
      text = await extractTextFromPdf(blob);
    } else if (isExcel) {
      text = await extractTextFromExcel(blob);
    }

    console.log(
      `[extractAttachmentText] 提取结果: ${text.substring(0, 200)}${text.length > 200 ? "..." : ""}`,
    );

    if (!text || text.startsWith("[")) {
      return ""; // 提取失败时不添加文本
    }

    return `【文件 "${file.name}" 的正文内容】\n${text}`;
  } catch (error) {
    console.error("[extractAttachmentText] 提取附件文本失败:", error);
    return "";
  }
}

export async function uploadImage(file: Blob): Promise<string> {
  try {
    return await uploadFile(file);
  } catch {
    return compressImage(file, 256 * 1024);
  }
}

export function uploadFile(file: Blob): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  return fetch(UPLOAD_URL, {
    method: "post",
    body,
    mode: "cors",
    credentials: "include",
  })
    .then((res) => res.json())
    .then((res) => {
      // console.log("res", res);
      if (res?.code == 0 && res?.data) {
        return res?.data;
      }
      throw Error(`upload Error: ${res?.msg}`);
    });
}

export function removeImage(imageUrl: string) {
  return fetch(imageUrl, {
    method: "DELETE",
    mode: "cors",
    credentials: "include",
  });
}

export function stream(
  chatPath: string,
  requestPayload: any,
  headers: any,
  tools: any[],
  funcs: Record<string, Function>,
  controller: AbortController,
  parseSSE: (text: string, runTools: any[]) => string | undefined,
  processToolMessage: (
    requestPayload: any,
    toolCallMessage: any,
    toolCallResult: any[],
  ) => void,
  options: any,
) {
  let responseText = "";
  let remainText = "";
  let finished = false;
  let running = false;
  let pendingRetry = false;
  let activeRequestSeq = 0;
  let currentRequestAccepted = false;
  let terminalErrorReported = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let runTools: any[] = [];
  let responseRes: Response;
  const scheduleChatRequest = (delayMs: number, beforeRequest?: () => void) => {
    if (controller.signal.aborted || finished) {
      pendingRetry = false;
      return;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (controller.signal.aborted || finished) {
        pendingRetry = false;
        return;
      }
      beforeRequest?.();
      chatApi(chatPath, headers, requestPayload, tools);
    }, delayMs);
  };
  const apiKeyRetry = createApiKeyGroupRetryContext({
    chatPath,
    headers,
    options,
    onRetry: () => {
      pendingRetry = true;
      scheduleChatRequest(apiKeyRetry.getRetryDelayMs());
    },
  });

  const tryPathRetry = (reason: string, response?: Response) => {
    const nextPath = options?.onPathRetry?.(reason, chatPath, response);
    if (!nextPath) return false;
    pendingRetry = true;
    apiKeyRetry.setLastErrorText(reason);
    responseText = "";
    remainText = "";
    runTools = [];
    chatPath = nextPath;
    scheduleChatRequest(0);
    return true;
  };

  const reportTerminalError = (reason: string) => {
    if (terminalErrorReported) return;
    terminalErrorReported = true;
    finished = true;
    options.onError?.(new Error(reason));
  };

  // animate response to make it looks smooth
  function animateResponseText() {
    if (finished || controller.signal.aborted) {
      responseText += remainText;
      return;
    }
    if (pendingRetry) {
      // 重试期间使用 setTimeout 降低 CPU 消耗
      setTimeout(() => requestAnimationFrame(animateResponseText), 100);
      return;
    }

    if (remainText.length > 0) {
      const fetchCount = Math.max(1, Math.round(remainText.length / 60));
      const fetchText = remainText.slice(0, fetchCount);
      responseText += fetchText;
      remainText = remainText.slice(fetchCount);
      options.onUpdate?.(responseText, fetchText);
    }

    requestAnimationFrame(animateResponseText);
  }

  // start animaion
  animateResponseText();

  const finish = () => {
    // 即使有 pendingRetry，也要优先处理中止状态
    if (controller.signal.aborted) {
      if (!finished) {
        finished = true;
        pendingRetry = false;
        options.onFinish(responseText + remainText, responseRes);
      }
      return;
    }
    if (pendingRetry) {
      return;
    }
    if (!finished) {
      if (!running && runTools.length > 0) {
        const executableTools = runTools.filter(
          (tool) => tool?.id && tool?.function?.name,
        );
        if (executableTools.length !== runTools.length) {
          console.warn("[Plugin] 跳过无效工具调用", {
            skipped: runTools.length - executableTools.length,
            toolCalls: runTools,
          });
        }
        if (executableTools.length === 0) {
          runTools.splice(0, runTools.length);
          return finish();
        }
        const toolCallMessage = {
          role: "assistant",
          tool_calls: executableTools,
        };
        running = true;
        runTools.splice(0, runTools.length); // empty runTools
        return Promise.all(
          toolCallMessage.tool_calls.map((tool) => {
            options?.onBeforeTool?.(tool);
            let toolArguments = {};
            try {
              toolArguments = tool?.function?.arguments
                ? JSON.parse(tool.function.arguments)
                : {};
            } catch (e) {
              return Promise.reject(e)
                .catch((e) => {
                  const errorMsg = `工具参数 JSON 解析失败: ${e.toString()}`;
                  options?.onAfterTool?.({
                    ...tool,
                    isError: true,
                    errorMsg,
                  });
                  return errorMsg;
                })
                .then((content) => ({
                  name: tool.function.name,
                  role: "tool",
                  content,
                  tool_call_id: tool.id,
                }));
            }
            return Promise.resolve(
              // @ts-ignore
              funcs[tool.function.name](toolArguments),
            )
              .then((res) => {
                let content = res.data || res?.statusText;
                // hotfix #5614
                content =
                  typeof content === "string"
                    ? content
                    : JSON.stringify(content);
                if (res.status >= 300) {
                  return Promise.reject(content);
                }
                return content;
              })
              .then((content) => {
                options?.onAfterTool?.({
                  ...tool,
                  content,
                  isError: false,
                });
                return content;
              })
              .catch((e) => {
                options?.onAfterTool?.({
                  ...tool,
                  isError: true,
                  errorMsg: e.toString(),
                });
                return e.toString();
              })
              .then((content) => ({
                name: tool.function.name,
                role: "tool",
                content,
                tool_call_id: tool.id,
              }));
          }),
        ).then((toolCallResult) => {
          processToolMessage(requestPayload, toolCallMessage, toolCallResult);
          scheduleChatRequest(60, () => {
            logChatTrace("[ChatAPI] restart");
            running = false;
          });
        });
        return;
      }
      if (running) {
        return;
      }
      if (responseText.length + remainText.length === 0) {
        const errorText =
          apiKeyRetry.getLastErrorText() || "empty response from server";
        if (apiKeyRetry.tryFallbackRetry(errorText)) {
          return;
        }
        apiKeyRetry.setLastErrorText(errorText);
        reportTerminalError(errorText);
        return;
      }
      logChatTrace("[ChatAPI] end");
      finished = true;
      if (currentRequestAccepted) {
        apiKeyRetry.rememberSuccess(responseText + remainText);
        options?.onPathSuccess?.(chatPath);
      }
      options.onFinish(responseText + remainText, responseRes); // 将res传递给onFinish
    }
  };

  controller.signal.onabort = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    pendingRetry = false;
    finish();
  };

  function chatApi(
    chatPath: string,
    headers: any,
    requestPayload: any,
    tools: any,
  ) {
    // 每次发起新请求前重置重试状态，避免上一次重试标记阻塞 finish
    pendingRetry = false;
    currentRequestAccepted = false;
    const requestSeq = ++activeRequestSeq;
    apiKeyRetry.logAttemptStart();
    const hasTools = Array.isArray(tools) && tools.length > 0;
    const chatPayload = {
      method: "POST",
      body: JSON.stringify({
        ...requestPayload,
        tools: hasTools ? tools : undefined,
        tool_choice: hasTools ? requestPayload?.tool_choice : undefined,
        toolConfig: hasTools ? requestPayload?.toolConfig : undefined,
      }),
      signal: controller.signal,
      headers: stripInternalChatHeaders(headers),
    };
    const requestTimeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    fetchEventSource(chatPath, {
      fetch: tauriFetch as any,
      ...chatPayload,
      async onopen(res) {
        if (requestSeq !== activeRequestSeq) {
          return;
        }
        clearTimeout(requestTimeoutId);
        const contentType = res.headers.get("content-type");
        // console.log("[Request] response content type: ", contentType);
        responseRes = res;

        if (contentType?.startsWith("text/plain")) {
          pendingRetry = false;
          responseText = await res.clone().text();
          apiKeyRetry.setLastErrorText(responseText);
          currentRequestAccepted = true;
          return finish();
        }

        if (
          !res.ok ||
          !res.headers
            .get("content-type")
            ?.startsWith(EventStreamContentType) ||
          res.status !== 200
        ) {
          const responseTexts = [responseText];
          let extraInfo = await res.clone().text();
          const requestErrorText =
            extraInfo || `HTTP ${res.status} ${res.statusText || ""}`.trim();
          apiKeyRetry.setLastErrorText(requestErrorText);

          // 优先尝试路径重试
          if (tryPathRetry(requestErrorText, res)) {
            return;
          }

          // 解析 JSON 检测可重试错误（model_not_found 等）
          let resJson: any = null;
          try {
            resJson = JSON.parse(extraInfo || "");
          } catch {}
          const retryableReason = resJson
            ? getRetryableErrorReason(resJson)
            : "";

          // 如果是可重试错误，优先触发 Key 切换重试
          if (
            retryableReason &&
            apiKeyRetry.tryFallbackRetry(retryableReason)
          ) {
            return;
          }

          if (apiKeyRetry.tryFallbackRetry(requestErrorText)) {
            return; // 不调用 finish，继续重试
          }

          // 复用已解析的 JSON 用于显示
          if (resJson) {
            extraInfo = prettyObject(resJson);
          }

          if (res.status === 401) {
            responseTexts.push(Locale.Error.Unauthorized);
          }

          if (extraInfo) {
            responseTexts.push(extraInfo);
          }

          responseText = responseTexts.join("\n\n");
          apiKeyRetry.setLastErrorText(responseText);

          return finish();
        }

        pendingRetry = false;
        apiKeyRetry.resetLastError();
        currentRequestAccepted = true;
      },
      onmessage(msg) {
        if (requestSeq !== activeRequestSeq) {
          return;
        }
        if (msg.data === "[DONE]" || finished) {
          return finish();
        }
        const text = msg.data;
        // Skip empty messages
        if (!text || text.trim().length === 0) {
          return;
        }
        try {
          const chunk = parseSSE(text, runTools);
          if (chunk) {
            remainText += chunk;
          }
        } catch (e) {
          console.error("[Request] parse error", text, msg, e);
        }
      },
      onclose() {
        if (requestSeq !== activeRequestSeq) {
          return;
        }
        clearTimeout(requestTimeoutId);
        if (pendingRetry) {
          return;
        }
        finish();
      },
      onerror(e) {
        if (requestSeq !== activeRequestSeq) {
          return;
        }
        clearTimeout(requestTimeoutId);
        const errorText =
          e?.message || e?.toString?.() || "stream connection failed";
        if (tryPathRetry(errorText)) {
          return;
        }
        if (apiKeyRetry.tryFallbackRetry(errorText)) {
          return;
        }
        if (pendingRetry) {
          return;
        }
        apiKeyRetry.setLastErrorText(
          e?.message || e?.toString?.() || apiKeyRetry.getLastErrorText(),
        );
        options?.onError?.(e);
        throw e;
      },
      openWhenHidden: true,
    });
  }
  logChatTrace("[ChatAPI] start");
  chatApi(chatPath, headers, requestPayload, tools); // call fetchEventSource
}

export function streamWithThink(
  chatPath: string,
  requestPayload: any,
  headers: any,
  tools: any[],
  funcs: Record<string, Function>,
  controller: AbortController,
  parseSSE: (
    text: string,
    runTools: any[],
  ) => {
    isThinking: boolean;
    content: string | undefined;
  },
  processToolMessage: (
    requestPayload: any,
    toolCallMessage: any,
    toolCallResult: any[],
  ) => void,
  options: any,
) {
  let responseText = "";
  let remainText = "";
  let finished = false;
  let running = false;
  let pendingRetry = false;
  let activeRequestSeq = 0;
  let currentRequestAccepted = false;
  let terminalErrorReported = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let runTools: any[] = [];
  let responseRes: Response;
  let isInThinkingMode = false;
  let lastIsThinking = false;
  let lastIsThinkingTagged = false; //between <think> and </think> tags
  const scheduleChatRequest = (delayMs: number, beforeRequest?: () => void) => {
    if (controller.signal.aborted || finished) {
      pendingRetry = false;
      return;
    }
    if (retryTimer) {
      clearTimeout(retryTimer);
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (controller.signal.aborted || finished) {
        pendingRetry = false;
        return;
      }
      beforeRequest?.();
      chatApi(chatPath, headers, requestPayload, tools);
    }, delayMs);
  };
  const apiKeyRetry = createApiKeyGroupRetryContext({
    chatPath,
    headers,
    options,
    onRetry: () => {
      pendingRetry = true;
      scheduleChatRequest(apiKeyRetry.getRetryDelayMs(), () => {
        const authType = String(headers["x-api-key-auth-type"] || "bearer");
        if (authType === "query-key") {
          const nextApiKey = headers["x-api-key-query-value"] || "";
          const queryParamName = String(
            headers["x-api-key-auth-query-param"] || "key",
          ).trim();
          chatPath = replaceUrlQueryParam(chatPath, queryParamName, nextApiKey);
        }
      });
    },
  });

  const tryPathRetry = (reason: string, response?: Response) => {
    const nextPath = options?.onPathRetry?.(reason, chatPath, response);
    if (!nextPath) return false;
    pendingRetry = true;
    apiKeyRetry.setLastErrorText(reason);
    responseText = "";
    remainText = "";
    runTools = [];
    chatPath = nextPath;
    scheduleChatRequest(0);
    return true;
  };

  const reportTerminalError = (reason: string) => {
    if (terminalErrorReported) return;
    terminalErrorReported = true;
    finished = true;
    options.onError?.(new Error(reason));
  };

  // animate response to make it looks smooth
  function animateResponseText() {
    if (finished || controller.signal.aborted) {
      responseText += remainText;
      return;
    }
    if (pendingRetry) {
      // 重试期间使用 setTimeout 降低 CPU 消耗
      setTimeout(() => requestAnimationFrame(animateResponseText), 100);
      return;
    }

    if (remainText.length > 0) {
      const fetchCount = Math.max(1, Math.round(remainText.length / 60));
      const fetchText = remainText.slice(0, fetchCount);
      responseText += fetchText;
      remainText = remainText.slice(fetchCount);
      options.onUpdate?.(responseText, fetchText);
    }

    requestAnimationFrame(animateResponseText);
  }

  // start animaion
  animateResponseText();

  const tryCompatibilityRetry = (reason: string) => {
    const nextPayload = options?.onCompatibilityRetry?.(reason, requestPayload);
    if (!nextPayload) {
      return false;
    }

    console.warn("[Chat Compatibility] 检测到不兼容参数，已关闭后重试");
    pendingRetry = true;
    apiKeyRetry.setLastErrorText(reason);
    responseText = "";
    remainText = "";
    runTools = [];
    isInThinkingMode = false;
    lastIsThinking = false;
    lastIsThinkingTagged = false;
    requestPayload = nextPayload;

    scheduleChatRequest(0);

    return true;
  };

  const finish = () => {
    // 即使有 pendingRetry，也要优先处理中止状态
    if (controller.signal.aborted) {
      if (!finished) {
        finished = true;
        pendingRetry = false;
        options.onFinish(responseText + remainText, responseRes);
      }
      return;
    }
    if (pendingRetry) {
      return;
    }
    if (!finished) {
      if (!running && runTools.length > 0) {
        const executableTools = runTools.filter(
          (tool) => tool?.id && tool?.function?.name,
        );
        if (executableTools.length !== runTools.length) {
          console.warn("[Plugin] 跳过无效工具调用", {
            skipped: runTools.length - executableTools.length,
            toolCalls: runTools,
          });
        }
        if (executableTools.length === 0) {
          runTools.splice(0, runTools.length);
          return finish();
        }
        const toolCallMessage = {
          role: "assistant",
          tool_calls: executableTools,
        };
        running = true;
        runTools.splice(0, runTools.length); // empty runTools
        return Promise.all(
          toolCallMessage.tool_calls.map((tool) => {
            options?.onBeforeTool?.(tool);
            let toolArguments = {};
            try {
              toolArguments = tool?.function?.arguments
                ? JSON.parse(tool.function.arguments)
                : {};
            } catch (e) {
              return Promise.reject(e)
                .catch((e) => {
                  const errorMsg = `工具参数 JSON 解析失败: ${e.toString()}`;
                  options?.onAfterTool?.({
                    ...tool,
                    isError: true,
                    errorMsg,
                  });
                  return errorMsg;
                })
                .then((content) => ({
                  name: tool.function.name,
                  role: "tool",
                  content,
                  tool_call_id: tool.id,
                }));
            }
            return Promise.resolve(
              // @ts-ignore
              funcs[tool.function.name](toolArguments),
            )
              .then((res) => {
                let content = res.data || res?.statusText;
                // hotfix #5614
                content =
                  typeof content === "string"
                    ? content
                    : JSON.stringify(content);
                if (res.status >= 300) {
                  return Promise.reject(content);
                }
                return content;
              })
              .then((content) => {
                options?.onAfterTool?.({
                  ...tool,
                  content,
                  isError: false,
                });
                return content;
              })
              .catch((e) => {
                options?.onAfterTool?.({
                  ...tool,
                  isError: true,
                  errorMsg: e.toString(),
                });
                return e.toString();
              })
              .then((content) => ({
                name: tool.function.name,
                role: "tool",
                content,
                tool_call_id: tool.id,
              }));
          }),
        ).then((toolCallResult) => {
          processToolMessage(requestPayload, toolCallMessage, toolCallResult);
          scheduleChatRequest(60, () => {
            logChatTrace("[ChatAPI] restart");
            running = false;
          });
        });
        return;
      }
      if (running) {
        return;
      }
      if (responseText.length + remainText.length === 0) {
        const errorText =
          apiKeyRetry.getLastErrorText() || "empty response from server";
        if (apiKeyRetry.tryFallbackRetry(errorText)) {
          return;
        }
        apiKeyRetry.setLastErrorText(errorText);
        reportTerminalError(errorText);
        return;
      }
      logChatTrace("[ChatAPI] end");
      finished = true;
      if (currentRequestAccepted) {
        apiKeyRetry.rememberSuccess(responseText + remainText);
        options?.onPathSuccess?.(chatPath);
      }
      options?.onCompatibilitySuccess?.(
        responseText + remainText,
        requestPayload,
      );
      options.onFinish(responseText + remainText, responseRes);
    }
  };

  controller.signal.onabort = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    pendingRetry = false;
    finish();
  };

  function chatApi(
    chatPath: string,
    headers: any,
    requestPayload: any,
    tools: any,
  ) {
    // 每次发起新请求前重置重试状态，避免上一次重试标记阻塞 finish
    pendingRetry = false;
    currentRequestAccepted = false;
    const requestSeq = ++activeRequestSeq;
    apiKeyRetry.logAttemptStart();
    const hasTools = Array.isArray(tools) && tools.length > 0;
    const chatPayload = {
      method: "POST",
      body: JSON.stringify({
        ...requestPayload,
        tools: hasTools ? tools : undefined,
        tool_choice: hasTools ? requestPayload?.tool_choice : undefined,
        toolConfig: hasTools ? requestPayload?.toolConfig : undefined,
      }),
      signal: controller.signal,
      headers: stripInternalChatHeaders(headers),
    };
    const requestTimeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    fetchEventSource(chatPath, {
      fetch: tauriFetch as any,
      ...chatPayload,
      async onopen(res) {
        if (requestSeq !== activeRequestSeq) {
          return;
        }
        clearTimeout(requestTimeoutId);
        const contentType = res.headers.get("content-type");
        // console.log("[Request] response content type: ", contentType);
        responseRes = res;

        if (contentType?.startsWith("text/plain")) {
          pendingRetry = false;
          responseText = await res.clone().text();
          apiKeyRetry.setLastErrorText(responseText);
          currentRequestAccepted = true;
          return finish();
        }

        if (
          !res.ok ||
          !res.headers
            .get("content-type")
            ?.startsWith(EventStreamContentType) ||
          res.status !== 200
        ) {
          const responseTexts = [responseText];
          let extraInfo = await res.clone().text();
          const requestErrorText =
            extraInfo || `HTTP ${res.status} ${res.statusText || ""}`.trim();
          apiKeyRetry.setLastErrorText(requestErrorText);

          if (tryPathRetry(requestErrorText, res)) {
            return;
          }

          if (tryCompatibilityRetry(requestErrorText)) {
            return;
          }

          if (apiKeyRetry.tryFallbackRetry(requestErrorText)) {
            return; // 不调用 finish，继续重试
          }

          const retryErrorText = apiKeyRetry.getLastErrorText();
          if (retryErrorText) {
            responseTexts.push(retryErrorText);
          }

          try {
            const resJson = await res.clone().json();
            extraInfo = prettyObject(resJson);
          } catch {}

          if (res.status === 401) {
            responseTexts.push(Locale.Error.Unauthorized);
          }

          if (extraInfo) {
            responseTexts.push(extraInfo);
          }

          responseText = responseTexts.join("\n\n");
          apiKeyRetry.setLastErrorText(responseText);

          return finish();
        }

        pendingRetry = false;
        apiKeyRetry.resetLastError();
        currentRequestAccepted = true;
      },
      onmessage(msg) {
        if (requestSeq !== activeRequestSeq) {
          return;
        }
        if (msg.data === "[DONE]" || finished) {
          return finish();
        }
        const text = msg.data;
        // Skip empty messages
        if (!text || text.trim().length === 0) {
          return;
        }
        try {
          const chunk = parseSSE(text, runTools);
          // Skip if content is empty
          if (!chunk?.content || chunk.content.length === 0) {
            return;
          }

          // When thought display is disabled, preserve any final answer that
          // shares an SSE chunk with <think> tags instead of dropping it.
          if (options.config.includeThoughts === false) {
            if (chunk.isThinking) {
              return;
            }
            const stripped = stripHiddenThinkingTags(
              chunk.content,
              lastIsThinkingTagged,
            );
            lastIsThinkingTagged = stripped.isInsideThinkingTag;
            chunk.content = stripped.content;
            if (!chunk.content) {
              return;
            }
          } else if (!chunk.isThinking) {
            if (chunk.content.startsWith("<think>")) {
              chunk.isThinking = true;
              chunk.content = chunk.content.slice(7).trim();
              lastIsThinkingTagged = true;
            } else if (chunk.content.endsWith("</think>")) {
              chunk.isThinking = false;
              chunk.content = chunk.content.slice(0, -8).trim();
              lastIsThinkingTagged = false;
            } else if (lastIsThinkingTagged) {
              chunk.isThinking = true;
            }
          }

          // Check if thinking mode changed
          const isThinkingChanged = lastIsThinking !== chunk.isThinking;
          lastIsThinking = chunk.isThinking;

          if (chunk.isThinking) {
            // If in thinking mode
            if (!isInThinkingMode || isThinkingChanged) {
              // If this is a new thinking block or mode changed, add prefix
              isInThinkingMode = true;
              if (remainText.length > 0) {
                remainText += "\n";
              }
              remainText += "> " + chunk.content;
            } else {
              // Handle newlines in thinking content
              if (chunk.content.includes("\n\n")) {
                const lines = chunk.content.split("\n\n");
                remainText += lines.join("\n\n> ");
              } else {
                remainText += chunk.content;
              }
            }
          } else {
            // If in normal mode
            if (isInThinkingMode || isThinkingChanged) {
              // If switching from thinking mode to normal mode
              isInThinkingMode = false;
              remainText += "\n\n" + chunk.content;
            } else {
              remainText += chunk.content;
            }
          }
        } catch (e) {
          console.error("[Request] parse error", text, msg, e);
          // Don't throw error for parse failures, just log them
        }
      },
      onclose() {
        if (requestSeq !== activeRequestSeq) {
          return;
        }
        clearTimeout(requestTimeoutId);
        if (pendingRetry) {
          return;
        }
        finish();
      },
      onerror(e) {
        if (requestSeq !== activeRequestSeq) {
          return;
        }
        clearTimeout(requestTimeoutId);
        const errorText =
          e?.message || e?.toString?.() || "stream connection failed";
        if (tryPathRetry(errorText)) {
          return;
        }
        if (apiKeyRetry.tryFallbackRetry(errorText)) {
          return;
        }
        if (pendingRetry) {
          return;
        }
        apiKeyRetry.setLastErrorText(
          e?.message || e?.toString?.() || apiKeyRetry.getLastErrorText(),
        );
        options?.onError?.(e);
        throw e;
      },
      openWhenHidden: true,
    });
  }
  logChatTrace("[ChatAPI] start");
  chatApi(chatPath, headers, requestPayload, tools); // call fetchEventSource
}
