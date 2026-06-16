import chatStyles from "@/app/components/chat.module.scss";
import styles from "@/app/components/draw/draw.module.scss";
import homeStyles from "@/app/components/home.module.scss";

import { IconButton } from "@/app/components/button";
import ReturnIcon from "@/app/icons/return.svg";
import Locale from "@/app/locales";
import { CACHE_URL_PREFIX, Path } from "@/app/constant";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  copyToClipboard,
  getMessageTextContent,
  useMobileScreen,
} from "@/app/utils";
import { useNavigate, useLocation } from "react-router-dom";
import { ChatAction } from "@/app/components/chat";
import DeleteIcon from "@/app/icons/clear.svg";
import CopyIcon from "@/app/icons/copy.svg";
import ResetIcon from "@/app/icons/reload.svg";
import DownloadIcon from "@/app/icons/download.svg";
import ImageIcon from "@/app/icons/image.svg";
import { useDrawStore } from "@/app/store/draw";
import LoadingIcon from "@/app/icons/three-dots.svg";
import LogoIcon from "@/app/icons/logo.svg";
import {
  showConfirm,
  showImageModal,
  showModal,
  showTopNotice,
  showToast,
} from "@/app/components/ui-lib";
import { removeImage } from "@/app/utils/chat";
import { prepareRouteEntryForSync } from "@/app/utils/route-sync-entry";
import { SideBar } from "./draw-sidebar";
import { WindowContent } from "@/app/components/home";
import { params } from "./draw-panel";
import clsx from "clsx";

const DRAW_INITIAL_RENDER_COUNT = 6;
const DRAW_RENDER_BATCH_SIZE = 6;
const IMAGE_DIMENSION_CACHE_LIMIT = 120;
const imageDimensionCache = new Map<string, string>();

const PARAM_LABEL_FALLBACKS: Record<string, string> = {
  prompt: "提示词",
  negative_prompt: "反向提示词",
  aspect_ratio: "画面比例",
  image_size: "图像尺寸",
  quality: "图像质量",
  resolution: "分辨率",
  seed: "Seed",
  guidance_scale: "指导系数",
  output_format: "输出格式",
  response_format: "返回格式",
  style: "图片风格",
  model: "模型版本",
  n: "生成数量",
  thinking_mode: "思考模式",
  prompt_extend: "提示词智能改写",
  optimize_prompt_mode: "提示词优化模式",
  web_search: "联网搜索",
  watermark: "水印",
  safety_tolerance: "安全审核容忍度",
  prompt_upsampling: "提示词增强",
  rendering_speed: "渲染速度/质量",
  input_fidelity: "保真度",
  moderation: "内容审核",
};

function getParamConfig(label: string) {
  return params.find((item) => item.value === label);
}

// Draw 页面独立主题（auto/light/dark），仅存 localStorage，不进 store、不同步。
export type DrawTheme = "auto" | "light" | "dark";
const DRAW_THEME_STORAGE_KEY = "nextchat-draw-theme";

function readDrawTheme(): DrawTheme {
  if (typeof window === "undefined") return "auto";
  try {
    const value = window.localStorage.getItem(DRAW_THEME_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "auto") return value;
  } catch {
    // 忽略读取异常
  }
  return "auto";
}

const DRAW_THEME_ORDER: DrawTheme[] = ["dark", "light", "auto"];
export const DRAW_THEME_LABELS: Record<DrawTheme, string> = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
};

export function useDrawTheme() {
  const [theme, setThemeState] = useState<DrawTheme>(readDrawTheme);
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) =>
      setSystemDark(event.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const resolvedTheme: "light" | "dark" =
    theme === "auto" ? (systemDark ? "dark" : "light") : theme;

  const setTheme = useCallback((next: DrawTheme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(DRAW_THEME_STORAGE_KEY, next);
    } catch {
      // 忽略写入异常
    }
  }, []);

  const cycleTheme = useCallback(() => {
    const currentIndex = DRAW_THEME_ORDER.indexOf(theme);
    setTheme(DRAW_THEME_ORDER[(currentIndex + 1) % DRAW_THEME_ORDER.length]);
  }, [theme, setTheme]);

  return { theme, resolvedTheme, setTheme, cycleTheme };
}

function getParamLabel(label: string) {
  return (
    getParamConfig(label)?.name ||
    PARAM_LABEL_FALLBACKS[label] ||
    label
      .split("_")
      .map((part) => part.trim())
      .filter(Boolean)
      .join(" ")
  );
}

