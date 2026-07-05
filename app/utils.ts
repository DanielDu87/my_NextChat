import { useEffect, useState } from "react";
import type { RequestMessage } from "./client/api";
import constants from "./constant";
export { formatChinaDateTime } from "./utils/format";
// import { fetch as tauriFetch, ResponseType } from "@tauri-apps/api/http";
import { fetch as tauriStreamFetch } from "./utils/stream";
import { useAccessStore } from "./store";
import type { DalleQuality, DalleStyle, ModelSize } from "./typing";

const {
  REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS_FOR_THINKING,
  ServiceProvider,
  VISION_MODEL_REGEXES,
  EXCLUDE_VISION_MODEL_REGEXES,
} = constants;
type ServiceProviderValue =
  (typeof ServiceProvider)[keyof typeof ServiceProvider];

async function getToastHelpers() {
  const [{ showToast, showTopNotice }, { default: Locale }] = await Promise.all(
    [import("./components/ui-lib"), import("./locales")],
  );

  return { showToast, showTopNotice, Locale };
}

export function trimTopic(topic: string) {
  // Fix an issue where double quotes still show in the Indonesian language
  // This will remove the specified punctuation from the end of the string
  // and also trim quotes from both the start and end if they exist.
  return (
    topic
      // remove think/reasoning tags
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
      // fix for gemini
      .replace(/^["“”*]+|["“”*]+$/g, "")
      .replace(/[，。！？”“"、,.!?*]*$/, "")
      .trim()
  );
}

export async function copyToClipboard(
  text: string,
  options?: { silent?: boolean },
) {
  const notifySuccess = async () => {
    if (options?.silent) return;
    const { showTopNotice, Locale } = await getToastHelpers();
    showTopNotice(Locale.Copy.Success);
  };

  const notifyFailed = async () => {
    if (options?.silent) return;
    const { showTopNotice, Locale } = await getToastHelpers();
    showTopNotice(Locale.Copy.Failed);
  };

  const copyWithExecCommand = () => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "0";
    textArea.style.top = "0";
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      return document.execCommand("copy");
    } finally {
      document.body.removeChild(textArea);
    }
  };

  try {
    if (window.__TAURI__) {
      await window.__TAURI__.writeText(text);
    } else {
      if (
        isIOS() ||
        !window.isSecureContext ||
        !navigator.clipboard?.writeText
      ) {
        const ok = copyWithExecCommand();
        if (ok) {
          await notifySuccess();
          return true;
        }
        await notifyFailed();
        return false;
      }
      await navigator.clipboard.writeText(text);
    }

    await notifySuccess();
    return true;
  } catch (error) {
    const ok = copyWithExecCommand();
    if (ok) {
      await notifySuccess();
      return true;
    }
    await notifyFailed();
    return false;
  }
}

export async function downloadAs(text: string, filename: string) {
  if (window.__TAURI__) {
    const result = await window.__TAURI__.dialog.save({
      defaultPath: `${filename}`,
      filters: [
        {
          name: `${filename.split(".").pop()} files`,
          extensions: [`${filename.split(".").pop()}`],
        },
        {
          name: "All Files",
          extensions: ["*"],
        },
      ],
    });

    if (result !== null) {
      try {
        await window.__TAURI__.fs.writeTextFile(result, text);
        const { showTopNotice, Locale } = await getToastHelpers();
        showTopNotice(Locale.Download.Success);
      } catch (error) {
        const { showToast, Locale } = await getToastHelpers();
        showToast(Locale.Download.Failed);
      }
    } else {
      const { showToast, Locale } = await getToastHelpers();
      showToast(Locale.Download.Failed);
    }
  } else {
    const element = document.createElement("a");
    element.setAttribute(
      "href",
      "data:text/plain;charset=utf-8," + encodeURIComponent(text),
    );
    element.setAttribute("download", filename);

    element.style.display = "none";
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
  }
}

export function readFromFile() {
  return new Promise<string>((res, rej) => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/json";

    fileInput.onchange = (event: any) => {
      const file = event.target?.files?.[0];
      if (!file) {
        rej(new Error("[File] 用户取消选择文件"));
        return;
      }

      const fileReader = new FileReader();
      fileReader.onload = (e: any) => {
        res(e.target.result);
      };
      fileReader.onerror = (e) => rej(e);
      fileReader.readAsText(file);
    };

    fileInput.click();
  });
}

