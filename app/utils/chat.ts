import {
  CACHE_URL_PREFIX,
  UPLOAD_URL,
  REQUEST_TIMEOUT_MS,
} from "@/app/constant";
import type { MultimodalContent, RequestMessage } from "@/app/client/api";
import Locale from "@/app/locales";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import { prettyObject } from "./format";
import { fetch as tauriFetch } from "./stream";

function isYutoApiChatPath(chatPath: string) {
  return (
    chatPath.includes("cn.gptapi.asia") ||
    chatPath.includes("gptapi.asia") ||
    chatPath.includes("one.ooo.cool") ||
    chatPath.includes("ocoolai.com")
  );
}

function getAuthHeaderName(headers: Record<string, string>) {
  return Object.keys(headers).find(
    (key) =>
      key.toLowerCase() === "authorization" ||
      key.toLowerCase() === "x-api-key",
  );
}

function getYutoGroupName(
  fallbackApiKeyGroups: string[],
  currentKeyIndex: number,
) {
  return fallbackApiKeyGroups[currentKeyIndex] || `index-${currentKeyIndex}`;
}

function formatYutoFailureMessage(currentGroup: string, reason: string) {
  const normalizedReason = String(reason || "").trim();
  return [
    "[分组重试] 全部分组重试后仍失败",
    `最终分组: ${currentGroup}`,
    `错误信息: ${normalizedReason || "unknown error"}`,
  ].join("\n");
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

    if (file.type.includes("heic")) {
      try {
        const heic2any = require("heic2any");
        heic2any({ blob: file, toType: "image/jpeg" })
          .then((blob: Blob) => {
            reader.readAsDataURL(blob);
          })
          .catch((e: any) => {
            reject(e);
          });
      } catch (e) {
        reject(e);
      }
    }

    reader.readAsDataURL(file);
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

export function uploadImage(file: Blob): Promise<string> {
  if (!window._SW_ENABLED) {
    // if serviceWorker register error, using compressImage
    return compressImage(file, 256 * 1024);
  }
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
  let lastErrorText = "";
  let activeRequestSeq = 0;
  let runTools: any[] = [];
  let responseRes: Response;

  // animate response to make it looks smooth
  function animateResponseText() {
    if (pendingRetry) {
      requestAnimationFrame(animateResponseText);
      return;
    }
    if (
      controller.signal.aborted &&
      currentKeyIndex < fallbackApiKeys.length - 1
    ) {
      requestAnimationFrame(animateResponseText);
      return;
    }
    if (finished || controller.signal.aborted) {
      responseText += remainText;
      // console.log("[Response Animation] finished");
      if (responseText?.length === 0) {
        const errorText = lastErrorText || "empty response from server";
        if (tryYutoFallbackRetry(errorText)) {
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

  // 获取 fallback API keys（用于降级重试）
  const fallbackApiKeys: string[] = headers["x-fallback-api-keys"] || [];
  const fallbackApiKeyGroups: string[] =
    headers["x-fallback-api-key-groups"] || [];
  let currentKeyIndex = 0;

  const tryYutoFallbackRetry = (reason: string) => {
    const currentGroup = getYutoGroupName(
      fallbackApiKeyGroups,
      currentKeyIndex,
    );
    // 获取当前供应商名称，用于日志显示
    const providerName = options.config?.providerName || "API";

    console.log(`[Chat] ${providerName} 分组请求失败`, {
      currentGroup,
      reason,
    });

    if (
      !isYutoApiChatPath(chatPath) ||
      fallbackApiKeys.length === 0 ||
      currentKeyIndex >= fallbackApiKeys.length - 1
    ) {
      lastErrorText = formatYutoFailureMessage(currentGroup, reason);
      console.log(`[Chat] ${providerName} 无可用下一分组，停止重试`, {
        currentGroup,
        totalGroups: fallbackApiKeys.length,
      });
      return false;
    }

    const nextGroup = getYutoGroupName(
      fallbackApiKeyGroups,
      currentKeyIndex + 1,
    );

    console.log(
      `[Chat] ${providerName} 流式请求失败，尝试降级重试 (${currentKeyIndex + 1}/${
        fallbackApiKeys.length
      })`,
      { currentGroup, nextGroup, reason },
    );

    currentKeyIndex++;
    pendingRetry = true;
    lastErrorText = reason;

    const nextApiKey = fallbackApiKeys[currentKeyIndex];
    const authHeader = getAuthHeaderName(headers);
    if (authHeader) {
      headers[authHeader] = `Bearer ${nextApiKey}`;
    }

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
        const toolCallMessage = {
          role: "assistant",
          tool_calls: [...runTools],
        };
        running = true;
        runTools.splice(0, runTools.length); // empty runTools
        return Promise.all(
          toolCallMessage.tool_calls.map((tool) => {
            options?.onBeforeTool?.(tool);
            return Promise.resolve(
              // @ts-ignore
              funcs[tool.function.name](
                // @ts-ignore
                tool?.function?.arguments
                  ? JSON.parse(tool?.function?.arguments)
                  : {},
              ),
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
            console.debug("[ChatAPI] restart");
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
        if (
          tryYutoFallbackRetry(lastErrorText || "empty response from server")
        ) {
          return;
        }
      }
      console.debug("[ChatAPI] end");
      finished = true;
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
    const requestSeq = ++activeRequestSeq;
    if (isYutoApiChatPath(chatPath) && fallbackApiKeys.length > 0) {
      const currentGroup = getYutoGroupName(
        fallbackApiKeyGroups,
        currentKeyIndex,
      );
      const providerName = options.config?.providerName || "API";
      console.log(`[Chat] ${providerName} 开始测试分组`, {
        currentGroup,
        attempt: currentKeyIndex + 1,
        totalGroups: fallbackApiKeys.length,
      });
    }
    const chatPayload = {
      method: "POST",
      body: JSON.stringify({
        ...requestPayload,
        tools: tools && tools.length ? tools : undefined,
      }),
      signal: controller.signal,
      headers,
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
          lastErrorText = responseText;
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
          lastErrorText =
            extraInfo || `HTTP ${res.status} ${res.statusText || ""}`.trim();

          if (tryYutoFallbackRetry(lastErrorText)) {
            return; // 不调用 finish，继续重试
          }

          if (isYutoApiChatPath(chatPath)) {
            const currentGroup = getYutoGroupName(
              fallbackApiKeyGroups,
              currentKeyIndex,
            );
            responseTexts.push(
              formatYutoFailureMessage(currentGroup, lastErrorText),
            );
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
          lastErrorText = responseText;

          return finish();
        }

        pendingRetry = false;
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
        if (
          tryYutoFallbackRetry(
            e?.message || e?.toString?.() || "stream connection failed",
          )
        ) {
          return;
        }
        if (pendingRetry) {
          return;
        }
        lastErrorText = e?.message || e?.toString?.() || lastErrorText;
        options?.onError?.(e);
        throw e;
      },
      openWhenHidden: true,
    });
  }
  console.debug("[ChatAPI] start");
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
  let lastErrorText = "";
  let activeRequestSeq = 0;
  let runTools: any[] = [];
  let responseRes: Response;
  let isInThinkingMode = false;
  let lastIsThinking = false;
  let lastIsThinkingTagged = false; //between <think> and </think> tags

  // animate response to make it looks smooth
  function animateResponseText() {
    if (pendingRetry) {
      requestAnimationFrame(animateResponseText);
      return;
    }
    if (
      controller.signal.aborted &&
      currentKeyIndex < fallbackApiKeys.length - 1
    ) {
      requestAnimationFrame(animateResponseText);
      return;
    }
    if (finished || controller.signal.aborted) {
      responseText += remainText;
      // console.log("[Response Animation] finished");
      if (responseText?.length === 0) {
        const errorText = lastErrorText || "empty response from server";
        if (tryYutoFallbackRetry(errorText)) {
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

  // 获取 fallback API keys（用于降级重试）
  const fallbackApiKeys: string[] = headers["x-fallback-api-keys"] || [];
  const fallbackApiKeyGroups: string[] =
    headers["x-fallback-api-key-groups"] || [];
  let currentKeyIndex = 0;

  const tryYutoFallbackRetry = (reason: string) => {
    const currentGroup = getYutoGroupName(
      fallbackApiKeyGroups,
      currentKeyIndex,
    );
    // 获取当前供应商名称，用于日志显示
    const providerName = options.config?.providerName || "API";

    console.log(`[Chat] ${providerName} 分组请求失败`, {
      currentGroup,
      reason,
    });

    if (
      !isYutoApiChatPath(chatPath) ||
      fallbackApiKeys.length === 0 ||
      currentKeyIndex >= fallbackApiKeys.length - 1
    ) {
      lastErrorText = formatYutoFailureMessage(currentGroup, reason);
      console.log(`[Chat] ${providerName} 无可用下一分组，停止重试`, {
        currentGroup,
        totalGroups: fallbackApiKeys.length,
      });
      return false;
    }

    const nextGroup = getYutoGroupName(
      fallbackApiKeyGroups,
      currentKeyIndex + 1,
    );

    console.log(
      `[Chat] ${providerName} 流式请求失败，尝试降级重试 (${currentKeyIndex + 1}/${
        fallbackApiKeys.length
      })`,
      { currentGroup, nextGroup, reason },
    );

    currentKeyIndex++;
    pendingRetry = true;
    lastErrorText = reason;

    const nextApiKey = fallbackApiKeys[currentKeyIndex];
    const authHeader = getAuthHeaderName(headers);
    if (authHeader) {
      headers[authHeader] = `Bearer ${nextApiKey}`;
    }

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
        const toolCallMessage = {
          role: "assistant",
          tool_calls: [...runTools],
        };
        running = true;
        runTools.splice(0, runTools.length); // empty runTools
        return Promise.all(
          toolCallMessage.tool_calls.map((tool) => {
            options?.onBeforeTool?.(tool);
            return Promise.resolve(
              // @ts-ignore
              funcs[tool.function.name](
                // @ts-ignore
                tool?.function?.arguments
                  ? JSON.parse(tool?.function?.arguments)
                  : {},
              ),
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
            console.debug("[ChatAPI] restart");
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
        if (
          tryYutoFallbackRetry(lastErrorText || "empty response from server")
        ) {
          return;
        }
      }
      console.debug("[ChatAPI] end");
      finished = true;
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
    const requestSeq = ++activeRequestSeq;
    if (isYutoApiChatPath(chatPath) && fallbackApiKeys.length > 0) {
      const currentGroup = getYutoGroupName(
        fallbackApiKeyGroups,
        currentKeyIndex,
      );
      const providerName = options.config?.providerName || "API";
      console.log(`[Chat] ${providerName} 开始测试分组`, {
        currentGroup,
        attempt: currentKeyIndex + 1,
        totalGroups: fallbackApiKeys.length,
      });
    }
    const chatPayload = {
      method: "POST",
      body: JSON.stringify({
        ...requestPayload,
        tools: tools && tools.length ? tools : undefined,
      }),
      signal: controller.signal,
      headers,
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
          lastErrorText = responseText;
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
          lastErrorText =
            extraInfo || `HTTP ${res.status} ${res.statusText || ""}`.trim();

          if (tryYutoFallbackRetry(lastErrorText)) {
            return; // 不调用 finish，继续重试
          }

          if (isYutoApiChatPath(chatPath)) {
            const currentGroup = getYutoGroupName(
              fallbackApiKeyGroups,
              currentKeyIndex,
            );
            responseTexts.push(
              formatYutoFailureMessage(currentGroup, lastErrorText),
            );
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
          lastErrorText = responseText;

          return finish();
        }

        pendingRetry = false;
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
        if (
          tryYutoFallbackRetry(
            e?.message || e?.toString?.() || "stream connection failed",
          )
        ) {
          return;
        }
        if (pendingRetry) {
          return;
        }
        lastErrorText = e?.message || e?.toString?.() || lastErrorText;
        options?.onError?.(e);
        throw e;
      },
      openWhenHidden: true,
    });
  }
  console.debug("[ChatAPI] start");
  chatApi(chatPath, headers, requestPayload, tools); // call fetchEventSource
}