function getParamValue(label: string, value: any) {
  const optionName = getParamConfig(label)?.options?.find(
    (item: any) => String(item.value) === String(value),
  )?.name;
  if (optionName) return optionName;

  switch (label) {
    case "seed":
      return value || 0;
    case "output_format":
      return value?.toUpperCase?.() || value;
    case "response_format":
      return value === "b64_json" ? "Base64 JSON" : "URL";
    case "image_size":
      return String(value).replace("x", " x ");
    case "quality":
      return (
        params
          .find((item) => item.value === "quality")
          ?.options?.find((item) => item.value === value)?.name || value
      );
    case "resolution":
      return String(value).toUpperCase();
    case "style":
      return (
        params
          .find((item) => item.value === "style")
          ?.options?.find((item) => item.value === value)?.name || value
      );
    default:
      return value;
  }
}

function getCachedImageDimension(src: string) {
  const value = imageDimensionCache.get(src);
  if (value) {
    imageDimensionCache.delete(src);
    imageDimensionCache.set(src, value);
  }
  return value || "";
}

function setCachedImageDimension(src: string, dimension: string) {
  if (!src || !dimension) return;
  imageDimensionCache.delete(src);
  imageDimensionCache.set(src, dimension);
  if (imageDimensionCache.size > IMAGE_DIMENSION_CACHE_LIMIT) {
    const oldestKey = imageDimensionCache.keys().next().value;
    if (oldestKey) imageDimensionCache.delete(oldestKey);
  }
}

function getDisplayImageSize(item: any) {
  const params = item?.params || {};
  const src = normalizeDrawImageSrc(item?.img_data || "");
  return (
    getCachedImageDimension(src) ||
    params.image_size ||
    params.resolution ||
    params.aspect_ratio ||
    ""
  );
}

function showTaskParams(item: any) {
  showModal({
    title: Locale.Draw.Detail,
    children: (
      <div className={styles["draw-param-modal"]}>
        <div className={styles["draw-param-prompt"]}>
          <strong>{Locale.DrawPanel.Prompt}</strong>
          <div>{item.params?.prompt || "-"}</div>
        </div>
        {Object.keys(item.params || {}).map((key) => {
          if (key === "prompt") {
            return null;
          }
          const value = getParamValue(key, item.params[key]);
          if (value === undefined || value === null || value === "") {
            return null;
          }

          return (
            <div className={styles["draw-param-row"]} key={key}>
              <strong>{getParamLabel(key)}</strong>
              <span>{String(value)}</span>
            </div>
          );
        })}
      </div>
    ),
  });
}

function showTaskError(item: any) {
  showModal({
    title: "生成失败",
    children: (
      <pre className={styles["draw-error-modal"]}>
        {String(item.error || "未知错误")}
      </pre>
    ),
  });
}

function getImageExtFromMime(mimeType: string) {
  const normalized = String(mimeType || "")
    .toLowerCase()
    .split(";")[0];
  switch (normalized) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/png":
      return "png";
    default:
      return "";
  }
}

function getImageExtFromUrl(url: string) {
  const dataMime = url.match(/^data:([^;,]+)[;,]/i)?.[1];
  const dataExt = getImageExtFromMime(dataMime || "");
  if (dataExt) return dataExt;

  try {
    const pathname = new URL(url, window.location.href).pathname;
    const ext = pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    return ["png", "jpg", "jpeg", "webp", "gif"].includes(ext || "")
      ? ext === "jpeg"
        ? "jpg"
        : ext || ""
      : "";
  } catch {
    return "";
  }
}