export function isIOS() {
  const userAgent = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent);
}

export function useWindowSize() {
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const onResize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return size;
}

export const MOBILE_MAX_WIDTH = 650;

function isPhoneDevice() {
  const nav = navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
  };
  if (nav.userAgentData?.mobile === true) return true;

  const userAgent = nav.userAgent || "";
  if (/iPhone|iPod|Windows Phone|Android.+Mobile/i.test(userAgent)) {
    return true;
  }

  const shortScreenEdge = Math.min(screen.width, screen.height);
  return (
    shortScreenEdge <= MOBILE_MAX_WIDTH &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches
  );
}

export function useMobileScreen() {
  const getIsMobileScreen = () =>
    isPhoneDevice() ||
    window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
  const [isMobileScreen, setIsMobileScreen] = useState(getIsMobileScreen);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobileScreen(isPhoneDevice() || event.matches);
    };

    setIsMobileScreen(isPhoneDevice() || mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return isMobileScreen;
}

export function isFirefox() {
  return (
    typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent)
  );
}

export function selectOrCopy(el: HTMLElement, content: string) {
  const currentSelection = window.getSelection();

  if (currentSelection?.type === "Range") {
    return false;
  }

  copyToClipboard(content);

  return true;
}

function getDomContentWidth(dom: HTMLElement) {
  const style = window.getComputedStyle(dom);
  const paddingWidth =
    parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const width = dom.clientWidth - paddingWidth;
  return width;
}

function getOrCreateMeasureDom(id: string, init?: (dom: HTMLElement) => void) {
  let dom = document.getElementById(id);

  if (!dom) {
    dom = document.createElement("span");
    dom.style.position = "absolute";
    dom.style.wordBreak = "break-word";
    dom.style.fontSize = "14px";
    dom.style.transform = "translateY(-200vh)";
    dom.style.pointerEvents = "none";
    dom.style.opacity = "0";
    dom.id = id;
    document.body.appendChild(dom);
    init?.(dom);
  }

  return dom!;
}

export function autoGrowTextArea(dom: HTMLTextAreaElement) {
  const measureDom = getOrCreateMeasureDom("__measure");
  const singleLineDom = getOrCreateMeasureDom("__single_measure", (dom) => {
    dom.innerText = "TEXT_FOR_MEASURE";
  });

  // 用 textarea 的真实计算样式来测量，避免内联 fontSize 与 CSS 的
  // `font-size !important` / line-height 不一致，导致折行数被低估、最后一行被裁切。
  const computed = window.getComputedStyle(dom);
  const fontStyles = {
    fontSize: computed.fontSize,
    lineHeight: computed.lineHeight,
    fontFamily: computed.fontFamily,
    fontWeight: computed.fontWeight,
    letterSpacing: computed.letterSpacing,
  };
  Object.assign(measureDom.style, fontStyles);
  Object.assign(singleLineDom.style, fontStyles);

  const width = getDomContentWidth(dom);
  measureDom.style.width = width + "px";
  measureDom.innerText = dom.value !== "" ? dom.value : "1";
  const endWithEmptyLine = dom.value.endsWith("\n");
  const height = parseFloat(window.getComputedStyle(measureDom).height);
  const singleLineHeight = parseFloat(
    window.getComputedStyle(singleLineDom).height,
  );

  const rows =
    Math.round(height / singleLineHeight) + (endWithEmptyLine ? 1 : 0);

  return rows;
}

export function getCSSVar(varName: string) {
  return getComputedStyle(document.body).getPropertyValue(varName).trim();
}

/**
 * Detects Macintosh
 */
export function isMacOS(): boolean {
  if (typeof window !== "undefined") {
    let userAgent = window.navigator.userAgent.toLocaleLowerCase();
    const macintosh = /iphone|ipad|ipod|macintosh/.test(userAgent);
    return !!macintosh;
  }
  return false;
}

export function getMessageTextContent(message: RequestMessage) {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return "";
  }
  for (const c of message.content) {
    if (c.type === "text") {
      return c.text ?? "";
    }
  }
  return "";
}

export function getMessageTextContentWithoutThinking(message: RequestMessage) {
  let content = "";

  if (typeof message.content === "string") {
    content = message.content;
  } else if (Array.isArray(message.content)) {
    for (const c of message.content) {
      if (c.type === "text") {
        content = c.text ?? "";
        break;
      }
    }
  }

  // Filter out thinking lines (starting with "> ")
  return content
    .split("\n")
    .filter((line) => !line.startsWith("> ") && line.trim() !== "")
    .join("\n")
    .trim();
}

