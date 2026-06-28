import {
  CACHE_URL_PREFIX,
  UPLOAD_URL,
  REQUEST_TIMEOUT_MS,
} from "@/app/constant";
import type { MultimodalContent, RequestMessage } from "@/app/client/api";
import * as LocaleModule from "@/app/locales";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import * as FormatModule from "./format";
import * as StreamModule from "./stream";
import * as ModelApiKeyMemoryModule from "./model-api-key-memory";

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

  console.log(`[MultiKey] ${providerName} ✅ 分组请求成功`, {
    currentGroup,
    attempt: currentKeyIndex + 1,
    totalGroups: fallbackApiKeyGroups.length,
    modelName: options?.config?.model,
    willSaveToLocalStorage: true,
  });

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
    console.log(`[MultiKey] ${providerName} 命中已记忆分组，正在尝试`, {
      currentGroup,
      attempt: currentKeyIndex + 1,
      totalGroups: fallbackApiKeyGroups.length,
      loadedFromLocalStorage: true,
    });
    return;
  }

  console.log(`[MultiKey] ${providerName} 正在尝试分组`, {
    currentGroup,
    attempt: currentKeyIndex + 1,
    totalGroups: fallbackApiKeyGroups.length,
  });
}

function getSafeRetryReason(reason: string, maxLength = 200) {
  return String(reason || "")
    .replace(/当前分组\s+[^"\s]+?\s+下/g, "当前分组 [provider-internal] 下")
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
  const providerName = options.config?.providerName || "API";
  const isMultiKeyRequest =
    fallbackApiKeys.length > 0 && fallbackApiKeyGroups.length > 0;

  if (isMultiKeyRequest) {
    console.log(`[MultiKey] ${providerName} 当前请求启用多 key`, {
      fallbackKeysCount: fallbackApiKeys.length,
      groupOrder: fallbackApiKeyGroups,
      rememberedGroup: headers["x-remembered-api-key-group"] || "",
      chatPath: chatPath.substring(0, 80),
    });
  } else {
    console.log(`[MultiKey] ${providerName} 当前请求未启用多 key`, {
      fallbackKeysCount: fallbackApiKeys.length,
      fallbackGroupsCount: fallbackApiKeyGroups.length,
      chatPath: chatPath.substring(0, 80),
    });
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
      console.log(`[MultiKey] ${providerName} 分组请求开始`, {
        currentGroup: getCurrentGroup(),
        attempt: currentKeyIndex + 1,
        totalGroups: fallbackApiKeys.length,
        requestPath: chatPath.substring(0, 80),
      });
    },
    resetLastError() {
      lastErrorText = "";
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
        console.log(`[MultiKey Retry] ${providerName} ❌ 所有分组重试失败`, {
          currentGroup,
          reason: getSafeRetryReason(reason, 100),
          totalGroups: fallbackApiKeys.length,
        });
        return false;
      }

      const nextGroup = getApiKeyGroupName(
        fallbackApiKeyGroups,
        currentKeyIndex + 1,
      );

      console.log(`[MultiKey Retry] ${providerName} ❌ 分组尝试失败`, {
        currentGroup,
        attempt: currentKeyIndex + 1,
        totalGroups: fallbackApiKeys.length,
        reason: reasonSummary,
        nextGroup,
      });

      if (headers["x-remembered-api-key-group"] === currentGroup) {
        console.log(
          `[MultiKey Retry] ${providerName} 已记忆分组失败，将继续尝试全部剩余分组`,
          {
            rememberedGroup: currentGroup,
            remainingGroups: fallbackApiKeyGroups.slice(currentKeyIndex + 1),
          },
        );
      }

      console.log(
        `[MultiKey Retry] ${providerName} 🔄 切换分组 (${currentKeyIndex + 1}/${
          fallbackApiKeys.length
        }): ${currentGroup} → ${nextGroup}`,
      );

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
  let runTools: any[] = [];
  let responseRes: Response;
  const apiKeyRetry = createApiKeyGroupRetryContext({
    chatPath,
    headers,
    options,
    onRetry: () => {
      pendingRetry = true;
      setTimeout(() => {
        chatApi(chatPath, headers, requestPayload, tools);
      }, 0);
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
    setTimeout(() => {
      chatApi(chatPath, headers, requestPayload, tools);
    }, 0);
    return true;
  };

  // animate response to make it looks smooth
  function animateResponseText() {
    if (pendingRetry) {
      requestAnimationFrame(animateResponseText);
      return;
    }
    if (controller.signal.aborted && apiKeyRetry.hasRemainingRetries()) {
      requestAnimationFrame(animateResponseText);
      return;
    }
    if (finished || controller.signal.aborted) {
      responseText += remainText;
      // console.log("[Response Animation] finished");
      if (responseText?.length === 0) {
        const errorText =
          apiKeyRetry.getLastErrorText() || "empty response from server";
        if (apiKeyRetry.tryFallbackRetry(errorText)) {
          requestAnimationFrame(animateResponseText);
          return;
        }
        options.onError?.(new Error(errorText));
      }
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
          setTimeout(() => {
            // call again
            logChatTrace("[ChatAPI] restart");
            running = false;
            chatApi(chatPath, headers, requestPayload, tools); // call fetchEventSource
          }, 60);
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
        responseText = errorText;
        apiKeyRetry.setLastErrorText(errorText);
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

  controller.signal.onabort = finish;

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
    const chatPayload = {
      method: "POST",
      body: JSON.stringify({
        ...requestPayload,
        tools: tools && tools.length ? tools : undefined,
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
        if (pendingRetry) {
          return;
        }
        finish();
      },
      onerror(e) {
        if (requestSeq !== activeRequestSeq) {
          return;
        }
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
  let runTools: any[] = [];
  let responseRes: Response;
  let isInThinkingMode = false;
  let lastIsThinking = false;
  let lastIsThinkingTagged = false; //between <think> and </think> tags
  const apiKeyRetry = createApiKeyGroupRetryContext({
    chatPath,
    headers,
    options,
    onRetry: () => {
      pendingRetry = true;
      setTimeout(() => {
        chatApi(chatPath, headers, requestPayload, tools);
      }, 0);
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
    setTimeout(() => {
      chatApi(chatPath, headers, requestPayload, tools);
    }, 0);
    return true;
  };

  // animate response to make it looks smooth
  function animateResponseText() {
    if (pendingRetry) {
      requestAnimationFrame(animateResponseText);
      return;
    }
    if (controller.signal.aborted && apiKeyRetry.hasRemainingRetries()) {
      requestAnimationFrame(animateResponseText);
      return;
    }
    if (finished || controller.signal.aborted) {
      responseText += remainText;
      // console.log("[Response Animation] finished");
      if (responseText?.length === 0) {
        const errorText =
          apiKeyRetry.getLastErrorText() || "empty response from server";
        if (apiKeyRetry.tryFallbackRetry(errorText)) {
          requestAnimationFrame(animateResponseText);
          return;
        }
        options.onError?.(new Error(errorText));
      }
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

    setTimeout(() => {
      chatApi(chatPath, headers, requestPayload, tools);
    }, 0);

    return true;
  };

  const finish = () => {
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
          setTimeout(() => {
            // call again
            logChatTrace("[ChatAPI] restart");
            running = false;
            chatApi(chatPath, headers, requestPayload, tools); // call fetchEventSource
          }, 60);
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
        responseText = errorText;
        apiKeyRetry.setLastErrorText(errorText);
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

  controller.signal.onabort = finish;

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
    const chatPayload = {
      method: "POST",
      body: JSON.stringify({
        ...requestPayload,
        tools: tools && tools.length ? tools : undefined,
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

          // deal with <think> and </think> tags start
          if (!chunk.isThinking) {
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
          // deal with <think> and </think> tags start

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
        if (pendingRetry) {
          return;
        }
        finish();
      },
      onerror(e) {
        if (requestSeq !== activeRequestSeq) {
          return;
        }
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
