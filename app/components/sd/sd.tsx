import chatStyles from "@/app/components/chat.module.scss";
import styles from "@/app/components/sd/sd.module.scss";
import homeStyles from "@/app/components/home.module.scss";

import { IconButton } from "@/app/components/button";
import ReturnIcon from "@/app/icons/return.svg";
import Locale from "@/app/locales";
import { Path } from "@/app/constant";
import React, { useEffect, useRef, useState } from "react";
import {
  copyToClipboard,
  getMessageTextContent,
  useMobileScreen,
} from "@/app/utils";
import { useNavigate, useLocation } from "react-router-dom";
import { ChatAction } from "@/app/components/chat";
import DeleteIcon from "@/app/icons/clear.svg";
import CopyIcon from "@/app/icons/copy.svg";
import PromptIcon from "@/app/icons/prompt.svg";
import ResetIcon from "@/app/icons/reload.svg";
import DownloadIcon from "@/app/icons/download.svg";
import ImageIcon from "@/app/icons/image.svg";
import { useSdStore } from "@/app/store/sd";
import LoadingIcon from "@/app/icons/three-dots.svg";
import ErrorIcon from "@/app/icons/delete.svg";
import SDIcon from "@/app/icons/sd.svg";
import {
  showConfirm,
  showImageModal,
  showModal,
  showToast,
} from "@/app/components/ui-lib";
import { removeImage } from "@/app/utils/chat";
import { SideBar } from "./sd-sidebar";
import { WindowContent } from "@/app/components/home";
import { params } from "./sd-panel";
import clsx from "clsx";

function getSdTaskStatus(item: any) {
  let s = "";
  switch (item.status) {
    case "success":
      s = Locale.Sd.Status.Success;
      break;
    case "error":
      s = Locale.Sd.Status.Error;
      break;
    case "wait":
      s = Locale.Sd.Status.Wait;
      break;
    case "running":
      s = Locale.Sd.Status.Running;
      break;
    default:
      s = item.status?.toUpperCase?.() || "-";
  }
  return (
    <div className={styles["draw-status-row"]} title={item.error}>
      <span
        className={clsx(
          styles["draw-status-badge"],
          styles[`draw-status-${item.status}`],
        )}
      >
        {s}
      </span>
      {item.status === "error" && (
        <button
          type="button"
          className={styles["draw-error-detail"]}
          onClick={() => {
            showModal({
              title: Locale.Sd.Detail,
              children: <div style={{ userSelect: "text" }}>{item.error}</div>,
            });
          }}
        >
          {item.error}
        </button>
      )}
    </div>
  );
}

function getParamLabel(label: string) {
  switch (label) {
    case "prompt":
      return Locale.SdPanel.Prompt;
    case "negative_prompt":
      return Locale.SdPanel.NegativePrompt;
    case "aspect_ratio":
      return Locale.SdPanel.AspectRatio;
    case "seed":
      return "Seed";
    case "output_format":
      return Locale.SdPanel.OutFormat;
    case "style":
      return Locale.SdPanel.ImageStyle;
    case "model":
      return Locale.SdPanel.ModelVersion;
    default:
      return label;
  }
}