export function getMessageImages(message: RequestMessage): string[] {
  if (typeof message.content === "string") {
    return [];
  }
  if (!Array.isArray(message.content)) {
    return [];
  }
  const urls: string[] = [];
  for (const c of message.content) {
    if (c.type === "image_url") {
      urls.push(c.image_url?.url ?? "");
    }
  }
  return urls;
}

export function isVisionModel(model: string) {
  const visionModels = useAccessStore.getState().visionModels;
  const envVisionModels = visionModels?.split(",").map((m) => m.trim());
  if (envVisionModels?.includes(model)) {
    return true;
  }
  return (
    !EXCLUDE_VISION_MODEL_REGEXES.some((regex) => regex.test(model)) &&
    VISION_MODEL_REGEXES.some((regex) => regex.test(model))
  );
}

export function isDalle3(model: string) {
  return "dall-e-3" === model;
}

export function isImageGenerationModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.includes("image") ||
    lowerModel.includes("imagen") ||
    lowerModel.includes("nano-banana") ||
    lowerModel.startsWith("dall-e") ||
    lowerModel.startsWith("dalle") ||
    lowerModel.includes("seedream") ||
    lowerModel.includes("qwen-image") ||
    lowerModel.includes("cogview") ||
    lowerModel.includes("flux") ||
    lowerModel.includes("ideogram") ||
    lowerModel.includes("recraft") ||
    lowerModel.includes("wan2.") ||
    lowerModel.includes("wanx") ||
    lowerModel.startsWith("irag-") ||
    lowerModel.startsWith("ernie-irag-")
  );
}

export function isVideoGenerationModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.includes("video-gen") ||
    lowerModel.includes("seedance") ||
    lowerModel.includes("veo") ||
    lowerModel.includes("sora") ||
    lowerModel.includes("runway") ||
    lowerModel.includes("pixverse") ||
    lowerModel.includes("vidu") ||
    lowerModel.includes("ray-2") ||
    lowerModel.includes("jimeng") ||
    lowerModel.includes("wanx") ||
    lowerModel.includes("t2v") ||
    lowerModel.includes("i2v")
  );
}

export function getTimeoutMSByModel(model: string) {
  model = model.toLowerCase();
  if (
    isImageGenerationModel(model) ||
    isVideoGenerationModel(model) ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.includes("deepseek-r") ||
    model.includes("-thinking")
  )
    return REQUEST_TIMEOUT_MS_FOR_THINKING;
  return REQUEST_TIMEOUT_MS;
}

export function getModelSizes(model: string): ModelSize[] {
  const lowerModel = model.toLowerCase();
  if (isVideoGenerationModel(model)) {
    if (lowerModel.includes("sora")) {
      return ["720x1280", "1280x720"];
    }
    return ["720x1280", "1280x720"];
  }
  if (lowerModel.includes("cogview")) {
    return [
      "1024x1024",
      "768x1344",
      "864x1152",
      "1344x768",
      "1152x864",
      "1440x720",
      "720x1440",
    ];
  }
  if (lowerModel.includes("gpt-image-1.5")) {
    return ["1024x1024", "1024x1536", "1536x1024"];
  }
  if (
    lowerModel.includes("gpt-image-2") ||
    lowerModel.includes("gpt-image-1")
  ) {
    return ["1024x1024", "1024x1536", "1536x1024", "1792x1024", "1024x1792"];
  }
  if (lowerModel.includes("imagen-4.0")) {
    return ["1024x1024", "768x1024", "1024x768", "1024x1536", "1536x1024"];
  }
  if (lowerModel.includes("glm-image")) {
    return [
      "1280x1280",
      "1568x1056",
      "1056x1568",
      "1472x1088",
      "1088x1472",
      "1728x960",
      "960x1728",
    ];
  }
  if (lowerModel.includes("wan2.7-image-pro")) {
    return ["1K", "2K", "4K"];
  }
  if (lowerModel.includes("wan2.7-image")) {
    return ["1K", "2K"];
  }
  if (lowerModel.includes("wan2.6")) {
    return ["1280x1280", "1280x1440", "1440x1280"];
  }
  if (lowerModel.includes("qwen-image-2.0")) {
    return [
      "1024x1024",
      "512x1024",
      "768x512",
      "768x1024",
      "1024x576",
      "576x1024",
      "2048x2048",
    ];
  }
  if (
    lowerModel.includes("qwen-image-max") ||
    lowerModel.includes("qwen-image-plus")
  ) {
    return ["1664x928", "1472x1104", "1328x1328", "1104x1472", "928x1664"];
  }
  if (
    lowerModel.includes("qwen-image-edit-plus") ||
    lowerModel.includes("qwen-image-edit-max")
  ) {
    return ["1024x1024", "512x512", "768x768", "1536x1536", "2048x2048"];
  }
  if (
    lowerModel.startsWith("dall-e-") ||
    lowerModel.startsWith("dalle-") ||
    lowerModel.startsWith("gpt-image-") ||
    lowerModel.includes("qwen-image") ||
    lowerModel.startsWith("irag-") ||
    lowerModel.startsWith("ernie-irag-")
  ) {
    return ["1024x1024", "1792x1024", "1024x1792"];
  }
  if (lowerModel.includes("flux")) {
    return [
      "1024x1024",
      "768x1024",
      "1024x768",
      "1536x1024",
      "1024x1536",
      "512x512",
    ];
  }
  return [];
}