async function downloadImage(url: string, id: string) {
  if (!url) return;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const ext =
      getImageExtFromUrl(url) || getImageExtFromMime(blob.type) || "png";
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `nextchat-draw-${id}.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    console.error("download image failed", error);
    showToast("图片下载失败");
  }
}

function normalizeDrawImageSrc(src: string) {
  const value = String(src || "").trim();
  if (!value) return "";
  if (
    value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("/")
  ) {
    return value;
  }

  if (/^[A-Za-z0-9+/=\s]+$/.test(value) && value.length > 100) {
    return `data:image/png;base64,${value.replace(/\s/g, "")}`;
  }

  return value;
}

function isRemovableCachedImage(src: string) {
  return String(src || "").startsWith(CACHE_URL_PREFIX);
}

function DrawImagePlaceholder(props: { error?: boolean; text?: string }) {
  return (
    <div
      className={clsx(styles["pre-img"], {
        [styles["draw-error-placeholder"]]: props.error,
      })}
    >
      {props.error ? (
        <span className={styles["draw-error-mark"]} aria-hidden="true" />
      ) : (
        <>
          <LoadingIcon className={styles["draw-loading-mark"]} />
          {props.text && (
            <span className={styles["draw-loading-text"]}>{props.text}</span>
          )}
        </>
      )}
    </div>
  );
}

function DrawImagePreview(props: { item: any; onImageLoaded?: () => void }) {
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(props.item.status === "success");
  const imageRef = useRef<HTMLImageElement>(null);
  const imageSrc = normalizeDrawImageSrc(props.item.img_data);

  useEffect(() => {
    setLoadFailed(false);
  }, [imageSrc]);

  useEffect(() => {
    if (props.item.status !== "success" || !imageSrc) {
      return;
    }

    const image = imageRef.current;
    if (!image) {
      return;
    }

    if (image.complete) {
      if (image.naturalWidth > 0) {
        setLoaded(true);
      } else {
        setLoadFailed(true);
      }
    }
  }, [imageSrc, props.item.status]);

  if (props.item.status === "error") {
    return <DrawImagePlaceholder error />;
  }

  if (props.item.status !== "success") {
    return <DrawImagePlaceholder text="生成中" />;
  }

  if (loadFailed || !imageSrc) {
    return <DrawImagePlaceholder error />;
  }

  return (
    <>
      {!loaded && <DrawImagePlaceholder />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        className={clsx(styles["img"], {
          [styles["img-loaded"]]: loaded,
        })}
        src={imageSrc}
        alt={props.item.params?.prompt || props.item.id}
        loading="lazy"
        decoding="async"
        onError={() => setLoadFailed(true)}
        onLoad={(event) => {
          setLoaded(true);
          const image = event.currentTarget;
          if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            setCachedImageDimension(
              imageSrc,
              `${image.naturalWidth}x${image.naturalHeight}`,
            );
            props.onImageLoaded?.();
          }
        }}
        onClick={() =>
          showImageModal(
            imageSrc,
            true,
            {
              width: "100%",
              height: "100%",
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            },
            {
              width: "100%",
              height: "100%",
              justifyContent: "center",
              alignItems: "center",
              overflow: "hidden",
              WebkitOverflowScrolling: "touch",
            },
          )
        }
      />
    </>
  );
}

export function Draw() {
  const isMobileScreen = useMobileScreen();
  const navigate = useNavigate();
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const drawImages = useDrawStore((state) => state.draw);
  const clearAllDraw = useDrawStore((state) => state.clearAllDraw);
  const clearRequestLogs = useDrawStore((state) => state.clearRequestLogs);
  const resumePendingTasks = useDrawStore((state) => state.resumePendingTasks);
  const removeDraw = useDrawStore((state) => state.removeDraw);
  const setCurrentModel = useDrawStore((state) => state.setCurrentModel);
  const setCurrentParams = useDrawStore((state) => state.setCurrentParams);
  const setSelectedProvider = useDrawStore(
    (state) => state.setSelectedProvider,
  );
  const [visibleImageCount, setVisibleImageCount] = useState(
    DRAW_INITIAL_RENDER_COUNT,
  );
  const [, refreshImageDimensions] = useState(0);
  const isDraw = location.pathname === Path.Draw || location.pathname === "/sd";
  const {
    theme: drawTheme,
    resolvedTheme,
    setTheme: setDrawTheme,
  } = useDrawTheme();

  // Draw 页面独立主题，仅作用于 Draw 路由，离开后恢复全局主题。
  // 全局主题通过 body.light/dark 生效，故 Draw 主题也挂在 body 上，
  // 并在 globals.scss 中置于 .light/.dark 之后以保证优先级。
  useEffect(() => {
    const target = document.body;
    const previous = target.getAttribute("data-draw-theme");
    target.setAttribute("data-draw-theme", resolvedTheme);
    return () => {
      if (previous === null) target.removeAttribute("data-draw-theme");
      else target.setAttribute("data-draw-theme", previous);
    };
  }, [resolvedTheme]);

  useEffect(() => {
    prepareRouteEntryForSync(location.pathname, {
      source: "draw-page",
    });
  }, [location.pathname]);

  useEffect(() => {
    setVisibleImageCount(
      Math.min(DRAW_INITIAL_RENDER_COUNT, Math.max(drawImages.length, 0)),
    );
  }, [drawImages.length]);

  useEffect(() => {
    if (visibleImageCount >= drawImages.length) {
      return;
    }

    const loadMore = () => {
      setVisibleImageCount((count) =>
        Math.min(count + DRAW_RENDER_BATCH_SIZE, drawImages.length),
      );
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const idleId = (
        window as Window & {
          requestIdleCallback: (
            callback: IdleRequestCallback,
            options?: IdleRequestOptions,
          ) => number;
          cancelIdleCallback: (handle: number) => void;
        }
      ).requestIdleCallback(loadMore, { timeout: 900 });

      return () =>
        (
          window as Window & {
            cancelIdleCallback: (handle: number) => void;
          }
        ).cancelIdleCallback(idleId);
    }

    const timer = globalThis.setTimeout(loadMore, 120);
    return () => globalThis.clearTimeout(timer);
  }, [drawImages.length, visibleImageCount]);

  const visibleDrawImages = React.useMemo(
    () => drawImages.slice(0, visibleImageCount),
    [drawImages, visibleImageCount],
  );

  const handleImageLoaded = useCallback(() => {
    refreshImageDimensions((count) => count + 1);
  }, []);

  const handleCopyPrompt = useCallback(async (prompt: string) => {
    const ok = await copyToClipboard(prompt, { silent: true });
    if (ok) {
      showTopNotice(Locale.Copy.Success);
    }
  }, []);

  const handleRetryFill = useCallback(
    (item: any) => {
      const model = String(item?.model || "").trim();
      if (model) {
        setCurrentModel(model);
      }
      if (item?.selectedProvider) {
        setSelectedProvider(item.selectedProvider);
      }
      setCurrentParams({ ...(item?.params || {}) });
      showToast("已填入参数，可修改后生成");
      if (isMobileScreen) {
        navigate(Path.Draw);
      }
    },
    [
      isMobileScreen,
      navigate,
      setCurrentModel,
      setCurrentParams,
      setSelectedProvider,
    ],
  );

  useEffect(() => {
    resumePendingTasks();
  }, [resumePendingTasks]);

  useEffect(() => {
    clearRequestLogs();
  }, [clearRequestLogs]);

  return (
    <>
      <SideBar
        className={clsx(styles["draw-sidebar"], {
          [homeStyles["sidebar-show"]]: isDraw,
        })}
        drawTheme={drawTheme}
        onSelectDrawTheme={setDrawTheme}
      />
      <WindowContent>
        <div
          className={clsx(chatStyles.chat, styles["draw-page"])}
          data-top-notice-anchor="true"
          key={"1"}
        >
          <div
            className={clsx("window-header", styles["draw-header"], {
              [styles["draw-history-header"]]: isMobileScreen && !isDraw,
            })}
          >
            {isMobileScreen && !isDraw ? (
              <div
                className={clsx(
                  homeStyles["sidebar-header"],
                  styles["draw-history-header-inner"],
                )}
              >
                <div
                  className={clsx(
                    homeStyles["sidebar-header-link"],
                    styles["draw-history-brand"],
                  )}
                >
                  <div
                    className={clsx(
                      homeStyles["sidebar-logo"],
                      styles["draw-history-logo"],
                      "no-dark",
                    )}
                  >
                    <LogoIcon width={35.05} height={38} />
                  </div>
                  <div
                    className={clsx(
                      homeStyles["sidebar-title-container"],
                      styles["draw-history-title"],
                    )}
                  >
                    <div
                      className={clsx(
                        homeStyles["sidebar-title"],
                        styles["draw-history-main-title"],
                      )}
                    >
                      AI 绘画
                    </div>
                    <div
                      className={clsx(
                        homeStyles["sidebar-sub-title"],
                        styles["draw-history-sub-title"],
                      )}
                    >
                      让AI画出想象
                    </div>
                  </div>
                </div>
                <div className="window-actions">
                  <div className={"window-action-button"}>
                    <IconButton
                      icon={<ReturnIcon />}
                      bordered
                      title={Locale.Chat.Actions.ChatList}
                      onClick={() => navigate(Path.Draw)}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <>
                {isMobileScreen && (
                  <div className="window-actions">
                    <div className={"window-action-button"}>
                      <IconButton
                        icon={<ReturnIcon />}
                        bordered
                        title={Locale.Chat.Actions.ChatList}
                        onClick={() => navigate(Path.Draw)}
                      />
                    </div>
                  </div>
                )}
                <div
                  className={clsx(
                    "window-header-title",
                    chatStyles["chat-body-title"],
                  )}
                  data-tauri-drag-region
                >
                  <div className={`window-header-main-title`}>
                    {isDraw ? "AI 绘画" : "作品历史"}
                  </div>
                  <div className="window-header-sub-title">
                    {Locale.Draw.SubTitle(drawImages.length || 0)}
                  </div>
                </div>

                <div className="window-actions">
                  {isMobileScreen && <LogoIcon width={50} height={50} />}
                </div>
              </>
            )}
          </div>
          <div
            className={clsx(chatStyles["chat-body"], styles["draw-body"])}
            ref={scrollRef}
          >
            <div className={styles["draw-gallery-toolbar"]}>
              <div className={styles["draw-gallery-title"]}>
                <strong>最近生成</strong>
              </div>
              <div className={styles["draw-gallery-actions"]}>
                <div className={styles["draw-gallery-count"]}>
                  {Locale.Draw.SubTitle(drawImages.length || 0)}
                </div>
                {drawImages.length > 0 && (
                  <IconButton
                    icon={<DeleteIcon />}
                    text="清除全部"
                    bordered
                    shadow
                    className={styles["draw-clear-all-btn"]}
                    onClick={() => {
                      showConfirm("确认清除所有画图记录？").then((res) => {
                        if (res) clearAllDraw();
                      });
                    }}
                  />
                )}
              </div>
            </div>
            <div className={styles["draw-img-list"]}>
              {drawImages.length > 0 ? (
                visibleDrawImages.map((item: any) => {
                  return (
                    <div
                      key={item.id}
                      className={clsx(styles["draw-img-item"], {
                        [styles["draw-img-item-error"]]:
                          item.status === "error",
                      })}
                    >
                      <div className={styles["draw-preview"]}>
                        <DrawImagePreview
                          item={item}
                          onImageLoaded={handleImageLoaded}
                        />
                      </div>
                      <div className={styles["draw-img-item-info"]}>
                        <button
                          type="button"
                          className={styles["draw-prompt"]}
                          title={item.params?.prompt}
                          onClick={() => showTaskParams(item)}
                        >
                          {item.params?.prompt || "-"}
                        </button>
                        {item.status === "error" && item.error && (
                          <button
                            type="button"
                            className={styles["draw-error-detail"]}
                            title={String(item.error)}
                            onClick={() => showTaskError(item)}
                          >
                            {String(item.error)}
                          </button>
                        )}
                        {item.status !== "error" && (
                          <div className={styles["draw-meta-grid"]}>
                            <span>{item.model_name}</span>
                            {getDisplayImageSize(item) && (
                              <span>
                                {getParamValue(
                                  "image_size",
                                  getDisplayImageSize(item),
                                )}
                              </span>
                            )}
                            {item.params?.quality && (
                              <span>
                                {getParamValue("quality", item.params.quality)}
                              </span>
                            )}
                            {item.params?.style && (
                              <span>
                                {getParamValue("style", item.params.style)}
                              </span>
                            )}
                          </div>
                        )}
                        <div className={styles["draw-card-actions"]}>
                          {item.status === "success" && (
                            <ChatAction
                              text="下载"
                              icon={<DownloadIcon />}
                              onClick={() =>
                                downloadImage(item.img_data, item.id)
                              }
                            />
                          )}
                          <ChatAction
                            text="复制"
                            icon={<CopyIcon />}
                            onClick={() =>
                              handleCopyPrompt(
                                getMessageTextContent({
                                  role: "user",
                                  content: item.params?.prompt || "",
                                }),
                              )
                            }
                          />
                          <ChatAction
                            text="重试"
                            icon={<ResetIcon />}
                            onClick={() => handleRetryFill(item)}
                          />
                          <ChatAction
                            text="删除"
                            icon={<DeleteIcon />}
                            onClick={async () => {
                              if (
                                await showConfirm(Locale.Draw.Danger.Delete)
                              ) {
                                removeDraw(item.id);
                                if (isRemovableCachedImage(item.img_data)) {
                                  removeImage(item.img_data).catch(() => {});
                                }
                              }
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className={styles["draw-empty"]}>
                  <ImageIcon />
                  <strong>{Locale.Draw.EmptyRecord}</strong>
                  <span>生成的图片会出现在这里</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </WindowContent>
    </>
  );
}