function getParamValue(label: string, value: any) {
  switch (label) {
    case "seed":
      return value || 0;
    case "output_format":
      return value?.toUpperCase?.() || value;
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

function showTaskParams(item: any) {
  showModal({
    title: Locale.Sd.GenerateParams,
    children: (
      <div className={styles["draw-param-modal"]}>
        {Object.keys(item.params || {}).map((key) => {
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

async function downloadImage(url: string, id: string) {
  if (!url) return;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const ext = blob.type.split("/")[1] || "png";
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

export function Sd() {
  const isMobileScreen = useMobileScreen();
  const navigate = useNavigate();
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sdStore = useSdStore();
  const [sdImages, setSdImages] = useState(sdStore.draw);
  const isSd = location.pathname === Path.Sd || location.pathname === "/sd";

  useEffect(() => {
    setSdImages(sdStore.draw);
  }, [sdStore.currentId, sdStore.draw]);

  return (
    <>
      <SideBar className={clsx({ [homeStyles["sidebar-show"]]: isSd })} />
      <WindowContent>
        <div className={clsx(chatStyles.chat, styles["sd-page"])} key={"1"}>
          <div className={clsx("window-header", styles["draw-header"])}>
            {isMobileScreen && (
              <div className="window-actions">
                <div className={"window-action-button"}>
                  <IconButton
                    icon={<ReturnIcon />}
                    bordered
                    title={Locale.Chat.Actions.ChatList}
                    onClick={() => navigate(Path.Sd)}
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
                {isSd ? "AI 绘画" : "作品历史"}
              </div>
              <div className="window-header-sub-title">
                {Locale.Sd.SubTitle(sdImages.length || 0)}
              </div>
            </div>

            <div className="window-actions">
              {isMobileScreen && <SDIcon width={50} height={50} />}
            </div>
          </div>
          <div
            className={clsx(chatStyles["chat-body"], styles["draw-body"])}
            ref={scrollRef}
          >
            <div className={styles["draw-gallery-toolbar"]}>
              <div className={styles["draw-gallery-title"]}>
                <span>作品</span>
                <strong>最近生成</strong>
              </div>
              <div className={styles["draw-gallery-count"]}>
                {Locale.Sd.SubTitle(sdImages.length || 0)}
              </div>
            </div>
            <div className={styles["sd-img-list"]}>
              {sdImages.length > 0 ? (
                sdImages.map((item: any) => {
                  return (
                    <div key={item.id} className={styles["sd-img-item"]}>
                      <div className={styles["draw-preview"]}>
                        {item.status === "success" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            className={styles["img"]}
                            src={item.img_data}
                            alt={item.params?.prompt || item.id}
                            onClick={() =>
                              showImageModal(
                                item.img_data,
                                true,
                                isMobileScreen
                                  ? { width: "100%", height: "fit-content" }
                                  : { maxWidth: "100%", maxHeight: "100%" },
                                isMobileScreen
                                  ? { width: "100%", height: "fit-content" }
                                  : { width: "100%", height: "100%" },
                              )
                            }
                          />
                        ) : item.status === "error" ? (
                          <div className={styles["pre-img"]}>
                            <ErrorIcon />
                          </div>
                        ) : (
                          <div className={styles["pre-img"]}>
                            <LoadingIcon />
                          </div>
                        )}
                      </div>
                      <div className={styles["sd-img-item-info"]}>
                        <div className={styles["draw-card-topline"]}>
                          {getSdTaskStatus(item)}
                          <span>{item.created_at}</span>
                        </div>
                        <button
                          type="button"
                          className={styles["draw-prompt"]}
                          title={item.params?.prompt}
                          onClick={() => {
                            showModal({
                              title: Locale.Sd.Detail,
                              children: (
                                <div style={{ userSelect: "text" }}>
                                  {item.params?.prompt}
                                </div>
                              ),
                            });
                          }}
                        >
                          {item.params?.prompt || "-"}
                        </button>
                        <div className={styles["draw-meta-grid"]}>
                          <span>{item.model_name}</span>
                          {item.params?.aspect_ratio && (
                            <span>{item.params.aspect_ratio}</span>
                          )}
                          {item.params?.style && (
                            <span>
                              {getParamValue("style", item.params.style)}
                            </span>
                          )}
                        </div>
                        <div className={styles["draw-card-actions"]}>
                          <ChatAction
                            text={Locale.Sd.Actions.Params}
                            icon={<PromptIcon />}
                            onClick={() => showTaskParams(item)}
                          />
                          <ChatAction
                            text={Locale.Sd.Actions.Copy}
                            icon={<CopyIcon />}
                            onClick={() =>
                              copyToClipboard(
                                getMessageTextContent({
                                  role: "user",
                                  content: item.params?.prompt || "",
                                }),
                              )
                            }
                          />
                          {item.status === "success" && (
                            <ChatAction
                              text={Locale.Sd.Actions.Download}
                              icon={<DownloadIcon />}
                              onClick={() =>
                                downloadImage(item.img_data, item.id)
                              }
                            />
                          )}
                          <ChatAction
                            text={Locale.Sd.Actions.Retry}
                            icon={<ResetIcon />}
                            onClick={() => {
                              const reqData = {
                                model: item.model,
                                model_name: item.model_name,
                                status: "wait",
                                params: { ...item.params },
                                created_at: new Date().toLocaleString(),
                                img_data: "",
                              };
                              sdStore.sendTask(reqData);
                            }}
                          />
                          <ChatAction
                            text={Locale.Sd.Actions.Delete}
                            icon={<DeleteIcon />}
                            onClick={async () => {
                              if (await showConfirm(Locale.Sd.Danger.Delete)) {
                                removeImage(item.img_data).finally(() => {
                                  sdStore.draw = sdImages.filter(
                                    (i: any) => i.id !== item.id,
                                  );
                                  sdStore.getNextId();
                                });
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
                  <strong>{Locale.Sd.EmptyRecord}</strong>
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