export function getSupportedImageQualityOptions(model: string): DalleQuality[] {
  const lowerModel = model.toLowerCase();
  if (lowerModel.includes("gpt-image-")) {
    return ["auto", "low", "medium", "high"];
  }
  if (lowerModel.includes("dall-e-3")) {
    return ["standard", "hd"];
  }
  if (lowerModel.includes("glm-image")) {
    return ["hd", "standard"];
  }
  if (lowerModel.includes("imagen-4.0")) {
    return ["low", "medium", "high"];
  }
  return [];
}

export function getSupportedImageStyleOptions(model: string): DalleStyle[] {
  const lowerModel = model.toLowerCase();
  if (lowerModel.includes("dall-e-3")) {
    return ["vivid", "natural"];
  }
  return [];
}

export function getSupportedVideoDurations(model: string): string[] {
  const lowerModel = model.toLowerCase();
  if (isVideoGenerationModel(model)) {
    if (lowerModel.includes("sora")) {
      return ["4", "8", "12"];
    }
    return ["4", "8"];
  }
  return [];
}

export function supportsVideoImageReference(model: string): boolean {
  const lowerModel = model.toLowerCase();
  return (
    isVideoGenerationModel(model) && /i2v|vidu|jimeng|wanx/.test(lowerModel)
  );
}

function parseModelSize(size: string): [number, number] | null {
  const matched = size.match(/^(\d+)x(\d+)$/);
  if (!matched) return null;
  return [Number(matched[1]), Number(matched[2])];
}

export function normalizeModelSize(
  model: string,
  preferredSize?: string,
): ModelSize {
  const supportedSizes = getModelSizes(model);
  if (supportedSizes.length === 0) {
    return (preferredSize as ModelSize) || ("1024x1024" as ModelSize);
  }

  if (preferredSize && supportedSizes.includes(preferredSize as ModelSize)) {
    return preferredSize as ModelSize;
  }

  const preferred = preferredSize ? parseModelSize(preferredSize) : null;
  const preferredAspect =
    preferred && preferred[1] !== 0 ? preferred[0] / preferred[1] : 1;

  const sorted = [...supportedSizes].sort((left, right) => {
    const leftSize = parseModelSize(left) ?? [0, 0];
    const rightSize = parseModelSize(right) ?? [0, 0];
    const leftArea = leftSize[0] * leftSize[1];
    const rightArea = rightSize[0] * rightSize[1];
    if (leftArea !== rightArea) {
      return rightArea - leftArea;
    }

    const leftAspect =
      leftSize[1] !== 0
        ? Math.abs(leftSize[0] / leftSize[1] - preferredAspect)
        : 0;
    const rightAspect =
      rightSize[1] !== 0
        ? Math.abs(rightSize[0] / rightSize[1] - preferredAspect)
        : 0;
    return leftAspect - rightAspect;
  });

  return sorted[0];
}

export function normalizeImageQuality(
  model: string,
  preferredQuality?: string,
): string {
  const lowerModel = model.toLowerCase();
  if (lowerModel.includes("gpt-image-")) {
    if (!preferredQuality || preferredQuality === "standard") {
      return "auto";
    }
    if (preferredQuality === "hd") {
      return "high";
    }
    if (["low", "medium", "high", "auto"].includes(preferredQuality)) {
      return preferredQuality;
    }
    return "auto";
  }

  if (lowerModel.includes("dall-e-3")) {
    if (!preferredQuality || preferredQuality === "standard") {
      return "standard";
    }
    if (preferredQuality === "high") {
      return "hd";
    }
    if (["standard", "hd"].includes(preferredQuality)) {
      return preferredQuality;
    }
    return "standard";
  }

  if (lowerModel.includes("dall-e-2")) {
    return "";
  }

  if (!preferredQuality) {
    return "standard";
  }

  return preferredQuality;
}

export function supportsImageQualityControl(model: string): boolean {
  return getSupportedImageQualityOptions(model).length > 0;
}

export function supportsImageStyleControl(model: string): boolean {
  return getSupportedImageStyleOptions(model).length > 0;
}

export function supportsCustomSize(model: string): boolean {
  return getModelSizes(model).length > 0;
}

export function supportsVideoDurationControl(model: string): boolean {
  return getSupportedVideoDurations(model).length > 0;
}

export function showPlugins(provider: ServiceProviderValue, model: string) {
  if (
    provider == ServiceProvider.OpenAI ||
    provider == ServiceProvider.Azure ||
    provider == ServiceProvider.Moonshot ||
    provider == ServiceProvider.ChatGLM
  ) {
    return true;
  }
  if (provider == ServiceProvider.Anthropic && !model.includes("claude-2")) {
    return true;
  }
  if (provider == ServiceProvider.Google && !model.includes("vision")) {
    return true;
  }
  return false;
}

export function fetch(
  url: string,
  options?: Record<string, unknown>,
): Promise<any> {
  if (window.__TAURI__) {
    return tauriStreamFetch(url, options);
  }
  return window.fetch(url, options);
}

export function adapter(config: Record<string, unknown>) {
  const { baseURL, url, params, data: body, ...rest } = config;
  const path = baseURL ? `${baseURL}${url}` : url;
  const fetchUrl = params
    ? `${path}?${new URLSearchParams(params as any).toString()}`
    : path;
  return fetch(fetchUrl as string, { ...rest, body }).then((res) => {
    const { status, headers, statusText } = res;
    return res
      .text()
      .then((data: string) => ({ status, statusText, headers, data }));
  });
}

export function safeLocalStorage(): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
} {
  let storage: Storage | null;

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      storage = window.localStorage;
    } else {
      storage = null;
    }
  } catch {
    storage = null;
  }

  return {
    getItem(key: string): string | null {
      if (storage) {
        return storage.getItem(key);
      }

      return null;
    },
    setItem(key: string, value: string): void {
      if (storage) {
        try {
          storage.setItem(key, value);
        } catch (error) {
          console.warn(
            `[safeLocalStorage] Failed to set item "${key}", skipping localStorage write:`,
            error,
          );
        }
      }
    },
    removeItem(key: string): void {
      if (storage) {
        storage.removeItem(key);
      }
    },
    clear(): void {
      if (storage) {
        storage.clear();
      }
    },
  };
}

export function getOperationId(operation: {
  operationId?: string;
  method: string;
  path: string;
}) {
  // pattern '^[a-zA-Z0-9_-]+$'
  return (
    operation?.operationId ||
    `${operation.method.toUpperCase()}${operation.path.replaceAll("/", "_")}`
  );
}

export function clientUpdate() {
  // this a wild for updating client app
  return getToastHelpers().then(
    ({ showToast, showTopNotice, Locale }) =>
      window.__TAURI__?.updater
        .checkUpdate()
        .then((updateResult) => {
          if (updateResult.shouldUpdate) {
            window.__TAURI__?.updater
              .installUpdate()
              .then(() => {
                showTopNotice(Locale.Settings.Update.Success);
              })
              .catch((e) => {
                console.error("[Install Update Error]", e);
                showToast(Locale.Settings.Update.Failed);
              });
          }
        })
        .catch((e) => {
          console.error("[Check Update Error]", e);
          showToast(Locale.Settings.Update.Failed);
        }),
  );
}

// https://gist.github.com/iwill/a83038623ba4fef6abb9efca87ae9ccb
export function semverCompare(a: string, b: string) {
  if (a.startsWith(b + "-")) return -1;
  if (b.startsWith(a + "-")) return 1;
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "case",
    caseFirst: "upper",
  });
}
