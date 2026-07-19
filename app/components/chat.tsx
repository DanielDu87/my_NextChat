import { useDebouncedCallback } from "use-debounce";
import NextImage from "next/image";
import React, {
  Fragment,
  RefObject,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import SparkMD5 from "spark-md5";
import { createPortal, flushSync } from "react-dom";

import SendUpIcon from "../icons/send-up.svg";
import BrainIcon from "../icons/brain.svg";
import RenameIcon from "../icons/rename.svg";
import ReturnIcon from "../icons/return.svg";
import CopyIcon from "../icons/copy.svg";
import SpeakIcon from "../icons/speak.svg";
import SpeakStopIcon from "../icons/speak-stop.svg";
import LoadingIcon from "../icons/three-dots.svg";
import LoadingButtonIcon from "../icons/loading.svg";
import PromptIcon from "../icons/prompt.svg";
import ResetIcon from "../icons/reload.svg";
import ReloadIcon from "../icons/reload.svg";
import DownIcon from "../icons/down.svg";
import ConfirmIcon from "../icons/confirm.svg";
import SelectorCheckIcon from "../icons/selector-check.svg";
import ConfigIcon from "../icons/config.svg";
import ConnectionIcon from "../icons/connection.svg";
import DownloadIcon from "../icons/download.svg";
import HistoryIcon from "../icons/history.svg";
import MoneyIcon from "../icons/money.svg";
import UserIcon from "../icons/user.svg";
import DeleteIcon from "../icons/clear.svg";
import CloseIcon from "../icons/close.svg";
import CancelIcon from "../icons/cancel.svg";
import LogOutDoorIcon from "../icons/log-out-door.svg";
import ImageIcon from "../icons/image.svg";
import AddIcon from "../icons/add.svg";

import StopIcon from "../icons/pause.svg";
import PlayIcon from "../icons/play.svg";
import RobotIcon from "../icons/robot.svg";
import SizeIcon from "../icons/size.svg";
import QualityIcon from "../icons/hd.svg";
import McpToolIcon from "../icons/tool.svg";
import {
  BOT_HELLO,
  ChatMessage,
  ChatMessageAttachedFile,
  createMessage,
  createEmptySession,
  normalizeSession,
  useChatStore,
} from "../store/chat";
import { selectChatSessionById } from "../store/chat-index";
import { DEFAULT_TOPIC, getBotHelloContent } from "../store/chat-defaults";
import { useAccessStore } from "../store/access";
import { ModelType, SubmitKey, useAppConfig } from "../store/config";
import { useCurrentSession } from "../store/chat-session";
import { useModelCacheStore } from "../store/model-cache";
import { useUpdateStore } from "../store/update";

import {
  autoGrowTextArea,
  copyToClipboard,
  formatChinaDateTime,
  getMessageImages,
  getMessageTextContent,
  getModelSizes,
  getSupportedVideoDurations,
  getSupportedImageQualityOptions,
  getSupportedImageStyleOptions,
  normalizeModelSize,
  normalizeImageQuality,
  isIOS,
  supportsCustomSize,
  supportsImageQualityControl,
  supportsImageStyleControl,
  supportsVideoDurationControl,
  supportsVideoImageReference,
  useMobileScreen,
  useWindowSize,
  selectOrCopy,
} from "../utils";
import { safeLocalStorage } from "../utils/safe-local-storage";
import { indexedDbStateStorage } from "../utils/indexeddb-state-storage";
import { withSyncUserHeaders } from "../utils/sync-user-client";

import { useAllModels } from "../utils/hooks";
import { resolveModelProviderId } from "../utils/model";
import { getPreferredDefaultChatModel } from "../utils/model";
import {
  compareModelsBySeriesVersion,
  compareProviderDisplayNames,
} from "../utils/model-series-order";
import { convertHeicImage } from "../utils/chat";
import { ensureProviderModelsReady } from "../utils/provider-sync";
import { isPerfFeatureEnabled, logPerfSummary, nowMs } from "../utils/perf";
import {
  getActiveModelSelectorProviderId,
  getModelSelectorDefaultValue,
} from "../utils/model-selector-provider";
import { isLegacyGeneratedCustomProviderId } from "../utils/access-profiles";
import { getModelVendorGroupName } from "../utils/model-vendor-normalize";
import { getModelDisplayGroup } from "../utils/model-display-group";

import { ChatControllerPool } from "../client/controller";
import { Prompt, usePromptStore } from "../store/prompt";
import { bootstrapSharedPrompts } from "../utils/prompt-bootstrap";
import { isAbortLikeError } from "../utils/stale-revalidate";
import Locale from "../locales";

import { IconButton } from "./button";
import { LoadingPanel } from "./loading-panel";
import { LoadingView } from "./loading-view";
import { Markdown } from "./markdown";
import styles from "./chat.module.scss";

import {
  List,
  ListItem,
  Modal,
  NoticePill,
  Selector,
  hideTopNotice as hideTopNoticeCard,
  showConfirm,
  showImageModal,
  showModal,
  showPrompt,
  showTopNotice as showTopNoticeCard,
  showToast,
} from "./ui-lib";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  CHAT_PAGE_SIZE,
  DEFAULT_TTS_ENGINE,
  ModelProvider,
  Path,
  REQUEST_TIMEOUT_MS,
  CACHE_URL_PREFIX,
  ServiceProvider,
  StoreKey,
  UPLOAD_URL,
  UNFINISHED_INPUT,
} from "../constant";

import { useSyncStore } from "../store/sync";
import { ProviderType } from "../utils/cloud";
import { getEffectiveProviderBaseUrl } from "../utils/provider-url";

const CHAT_BACKUP_ENTRIES = [
  { name: "API 配置", path: Path.ApiConfig, icon: <ConnectionIcon /> },
  { name: "API 备份", path: Path.ApiConfigBackups, icon: <DownloadIcon /> },
  { name: "对话备份", path: Path.ChatBackups, icon: <HistoryIcon /> },
  { name: "余额查询", path: Path.ProviderBalances, icon: <MoneyIcon /> },
  { name: "模型获取", path: Path.ProviderModelFetch, icon: <ReloadIcon /> },
];

const SEARCH_TOOL_NAME_PATTERN = /search|搜索/i;

function syncModelSelectionNow(includeGlobalDefault: boolean) {
  const syncStore = useSyncStore.getState();
  if (!syncStore.cloudSync?.()) {
    console.info("[模型选择器] 未启用云同步，本地模型选择已保留");
    return;
  }
  // 老对话只同步会话模型；最新对话同时更新后续新对话的默认模型。
  const keys: Array<StoreKey.Config | StoreKey.Chat> = includeGlobalDefault
    ? [StoreKey.Config, StoreKey.Chat]
    : [StoreKey.Chat];
  void syncStore
    .sync(keys, {
      force: true,
      isolateQueue: true,
    })
    .then(() => {
      console.info("[模型选择器] 模型选择后台同步完成", {
        同步范围: includeGlobalDefault ? "最新对话 + 全局默认" : "当前老对话",
      });
    })
    .catch((error: unknown) => {
      console.error("[模型选择器] 模型选择立即同步失败", error);
    });
}

import { Avatar, FIXED_USER_AVATAR } from "./emoji";
import { ContextPrompts, MaskConfig } from "./mask";
import { saveGlobalModelConfig } from "../store/mask";
import { ChatCommandPrefix, useChatCommand, useCommand } from "../command";
import { runWithImmediateStoreSyncPausedSync } from "../utils/store";
import { markPendingModelSelection } from "../utils/sync";
import { prettyObject } from "../utils/format";
import {
  readManualSessionModelSelection,
  saveManualSessionModelSelection,
} from "../utils/manual-model-selection";
import { ExportMessageModal } from "./exporter";
import { ClientApi, MultimodalContent } from "../client/api";
import { isRememberedRuntimeBlobUrl } from "../client/platforms/openai";

// 移除文字自适应缩放功能，改用 CSS overflow: hidden + hover 滚动
import { createTTSPlayer } from "../utils/audio";
import { MsEdgeTTS, OUTPUT_FORMAT } from "../utils/ms_edge_tts";
import {
  getModelParameterSupport,
  sanitizeModelConfigForCapability,
} from "../client/model-parameter-rules";

import { isEmpty } from "lodash-es";
import {
  getModelProvider,
  getPreferredRuntimeModelConfig,
  normalizeReservedDisplayModelName,
} from "../utils/model";
import { RealtimeChat } from "@/app/components/realtime-chat";
import { useAuthStore } from "../store/auth";
import { UserMenu } from "./user-menu";
import { AddModelSelector } from "./add-model-modal";

let hasMountedChatInCurrentPage = false;

function areSelectorItemsEqual(
  left: Array<{
    title: string;
    value: string;
    disable?: boolean;
    order?: number;
    publishedAt?: number;
    catalogRank?: number;
    remoteRank?: number;
    group?: string;
  }>,
  right: Array<{
    title: string;
    value: string;
    disable?: boolean;
    order?: number;
    publishedAt?: number;
    catalogRank?: number;
    remoteRank?: number;
    group?: string;
  }>,
) {
  if (left === right) {
    return true;
  }

  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];
    if (
      current.title !== next.title ||
      current.value !== next.value ||
      current.disable !== next.disable ||
      current.order !== next.order ||
      current.publishedAt !== next.publishedAt ||
      current.catalogRank !== next.catalogRank ||
      current.remoteRank !== next.remoteRank ||
      current.group !== next.group
    ) {
      return false;
    }
  }

  return true;
}

function formatMessageUsage(
  usage?: Partial<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
    systemTokens: number;
  }>,
) {
  if (!usage) {
    return "";
  }

  const parts: string[] = [];

  if (
    usage.systemTokens !== undefined &&
    Number.isFinite(usage.systemTokens) &&
    usage.systemTokens > 0
  ) {
    parts.push(`系统 ${usage.systemTokens}`);
  }
  if (Number.isFinite(usage.promptTokens)) {
    parts.push(`输入 ${usage.promptTokens}`);
  }
  if (
    Number.isFinite(usage.reasoningTokens) &&
    (usage.reasoningTokens || 0) > 0
  ) {
    parts.push(`思考 ${usage.reasoningTokens}`);
  }
  if (Number.isFinite(usage.completionTokens)) {
    parts.push(`输出 ${usage.completionTokens}`);
  }
  if (Number.isFinite(usage.totalTokens)) {
    parts.push(`合计 ${usage.totalTokens}`);
  }
  if (Number.isFinite(usage.cachedTokens) && (usage.cachedTokens || 0) > 0) {
    parts.push(`缓存 ${usage.cachedTokens}`);
  }

  return parts.length > 0 ? `Tokens: ${parts.join(" / ")}` : "";
}

function trimMessageBoundaryText(text: string) {
  return text.replace(
    /^[\s\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]+|[\s\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]+$/g,
    "",
  );
}

function buildMessageCopyText(message: ChatMessage) {
  const text = trimMessageBoundaryText(getMessageTextContent(message));
  const images = getMessageImages(message).filter(Boolean);
  if (images.length === 0) {
    return text;
  }

  const imageText = images
    .map((url, index) => `![图片${index + 1}](${url})`)
    .join("\n");
  return [text, imageText].filter(Boolean).join("\n\n");
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMessageCopyHtml(message: ChatMessage) {
  const text = trimMessageBoundaryText(getMessageTextContent(message));
  const images = getMessageImages(message).filter(Boolean);
  const textHtml = text
    ? `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`
    : "";
  const imageHtml = images
    .map((url) => `<p><img src="${escapeHtml(url)}"></p>`)
    .join("");
  return `${textHtml}${imageHtml}`;
}

async function copyMessageToClipboard(
  message: ChatMessage,
  options?: { silent?: boolean },
) {
  const text = trimMessageBoundaryText(getMessageTextContent(message));
  const images = getMessageImages(message).filter(Boolean);
  if (
    images.length === 0 ||
    typeof ClipboardItem === "undefined" ||
    !navigator.clipboard?.write
  ) {
    return copyToClipboard(buildMessageCopyText(message), options);
  }

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([buildMessageCopyHtml(message)], {
          type: "text/html",
        }),
      }),
    ]);
    if (!options?.silent) {
      showTopNoticeCard(Locale.Copy.Success);
    }
    return true;
  } catch {
    return copyToClipboard(buildMessageCopyText(message), options);
  }
}

function getProfileProviderId(profile: { provider: string; name: string }) {
  return profile.provider === ServiceProvider.Custom
    ? `custom_${profile.name}`
    : profile.provider === ServiceProvider.Local
    ? `${String(profile.provider).toLowerCase()}_${profile.name}`.toLowerCase()
    : String(profile.provider).toLowerCase();
}

function isProfileScopedProviderId(providerId: unknown) {
  const value = String(providerId || "")
    .trim()
    .toLowerCase();
  return value.startsWith("custom_") || value.startsWith("local_");
}

function normalizeProviderLookup(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^(custom|local)[_\s-]+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

function buildProviderModelsFromCachedNames(
  cachedModels: string,
  providerId: string,
  providerName: ServiceProvider,
) {
  return cachedModels
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name, index) => ({
      name,
      displayName: name,
      available: true,
      sorted: index,
      provider: {
        id: providerId,
        providerName,
        providerType:
          providerName === ServiceProvider.Local ? "openai" : "custom",
        sorted: 0,
      },
    }));
}

function buildProviderModelsFromAddedCustomModels(
  customModels: string,
  providerId: string,
  providerName: ServiceProvider,
) {
  const normalizedProviderId = String(providerId || "").toLowerCase();
  const seenNames = new Set<string>();

  return customModels
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("+"))
    .map((entry) => entry.slice(1))
    .map((entry) => entry.split("=")[0])
    .map((entry) => {
      const [modelName, entryProviderId] = getModelProvider(entry);
      return {
        modelName: modelName.trim(),
        providerId: String(entryProviderId || "")
          .trim()
          .toLowerCase(),
      };
    })
    .filter(
      ({ modelName, providerId }) =>
        !!modelName && providerId === normalizedProviderId,
    )
    .filter(({ modelName }) => {
      const key = modelName.toLowerCase();
      if (seenNames.has(key)) {
        return false;
      }
      seenNames.add(key);
      return true;
    })
    .map(({ modelName }, index) => ({
      name: modelName,
      displayName: modelName,
      available: true,
      sorted: index,
      provider: {
        id: normalizedProviderId,
        providerName,
        providerType:
          providerName === ServiceProvider.Local ? "openai" : "custom",
        sorted: 0,
      },
    }));
}

function getActiveAccessProfile(
  profiles: Array<{
    name: string;
    provider: ServiceProvider;
    baseUrl?: string;
    apiKey?: string;
    enabled?: boolean;
  }> = [],
  providerName: ServiceProvider | undefined,
  activeBaseUrl?: string,
  activeApiKey?: string,
) {
  if (
    providerName !== ServiceProvider.Custom &&
    providerName !== ServiceProvider.Local
  ) {
    return undefined;
  }

  const activeProfile = profiles.find((profile) => {
    if (profile.provider !== providerName || !profile.baseUrl) {
      return false;
    }

    if (profile.baseUrl !== activeBaseUrl) {
      return false;
    }

    if (!activeApiKey) {
      return true;
    }

    return (profile.apiKey || "") === activeApiKey;
  });

  if (activeProfile) {
    return activeProfile;
  }

  return profiles.find(
    (profile) => profile.provider === providerName && profile.enabled,
  );
}

function applyProfileToAccessStore(
  access: any,
  profile: {
    id?: string;
    name: string;
    provider: ServiceProvider;
    baseUrl?: string;
    apiKey?: string;
    openAICompatible?: boolean;
  },
  options?: {
    customModels?: string;
  },
) {
  access.provider = profile.provider;
  access.profileSelectionUpdatedAt = Date.now();
  if (options?.customModels !== undefined) {
    access.customModels = options.customModels;
  }

  access.apiProfiles = access.apiProfiles.map((item: any) => ({
    ...item,
    enabled: item.id === profile.id,
  }));

  const effectiveBaseUrl = getEffectiveProviderBaseUrl(
    profile.provider,
    profile.baseUrl,
  );

  switch (profile.provider) {
    case ServiceProvider.Custom:
      access.customUrl = effectiveBaseUrl;
      access.customApiKey = profile.apiKey || "";
      access.customOpenAICompatible = profile.openAICompatible ?? true;
      break;
    case ServiceProvider.OpenAI:
      access.openaiUrl = effectiveBaseUrl || access.openaiUrl;
      access.openaiApiKey = profile.apiKey || access.openaiApiKey;
      break;
    case ServiceProvider.Azure:
      access.azureUrl = effectiveBaseUrl || access.azureUrl;
      access.azureApiKey = profile.apiKey || access.azureApiKey;
      break;
    case ServiceProvider.Google:
      access.googleUrl = effectiveBaseUrl || access.googleUrl;
      access.googleApiKey = profile.apiKey || access.googleApiKey;
      break;
    case ServiceProvider.Anthropic:
      access.anthropicUrl = effectiveBaseUrl || access.anthropicUrl;
      access.anthropicApiKey = profile.apiKey || access.anthropicApiKey;
      break;
    case ServiceProvider.Baidu:
      access.baiduUrl = effectiveBaseUrl || access.baiduUrl;
      access.baiduApiKey = profile.apiKey || access.baiduApiKey;
      break;
    case ServiceProvider.ByteDance:
      access.bytedanceUrl = effectiveBaseUrl || access.bytedanceUrl;
      access.bytedanceApiKey = profile.apiKey || access.bytedanceApiKey;
      break;
    case ServiceProvider.Alibaba:
      access.alibabaUrl = effectiveBaseUrl || access.alibabaUrl;
      access.alibabaApiKey = profile.apiKey || access.alibabaApiKey;
      break;
    case ServiceProvider.Tencent:
      access.tencentUrl = effectiveBaseUrl || access.tencentUrl;
      break;
    case ServiceProvider.Moonshot:
      access.moonshotUrl = effectiveBaseUrl || access.moonshotUrl;
      access.moonshotApiKey = profile.apiKey || access.moonshotApiKey;
      break;
    case ServiceProvider.Stability:
      access.stabilityUrl = effectiveBaseUrl || access.stabilityUrl;
      access.stabilityApiKey = profile.apiKey || access.stabilityApiKey;
      break;
    case ServiceProvider.Iflytek:
      access.iflytekUrl = effectiveBaseUrl || access.iflytekUrl;
      access.iflytekApiKey = profile.apiKey || access.iflytekApiKey;
      break;
    case ServiceProvider.XAI:
      access.xaiUrl = effectiveBaseUrl || access.xaiUrl;
      access.xaiApiKey = profile.apiKey || access.xaiApiKey;
      break;
    case ServiceProvider.ChatGLM:
      access.chatglmUrl = effectiveBaseUrl || access.chatglmUrl;
      access.chatglmApiKey = profile.apiKey || access.chatglmApiKey;
      break;
    case ServiceProvider.DeepSeek:
      access.deepseekUrl = effectiveBaseUrl || access.deepseekUrl;
      access.deepseekApiKey = profile.apiKey || access.deepseekApiKey;
      break;
    case ServiceProvider.SiliconFlow:
      access.siliconflowUrl = effectiveBaseUrl || access.siliconflowUrl;
      access.siliconflowApiKey = profile.apiKey || access.siliconflowApiKey;
      break;
    case ServiceProvider["302.AI"]:
      access.ai302Url = effectiveBaseUrl || access.ai302Url;
      access.ai302ApiKey = profile.apiKey || access.ai302ApiKey;
      break;
    case ServiceProvider.Local:
      access.localUrl = effectiveBaseUrl || access.localUrl;
      access.localApiKey = profile.apiKey || access.localApiKey;
      break;
    default:
      break;
  }
}

function areModelConfigValuesEqual(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
) {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
}

import clsx from "clsx";
import { getAvailableClientsCount } from "../mcp/actions";
import { getClientConfig } from "../config/client";

const localStorage = safeLocalStorage();
const ACTIVE_UNFINISHED_INPUT_KEY = "unfinished-input-active";
const ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY = "unfinished-attach-images-active";
const MAX_ATTACH_IMAGES = 9;
const UNFINISHED_ATTACH_IMAGES_TTL_MS = 24 * 60 * 60 * 1000;
const STREAMING_CONTROLLER_STARTUP_GRACE_MS = 1500;
const UNFINISHED_ATTACH_IMAGES = (id: string) =>
  "unfinished-attach-images-" + id;

const MODEL_SELECTOR_GROUP_STORAGE_KEY = "nextchat:model-selector-group";
const MODEL_SELECTOR_PROVIDER_STORAGE_KEY = "nextchat:model-selector-provider";
const LAST_MODEL_SELECTION_STORAGE_KEY = "nextchat:last-model-selection";
type ComposerAttachedImage = {
  id: string;
  previewUrl: string;
  localPreviewUrl?: string;
};

type AttachImagesDraftPayload = {
  version: 2;
  images: Array<Pick<ComposerAttachedImage, "id" | "previewUrl">>;
  updatedAt: number;
  expiresAt: number;
};

type AttachmentTypeKind = ChatMessageAttachedFile["typeKind"];

type ComposerUploadingAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  isImage: boolean;
  contentMd5?: string;
  uploadContentType: string;
  typeKind: AttachmentTypeKind;
  typeLabel: string;
  progress: number;
  phase: "preparing" | "uploading";
};

const sessionComposerAttachmentDrafts = new Map<
  string,
  {
    images: ComposerAttachedImage[];
    files: ChatMessageAttachedFile[];
  }
>();
let currentPageComposerAttachmentDraft: {
  images: ComposerAttachedImage[];
  files: ChatMessageAttachedFile[];
} | null = null;
let currentPageComposerAttachmentDraftSessionId = "";
const FILE_PREVIEW_CACHE_MAX_ENTRIES = 24;
const filePreviewObjectUrlCache = new Map<
  string,
  {
    blob: Blob;
    objectUrl: string;
    updatedAt: number;
  }
>();

function clearComposerAttachmentDraftCache(sessionId: string) {
  if (!sessionId) {
    return;
  }
  sessionComposerAttachmentDrafts.delete(sessionId);
  if (currentPageComposerAttachmentDraftSessionId === sessionId) {
    currentPageComposerAttachmentDraft = null;
    currentPageComposerAttachmentDraftSessionId = "";
  }
}

function getCachedPreviewBlob(previewUrl: string) {
  const cacheKey = String(previewUrl || "").trim();
  if (!cacheKey) {
    return null;
  }
  const cached = filePreviewObjectUrlCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  cached.updatedAt = Date.now();
  return cached;
}

function setCachedPreviewBlob(previewUrl: string, blob: Blob) {
  const cacheKey = String(previewUrl || "").trim();
  if (!cacheKey) {
    return null;
  }
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
    if (!oldestEntry) {
      break;
    }
    filePreviewObjectUrlCache.delete(oldestEntry[0]);
    URL.revokeObjectURL(oldestEntry[1].objectUrl);
  }

  return cached;
}

function trimBoundaryInvisibleChars(text: string) {
  return String(text || "").replace(
    /^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/g,
    "",
  );
}

function sanitizeDraftInputText(text: string) {
  return trimBoundaryInvisibleChars(text);
}

function createComposerAttachedImage(
  previewUrl: string,
  localPreviewUrl?: string,
  id?: string,
): ComposerAttachedImage {
  return {
    id: String(
      id || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ),
    previewUrl: String(previewUrl || "").trim(),
    localPreviewUrl: String(localPreviewUrl || "").trim() || undefined,
  };
}

function normalizeComposerAttachedImage(
  image: unknown,
): ComposerAttachedImage | null {
  if (typeof image === "string") {
    const previewUrl = image.trim();
    return previewUrl ? createComposerAttachedImage(previewUrl) : null;
  }

  if (!image || typeof image !== "object") {
    return null;
  }

  const previewUrl = String(
    (image as { previewUrl?: unknown; url?: unknown }).previewUrl ??
      (image as { previewUrl?: unknown; url?: unknown }).url ??
      "",
  ).trim();
  if (!previewUrl) {
    return null;
  }

  const id = String((image as { id?: unknown }).id || "").trim() || undefined;
  return createComposerAttachedImage(previewUrl, undefined, id);
}

function sanitizeDraftAttachImages(images: unknown) {
  if (!Array.isArray(images)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: ComposerAttachedImage[] = [];
  for (const item of images) {
    const nextImage = normalizeComposerAttachedImage(item);
    if (!nextImage || seen.has(nextImage.previewUrl)) {
      continue;
    }
    seen.add(nextImage.previewUrl);
    normalized.push(nextImage);
    if (normalized.length >= MAX_ATTACH_IMAGES) {
      break;
    }
  }

  return normalized;
}

function createAttachImagesDraftPayload(
  images: ComposerAttachedImage[],
): AttachImagesDraftPayload {
  const now = Date.now();
  return {
    version: 2,
    images: sanitizeDraftAttachImages(images).map((image) => ({
      id: image.id,
      previewUrl: image.previewUrl,
    })),
    updatedAt: now,
    expiresAt: now + UNFINISHED_ATTACH_IMAGES_TTL_MS,
  };
}

function getComposerAttachedImagePreviewUrl(
  image: Pick<ComposerAttachedImage, "previewUrl" | "localPreviewUrl">,
) {
  return String(image.localPreviewUrl || image.previewUrl || "").trim();
}

function revokeLocalComposerAttachedImagePreviewUrl(
  image: Pick<ComposerAttachedImage, "localPreviewUrl">,
) {
  const url = String(image.localPreviewUrl || "").trim();
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function mergeComposerAttachedImages(
  currentImages: ComposerAttachedImage[],
  nextImages: ComposerAttachedImage[],
) {
  const ordered: ComposerAttachedImage[] = [];
  const byUrl = new Map<string, ComposerAttachedImage>();

  for (const item of [...currentImages, ...nextImages]) {
    const previewUrl = String(item.previewUrl || "").trim();
    if (!previewUrl) {
      continue;
    }

    const existing = byUrl.get(previewUrl);
    if (!existing) {
      const normalized = createComposerAttachedImage(
        previewUrl,
        item.localPreviewUrl,
        item.id,
      );
      byUrl.set(previewUrl, normalized);
      ordered.push(normalized);
      continue;
    }

    if (!existing.localPreviewUrl && item.localPreviewUrl) {
      existing.localPreviewUrl = item.localPreviewUrl;
    }
  }

  return ordered.slice(0, MAX_ATTACH_IMAGES);
}

async function readAttachImagesDraft(keys: string[]) {
  const now = Date.now();
  const indexedDbValues =
    keys.length > 0 ? await indexedDbStateStorage.getRawItems(keys) : {};

  for (const key of keys) {
    const raw = indexedDbValues[key] ?? localStorage.getItem(key);
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);

      // Backward compatible with the previous plain string-array format.
      if (Array.isArray(parsed)) {
        const images = sanitizeDraftAttachImages(parsed);
        if (images.length === 0) {
          void indexedDbStateStorage.removeRawItem(key);
          localStorage.removeItem(key);
          continue;
        }
        return { images, fromLegacy: true };
      }

      const images = sanitizeDraftAttachImages(parsed?.images);
      const expiresAt = Number(parsed?.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        void indexedDbStateStorage.removeRawItem(key);
        localStorage.removeItem(key);
        continue;
      }

      if (images.length === 0) {
        void indexedDbStateStorage.removeRawItem(key);
        localStorage.removeItem(key);
        continue;
      }

      return { images, fromLegacy: false };
    } catch {
      void indexedDbStateStorage.removeRawItem(key);
      localStorage.removeItem(key);
    }
  }

  return null;
}

function isAttachableImageFile(file: Pick<File, "name" | "type">) {
  const normalizedType = String(file.type || "").toLowerCase();
  const normalizedName = String(file.name || "").toLowerCase();
  return (
    normalizedType.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|heic|heif|bmp|avif|svg)$/i.test(normalizedName)
  );
}

function getAttachmentTypeKind(
  file: Pick<File, "name" | "type">,
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

function getAttachmentTypeLabel(file: Pick<File, "name" | "type">) {
  const typeKind = getAttachmentTypeKind(file);
  switch (typeKind) {
    case "pdf":
      return "PDF";
    case "spreadsheet":
      return "表格文件";
    case "document":
      return "文档文件";
    case "archive":
      return "压缩文件";
    default:
      return "文件";
  }
}

function getPreviewContentType(file: Pick<File, "name" | "type">) {
  const normalizedType = String(file.type || "").toLowerCase();
  const normalizedName = String(file.name || "").toLowerCase();
  if (normalizedType && normalizedType !== "application/octet-stream") {
    return normalizedType;
  }
  if (normalizedName.endsWith(".pdf")) return "application/pdf";
  if (/\.(png)$/i.test(normalizedName)) return "image/png";
  if (/\.(jpe?g)$/i.test(normalizedName)) return "image/jpeg";
  if (/\.(webp)$/i.test(normalizedName)) return "image/webp";
  if (/\.(gif)$/i.test(normalizedName)) return "image/gif";
  if (/\.(svg)$/i.test(normalizedName)) return "image/svg+xml";
  if (/\.(txt|md|log)$/i.test(normalizedName)) return "text/plain";
  if (/\.(json)$/i.test(normalizedName)) return "application/json";
  if (/\.(csv)$/i.test(normalizedName)) return "text/csv";
  if (/\.(tsv)$/i.test(normalizedName)) return "text/tab-separated-values";
  if (/\.(docx)$/i.test(normalizedName)) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (/\.(xlsx)$/i.test(normalizedName)) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "application/octet-stream";
}

// Excel 预览行数限制，超出则截断避免主线程阻塞
const EXCEL_PREVIEW_MAX_ROWS = 500;

function formatAttachmentSize(size: number) {
  const safeSize = Number.isFinite(size) ? Math.max(0, size) : 0;
  if (safeSize < 1024) return `${safeSize} B`;
  if (safeSize < 1024 * 1024) return `${(safeSize / 1024).toFixed(1)} KB`;
  if (safeSize < 1024 * 1024 * 1024) {
    return `${(safeSize / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(safeSize / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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

const PREVIEW_DOWNLOAD_CHUNK_SIZE = 256 * 1024;

async function downloadPreviewBlobInChunks(options: {
  url: string;
  signal?: AbortSignal;
  fileContentType: string;
  onHeaders?: (contentType: string, total: number) => void;
  onProgress?: (loaded: number, total: number) => Promise<void> | void;
}) {
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
      headers: {
        Range: `bytes=${start}-${end}`,
      },
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

function isImageAttachmentFile(
  file: Pick<ChatMessageAttachedFile, "type" | "name">,
) {
  return (
    String(file.type || "")
      .toLowerCase()
      .startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|bmp|svg|avif|heic|heif)$/i.test(
      String(file.name || ""),
    )
  );
}

function createAttachedFileFromUpload(
  file: File,
  previewUrl: string,
  localPreviewUrl?: string,
  contentMd5?: string,
): ChatMessageAttachedFile {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    name: file.name || "未命名文件",
    type: getPreviewContentType(file),
    size: file.size || 0,
    contentMd5,
    typeLabel: getAttachmentTypeLabel(file),
    typeKind: getAttachmentTypeKind(file),
    previewUrl,
    localPreviewUrl,
  };
}

function getUploadContentType(file: Pick<File, "type">) {
  return String(file.type || "application/octet-stream").trim();
}

function getComposerAttachedFileIdentityKey(
  file: Pick<
    ChatMessageAttachedFile,
    "previewUrl" | "name" | "size" | "type" | "typeKind" | "contentMd5"
  >,
) {
  const contentMd5 = String(file.contentMd5 || "")
    .trim()
    .toLowerCase();
  if (contentMd5) {
    return `md5:${file.type}:${contentMd5}`;
  }
  const previewUrl = String(file.previewUrl || "").trim();
  if (previewUrl) {
    return `preview:${previewUrl}`;
  }
  return `meta:${file.name}|${file.size}|${file.type}|${file.typeKind}`;
}

function getComposerPendingFileMetaKey(file: File) {
  return `meta:${file.name}|${file.size}|${getPreviewContentType(
    file,
  )}|${getAttachmentTypeKind(file)}`;
}

function mergeComposerAttachedFiles(
  currentFiles: ChatMessageAttachedFile[],
  nextFiles: ChatMessageAttachedFile[],
) {
  const ordered: ChatMessageAttachedFile[] = [];
  const byKey = new Map<string, ChatMessageAttachedFile>();

  for (const item of [...currentFiles, ...nextFiles]) {
    const identityKey = getComposerAttachedFileIdentityKey(item);
    if (!identityKey) {
      continue;
    }

    const existing = byKey.get(identityKey);
    if (!existing) {
      const normalized = { ...item };
      byKey.set(identityKey, normalized);
      ordered.push(normalized);
      continue;
    }

    if (!existing.localPreviewUrl && item.localPreviewUrl) {
      existing.localPreviewUrl = item.localPreviewUrl;
    }
  }

  return ordered.slice(0, MAX_ATTACH_IMAGES);
}

async function computeFileContentMd5(file: Blob) {
  const buffer = await file.arrayBuffer();
  return SparkMD5.ArrayBuffer.hash(buffer);
}

async function resolveComposerCachedUploadUrl(
  file: File,
  contentMd5: string,
): Promise<string> {
  const res = await fetch("/api/cache/resolve", {
    method: "POST",
    credentials: "include",
    headers: withSyncUserHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      fileName: file.name || "file",
      contentType: getUploadContentType(file),
      contentMd5,
    }),
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok || payload?.code !== 0) {
    return "";
  }

  return payload?.data?.hit ? String(payload.data.url || "").trim() : "";
}

function revokeLocalAttachmentPreviewUrl(
  file: Pick<ChatMessageAttachedFile, "localPreviewUrl">,
) {
  const url = String(file.localPreviewUrl || "").trim();
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function stripLocalAttachmentPreviewUrl(
  file: ChatMessageAttachedFile,
): ChatMessageAttachedFile {
  const { localPreviewUrl: _localPreviewUrl, ...rest } = file;
  return rest;
}

function isServerCacheUrl(url: unknown) {
  return String(url || "")
    .trim()
    .startsWith(CACHE_URL_PREFIX);
}

function deleteUnsentServerCacheUrl(url: unknown) {
  const cacheUrl = String(url || "").trim();
  if (!isServerCacheUrl(cacheUrl)) {
    return;
  }

  void fetch(cacheUrl, {
    method: "DELETE",
    credentials: "include",
  }).catch(() => {});
}

function buildAttachedFilesPromptText(files: ChatMessageAttachedFile[]) {
  if (files.length === 0) return "";
  const lines = files.map((file, index) => {
    const parts = [
      `${index + 1}. 名称：${file.name || "未命名文件"}`,
      `类型：${file.typeLabel || "文件"}`,
      `大小：${formatAttachmentSize(file.size)}`,
    ];
    return parts.join("，");
  });
  return [
    "用户附加了以下文件，仅提供文件元数据，不代表已经提取正文内容：",
    ...lines,
  ].join("\n");
}

function getPreviewFileKind(
  file: Pick<ChatMessageAttachedFile, "type" | "name">,
) {
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

function isDocxPreviewFile(
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

function getFilePreviewErrorMessage(error: unknown) {
  const raw = String((error as Error)?.message || error || "").trim();
  if (!raw) {
    return "文件预览失败，请稍后重试。";
  }
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
  const actions = [
    props.onAction
      ? {
          label: props.actionLabel || "重试",
          onClick: props.onAction,
          tone: "primary" as const,
        }
      : null,
    props.onCancel
      ? {
          label: props.cancelLabel || "取消下载",
          onClick: props.onCancel,
          tone: "secondary" as const,
        }
      : null,
  ].filter(Boolean) as Array<{
    label: string;
    onClick?: () => void;
    tone?: "primary" | "secondary";
  }>;

  return (
    <LoadingPanel
      title={props.title}
      message={props.message}
      progress={props.progress}
      progressLabel={props.progressLabel}
      fileName={props.file.name || "未命名文件"}
      metaItems={props.metaItems}
      actions={actions}
      icon={
        <div
          className={clsx(
            styles["file-preview-state-icon"],
            styles[`attach-file-${props.file.typeKind}`],
          )}
        >
          <div className={styles["attach-file-icon"]}>
            <span className={styles["attach-file-glyph"]}></span>
          </div>
        </div>
      }
      className={styles["file-preview-state"]}
    />
  );
}

function FilePreviewContent(props: { file: ChatMessageAttachedFile }) {
  const { file } = props;
  const previewUrl = String(file.previewUrl || "").trim();
  const fileKind = getPreviewFileKind(file);
  const hostRef = useRef<HTMLDivElement>(null);
  const [blobUrl, setBlobUrl] = useState("");
  const [textContent, setTextContent] = useState("");
  const [spreadsheetSheets, setSpreadsheetSheets] = useState<
    Array<{ name: string; totalRows: number; html: string }>
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

  const cancelDownload = useCallback(() => {
    userCancelledDownloadRef.current = true;
    setDownloadCancelled(true);
    setError("");
    setLoading(false);
    downloadAbortRef.current?.();
  }, []);

  const downloadProgressLabel = useMemo(() => {
    return `${Math.round(downloadProgress * 100)}%`;
  }, [downloadProgress]);

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
    <object
      data={url}
      type={getPreviewContentType(file)}
      className={styles["file-preview-frame"]}
    >
      <iframe
        src={url}
        title={file.name || "文件预览"}
        className={styles["file-preview-frame"]}
      />
    </object>
  );

  const iframePreview = (url: string) => (
    <iframe
      src={url}
      title={file.name || "文件预览"}
      className={styles["file-preview-frame"]}
    />
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
            // 使用 sheetRows 限制每个 sheet 的最大行数，避免主线程阻塞
            const workbook = XLSX.read(buffer, {
              type: "array",
              sheetRows: EXCEL_PREVIEW_MAX_ROWS,
            });
            // 记录每个 sheet 的原始范围以显示截断提示
            const originalRangeRef = new Map<string, string>();
            for (const sheetName of workbook.SheetNames) {
              originalRangeRef.set(
                sheetName,
                workbook.Sheets[sheetName]?.["!ref"] || "",
              );
            }
            const nextSheets = workbook.SheetNames.map((sheetName) => {
              const sheet = workbook.Sheets[sheetName];
              if (!sheet) return null;
              const originalRange = originalRangeRef.get(sheetName) || "";
              const totalRows = (() => {
                const m = originalRange.match(/:([A-Z]+)(\d+)$/);
                return m ? parseInt(m[2], 10) : EXCEL_PREVIEW_MAX_ROWS;
              })();
              return {
                name: sheetName,
                totalRows,
                html: XLSX.utils.sheet_to_html(sheet, {
                  id: `sheet-${sheetName}`,
                }),
              };
            }).filter(
              (
                sheet,
              ): sheet is { name: string; totalRows: number; html: string } =>
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
          }
          return;
        }

        let responseType = "";
        let contentLength = 0;

        abortController = new AbortController();
        downloadAbortRef.current = () => abortController?.abort();
        const responseBlob = await downloadPreviewBlobInChunks({
          url: previewUrl,
          signal: abortController.signal,
          fileContentType: getPreviewContentType(file),
          onHeaders: (nextContentType, nextTotal) => {
            responseType = nextContentType;
            contentLength = nextTotal;
            if (!cancelled && nextTotal > 0) {
              setDownloadTotalBytes(nextTotal);
            }
          },
          onProgress: async (loaded, total) => {
            if (cancelled) {
              return;
            }

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
          // 使用 sheetRows 限制每个 sheet 的最大行数，避免主线程阻塞
          const workbook = XLSX.read(buffer, {
            type: "array",
            sheetRows: EXCEL_PREVIEW_MAX_ROWS,
          });
          // 记录每个 sheet 的原始范围以显示截断提示
          const originalRangeRef = new Map<string, string>();
          for (const sheetName of workbook.SheetNames) {
            originalRangeRef.set(
              sheetName,
              workbook.Sheets[sheetName]?.["!ref"] || "",
            );
          }
          const nextSheets = workbook.SheetNames.map((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            if (!sheet) return null;
            const originalRange = originalRangeRef.get(sheetName) || "";
            const totalRows = (() => {
              const m = originalRange.match(/:([A-Z]+)(\d+)$/);
              return m ? parseInt(m[2], 10) : EXCEL_PREVIEW_MAX_ROWS;
            })();
            return {
              name: sheetName,
              totalRows,
              html: XLSX.utils.sheet_to_html(sheet, {
                id: `sheet-${sheetName}`,
              }),
            };
          }).filter(
            (
              sheet,
            ): sheet is { name: string; totalRows: number; html: string } =>
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
    return objectPreview(previewUrl);
  }

  if (fileKind === "generic") {
    return objectPreview(previewUrl);
  }

  if (fileKind === "pdf") {
    const pdfSourceUrl = blobUrl || previewUrl;
    const pdfUrl = pdfSourceUrl.includes("#")
      ? pdfSourceUrl
      : `${pdfSourceUrl}#toolbar=1&navpanes=0`;
    return (
      <div className={styles["file-preview-root"]}>
        <div className={styles["file-preview-meta"]}>
          <span>{file.typeLabel || "PDF"}</span>
          <span>{formatAttachmentSize(file.size)}</span>
        </div>
        {loading ? (
          <FilePreviewState
            file={file}
            title="正在下载文件..."
            message="请稍候，文件下载完成后会自动预览。"
            progress={downloadProgress}
            progressLabel={downloadProgressLabel}
            metaItems={downloadMetaItems}
            onCancel={cancelDownload}
          />
        ) : downloadCancelled ? (
          <FilePreviewState
            file={file}
            title="已取消下载"
            message="下载已取消，重新开始后会继续预览这个文件。"
            actionLabel="重新下载"
            onAction={restartPreview}
            metaItems={downloadMetaItems}
          />
        ) : error ? (
          <FilePreviewState
            file={file}
            title="PDF 预览失败"
            message={error}
            onAction={restartPreview}
            metaItems={downloadMetaItems}
          />
        ) : pdfSourceUrl ? (
          objectPreview(pdfUrl)
        ) : (
          <FilePreviewState
            file={file}
            title="PDF 预览失败"
            message="没有拿到可预览的文件内容，请重试。"
            onAction={restartPreview}
            metaItems={downloadMetaItems}
          />
        )}
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
        className={clsx(styles["docx-preview-root"], {
          [styles["docx-preview-root-loading"]]: loading,
        })}
      >
        <div ref={hostRef} className={styles["docx-preview-container"]} />
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
    body = <pre className={styles["file-preview-text"]}>{textContent}</pre>;
  } else if (fileKind === "spreadsheet") {
    body = (
      <div className={styles["xlsx-preview-root"]}>
        {spreadsheetSheets.length > 0 && (
          <div className={styles["xlsx-preview-tabs"]}>
            {spreadsheetSheets.map((sheet) => {
              const isActive = sheet.name === activeSheet?.name;
              return (
                <button
                  key={sheet.name}
                  type="button"
                  className={clsx(styles["xlsx-preview-tab"], {
                    [styles["xlsx-preview-tab-active"]]: isActive,
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
          <div
            className={styles["xlsx-preview-sheet"]}
            dangerouslySetInnerHTML={{ __html: activeSheet.html }}
          />
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

  return (
    <div className={styles["file-preview-root"]}>
      <div className={styles["file-preview-meta"]}>
        <span>{file.typeLabel || "文件"}</span>
        <span>{formatAttachmentSize(file.size)}</span>
        {spreadsheetSheets.length > 0 && (
          <span>{`${spreadsheetSheets.length} 个工作表`}</span>
        )}
        {activeSheet && activeSheet.totalRows > EXCEL_PREVIEW_MAX_ROWS && (
          <span style={{ color: "#d97706" }}>
            （显示前 {EXCEL_PREVIEW_MAX_ROWS} / 共 {activeSheet.totalRows} 行）
          </span>
        )}
      </div>
      <div className={styles["file-preview-body"]}>{body}</div>
    </div>
  );
}

function isCacheUploadEnabled() {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean((window as any)._SW_ENABLED);
}

function formatModelProviderLabel(modelName: unknown, providerName: unknown) {
  const model = String(modelName || "").trim();
  const provider = String(providerName || "").trim();

  if (!model) {
    return provider;
  }

  if (!provider) {
    return model;
  }

  if (model.toLowerCase().endsWith(`@${provider.toLowerCase()}`)) {
    return model;
  }

  return `${model}@${provider}`;
}

function normalizeModelProviderDisplayLabel(
  modelName: unknown,
  providerName: unknown,
) {
  const model = normalizeReservedDisplayModelName(String(modelName || ""));
  const parenMatch = model.match(/^(.+?)（(.+?)）$/);
  if (parenMatch) {
    return formatModelProviderLabel(parenMatch[1], parenMatch[2]);
  }

  return formatModelProviderLabel(model, providerName);
}

function extractProviderDisplayNameFromModelLabel(label: unknown) {
  const value = String(label || "").trim();
  if (!value) {
    return "";
  }

  const atIndex = value.lastIndexOf("@");
  if (atIndex >= 0 && atIndex < value.length - 1) {
    return value.slice(atIndex + 1).trim();
  }

  const parenMatch = value.match(/^.+?（(.+?)）$/);
  return parenMatch?.[1]?.trim() || "";
}

function getMessageProviderDisplayName(
  message: ChatMessage,
  profiles: Array<{
    id?: string;
    name: string;
    provider: ServiceProvider;
    enabled?: boolean;
  }>,
) {
  const profileId = String(message.profileId || "").trim();
  const providerId = String(message.providerId || "")
    .trim()
    .toLowerCase();
  const matchedProfile = profiles.find((profile) => {
    if (profileId && profile.id === profileId) {
      return true;
    }
    if (providerId && profile.provider === ServiceProvider.Custom) {
      return `custom_${profile.name}`.toLowerCase() === providerId;
    }
    if (providerId && profile.provider === ServiceProvider.Local) {
      return (
        `${String(profile.provider).toLowerCase()}_${
          profile.name
        }`.toLowerCase() === providerId
      );
    }
    return providerId && String(profile.provider).toLowerCase() === providerId;
  });
  if (matchedProfile?.name) {
    return matchedProfile.name;
  }

  const currentProfile = profiles.find((profile) => profile.enabled);
  if ((profileId || providerId) && currentProfile?.name) {
    return currentProfile.name;
  }

  return (
    String(message.profileName || "").trim() ||
    extractProviderDisplayNameFromModelLabel(
      message.modelDisplay || message.model,
    )
  );
}

function resolveMessageModelSelection(
  message: ChatMessage | undefined,
  profiles: Array<{
    id?: string;
    name: string;
    provider: ServiceProvider;
    enabled?: boolean;
  }>,
) {
  if (!message) {
    return null;
  }

  const rawModelLabel = String(
    message.modelDisplay || message.model || "",
  ).trim();
  const [parsedModel, parsedProviderLabel] = getModelProvider(rawModelLabel);
  const model = String(parsedModel || message.model || "").trim();
  if (!model) {
    return null;
  }

  const providerId = String(message.providerId || "")
    .trim()
    .toLowerCase();
  const profileId = String(message.profileId || "").trim();
  const providerDisplayName =
    String(message.profileName || "").trim() ||
    String(parsedProviderLabel || "").trim();
  const normalizedProviderDisplayName =
    normalizeProviderLookup(providerDisplayName);

  const matchedProfile = profiles.find((profile) => {
    const profileProviderId = getProfileProviderId(profile).toLowerCase();
    return (
      (!!profileId && profile.id === profileId) ||
      (!!providerId && profileProviderId === providerId) ||
      (!!normalizedProviderDisplayName &&
        normalizeProviderLookup(profile.name) === normalizedProviderDisplayName)
    );
  });
  const currentProfile = profiles.find((profile) => profile.enabled);
  const effectiveProfile =
    matchedProfile || (profileId || providerId ? currentProfile : undefined);

  const resolvedProviderName =
    effectiveProfile && !matchedProfile
      ? effectiveProfile.provider
      : message.providerName ||
        effectiveProfile?.provider ||
        (providerId.startsWith("custom_")
          ? ServiceProvider.Custom
          : providerId.startsWith("local_")
          ? ServiceProvider.Local
          : (providerId as ServiceProvider));
  const resolvedProviderId =
    effectiveProfile && !matchedProfile
      ? getProfileProviderId(effectiveProfile)
      : providerId ||
        (matchedProfile ? getProfileProviderId(matchedProfile) : "");

  if (!resolvedProviderName || !resolvedProviderId) {
    return null;
  }

  return {
    model: model as ModelType,
    providerName: resolvedProviderName as ServiceProvider,
    providerId: resolvedProviderId.toLowerCase(),
    profileId: effectiveProfile?.id || profileId || "",
  };
}

const ttsPlayer = createTTSPlayer();

const MCPAction = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [count, setCount] = useState<number>(0);
  const mcpEnabled = Boolean(getClientConfig()?.enableMcp);

  useEffect(() => {
    let cancelled = false;

    if (!mcpEnabled) {
      setCount(0);
      return;
    }

    // `/chat` 往往只是过渡路由，等它稳定到具体会话页再触发 server action，
    // 避免 Next 在路由切换时把 `POST /chat` 中止并刷出 ERR_ABORTED。
    if (location.pathname === Path.Chat) {
      setCount(0);
      return;
    }

    const checkMcpStatus = async () => {
      try {
        const count = await getAvailableClientsCount();
        if (cancelled) return;
        setCount(count);
      } catch (error) {
        if (!cancelled) {
          console.error("[MCP] failed to check status", error);
          setCount(0);
        }
      }
    };

    void checkMcpStatus();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, mcpEnabled]);

  if (!mcpEnabled) return null;

  return (
    <ChatAction
      onClick={() => navigate(Path.McpMarket)}
      text={`MCP${count ? ` (${count})` : ""}`}
      icon={<McpToolIcon />}
    />
  );
};

export function SessionConfigModel(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const currentSessionSnapshot = useChatStore((state) =>
    state.currentSession(),
  );
  const session = currentSessionSnapshot;

  if (!session) {
    return null;
  }

  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Context.Edit}
        className="session-config-modal"
        onClose={() => props.onClose()}
        actions={[
          <IconButton
            key="reset"
            icon={<ResetIcon />}
            text={Locale.Chat.Config.Reset}
            onClick={async () => {
              if (await showConfirm(Locale.Memory.ResetConfirm)) {
                chatStore.updateTargetSession(
                  session,
                  (session) => (session.memoryPrompt = ""),
                );
              }
            }}
          />,
        ]}
      >
        <MaskConfig
          mask={session.mask}
          updateMask={(updater) => {
            const mask = { ...session.mask };
            updater(mask);
            chatStore.updateTargetSession(
              session,
              (session) => (session.mask = mask),
            );
          }}
          shouldSyncFromGlobal
          readonlyModel
          hideIdentitySettings
          extraListItems={
            session.mask.modelConfig.sendMemory ? (
              <ListItem
                className="copyable"
                title={`${Locale.Memory.Title} (${session.lastSummarizeIndex} of ${session.messages.length})`}
                subTitle={session.memoryPrompt || Locale.Memory.EmptyContent}
              ></ListItem>
            ) : (
              <></>
            )
          }
        ></MaskConfig>
      </Modal>
    </div>
  );
}

function PromptToast(props: { showToast?: boolean; onClick?: () => void }) {
  const currentSessionSnapshot = useChatStore(
    (state) => state.sessions[state.currentSessionIndex],
  );
  const session = normalizeSession(currentSessionSnapshot);
  const context = session?.mask?.context ?? [];

  return (
    <div className={styles["prompt-toast"]} key="prompt-toast">
      {props.showToast && context.length > 0 && (
        <div className="clickable" role="button" onClick={props.onClick}>
          <NoticePill>
            <BrainIcon />
            <span>{Locale.Context.Toast(context.length)}</span>
          </NoticePill>
        </div>
      )}
    </div>
  );
}

function useSubmitHandler() {
  const config = useAppConfig();
  const submitKey = config.submitKey;
  const isComposing = useRef(false);

  useEffect(() => {
    const onCompositionStart = () => {
      isComposing.current = true;
    };
    const onCompositionEnd = () => {
      isComposing.current = false;
    };

    window.addEventListener("compositionstart", onCompositionStart);
    window.addEventListener("compositionend", onCompositionEnd);

    return () => {
      window.removeEventListener("compositionstart", onCompositionStart);
      window.removeEventListener("compositionend", onCompositionEnd);
    };
  }, []);

  const shouldSubmit = (e: React.KeyboardEvent<HTMLElement>) => {
    // Fix Chinese input method "Enter" on Safari
    if (e.keyCode == 229) return false;
    if (e.key !== "Enter") return false;
    if (e.key === "Enter" && (e.nativeEvent.isComposing || isComposing.current))
      return false;
    return (
      (config.submitKey === SubmitKey.AltEnter && e.altKey) ||
      (config.submitKey === SubmitKey.CtrlEnter && e.ctrlKey) ||
      (config.submitKey === SubmitKey.ShiftEnter && e.shiftKey) ||
      (config.submitKey === SubmitKey.MetaEnter && e.metaKey) ||
      (config.submitKey === SubmitKey.Enter &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.metaKey)
    );
  };

  return {
    submitKey,
    shouldSubmit,
  };
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getHighlightedPromptText(text: string, keyword: string) {
  const trimmedKeyword = keyword.trim();
  if (!trimmedKeyword) return text;

  const pattern = new RegExp(`(${escapeRegExp(trimmedKeyword)})`, "gi");
  return text.split(pattern).map((part, index) =>
    part.toLowerCase() === trimmedKeyword.toLowerCase() ? (
      <mark
        key={`${part}-${index}`}
        className={styles["prompt-search-highlight"]}
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export type RenderPrompt = Pick<Prompt, "title" | "content">;

export function PromptHints(props: {
  prompts: RenderPrompt[];
  onPromptSelect: (prompt: RenderPrompt) => void;
}) {
  const noPrompts = props.prompts.length === 0;
  const [selectIndex, setSelectIndex] = useState(0);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectIndex(0);
  }, [props.prompts.length]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (noPrompts || e.metaKey || e.altKey || e.ctrlKey) {
        return;
      }
      // arrow up / down to select prompt
      const changeIndex = (delta: number) => {
        e.stopPropagation();
        e.preventDefault();
        const nextIndex = Math.max(
          0,
          Math.min(props.prompts.length - 1, selectIndex + delta),
        );
        setSelectIndex(nextIndex);
        selectedRef.current?.scrollIntoView({
          block: "center",
        });
      };

      if (e.key === "ArrowUp") {
        changeIndex(1);
      } else if (e.key === "ArrowDown") {
        changeIndex(-1);
      } else if (e.key === "Enter") {
        const selectedPrompt = props.prompts.at(selectIndex);
        if (selectedPrompt) {
          props.onPromptSelect(selectedPrompt);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.prompts.length, selectIndex]);

  if (noPrompts) return null;
  return (
    <div className={styles["prompt-hints"]}>
      {props.prompts.map((prompt, i) => (
        <div
          ref={i === selectIndex ? selectedRef : null}
          className={clsx(styles["prompt-hint"], {
            [styles["prompt-hint-selected"]]: i === selectIndex,
          })}
          key={prompt.title + i.toString()}
          onClick={() => props.onPromptSelect(prompt)}
          onMouseEnter={() => setSelectIndex(i)}
        >
          <div className={styles["hint-title"]}>{prompt.title}</div>
          <div className={styles["hint-content"]}>{prompt.content}</div>
        </div>
      ))}
    </div>
  );
}

function PromptPickerManageIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
      <defs>
        <path id="prompt-picker-manage-mask" d="M0 0h16v16H0z" />
      </defs>
      <g>
        <mask id="prompt-picker-manage-mask-fill" fill="#fff">
          <use href="#prompt-picker-manage-mask" />
        </mask>
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeDasharray="0 0"
          mask="url(#prompt-picker-manage-mask-fill)"
        >
          <path d="m6.7 2.7 1.41 1.41M10 1.333v2m0 0v-2M13.296 2.7l-1.41 1.41m0 0 1.41-1.41m1.37 3.3h-2m0 0h2m-1.37 3.296-1.41-1.41m0 0 1.41 1.41M10 10.666v-2m0 0v2m-3.3-1.37 1.41-1.41m0 0L6.7 9.296M5.333 6h2m0 0h-2M9.858 6.138l-8.01 8.01" />
        </g>
      </g>
    </svg>
  );
}

function PromptPickerModal(props: {
  prompts: RenderPrompt[];
  isLoading: boolean;
  onClose: () => void;
  onManage: () => void;
  onPromptSelect: (prompt: RenderPrompt) => void;
}) {
  const [searchText, setSearchText] = useState("");
  const isMobileScreen = useMobileScreen();
  const promptStore = usePromptStore();
  const keyword = searchText.trim();
  const visiblePrompts = useMemo(() => {
    return keyword ? promptStore.search(keyword) : props.prompts;
  }, [keyword, promptStore, props.prompts]);

  const pickerNode = (
    <div className={styles["prompt-picker-mask"]} onClick={props.onClose}>
      <div
        className={styles["prompt-picker-panel"]}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles["prompt-picker-header"]}>
          <div>
            <div className={styles["prompt-picker-title-main"]}>选择提示词</div>
            <div className={styles["prompt-picker-title-sub"]}>
              选择后会插入当前对话输入框
            </div>
          </div>
          <div className={styles["prompt-picker-header-actions"]}>
            <span className={styles["prompt-picker-count"]}>
              共 {visiblePrompts.length} 条
            </span>
            <IconButton
              aria="关闭"
              icon={<CloseIcon />}
              close
              onClick={props.onClose}
            />
          </div>
        </div>

        <div className={styles["prompt-picker-toolbar"]}>
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="搜索提示词..."
            // nextchat-input-control 提供 idle/hover/focus/dark 适配；本地 .prompt-picker-search 仅保留尺寸约束。
            className={`${styles["prompt-picker-search"]} nextchat-input-control`}
            autoFocus={!isMobileScreen}
          />
          <IconButton
            icon={<PromptPickerManageIcon />}
            text="管理提示词"
            // nextchat-default-button 提供 idle/hover/focus/dark 适配；本地 .prompt-picker-manage 仅保留尺寸约束。
            className={`${styles["prompt-picker-manage"]} nextchat-default-button`}
            onClick={props.onManage}
          />
        </div>

        <div className={styles["prompt-picker-list"]}>
          {props.isLoading ? (
            <div
              className={clsx(
                styles["prompt-picker-empty"],
                styles["prompt-picker-loading"],
              )}
              aria-label="正在从数据库加载提示词"
            >
              <LoadingIcon className={styles["prompt-picker-loading-dots"]} />
              <div>正在从数据库加载提示词...</div>
            </div>
          ) : visiblePrompts.length === 0 ? (
            <div className={styles["prompt-picker-empty"]}>
              <div className={styles["prompt-picker-empty-icon"]}>🔍</div>
              <div>{keyword ? "未搜索到相关提示词" : "暂无可用提示词"}</div>
            </div>
          ) : (
            visiblePrompts.map((prompt, index) => (
              <button
                type="button"
                className={styles["prompt-picker-item"]}
                key={`${prompt.title}-${index}`}
                onClick={() => props.onPromptSelect(prompt)}
              >
                <span className={styles["prompt-picker-item-icon"]}>
                  <PromptIcon />
                </span>
                <span className={styles["prompt-picker-item-body"]}>
                  <span className={styles["prompt-picker-title"]}>
                    {getHighlightedPromptText(prompt.title, keyword)}
                  </span>
                  <span className={styles["prompt-picker-content"]}>
                    {getHighlightedPromptText(prompt.content, keyword)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(pickerNode, document.body);
}

function ClearContextDivider() {
  const chatStore = useChatStore();
  const currentSessionSnapshot = useChatStore(
    (state) => state.sessions[state.currentSessionIndex],
  );
  const { session: loadedSession } = useCurrentSession();
  const session = loadedSession ?? currentSessionSnapshot;

  return (
    <div
      className={styles["clear-context"]}
      onClick={() =>
        chatStore.updateTargetSession(
          session,
          (session) => (session.clearContextIndex = undefined),
        )
      }
    >
      <div className={styles["clear-context-tips"]}>{Locale.Context.Clear}</div>
      <div className={styles["clear-context-revert-btn"]}>
        {Locale.Context.Revert}
      </div>
    </div>
  );
}

export function ChatAction(props: {
  text: string;
  icon: JSX.Element;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const iconRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState({
    full: 16,
    icon: 16,
  });

  function updateWidth() {
    if (!iconRef.current || !textRef.current) return;
    const getWidth = (dom: HTMLDivElement) => dom.getBoundingClientRect().width;
    const textWidth = getWidth(textRef.current);
    const iconWidth = getWidth(iconRef.current);
    setWidth({
      full: textWidth + iconWidth,
      icon: iconWidth,
    });
  }

  return (
    <div
      className={clsx(
        styles["chat-input-action"],
        "clickable",
        props.className,
        {
          [styles["chat-input-action-disabled"]]: props.disabled,
        },
      )}
      onClick={() => {
        if (props.disabled) return;
        props.onClick();
        setTimeout(updateWidth, 1);
      }}
      onMouseEnter={updateWidth}
      onTouchStart={updateWidth}
      style={
        {
          "--icon-width": `${width.icon}px`,
          "--full-width": `${width.full}px`,
        } as React.CSSProperties
      }
    >
      <div
        ref={iconRef}
        className={clsx(styles["icon"], "nextchat-action-button-icon")}
      >
        {props.icon}
      </div>
      <div
        className={clsx(styles["text"], "nextchat-action-button-text")}
        ref={textRef}
      >
        {props.text}
      </div>
    </div>
  );
}

function MobileAddIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <path
        d="M15 7.5V22.5M7.5 15H22.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChatHeaderExportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8.34 5.17C3.34 5.17 1.67 8.84 1.67 14.5C1.67 14.5 3.67 9.5 8.34 9.5V13.17L14.34 7.5L8.34 1.5V5.17Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.333"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

function MobileClearIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <path
        d="M9 9L21 21M21 9L9 21"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const MOBILE_INPUT_ACTION_BUTTON_STYLE = {
  width: 44,
  height: 44,
  minWidth: 44,
  minHeight: 44,
  maxWidth: 44,
  maxHeight: 44,
  padding: 0,
  borderRadius: "50%",
  flex: "0 0 44px",
  alignSelf: "flex-end",
} as const;

function useScrollToBottom(
  scrollRef: RefObject<HTMLDivElement>,
  detach: boolean = false,
  messages: ChatMessage[],
  autoScrollEnabled: boolean = true,
) {
  // for auto-scroll
  const [autoScroll, setAutoScroll] = useState(false);
  const fallbackScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const scrollRafRef = useRef<number | null>(null);
  const cancelScheduledScrollToBottom = useCallback(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    if (fallbackScrollTimerRef.current) {
      clearTimeout(fallbackScrollTimerRef.current);
      fallbackScrollTimerRef.current = null;
    }
  }, []);

  const scrollDomToBottom = useCallback(() => {
    const dom = scrollRef.current;
    if (dom) {
      const runScroll = () => {
        scrollRafRef.current = null;
        setAutoScroll(true);
        const targetTop = Math.max(0, dom.scrollHeight - dom.clientHeight);
        dom.scrollTop = targetTop;
      };

      cancelScheduledScrollToBottom();
      scrollRafRef.current = requestAnimationFrame(runScroll);
      fallbackScrollTimerRef.current = setTimeout(() => {
        fallbackScrollTimerRef.current = null;
        runScroll();
      }, 48);
    }
  }, [cancelScheduledScrollToBottom, scrollRef]);

  // auto scroll when messages length changes (非流式期间)
  const lastMessagesLength = useRef(messages.length);
  useEffect(() => {
    if (
      autoScrollEnabled &&
      autoScroll &&
      messages.length > lastMessagesLength.current &&
      !detach
    ) {
      scrollDomToBottom();
    }
    lastMessagesLength.current = messages.length;
  }, [
    autoScroll,
    autoScrollEnabled,
    messages.length,
    detach,
    scrollDomToBottom,
  ]);

  useEffect(() => {
    return () => {
      cancelScheduledScrollToBottom();
    };
  }, [cancelScheduledScrollToBottom]);

  return {
    scrollRef,
    autoScroll,
    setAutoScroll,
    scrollDomToBottom,
    cancelScheduledScrollToBottom,
  };
}

export function ChatActions(props: {
  uploadImage: () => void;
  setAttachImages: (images: ComposerAttachedImage[]) => void;
  setUploading: (uploading: boolean) => void;
  uploading: boolean;
}) {
  const config = useAppConfig();
  const chatStore = useChatStore();
  const currentSessionSnapshot = useChatStore(
    (state) => state.sessions[state.currentSessionIndex],
  );
  const { session: loadedSession, loading: sessionLoading } =
    useCurrentSession();
  const session = loadedSession ?? currentSessionSnapshot;
  const previousSessionIdRef = useRef<string | null>(null);

  const getModelGroup = useCallback(
    (
      modelName: string,
      providerName?: string,
      vendorName?: string,
      displayName?: string,
    ) => {
      const normalizedModelName = modelName.toLowerCase();
      const normalizedDisplayName = String(displayName ?? "").toLowerCase();

      if (
        normalizedModelName.includes("aihubmix") ||
        normalizedDisplayName.includes("aihubmix")
      ) {
        return "AihubMix";
      }

      if (vendorName?.trim()) {
        return getModelDisplayGroup({
          modelName,
          providerName,
          vendorName,
          displayName,
        });
      }

      const fullName = `${modelName} ${providerName ?? ""}`.toLowerCase();

      const groupByKeywords = (
        label: string,
        keywords: string[],
        matcher?: (name: string) => boolean,
      ) => {
        if (keywords.some((keyword) => fullName.includes(keyword))) {
          return label;
        }
        if (matcher?.(modelName.toLowerCase())) {
          return label;
        }
        return null;
      };

      return (
        groupByKeywords(
          "OpenAI",
          ["gpt", "chatgpt", "openai", "codex"],
          (name) =>
            /^o[1345](?:$|[^a-z])/i.test(name) ||
            name.includes("o1-") ||
            name.includes("o3-") ||
            name.includes("o4-") ||
            name.includes("o5-"),
        ) ||
        groupByKeywords("Claude", ["claude", "anthropic"]) ||
        groupByKeywords("Gemini", ["gemini", "google"]) ||
        groupByKeywords("Minimax", ["minimax", "abab"]) ||
        groupByKeywords("Grok", ["grok", "xai", "x.ai"]) ||
        groupByKeywords("Meta", ["llama", "meta-llama", "meta "]) ||
        groupByKeywords("Mistral", ["mistral", "mixtral", "ministral"]) ||
        groupByKeywords("DeepSeek", ["deepseek", "deep-seek"]) ||
        groupByKeywords("Doubao", [
          "doubao",
          "seed",
          "bytedance",
          "volc",
          "字节",
        ]) ||
        groupByKeywords("Qwen", ["qwen", "alibaba", "tongyi", "阿里"]) ||
        groupByKeywords("Xiaomi", ["xiaomi", "mimo", "mi-mo"]) ||
        groupByKeywords("iFLYTEK Spark", [
          "iflytek",
          "xfyun",
          "spark",
          "讯飞",
        ]) ||
        groupByKeywords("01.AI", ["01-ai", "01.ai", "yi-", "lingyi", "万物"]) ||
        groupByKeywords("StepFun", ["stepfun", "step-", "阶跃"]) ||
        groupByKeywords("Tencent Hunyuan", ["hunyuan", "tencent", "腾讯"]) ||
        groupByKeywords("ERNIE", ["baidu", "ernie", "wenxin", "qianfan"]) ||
        groupByKeywords("Z.ai", ["z.ai", "z-ai", "zhipu", "chatglm", "glm-"]) ||
        groupByKeywords("Kimi", ["moonshot", "kimi"]) ||
        groupByKeywords("Cohere", ["cohere", "command-r"]) ||
        groupByKeywords("Perplexity", ["perplexity", "sonar"]) ||
        groupByKeywords("Stability", [
          "stable-diffusion",
          "stability",
          "sdxl",
          "sd3",
        ]) ||
        groupByKeywords("Nvidia", ["nvidia", "nemotron", "phi-"]) ||
        groupByKeywords("Baichuan", ["baichuan"]) ||
        groupByKeywords("Ideogram", ["ideogram"]) ||
        groupByKeywords("Jina AI", ["jina"]) ||
        groupByKeywords("Flux", ["flux-"]) ||
        groupByKeywords("Meituan", ["longcat", "meituan"]) ||
        groupByKeywords("InclusionAI", ["inclusion", "ling-", "ring-"]) ||
        groupByKeywords("BAAI", ["bge-", "baai"]) ||
        groupByKeywords("OpenRouter", ["openrouter"]) ||
        groupByKeywords("Microsoft", ["microsoft", "wizardlm"]) ||
        "Other"
      );
    },
    [],
  );
  // switch model
  const currentModel = normalizeReservedDisplayModelName(
    session?.mask?.modelConfig?.model || "",
  );
  const currentProviderName =
    session?.mask?.modelConfig?.providerName || ServiceProvider.OpenAI;

  // 只使用真实模型集合和用户手动维护的全局自定义模型。
  const globalCustomModels = useAppConfig((state) => state.customModels);
  const globalCustomModelEntries = useMemo(
    () =>
      globalCustomModels
        .split(",")
        .map((v) => v.trim())
        .filter((v) => !!v),
    [globalCustomModels],
  );
  const globalCustomModelEntryMap = useMemo(() => {
    const map = new Map<string, string>();
    globalCustomModelEntries.forEach((entry) => {
      const normalizedEntry =
        entry.startsWith("+") || entry.startsWith("-") ? entry.slice(1) : entry;
      const [name] = normalizedEntry.split("=");
      if (!map.has(name)) {
        map.set(name, entry);
      }
    });
    return map;
  }, [globalCustomModelEntries]);
  const globalCustomModelValueSet = useMemo(
    () =>
      new Set(
        globalCustomModelEntries.map((entry) => {
          const normalizedEntry =
            entry.startsWith("+") || entry.startsWith("-")
              ? entry.slice(1)
              : entry;
          const [name] = normalizedEntry.split("=");
          return name;
        }),
      ),
    [globalCustomModelEntries],
  );
  const currentCustomModelKey = `${currentModel}@${currentProviderName}`;
  const accessProfiles = useAccessStore((state) => state.apiProfiles);

  // 使用 useAllModels 获取完整的真实模型列表。
  const allModels = useAllModels();

  const currentProviderId = useMemo(() => {
    return (
      resolveModelProviderId(
        allModels,
        session.mask.modelConfig,
        accessProfiles,
      ) || String(currentProviderName).toLowerCase()
    );
  }, [
    accessProfiles,
    allModels,
    currentProviderName,
    session.mask.modelConfig,
  ]);

  const models = useMemo(() => {
    const filteredModels = allModels.filter((m) => m.available);
    return filteredModels;
  }, [allModels]);
  const [showSizeSelector, setShowSizeSelector] = useState(false);
  const [showQualitySelector, setShowQualitySelector] = useState(false);
  const [showStyleSelector, setShowStyleSelector] = useState(false);
  const [showDurationSelector, setShowDurationSelector] = useState(false);
  const modelSizes = getModelSizes(currentModel);
  const videoDurationOptions = getSupportedVideoDurations(currentModel);
  const imageQualityOptions = getSupportedImageQualityOptions(currentModel);
  const imageStyleOptions = getSupportedImageStyleOptions(currentModel);
  const currentSize = normalizeModelSize(
    currentModel,
    session.mask.modelConfig?.size,
  );
  const autoAdjustedSizeRef = useRef<string>("");
  const currentQuality = session.mask.modelConfig?.quality ?? "standard";
  const currentStyle = session.mask.modelConfig?.style ?? "vivid";
  const currentSeconds = session.mask.modelConfig?.seconds ?? "4";
  const currentModelSupport = getModelParameterSupport(currentModel);
  const supportsImageGenerationControls =
    currentModelSupport.capability === "image";
  const supportsVideoGenerationControls =
    currentModelSupport.capability === "video";
  const supportsSizeControl = supportsCustomSize(currentModel);
  const supportsQualityControl = supportsImageQualityControl(currentModel);
  const supportsStyleControl = supportsImageStyleControl(currentModel);
  const supportsVideoDuration = supportsVideoDurationControl(currentModel);
  const supportsVideoReference = supportsVideoImageReference(currentModel);
  const sessionId = session?.id ?? "";
  const sessionModelConfigSize = session.mask.modelConfig.size;
  const sessionModelConfigQuality = session.mask.modelConfig.quality;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const isMobileScreen = useMobileScreen();

  useEffect(() => {
    previousSessionIdRef.current = sessionId;
  }, [sessionId]);

  return (
    <div
      className={clsx(
        styles["chat-input-actions"],
        styles["chat-input-actions-main"],
        styles["chat-actions-row-container"],
      )}
    >
      <ChatAction
        onClick={props.uploadImage}
        text={
          props.uploading
            ? "上传图片中"
            : supportsVideoReference
            ? "参考图 / i2v"
            : supportsImageGenerationControls
            ? "参考图"
            : "图片"
        }
        icon={props.uploading ? <LoadingButtonIcon /> : <ImageIcon />}
      />

      {supportsImageGenerationControls && (
        <>
          {supportsSizeControl && (
            <ChatAction
              onClick={() => setShowSizeSelector(true)}
              text={`尺寸 ${currentSize}`}
              icon={<SizeIcon />}
            />
          )}

          {supportsQualityControl && (
            <ChatAction
              onClick={() => setShowQualitySelector(true)}
              text={`画质 ${currentQuality}`}
              icon={<QualityIcon />}
            />
          )}

          {supportsStyleControl && (
            <ChatAction
              onClick={() => setShowStyleSelector(true)}
              text={`风格 ${currentStyle}`}
              icon={<ImageIcon />}
            />
          )}
        </>
      )}

      {supportsVideoGenerationControls && (
        <>
          {supportsSizeControl && (
            <ChatAction
              onClick={() => setShowSizeSelector(true)}
              text={`尺寸 ${currentSize}`}
              icon={<SizeIcon />}
            />
          )}
          {supportsSizeControl && (
            <ChatAction
              onClick={() => {
                const nextSize =
                  currentSize === "720x1280"
                    ? "1280x720"
                    : currentSize === "1280x720"
                    ? "720x1280"
                    : "720x1280";
                chatStore.updateTargetSession(session, (session) => {
                  session.mask.modelConfig.size = nextSize as any;
                });
                showTopNoticeCard(
                  nextSize === "720x1280" ? "已切换竖版" : "已切换横版",
                );
              }}
              text={
                currentSize.startsWith("720x") ||
                currentSize.startsWith("1024x")
                  ? "横竖版切换"
                  : "横竖版切换"
              }
              icon={<ReturnIcon />}
            />
          )}
          {supportsVideoDuration && (
            <ChatAction
              onClick={() => setShowDurationSelector(true)}
              text={`时长 ${currentSeconds}s`}
              icon={<PlayIcon />}
            />
          )}
        </>
      )}

      {/* 各种选择器（隐藏） */}
      {showSizeSelector && (
        <Selector
          centerContent={true}
          title="选择尺寸"
          defaultSelectedValue={currentSize}
          items={modelSizes.map((m) => ({
            title: m,
            value: m,
          }))}
          onClose={() => setShowSizeSelector(false)}
          onSelection={(s) => {
            if (s.length === 0) return;
            const size = s[0];
            chatStore.updateTargetSession(session, (session) => {
              session.mask.modelConfig.size = size;
            });
            showTopNoticeCard(size);
          }}
        />
      )}

      {showQualitySelector && (
        <Selector
          centerContent={true}
          title="选择画质"
          defaultSelectedValue={currentQuality}
          items={imageQualityOptions.map((m) => ({
            title: m,
            value: m,
          }))}
          onClose={() => setShowQualitySelector(false)}
          onSelection={(q) => {
            if (q.length === 0) return;
            const quality = q[0];
            chatStore.updateTargetSession(session, (session) => {
              session.mask.modelConfig.quality = quality;
            });
            showTopNoticeCard(quality);
          }}
        />
      )}

      {showStyleSelector && (
        <Selector
          centerContent={true}
          title="选择风格"
          defaultSelectedValue={currentStyle}
          items={imageStyleOptions.map((m) => ({
            title: m,
            value: m,
          }))}
          onClose={() => setShowStyleSelector(false)}
          onSelection={(s) => {
            if (s.length === 0) return;
            const style = s[0];
            chatStore.updateTargetSession(session, (session) => {
              session.mask.modelConfig.style = style;
            });
            showTopNoticeCard(style);
          }}
        />
      )}

      {showDurationSelector && (
        <Selector
          centerContent={true}
          title="选择视频时长"
          defaultSelectedValue={currentSeconds}
          items={videoDurationOptions.map((m) => ({
            title: `${m} 秒`,
            value: m,
          }))}
          onClose={() => setShowDurationSelector(false)}
          onSelection={(s) => {
            if (s.length === 0) return;
            const seconds = s[0];
            chatStore.updateTargetSession(session, (session) => {
              session.mask.modelConfig.seconds = seconds;
            });
            showTopNoticeCard(`${seconds} 秒`);
          }}
        />
      )}
    </div>
  );
}

export function EditMessageModal(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const navigate = useNavigate();
  const currentSessionSnapshot = useChatStore(
    (state) => state.sessions[state.currentSessionIndex],
  );
  const { session: loadedSession } = useCurrentSession();
  const session = loadedSession ?? currentSessionSnapshot;

  if (!session) {
    return null;
  }

  return (
    <div
      className="modal-mask"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <Modal
        title={Locale.Chat.EditMessage.Title}
        className="session-config-modal"
        onClose={props.onClose}
        hideMaxToggle
        actions={[
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={() => {
              props.onClose();
            }}
          />,
        ]}
      >
        <MaskConfig
          mask={session.mask}
          updateMask={(updater) => {
            const mask = { ...session.mask };
            updater(mask);
            chatStore.updateTargetSession(
              session,
              (session) => (session.mask = mask),
            );
          }}
          shouldSyncFromGlobal
          readonlyModel
          hideIdentitySettings
          extraListItems={
            session.mask.modelConfig.sendMemory ? (
              <ListItem
                className="copyable"
                title={`${Locale.Memory.Title} (${session.lastSummarizeIndex} of ${session.messages.length})`}
                subTitle={session.memoryPrompt || Locale.Memory.EmptyContent}
              ></ListItem>
            ) : (
              <></>
            )
          }
        ></MaskConfig>
      </Modal>
    </div>
  );
}

export function DeleteImageButton(props: { deleteImage: () => void }) {
  return (
    <div
      className={styles["delete-image"]}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.deleteImage();
      }}
    >
      <DeleteIcon />
    </div>
  );
}

function ChatImage(props: {
  url: string;
  className: string;
  onOpen: (url: string) => void;
}) {
  const { url, className, onOpen } = props;
  // 加载状态：loading 时显示占位符，加载完成或失败后移除占位层
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );

  // 缓存命中时图片可能在 React 绑定 onLoad 之前就已就绪，
  // 在 img 挂载瞬间检测 complete，命中则直接进入 loaded，避免占位符闪烁
  const handleImgRef = useCallback((node: HTMLImageElement | null) => {
    if (node && node.complete) {
      setStatus(node.naturalWidth > 0 ? "loaded" : "error");
    }
  }, []);

  return (
    <span
      className={clsx(styles["chat-message-item-image-wrapper"], className)}
      data-status={status}
    >
      {status === "loading" && (
        <span
          className={styles["chat-message-item-image-placeholder"]}
          aria-hidden="true"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={handleImgRef}
        className={styles["chat-message-item-image-inner"]}
        src={url}
        alt=""
        role="button"
        tabIndex={0}
        title="点击查看原图"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("error")}
        onClick={() => onOpen(url)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(url);
          }
        }}
      />
    </span>
  );
}

function renderGeneratedMedia(
  url: string,
  className: string,
  key?: string | number,
) {
  const isExpiredSignedImageUrl = (() => {
    try {
      const parsed = new URL(url);
      const expiresAt = parsed.searchParams.get("se");
      return expiresAt ? Date.parse(expiresAt) < Date.now() : false;
    } catch {
      return false;
    }
  })();

  if (isExpiredSignedImageUrl) {
    return (
      <div className={className} key={key}>
        媒体链接已过期
      </div>
    );
  }

  if (/^blob:/i.test(url) && !isRememberedRuntimeBlobUrl(url)) {
    return (
      <div className={className} key={key}>
        本地媒体缓存已失效
      </div>
    );
  }

  if (/^blob:/i.test(url)) {
    return (
      <video className={className} key={key} controls src={url}>
        <track kind="captions" />
      </video>
    );
  }

  return (
    <ChatImage
      key={key}
      url={url}
      className={className}
      onOpen={(target) => showImageModal(target, true)}
    />
  );
}

export function ShortcutKeyModal(props: { onClose: () => void }) {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const shortcuts = [
    {
      title: Locale.Chat.ShortcutKey.newChat,
      keys: isMac ? ["⌘", "Shift", "O"] : ["Ctrl", "Shift", "O"],
    },
    { title: Locale.Chat.ShortcutKey.focusInput, keys: ["Shift", "Esc"] },
    {
      title: Locale.Chat.ShortcutKey.copyLastCode,
      keys: isMac ? ["⌘", "Shift", ";"] : ["Ctrl", "Shift", ";"],
    },
    {
      title: Locale.Chat.ShortcutKey.copyLastMessage,
      keys: isMac ? ["⌘", "Shift", "C"] : ["Ctrl", "Shift", "C"],
    },
    {
      title: Locale.Chat.ShortcutKey.showShortcutKey,
      keys: isMac ? ["⌘", "/"] : ["Ctrl", "/"],
    },
    {
      title: Locale.Chat.ShortcutKey.clearContext,
      keys: isMac
        ? ["⌘", "Shift", "backspace"]
        : ["Ctrl", "Shift", "backspace"],
    },
  ];
  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Chat.ShortcutKey.Title}
        onClose={props.onClose}
        actions={[
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={() => {
              props.onClose();
            }}
          />,
        ]}
      >
        <div className={styles["shortcut-key-container"]}>
          <div className={styles["shortcut-key-grid"]}>
            {shortcuts.map((shortcut, index) => (
              <div key={index} className={styles["shortcut-key-item"]}>
                <div className={styles["shortcut-key-title"]}>
                  {shortcut.title}
                </div>
                <div className={styles["shortcut-key-keys"]}>
                  {shortcut.keys.map((key, i) => (
                    <div key={i} className={styles["shortcut-key"]}>
                      <span>{key}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}

function _Chat() {
  type RenderMessage = ChatMessage & { preview?: boolean };
  type AiTextSelection = {
    text: string;
    messageId: string;
  };
  type AiTextSelectionBubble = AiTextSelection & {
    top: number;
    left: number;
  };

  const location = useLocation();
  const suppressInitialModelToast = Boolean(
    (location.state as { suppressModelToast?: boolean } | null)
      ?.suppressModelToast,
  );
  const chatStore = useChatStore();
  const emptySessionRef = useRef(createEmptySession());
  const isFirstChatMountRef = useRef(!hasMountedChatInCurrentPage);
  const currentSessionSnapshot = useChatStore(
    (state) => state.sessions[state.currentSessionIndex],
  );
  const { session: loadedSession, loading: sessionLoading } =
    useCurrentSession();
  const session = loadedSession ?? currentSessionSnapshot;
  const liveSession = currentSessionSnapshot ?? session;
  const safeSession = session ?? emptySessionRef.current;

  useEffect(() => {
    hasMountedChatInCurrentPage = true;
  }, []);

  useEffect(() => {
    if (!safeSession?.id || typeof window === "undefined") {
      return;
    }

    const routePath =
      String(window.location.hash || "").replace(/^#/, "") ||
      window.location.pathname;
    const urlSessionId = routePath.startsWith(`${Path.Chat}/`)
      ? decodeURIComponent(routePath.slice(Path.Chat.length + 1))
      : "";
    if (urlSessionId && urlSessionId !== safeSession.id) {
      return;
    }

    try {
      window.sessionStorage.setItem(
        "nextchat_tab_current_session_id",
        safeSession.id,
      );
      window.sessionStorage.setItem("nextchat_tab_initialized", "1");
    } catch {}
  }, [safeSession?.id]);

  const config = useAppConfig();
  const fontSize = config.fontSize;
  const fontFamily = config.fontFamily;

  const [showExport, setShowExport] = useState(false);
  const [showBackupMenu, setShowBackupMenu] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showAddModelModal, setShowAddModelModal] = useState(false);
  const [addModelProfile, setAddModelProfile] = useState<{
    profiles: any[];
    currentProviderId: string;
  } | null>(null);

  const [modelSelectorDefaultValue, setModelSelectorDefaultValue] = useState<
    string | undefined
  >(undefined);
  const [modelSelectorDefaultGroup, setModelSelectorDefaultGroup] = useState<
    string | undefined
  >(() => {
    const storedGroup = String(
      localStorage.getItem(MODEL_SELECTOR_GROUP_STORAGE_KEY) || "",
    ).trim();
    return storedGroup || undefined;
  });
  const [modelSelectorProviderId, setModelSelectorProviderId] = useState("");
  const modelSelectorItemsCacheRef = useRef<Record<string, any[]>>({});
  const resetModelSelectorGroupToAll = useCallback(() => {
    setModelSelectorDefaultGroup("All");
    localStorage.setItem(MODEL_SELECTOR_GROUP_STORAGE_KEY, "All");
  }, []);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mobileInputRef = useRef<HTMLDivElement>(null);
  const mobileInputEndRef = useRef<HTMLSpanElement | null>(null);
  const mobileInputTouchYRef = useRef<number | null>(null);
  const mobileInputTouchTimeRef = useRef<number | null>(null);
  const mobileInputTouchVelocityRef = useRef(0);
  const mobileInputInertiaRafRef = useRef<number | null>(null);
  const mobileInputOutsidePointerBlurRef = useRef(false);
  const mobileInputSubmitBlurRef = useRef(false);
  const mobileSubmitTouchHandledRef = useRef(false);
  const inputScrollIndicatorHideTimerRef = useRef<number | null>(null);
  const syncInputScrollIndicatorRef = useRef<(visible?: boolean) => void>(
    () => {},
  );
  const mobileInputPreservedHeightRef = useRef("44px");
  const mobileInputMeasuredHeightRef = useRef(44);
  const preserveMobileInputBlurHeightRef = useRef(false);
  const collapseTimersRef = useRef<number[]>([]);
  const mobileBlurTimerRef = useRef<number | null>(null);
  const pendingMobileInputResetAfterSubmitRef = useRef(false);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const inputPanelRef = useRef<HTMLDivElement>(null);
  const inputPlaceholderRef = useRef<HTMLSpanElement>(null);
  const inputPanelRectRef = useRef<DOMRect | null>(null);
  const inputPanelWasEmptyRef = useRef(true);
  // 记录手指/鼠标按下时输入框是否已聚焦，用于决定点击后光标是否跳到末尾
  const inputFocusedBeforePointerRef = useRef(false);
  // 键盘打开时用于实测输入面板位置，计算填充高度
  const chatRootRef = useRef<HTMLDivElement>(null);
  const chatInputInnerRef = useRef<HTMLLabelElement>(null);
  const statusPanelRef = useRef<HTMLDivElement>(null);
  const statusPanelOverlapRafRef = useRef<number | null>(null);
  const mobileViewportRafRef = useRef<number | null>(null);
  const mobileViewportReleaseTimersRef = useRef<number[]>([]);
  const mobileMessageVisibilityTimersRef = useRef<number[]>([]);
  const mobileKeyboardOpenedSinceFocusRef = useRef(false);
  const mobileKeyboardDismissByViewportRef = useRef(false);
  const mobileExpandedViewportHeightRef = useRef(0);
  const mobileKeyboardReleaseWasActiveRef = useRef(false);
  const aiSelectionTouchTimerRef = useRef<number | null>(null);
  const aiSelectionActiveMessageIdRef = useRef("");
  const aiSelectionPendingRef = useRef<AiTextSelectionBubble | null>(null);
  const mobileKeyboardStableMetricsRef = useRef<{
    visualHeight: number;
    accessoryInset: number;
    overlapCorrection: number;
    fillHeight: number;
  } | null>(null);
  const syncReadyFocusSessionRef = useRef("");
  const [userInput, setUserInput] = useState("");
  const [aiSelectionBubble, setAiSelectionBubble] =
    useState<AiTextSelectionBubble | null>(null);
  const [aiSelectionContext, setAiSelectionContext] =
    useState<AiTextSelection | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editInputRows, setEditInputRows] = useState(1);
  const [editMobileMessageId, setEditMobileMessageId] = useState<string | null>(
    null,
  );
  const [isInputHintOverflow, setIsInputHintOverflow] = useState(false);
  const [isMobileInputFocused, setIsMobileInputFocused] = useState(false);
  const [isMobileKeyboardReleasing, setIsMobileKeyboardReleasing] =
    useState(false);
  const [preserveMobileInputBlurHeight, setPreserveMobileInputBlurHeight] =
    useState(false);
  const [statusPanelOverlapsMessages, setStatusPanelOverlapsMessages] =
    useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isModelConfigSyncConfirmed, setIsModelConfigSyncConfirmed] =
    useState(false);
  const criticalSyncReady = useSyncStore(
    (state: any) => state.criticalSyncReady,
  );
  const criticalSyncInProgress = useSyncStore(
    (state: any) => state.criticalSyncInProgress,
  );
  const syncProvider = useSyncStore((state) => state.provider);
  const isChatUnavailableForSync = false;
  const readOnly = useAuthStore((state) => state.readOnly);
  const { submitKey, shouldSubmit } = useSubmitHandler();
  const scrollRef = useRef<HTMLDivElement>(null);
  const initializedBottomSessionRef = useRef("");
  // 打开会话后用于"内容撑高补滚"的守护资源（Markdown 异步渲染：省略号 -> 真实文字 -> 高度变化）
  const initialBottomGuardRef = useRef<{
    observer: MutationObserver | null;
    timeout: number | null;
    raf: number | null;
  }>({ observer: null, timeout: null, raf: null });
  const forceScrollTimeoutsRef = useRef<number[]>([]);
  const forceScrollRafsRef = useRef<number[]>([]);
  const programmaticScrollToBottomUntilRef = useRef(0);
  const animatedScrollToBottomRafRef = useRef<number | null>(null);
  const animatedScrollToBottomRunRef = useRef(0);
  const [, setIsScrollToBottomAnimating] = useState(false);
  const isScrolledToBottom = scrollRef?.current
    ? Math.abs(
        scrollRef.current.scrollHeight -
          (scrollRef.current.scrollTop + scrollRef.current.clientHeight),
      ) <= 1
    : false;
  const isAttachWithTop = (() => {
    const lastMessage = scrollRef.current?.lastElementChild as HTMLElement;
    // if scrolllRef is not ready or no message, return false
    if (!scrollRef?.current || !lastMessage) return false;
    const topDistance =
      lastMessage!.getBoundingClientRect().top -
      scrollRef.current.getBoundingClientRect().top;
    // leave some space for user question
    return topDistance < 100;
  })();

  const isTyping = userInput !== "";
  const sessionMessages = useMemo(
    () => (Array.isArray(safeSession.messages) ? safeSession.messages : []),
    [safeSession.messages],
  );

  useEffect(() => {
    if (syncProvider !== ProviderType.Database) {
      setIsModelConfigSyncConfirmed(true);
      return;
    }

    setIsModelConfigSyncConfirmed(criticalSyncReady && !criticalSyncInProgress);
  }, [criticalSyncInProgress, criticalSyncReady, syncProvider]);

  useEffect(() => {
    if (syncProvider === ProviderType.Database && !criticalSyncReady) {
      return;
    }

    useChatStore.getState().refreshFreshDefaultSessionModel?.();
  }, [criticalSyncReady, syncProvider]);

  useEffect(() => {
    if (editingMessageId && editInputRef.current) {
      const textarea = editInputRef.current;
      textarea.focus();
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);
      const rows = autoGrowTextArea(textarea);
      setEditInputRows(rows);
    }
  }, [editingMessageId]);

  useEffect(() => {
    if (editingMessageId && editInputRef.current) {
      const rows = autoGrowTextArea(editInputRef.current);
      setEditInputRows(rows);
    }
  }, [editContent, editingMessageId]);

  const currentSessionSummaryMessageCount = useChatStore((state) => {
    const summary = state.sessionSummaries.find(
      (item) => item.id === safeSession.id,
    );
    return Number(summary?.messageCount || 0);
  });
  const currentSessionHasMessages =
    sessionMessages.length > 0 || currentSessionSummaryMessageCount > 0;
  const latestSessionId = useChatStore((state) => state.sessions[0]?.id || "");

  const sessionMask =
    liveSession?.mask ?? safeSession.mask ?? emptySessionRef.current.mask;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sessionMaskRef = useRef(sessionMask);
  sessionMaskRef.current = sessionMask;
  const sessionContext = useMemo(
    () => (Array.isArray(sessionMask?.context) ? sessionMask.context : []),
    [sessionMask?.context],
  );

  // 判断是否有助手消息正在流式输出
  const isAssistantStreaming = useMemo(
    () =>
      sessionMessages.some(
        (message) => message.role === "assistant" && message.streaming,
      ),
    [sessionMessages],
  );

  // if user is typing, should auto scroll to bottom
  // if user is not typing, should auto scroll to bottom only if already at bottom
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(false);
  const autoScrollEnabledRef = useRef(false);
  autoScrollEnabledRef.current = autoScrollEnabled;
  const followStreamingAfterScrollButtonRef = useRef(false);
  const { setAutoScroll, scrollDomToBottom, cancelScheduledScrollToBottom } =
    useScrollToBottom(scrollRef, false, sessionMessages, autoScrollEnabled);
  const [hitBottom, setHitBottom] = useState(true);
  const [chatBodyOverflowing, setChatBodyOverflowing] = useState(false);
  const [isFarFromBottom, setIsFarFromBottom] = useState(false);
  const hitBottomStateRef = useRef(true);
  const chatBodyOverflowingStateRef = useRef(false);
  const isFarFromBottomStateRef = useRef(false);
  hitBottomStateRef.current = hitBottom;
  chatBodyOverflowingStateRef.current = chatBodyOverflowing;
  isFarFromBottomStateRef.current = isFarFromBottom;
  const scrollMetricsRafRef = useRef<number | null>(null);
  const pendingScrollMetricsRef = useRef<{
    dom: HTMLElement;
    updateMessageWindow: boolean;
    programmatic: boolean;
  } | null>(null);
  const isMobileScreen = useMobileScreen();
  const isIOSMobile = useMemo(
    () => isMobileScreen && isIOS(),
    [isMobileScreen],
  );
  const { width: windowWidth } = useWindowSize();
  const [showStatusUserPanel, setShowStatusUserPanel] = useState(
    () => !isMobileScreen || !currentSessionHasMessages,
  );

  useEffect(() => {
    setShowStatusUserPanel(!isMobileScreen || !currentSessionHasMessages);
  }, [currentSessionHasMessages, isMobileScreen, safeSession.id]);

  useLayoutEffect(() => {
    const panel = inputPanelRef.current;
    if (!panel || typeof window === "undefined") return;

    const previousRect = inputPanelRectRef.current;
    const nextRect = panel.getBoundingClientRect();
    const shouldAnimateToBottom =
      !isMobileScreen &&
      inputPanelWasEmptyRef.current &&
      currentSessionHasMessages &&
      previousRect;

    inputPanelRectRef.current = nextRect;
    inputPanelWasEmptyRef.current = !currentSessionHasMessages;

    if (!shouldAnimateToBottom) return;

    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;

    panel.style.transition = "none";
    panel.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
    panel.style.willChange = "transform";

    const raf = window.requestAnimationFrame(() => {
      panel.style.transition = "transform 180ms cubic-bezier(0.2, 0, 0, 1)";
      panel.style.transform = "translate3d(0, 0, 0)";
    });

    const timer = window.setTimeout(() => {
      panel.style.transition = "";
      panel.style.transform = "";
      panel.style.willChange = "";
    }, 220);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      panel.style.transition = "";
      panel.style.transform = "";
      panel.style.willChange = "";
    };
  }, [currentSessionHasMessages, isMobileScreen]);

  const navigate = useNavigate();
  const backupMenuTimerRef = useRef<NodeJS.Timeout | null>(null);
  const handleBackupMenuEnter = useCallback(() => {
    if (backupMenuTimerRef.current) {
      clearTimeout(backupMenuTimerRef.current);
      backupMenuTimerRef.current = null;
    }
    setShowBackupMenu(true);
  }, []);
  const handleBackupMenuLeave = useCallback(() => {
    backupMenuTimerRef.current = setTimeout(() => {
      setShowBackupMenu(false);
    }, 200);
  }, []);
  useEffect(() => {
    return () => {
      if (backupMenuTimerRef.current) {
        clearTimeout(backupMenuTimerRef.current);
      }
    };
  }, []);
  const [attachImages, setAttachImages] = useState<ComposerAttachedImage[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<ChatMessageAttachedFile[]>(
    [],
  );
  const [uploadingAttachments, setUploadingAttachments] = useState<
    ComposerUploadingAttachment[]
  >([]);
  const lastAssistantSignatureRef = useRef("");
  const ignoredUploadingAttachmentIdsRef = useRef(new Set<string>());
  const uploadingAttachmentXhrRef = useRef(new Map<string, XMLHttpRequest>());
  const composerSnapshotRef = useRef({
    attachImages: 0,
    attachedFiles: 0,
    uploadingAttachments: 0,
    hasComposerAttachments: false,
    currentSessionHasMessages: false,
    isChatUnavailableForSync: false,
    safeSessionId: "",
  });
  const streamingScrollResumeTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const streamingAutoScrollPausedRef = useRef(false);
  const pendingCenterLatestUserMessageRef = useRef<{
    sessionId: string;
    requestAt: number;
  } | null>(null);
  const userScrollIntentRef = useRef(false);
  const userScrollIntentUntilRef = useRef(0);
  const userScrollWindowUpdateUntilRef = useRef(0);
  const lastChatBodyScrollTopRef = useRef(0);
  const chatBodyTouchStartYRef = useRef<number | null>(null);
  const chatBodyTouchMovedRef = useRef(false);
  const chatBodyTouchPausedFollowRef = useRef(false);
  const [centeredLatestUserMessageKey, setCenteredLatestUserMessageKey] =
    useState<string | null>(null);
  const [
    centeredLatestUserMessageSpacerHeight,
    setCenteredLatestUserMessageSpacerHeight,
  ] = useState(0);
  const inputFontSize = isMobileScreen
    ? Math.max(Number(config.fontSize) || 16, 16)
    : config.fontSize;
  const hasPendingUploads = uploadingAttachments.length > 0;
  const hasUploadedFiles = attachedFiles.length > 0;
  const uploadingImageCount = uploadingAttachments.filter(
    (attachment) => attachment.isImage,
  ).length;
  const uploadingFileCount = uploadingAttachments.length - uploadingImageCount;
  const hasComposerImageCards =
    attachImages.length > 0 || uploadingImageCount > 0;
  const hasComposerFileCards =
    attachedFiles.length > 0 || uploadingFileCount > 0;
  const hasMixedComposerAttachmentKinds =
    hasComposerImageCards && hasComposerFileCards;
  const hasImageOnlyComposerAttachments =
    hasComposerImageCards && !hasComposerFileCards;
  const hasComposerAttachments =
    attachImages.length > 0 || hasUploadedFiles || hasPendingUploads;
  const totalComposerAttachmentCount =
    attachImages.length + attachedFiles.length + uploadingAttachments.length;
  const uploading = hasPendingUploads;

  useEffect(() => {
    composerSnapshotRef.current = {
      attachImages: attachImages.length,
      attachedFiles: attachedFiles.length,
      uploadingAttachments: uploadingAttachments.length,
      hasComposerAttachments,
      currentSessionHasMessages,
      isChatUnavailableForSync,
      safeSessionId: safeSession.id,
    };
  }, [
    attachImages.length,
    attachedFiles.length,
    currentSessionHasMessages,
    hasComposerAttachments,
    isChatUnavailableForSync,
    safeSession.id,
    uploadingAttachments.length,
  ]);
  const isStaleStreamingMessage = useCallback(
    (message: ChatMessage) => {
      if (!message.streaming) return false;
      if (!message.id) return true;
      const messageTime = new Date(message.date).getTime();
      if (
        Number.isFinite(messageTime) &&
        Date.now() - messageTime < STREAMING_CONTROLLER_STARTUP_GRACE_MS
      ) {
        return false;
      }
      return !ChatControllerPool.has(session.id, message.id);
    },
    [session.id],
  );
  const isStaleAssistantLoadingBubble = useCallback(
    (message: ChatMessage) => {
      if (message.role !== "assistant") return false;
      const shouldShowLoadingBubble =
        Boolean((message as any).preview) || Boolean(message.streaming);
      if (!shouldShowLoadingBubble) return false;
      if (getMessageTextContent(message).length > 0) return false;
      const messageTime = new Date(message.date).getTime();
      if (
        Number.isFinite(messageTime) &&
        Date.now() - messageTime < STREAMING_CONTROLLER_STARTUP_GRACE_MS
      ) {
        return false;
      }
      if (!message.streaming) return true;
      if (!message.id) return true;
      return !ChatControllerPool.has(session.id, message.id);
    },
    [session.id],
  );
  const hasOnlyEmptyHistoryPlaceholders = useMemo(() => {
    if (sessionLoading || !currentSessionHasMessages) {
      return false;
    }
    if (sessionMessages.length === 0) {
      return false;
    }

    return sessionMessages.every((message) => {
      if ((message as any).preview || message.streaming) {
        return false;
      }
      if (getMessageTextContent(message).trim().length > 0) {
        return false;
      }
      if (getMessageImages(message).length > 0) {
        return false;
      }
      if (message.tools?.length) {
        return false;
      }
      return true;
    });
  }, [currentSessionHasMessages, sessionLoading, sessionMessages]);

  // current model name
  const currentRawModel = sessionMask?.modelConfig?.model || "";
  const currentModel = normalizeReservedDisplayModelName(
    sessionMask?.modelConfig?.model || "",
  );
  const isModelSelectionSyncing =
    syncProvider === ProviderType.Database && !isModelConfigSyncConfirmed;
  const currentProviderName =
    sessionMask?.modelConfig?.providerName || ServiceProvider.OpenAI;

  // 模型选择器所需变量
  const allModels = useAllModels();
  const messageModelLookup = useMemo(() => {
    const byProviderAndName = new Map<string, (typeof allModels)[number]>();
    const byName = new Map<string, (typeof allModels)[number]>();
    for (const model of allModels) {
      const normalizedName = String(model.name || "").toLowerCase();
      const normalizedProviderId = String(
        model.provider?.id || "",
      ).toLowerCase();
      if (!normalizedName) continue;
      if (normalizedProviderId) {
        byProviderAndName.set(
          `${normalizedProviderId}\u0000${normalizedName}`,
          model,
        );
      }
      if (!byName.has(normalizedName)) {
        byName.set(normalizedName, model);
      }
    }
    return { byProviderAndName, byName };
  }, [allModels]);
  const globalCustomModels = useAppConfig((state) => state.customModels);
  const apiProfiles = useAccessStore((state) => state.apiProfiles);
  const latestAssistantModelSelection = useMemo(() => {
    const latestAssistantMessage = [...sessionMessages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          !message.isError &&
          Boolean(message.model || message.modelDisplay),
      );

    return resolveMessageModelSelection(latestAssistantMessage, apiProfiles);
  }, [apiProfiles, sessionMessages]);
  const latestSuccessfulRetrySelection = useMemo(() => {
    const latestSuccessfulRetryMessage = [...sessionMessages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          !message.streaming &&
          !message.isError &&
          message.retryAttempts?.some(
            (attempt) => attempt.status === "success",
          ),
      );

    return resolveMessageModelSelection(
      latestSuccessfulRetryMessage,
      apiProfiles,
    );
  }, [apiProfiles, sessionMessages]);
  const modelCacheProfiles = useModelCacheStore((state) => state.profiles);
  const accessStore = useAccessStore() as any;
  const currentProviderId = useMemo(() => {
    return (
      resolveModelProviderId(
        allModels,
        sessionMask?.modelConfig,
        apiProfiles,
      ) || String(currentProviderName).toLowerCase()
    );
  }, [allModels, apiProfiles, currentProviderName, sessionMask?.modelConfig]);
  const currentProfile = useMemo(
    () =>
      apiProfiles.find((profile) => {
        return (
          getProfileProviderId(profile).toLowerCase() === currentProviderId
        );
      }),
    [apiProfiles, currentProviderId],
  );
  const activeSuccessfulRetrySelection =
    latestSuccessfulRetrySelection?.providerId === currentProviderId
      ? latestSuccessfulRetrySelection
      : null;
  const currentActiveProviderProfile = useMemo(
    () =>
      getActiveAccessProfile(
        apiProfiles,
        currentProviderName as ServiceProvider,
        currentProviderName === ServiceProvider.Local
          ? accessStore.localUrl
          : accessStore.customUrl,
        currentProviderName === ServiceProvider.Local
          ? accessStore.localApiKey
          : accessStore.customApiKey,
      ),
    [
      accessStore.customApiKey,
      accessStore.customUrl,
      accessStore.localApiKey,
      accessStore.localUrl,
      apiProfiles,
      currentProviderName,
    ],
  );
  const currentEnabledProfile = useMemo(
    () => apiProfiles.find((profile) => profile.enabled),
    [apiProfiles],
  );
  const shouldUseCurrentEnabledProfile =
    !currentProfile &&
    (isProfileScopedProviderId(currentProviderId) ||
      isLegacyGeneratedCustomProviderId(currentProviderId) ||
      isLegacyGeneratedCustomProviderId(currentProviderName));
  const currentProviderDisplayName =
    shouldUseCurrentEnabledProfile && currentEnabledProfile?.name
      ? currentEnabledProfile.name
      : currentProviderName === ServiceProvider.Custom ||
        currentProviderName === ServiceProvider.Local
      ? currentProfile?.name ||
        currentActiveProviderProfile?.name ||
        currentProviderName
      : currentProfile?.name || currentProviderName;
  const rawActiveModelSelectorProviderId = getActiveModelSelectorProviderId({
    showModelSelector,
    modelSelectorProviderId,
    currentProviderId,
  });
  const rawActiveModelSelectorProfile = apiProfiles.find(
    (profile) =>
      getProfileProviderId(profile).toLowerCase() ===
      rawActiveModelSelectorProviderId.toLowerCase(),
  );
  const activeModelSelectorProviderId =
    (isProfileScopedProviderId(rawActiveModelSelectorProviderId) ||
      isLegacyGeneratedCustomProviderId(rawActiveModelSelectorProviderId)) &&
    !rawActiveModelSelectorProfile &&
    currentEnabledProfile
      ? getProfileProviderId(currentEnabledProfile).toLowerCase()
      : rawActiveModelSelectorProviderId;
  const activeModelSelectorProfile = useMemo(
    () =>
      apiProfiles.find(
        (profile) =>
          getProfileProviderId(profile).toLowerCase() ===
          activeModelSelectorProviderId,
      ),
    [activeModelSelectorProviderId, apiProfiles],
  );
  const isActiveProfileModelSyncing = (() => {
    if (!activeModelSelectorProfile) return false;
    const cache = modelCacheProfiles?.[activeModelSelectorProfile.id];
    const syncStatus = String(cache?.syncStatus || "").toLowerCase();
    if (syncStatus === "first_sync" || syncStatus === "syncing") return true;
    if (syncStatus === "checking_remote") {
      const providerId = getProfileProviderId(
        activeModelSelectorProfile,
      ).toLowerCase();
      return !allModels.some(
        (model) =>
          model.available &&
          String(model?.provider?.id || "").toLowerCase() === providerId,
      );
    }
    return false;
  })();
  const activeModelSelectorProviderDisplayName =
    activeModelSelectorProfile?.name || currentProviderDisplayName;
  const successfulRetryBalanceProfile = useMemo(
    () =>
      activeSuccessfulRetrySelection
        ? apiProfiles.find(
            (profile) =>
              profile.id === activeSuccessfulRetrySelection.profileId ||
              getProfileProviderId(profile).toLowerCase() ===
                activeSuccessfulRetrySelection.providerId,
          )
        : undefined,
    [activeSuccessfulRetrySelection, apiProfiles],
  );
  const balanceProfileId =
    successfulRetryBalanceProfile?.id ||
    activeSuccessfulRetrySelection?.profileId ||
    currentProfile?.id ||
    String((sessionMask.modelConfig as any)?.profileId || "") ||
    String((currentActiveProviderProfile as any)?.id || "");
  const balanceProviderDisplayName =
    successfulRetryBalanceProfile?.name ||
    (activeSuccessfulRetrySelection
      ? String(activeSuccessfulRetrySelection.providerName)
      : activeModelSelectorProviderDisplayName);
  const balanceRefreshSignal = useMemo(() => {
    const latestCompletedAssistant = [...sessionMessages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          !message.streaming &&
          !message.isError &&
          Boolean(getMessageTextContent(message)),
      );
    if (!balanceProfileId || !isModelConfigSyncConfirmed) return "";
    const replySignal = latestCompletedAssistant
      ? `${latestCompletedAssistant.id}:${latestCompletedAssistant.date}`
      : "initial";
    const selectionUpdatedAt = Number(
      (safeSession.mask as any)?.modelSelectionUpdatedAt || 0,
    );
    const balanceProviderId =
      activeSuccessfulRetrySelection?.providerId || currentProviderId;
    return `${safeSession.id}:${balanceProviderId}:${balanceProfileId}:${selectionUpdatedAt}:${replySignal}`;
  }, [
    balanceProfileId,
    currentProviderId,
    isModelConfigSyncConfirmed,
    activeSuccessfulRetrySelection,
    safeSession.mask,
    safeSession.id,
    sessionMessages,
  ]);
  useEffect(() => {
    if (!currentSessionHasMessages || !latestAssistantModelSelection) {
      return;
    }
    if (readManualSessionModelSelection(session.id)) {
      return;
    }

    const currentModelConfig = sessionMask.modelConfig;
    const currentModelKey = [
      currentModelConfig.model,
      (currentModelConfig as any).providerId,
      currentModelConfig.providerName,
    ].join("|");
    const nextModelKey = [
      latestAssistantModelSelection.model,
      latestAssistantModelSelection.providerId,
      latestAssistantModelSelection.providerName,
    ].join("|");

    if (currentModelKey === nextModelKey) {
      return;
    }

    chatStore.updateTargetSession(session, (session) => {
      session.mask.modelConfig = sanitizeModelConfigForCapability({
        ...session.mask.modelConfig,
        model: latestAssistantModelSelection.model,
        providerName: latestAssistantModelSelection.providerName,
      });
      (session.mask.modelConfig as any).providerId =
        latestAssistantModelSelection.providerId;
      (session.mask.modelConfig as any).profileId =
        latestAssistantModelSelection.profileId;
      session.mask.syncGlobalConfig = true;
    });
  }, [
    chatStore,
    currentSessionHasMessages,
    latestAssistantModelSelection,
    session,
    session.id,
    sessionMask.modelConfig,
  ]);

  const globalCustomModelEntries = useMemo(
    () =>
      globalCustomModels
        .split(",")
        .map((v) => v.trim())
        .filter((v) => !!v),
    [globalCustomModels],
  );
  const globalCustomModelValueSet = useMemo(() => {
    return new Set(globalCustomModelEntries);
  }, [globalCustomModelEntries]);
  const globalCustomModelEntryMap = useMemo(() => {
    const map = new Map<string, string>();
    globalCustomModelEntries.forEach((entry) => {
      map.set(entry, entry);
    });
    return map;
  }, [globalCustomModelEntries]);
  const globalCustomModelKey = `${currentModel}@${currentProviderName}`;
  const isCustomModel = globalCustomModelValueSet.has(globalCustomModelKey);
  const getModelGroup = useCallback(
    (
      modelName: string,
      providerName?: string,
      vendorName?: string,
      displayName?: string,
    ) => {
      const normalizedModelName = modelName.toLowerCase();
      const normalizedDisplayName = String(displayName ?? "").toLowerCase();

      if (
        normalizedModelName.includes("aihubmix") ||
        normalizedDisplayName.includes("aihubmix")
      ) {
        return "AihubMix";
      }

      if (vendorName?.trim()) {
        return getModelDisplayGroup({
          modelName,
          providerName,
          vendorName,
          displayName,
        });
      }

      const fullName = `${modelName} ${providerName ?? ""}`.toLowerCase();

      const groupByKeywords = (
        label: string,
        keywords: string[],
        matcher?: (name: string) => boolean,
      ) => {
        if (keywords.some((keyword) => fullName.includes(keyword))) {
          return label;
        }
        if (matcher?.(modelName.toLowerCase())) {
          return label;
        }
        return null;
      };

      return (
        groupByKeywords(
          "OpenAI",
          ["gpt", "chatgpt", "openai", "codex"],
          (name) =>
            /^o[1345](?:$|[^a-z])/i.test(name) ||
            name.includes("o1-") ||
            name.includes("o3-") ||
            name.includes("o4-") ||
            name.includes("o5-"),
        ) ||
        groupByKeywords("Claude", ["claude", "anthropic"]) ||
        groupByKeywords("Gemini", ["gemini", "google"]) ||
        groupByKeywords("Minimax", ["minimax", "abab"]) ||
        groupByKeywords("Grok", ["grok", "xai", "x.ai"]) ||
        groupByKeywords("Meta", ["llama", "meta-llama", "meta "]) ||
        groupByKeywords("Mistral", ["mistral", "mixtral", "ministral"]) ||
        groupByKeywords("DeepSeek", ["deepseek", "deep-seek"]) ||
        groupByKeywords("Doubao", [
          "doubao",
          "seed",
          "bytedance",
          "volc",
          "字节",
        ]) ||
        groupByKeywords("Qwen", ["qwen", "alibaba", "tongyi", "阿里"]) ||
        groupByKeywords("Xiaomi", ["xiaomi", "mimo", "mi-mo"]) ||
        groupByKeywords("iFLYTEK Spark", [
          "iflytek",
          "xfyun",
          "spark",
          "讯飞",
        ]) ||
        groupByKeywords("01.AI", ["01-ai", "01.ai", "yi-", "lingyi", "万物"]) ||
        groupByKeywords("StepFun", ["stepfun", "step-", "阶跃"]) ||
        groupByKeywords("Tencent Hunyuan", ["hunyuan", "tencent", "腾讯"]) ||
        groupByKeywords("ERNIE", ["baidu", "ernie", "wenxin", "qianfan"]) ||
        groupByKeywords("Z.ai", ["z.ai", "z-ai", "zhipu", "chatglm", "glm-"]) ||
        groupByKeywords("Kimi", ["moonshot", "kimi"]) ||
        groupByKeywords("Cohere", ["cohere", "command-r"]) ||
        groupByKeywords("Perplexity", ["perplexity", "sonar"]) ||
        groupByKeywords("Stability", [
          "stable-diffusion",
          "stability",
          "sdxl",
          "sd3",
        ]) ||
        groupByKeywords("Nvidia", ["nvidia", "nemotron", "phi-"]) ||
        groupByKeywords("Baichuan", ["baichuan"]) ||
        groupByKeywords("Ideogram", ["ideogram"]) ||
        groupByKeywords("Jina AI", ["jina"]) ||
        groupByKeywords("Flux", ["flux-"]) ||
        groupByKeywords("Meituan", ["longcat", "meituan"]) ||
        groupByKeywords("InclusionAI", ["inclusion", "ling-", "ring-"]) ||
        groupByKeywords("BAAI", ["bge-", "baai"]) ||
        groupByKeywords("OpenRouter", ["openrouter"]) ||
        groupByKeywords("Microsoft", ["microsoft", "wizardlm"]) ||
        "Other"
      );
    },
    [],
  );
  const models = useMemo(() => {
    // 只显示用户手动添加的模型（customModels 中 + 前缀的条目）
    const customModels = String(config.customModels || "");
    const providerId = activeModelSelectorProviderId.toLowerCase();
    const providerName =
      activeModelSelectorProfile?.provider ||
      (currentProviderName as ServiceProvider);
    const seen = new Set<string>();

    return customModels
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("+"))
      .map((entry) => entry.slice(1).split("=")[0])
      .map((entry) => {
        const [modelName, entryProviderId] = getModelProvider(entry);
        return {
          modelName: modelName.trim(),
          providerId: String(entryProviderId || "")
            .trim()
            .toLowerCase(),
        };
      })
      .filter(({ modelName, providerId: entryProviderId }) => {
        if (!modelName || entryProviderId !== providerId) {
          return false;
        }
        const key = `${modelName.toLowerCase()}@${entryProviderId}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .map(({ modelName }, index) => {
        const runtimeModel = allModels.find(
          (model) =>
            model.name === modelName &&
            String(model?.provider?.id || "").toLowerCase() === providerId,
        );

        return {
          ...runtimeModel,
          name: modelName,
          displayName: runtimeModel?.displayName || modelName,
          available: true,
          sorted: runtimeModel?.sorted ?? index,
          provider: runtimeModel?.provider || {
            id: providerId,
            providerName,
            providerType:
              providerName === ServiceProvider.Local ? "openai" : "custom",
            sorted: 0,
          },
        };
      })
      .sort(compareModelsBySeriesVersion);
  }, [
    activeModelSelectorProfile?.provider,
    activeModelSelectorProviderId,
    allModels,
    config.customModels,
    currentProviderName,
  ]);
  const providerModelSelectorItems = useMemo(() => {
    const len = models.length;
    if (len === 0) return [];

    // 预分配数组以减少 GC 压力
    const result = new Array(len);
    let resultLen = 0;

    for (let i = 0; i < len; i++) {
      const model = models[i];
      if (!model) continue;

      // 使用 flatMap 一次性收集所有搜索关键词，避免多次 filter(Boolean)
      const caps = model.capabilities;
      const feats = model.features;
      const types = model.types;
      const categs = model.categories;

      const searchParts: string[] = [];
      if (caps?.length) searchParts.push(...caps);
      if (feats?.length) searchParts.push(...feats);
      if (types?.length) searchParts.push(...types);
      if (categs?.length) searchParts.push(...categs);

      const customKey = `${model.name}@${model?.provider?.providerName}`;
      const group = globalCustomModelValueSet.has(customKey)
        ? "Custom Models"
        : getModelGroup(
            model.name,
            model?.provider?.providerName,
            model?.vendor?.name,
            model.displayName,
          );

      result[resultLen++] = {
        title: model.displayName,
        searchText: [
          model.name,
          model.displayName,
          model.provider?.providerName,
          model.vendor?.name,
          ...searchParts,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
        sortKey: model.name,
        value: `${model.name}@${String(
          model?.provider?.id || "",
        ).toLowerCase()}`,
        disable: false,
        order: model.sorted,
        publishedAt: model.publishedAt,
        publishedAtSource: model.publishedAtSource,
        catalogRank: model.catalogRank,
        remoteRank: model.remoteRank,
        remoteRankSource: model.remoteRankSource,
        group,
        meta: {
          category: model.category,
          categorySource: model.categorySource,
          type: model.type,
          types: model.types,
          features: model.features,
          capabilities: model.capabilities,
          categories: model.categories,
          vendorName: model.vendor?.name,
        },
      };
    }

    // 裁剪到实际长度
    return resultLen < len ? result.slice(0, resultLen) : result;
  }, [globalCustomModelValueSet, getModelGroup, models]);

  const modelSelectorItems = providerModelSelectorItems;
  const isModelSelectorSyncing =
    isModelSelectionSyncing || isActiveProfileModelSyncing;
  const hasActiveProviderModels = models.length > 0;
  const currentModelName = useMemo(() => {
    if (isModelSelectorSyncing && !currentModel) {
      return "同步中...";
    }
    // 当前供应商没有可选模型时，不显示会话中遗留的模型名称。
    if (!currentModel || !hasActiveProviderModels) {
      return "";
    }
    return currentModel;
  }, [currentModel, hasActiveProviderModels, isModelSelectorSyncing]);
  const isPendingSessionModelSelection = useMemo(() => {
    if (!currentSessionHasMessages || !latestAssistantModelSelection) {
      return false;
    }
    if (readManualSessionModelSelection(session.id)) {
      return false;
    }

    const currentModelConfig = sessionMask.modelConfig;
    const currentModelKey = [
      currentModelConfig.model,
      (currentModelConfig as any).providerId,
      currentModelConfig.providerName,
    ].join("|");
    const nextModelKey = [
      latestAssistantModelSelection.model,
      latestAssistantModelSelection.providerId,
      latestAssistantModelSelection.providerName,
    ].join("|");

    return currentModelKey !== nextModelKey;
  }, [
    currentSessionHasMessages,
    latestAssistantModelSelection,
    session.id,
    sessionMask.modelConfig,
  ]);
  const shouldShowModelConfigLabel =
    isModelConfigSyncConfirmed &&
    !sessionLoading &&
    !isPendingSessionModelSelection;
  const modelSelectorButtonText = (
    <>
      <span className={styles["provider-button-name"]}>
        {activeModelSelectorProviderDisplayName}
      </span>{" "}
      {currentModelName &&
        (isModelSelectorSyncing ? (
          <span className={styles["provider-button-model-syncing"]}>
            {currentModelName}
          </span>
        ) : (
          <span className={styles["provider-button-model"]}>
            {currentModelName}
          </span>
        ))}
    </>
  );
  const modelSelectorButtonTitle = isModelSelectorSyncing
    ? currentModelName
    : currentModelName
    ? `${activeModelSelectorProviderDisplayName} ${currentModelName}`
    : activeModelSelectorProviderDisplayName;
  const currentDisplaySelectorValue = `${currentRawModel}@${
    activeModelSelectorProviderId || String(currentProviderName).toLowerCase()
  }`;
  // 供应商选择器相关
  const [isProviderSelectorOpen, setIsProviderSelectorOpen] = useState(false);
  const [modelSelectorResetKey, setModelSelectorResetKey] = useState(0);
  const showTopNotice = useCallback(
    (message: string) => {
      showTopNoticeCard(message, isMobileScreen ? 3500 : 2200);
    },
    [isMobileScreen],
  );
  const showCopyNotice = useCallback((ok: boolean) => {
    showTopNoticeCard(ok ? Locale.Copy.Success : Locale.Copy.Failed);
  }, []);
  const activeFilePreviewCloseRef = useRef<null | (() => void)>(null);
  const activeFilePreviewKeyRef = useRef("");
  useEffect(() => {
    return () => {
      activeFilePreviewCloseRef.current?.();
      activeFilePreviewCloseRef.current = null;
      activeFilePreviewKeyRef.current = "";
    };
  }, []);
  const openMessageAttachedFilePreview = useCallback(
    (file: ChatMessageAttachedFile) => {
      const previewUrl = String(
        file.localPreviewUrl || file.previewUrl || "",
      ).trim();
      if (!previewUrl) {
        showTopNotice("该文件暂时无法预览");
        return;
      }

      const previewKey = `${file.id}|${previewUrl}|${file.name}|${file.type}`;
      if (activeFilePreviewKeyRef.current === previewKey) {
        return;
      }

      activeFilePreviewCloseRef.current?.();
      activeFilePreviewCloseRef.current = null;
      activeFilePreviewKeyRef.current = previewKey;
      const previewFileKind = getPreviewFileKind(file);

      const closePreview = showModal({
        title: file.name || "文件预览",
        defaultMax: false,
        className: clsx(styles["file-preview-modal"], {
          [styles["file-preview-modal-office"]]:
            previewFileKind === "spreadsheet" ||
            (previewFileKind === "document" && isDocxPreviewFile(file)),
        }),
        onClose: () => {
          if (activeFilePreviewCloseRef.current === closePreview) {
            activeFilePreviewCloseRef.current = null;
            activeFilePreviewKeyRef.current = "";
          }
        },
        children: <FilePreviewContent file={{ ...file, previewUrl }} />,
      });
      activeFilePreviewCloseRef.current = closePreview;
    },
    [showTopNotice],
  );
  const [modelSelectorNotice, setModelSelectorNotice] = useState("");
  const lastProviderSwitchTimeRef = useRef(0);
  const modelSelectorOpenStartedAtRef = useRef(0);
  const modelSelectorNoticeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const modelSelectorRequiresSelectionRef = useRef(false);
  const mobileInitialModelToastKeyRef = useRef("");
  const suppressGlobalModelApplySessionRef = useRef("");
  const availableProviders = useMemo(() => {
    const providers = apiProfiles.reduce<
      Array<{ label: string; provider: string }>
    >((list, profile) => {
      const label = String(profile.name || profile.provider || "").trim();
      if (!label || list.some((item) => item.label === label)) {
        return list;
      }
      list.push({
        label,
        provider: String(profile.provider || label).trim(),
      });
      return list;
    }, []);

    return providers.sort((left, right) =>
      compareProviderDisplayNames(left.label, right.label),
    );
  }, [apiProfiles]);

  const collectProviderModelsForProfile = useCallback(
    (
      profile: {
        id?: string;
        name: string;
        provider: ServiceProvider;
        cachedModels?: string;
      },
      _reason?: string,
    ) => {
      const selectedProviderId = getProfileProviderId(profile).toLowerCase();
      const cachedProfileModels =
        useModelCacheStore.getState().profiles?.[profile.id || ""]
          ?.cachedModels ||
        profile.cachedModels ||
        "";
      const initialProviderModels = allModels.filter(
        (model) =>
          model.available &&
          String(model.provider?.id || "").toLowerCase() === selectedProviderId,
      );
      const latestCustomModels = useAppConfig.getState().customModels || "";
      const addedProviderModels = buildProviderModelsFromAddedCustomModels(
        latestCustomModels,
        selectedProviderId,
        profile.provider,
      );
      const cachedProviderModels = buildProviderModelsFromCachedNames(
        cachedProfileModels,
        selectedProviderId,
        profile.provider,
      );

      return {
        addedProviderModels,
        cachedProfileModels,
        cachedProviderModels,
        initialProviderModels,
        selectedProviderId,
      };
    },
    [allModels],
  );

  useEffect(() => {
    if (!showModelSelector) {
      setModelSelectorProviderId("");
      modelSelectorRequiresSelectionRef.current = false;
      modelSelectorItemsCacheRef.current = {};
      return;
    }
    setIsProviderSelectorOpen(false);
    setModelSelectorNotice("");
  }, [showModelSelector]);

  useEffect(() => {
    if (!showModelSelector || providerModelSelectorItems.length === 0) {
      return;
    }

    if (!activeModelSelectorProviderId) {
      return;
    }

    const previousItems =
      modelSelectorItemsCacheRef.current[activeModelSelectorProviderId] || [];
    if (areSelectorItemsEqual(previousItems, providerModelSelectorItems)) {
      return;
    }

    modelSelectorItemsCacheRef.current = {
      ...modelSelectorItemsCacheRef.current,
      [activeModelSelectorProviderId]: providerModelSelectorItems,
    };
  }, [
    activeModelSelectorProviderId,
    providerModelSelectorItems,
    showModelSelector,
  ]);

  useEffect(() => {
    if (!showModelSelector || modelSelectorItems.length === 0) {
      return;
    }

    if (
      modelSelectorNotice.includes("正在载入") ||
      modelSelectorNotice.includes("正在同步")
    ) {
      setModelSelectorNotice("");
    }
  }, [modelSelectorItems.length, modelSelectorNotice, showModelSelector]);

  useEffect(() => {
    return () => {
      if (modelSelectorNoticeTimerRef.current) {
        clearTimeout(modelSelectorNoticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const isChatRoute =
      location.pathname === Path.Chat ||
      location.pathname.startsWith(Path.Chat + "/");
    if (isChatRoute) return;
    hideTopNoticeCard();
    setModelSelectorNotice("");
    if (modelSelectorNoticeTimerRef.current) {
      clearTimeout(modelSelectorNoticeTimerRef.current);
      modelSelectorNoticeTimerRef.current = null;
    }
  }, [location.pathname]);

  const providerSwitchDisabled = useMemo(() => {
    return false;
  }, []);

  useEffect(() => {
    if (
      suppressInitialModelToast ||
      !isMobileScreen ||
      !shouldShowModelConfigLabel
    ) {
      return;
    }

    const sessionCreatedAt = Number(safeSession.createdAt || 0);
    const isRecentlyCreatedEmptySession =
      !currentSessionHasMessages &&
      sessionCreatedAt > 0 &&
      Date.now() - sessionCreatedAt < 10 * 1000;
    if (!isFirstChatMountRef.current && !isRecentlyCreatedEmptySession) {
      return;
    }

    const modelLabel = String(currentModelName || "").trim();
    const providerLabel = String(
      activeModelSelectorProviderDisplayName || "",
    ).trim();
    if (!modelLabel || !providerLabel) {
      return;
    }

    const toastKey = `${safeSession.id}|${providerLabel}|${modelLabel}`;
    if (mobileInitialModelToastKeyRef.current === toastKey) {
      return;
    }

    mobileInitialModelToastKeyRef.current = toastKey;
    showTopNotice(`当前模型：${providerLabel} ${modelLabel}`);
  }, [
    activeModelSelectorProviderDisplayName,
    currentModelName,
    currentSessionHasMessages,
    isMobileScreen,
    safeSession.createdAt,
    safeSession.id,
    shouldShowModelConfigLabel,
    showTopNotice,
    suppressInitialModelToast,
  ]);

  const isAiHubMixOrderingReady = useMemo(() => {
    const aiHubMixProfile = apiProfiles.find(
      (profile) => String(profile.id || "") === "default_aihubmix_profile",
    );
    if (!aiHubMixProfile) {
      return true;
    }

    const aiHubMixProviderId =
      getProfileProviderId(aiHubMixProfile).toLowerCase();
    const hasLoadedModels = allModels.some(
      (model) =>
        model.available &&
        String(model?.provider?.id || "").toLowerCase() === aiHubMixProviderId,
    );
    const cache = modelCacheProfiles?.[aiHubMixProfile.id];
    const syncStatus = String(cache?.syncStatus || "").toLowerCase();

    if (syncStatus === "first_sync" || syncStatus === "syncing") {
      return false;
    }

    if (syncStatus === "checking_remote" && !hasLoadedModels) {
      return false;
    }

    return true;
  }, [allModels, apiProfiles, modelCacheProfiles]);

  // prompt hints
  const promptStore = usePromptStore();
  const [promptHints, setPromptHints] = useState<RenderPrompt[]>([]);
  const [showPromptPicker, setShowPromptPicker] = useState(false);
  const [isPromptPickerLoading, setIsPromptPickerLoading] = useState(false);
  const [hasPromptPickerBootstrapped, setHasPromptPickerBootstrapped] =
    useState(false);
  const promptPickerLoadAbortRef = useRef<AbortController | null>(null);
  const pickerPrompts = useMemo(() => promptStore.search(""), [promptStore]);
  const onSearch = useDebouncedCallback(
    (text: string) => {
      const matchedPrompts = promptStore.search(text);
      setPromptHints(matchedPrompts);
    },
    100,
    { leading: true, trailing: true },
  );

  // auto grow input
  const [inputRows, setInputRows] = useState(2);
  const mobileInputHasText = userInput.trim().length > 0;
  const measure = useDebouncedCallback(
    () => {
      const textarea = inputRef.current;
      const mobileInput = mobileInputRef.current;
      if (isMobileScreen) {
        const inputEl = mobileInput ?? textarea;
        if (isMobileInputFocused && inputEl) {
          if (!mobileInputHasText) {
            setInputRows(1);
            if (inputEl === mobileInput) {
              syncMobileInputHeight("");
            } else {
              inputEl.style.height = "auto";
            }
            inputEl.scrollTop = 0;
            return;
          }
          // 聚焦时：由 CSS height: auto + max-height 控制，随内容自适应
          const rows = textarea
            ? autoGrowTextArea(textarea)
            : Math.ceil(syncMobileInputHeight() / 22);
          setInputRows(Math.min(8, Math.max(1, rows)));
          scheduleScrollMobileInputToBottom();
        } else {
          // 未聚焦时：保持默认紧凑高度，并显示最后一行
          setInputRows(1);
          if (inputEl) {
            collapseMobileInput();
          }
        }
        return;
      }
      const rows = textarea ? autoGrowTextArea(textarea) : 1;
      setInputRows(Math.min(20, Math.max(1, rows)));
      // 桌面端达到 max-height 后内部滚动，保持最后一行（光标处）可见
      if (textarea) {
        requestAnimationFrame(() => {
          if (document.activeElement === textarea) {
            textarea.scrollTop = textarea.scrollHeight;
          }
        });
      }
    },
    100,
    {
      leading: true,
      trailing: true,
    },
  );
  // 内容或聚焦状态变化时重新测量（聚焦展开 / 失焦收回）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(measure, [userInput, isMobileInputFocused]);

  // 挂载后二次测量：刷新页面恢复草稿时，首次测量可能早于布局宽度稳定 /
  // 字体加载完成，导致行数被低估而没有展开到适配的最大高度。
  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    const remeasure = () => {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => measure());
      });
    };
    remeasure();
    // 字体加载完成后再量一次，宽度计算才准确
    const fonts = (document as any).fonts;
    if (fonts?.ready) {
      fonts.ready.then(() => measure()).catch(() => {});
    }
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [measure]);

  // chat commands shortcuts
  const chatCommands = useChatCommand({
    new: () => navigate(Path.NewChat),
    newm: () => navigate(Path.NewChat),
    prev: () => chatStore.nextSession(-1),
    next: () => chatStore.nextSession(1),
    clear: () =>
      chatStore.updateTargetSession(
        session,
        (session) => (session.clearContextIndex = session.messages.length),
      ),
    fork: () => chatStore.forkSession(),
    del: () => chatStore.deleteCurrentSession(),
  });

  // only search prompts when user input is short
  const SEARCH_TEXT_LIMIT = 30;
  const onInput = useCallback(
    (text: string) => {
      setUserInput(text);
      const n = text.trim().length;

      // clear search results
      if (n === 0) {
        setPromptHints([]);
      } else if (text.match(ChatCommandPrefix)) {
        setPromptHints(chatCommands.search(text));
      } else if (!config.disablePromptHint && n < SEARCH_TEXT_LIMIT) {
        // check if need to trigger auto completion
        if (text.startsWith("/")) {
          let searchText = text.slice(1);
          onSearch(searchText);
        }
      }
    },
    [chatCommands, config.disablePromptHint, onSearch],
  );

  const buildAiSelectionPromptText = useCallback(
    (selection: AiTextSelection | null) => {
      const selectedText = selection?.text.trim();
      if (!selectedText) return "";

      return [
        "请只围绕下面这段 AI 回复内容回答：",
        "",
        `> ${selectedText.replace(/\n/g, "\n> ")}`,
      ].join("\n");
    },
    [],
  );

  // auto close prompt hints when clicking outside
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (promptHints.length === 0) return;
      // if click on input or prompt hints, do nothing
      const target = e.target as HTMLElement;
      const isClickOnInput = inputRef.current?.contains(target);
      if (isClickOnInput) return;

      const isClickOnPromptHints = target.closest(`.${styles["prompt-hints"]}`);
      if (isClickOnPromptHints) return;

      const isClickOnPromptAction = target.closest(
        '[data-chat-prompt-action="true"]',
      );
      if (isClickOnPromptAction) return;

      // check if click on any chat action (especially prompt action)
      const isClickOnAction = target.closest(
        `.${styles["chat-input-actions"]}`,
      );
      if (isClickOnAction) return;

      setPromptHints([]);
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [promptHints.length]);

  const blurMobileKeyboard = useCallback(() => {
    const runBlur = () => {
      inputRef.current?.blur();
      const mobileInput = mobileInputRef.current;
      if (mobileInput) {
        if (isIOSMobile) {
          mobileInput.setAttribute("contenteditable", "false");
        }
        mobileInput.blur();
      }
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && activeEl !== document.body) {
        activeEl.blur?.();
      }
      window.getSelection?.()?.removeAllRanges();
    };

    runBlur();
    window.requestAnimationFrame(runBlur);
    [40, 120, 260].forEach((delay) => {
      window.setTimeout(runBlur, delay);
    });
    if (isIOSMobile) {
      window.setTimeout(() => {
        mobileInputRef.current?.setAttribute("contenteditable", "true");
      }, 320);
    }
  }, [isIOSMobile]);

  const prepareMobileSubmitKeyboardDismiss = useCallback(() => {
    if (!isMobileScreen) return;
    mobileInputSubmitBlurRef.current = true;
    mobileInputOutsidePointerBlurRef.current = false;
    setIsMobileInputFocused(false);
    blurMobileKeyboard();
  }, [blurMobileKeyboard, isMobileScreen]);

  const doSubmit = (userInput: string) => {
    const hasAiSelectionContext = !!aiSelectionContext?.text.trim();
    if (
      userInput.trim() === "" &&
      !hasAiSelectionContext &&
      isEmpty(attachImages) &&
      attachedFiles.length === 0
    ) {
      return;
    }
    if (hasPendingUploads) return;

    if (isModelSelectorSyncing) {
      const allSessions = chatStore.sessions;
      const lastSession = [...allSessions]
        .filter((s) => s.id !== session.id && s.mask?.modelConfig?.model)
        .sort((a, b) => (b.lastUpdate || 0) - (a.lastUpdate || 0))[0];
      const lastModel = lastSession?.mask?.modelConfig?.model;
      if (lastModel) {
        chatStore.updateTargetSession(session, (s) => {
          s.mask.modelConfig.model = lastModel;
          s.mask.modelConfig.providerName =
            lastSession.mask.modelConfig.providerName;
        });
      } else {
        showTopNotice("模型同步中，请稍候...");
        return;
      }
    }

    const resetMobileComposerAfterSubmit = () => {
      if (!isMobileScreen) return;
      pendingMobileInputResetAfterSubmitRef.current = true;
      preserveMobileInputBlurHeightRef.current = false;
      setPreserveMobileInputBlurHeight(false);
      setInputRows(1);
      collapseTimersRef.current.forEach(clearTimeout);
      collapseTimersRef.current = [];
      resetMobileInputDom("");
      syncMobileInputHeight("");
      resetMobileInputBlurLayout();
      scheduleResetMobileInputViewportToStart();
      window.requestAnimationFrame(() => {
        resetMobileInputDom("");
        syncMobileInputHeight("");
        resetMobileInputBlurLayout();
      });
    };

    const clearSubmittedInputDraft = () => {
      localStorage.removeItem(unfinishedInputKey);
      localStorage.removeItem(ACTIVE_UNFINISHED_INPUT_KEY);
      pendingDraftRestoreRef.current = null;
    };

    const messageAttachedFiles = attachedFiles.map(
      stripLocalAttachmentPreviewUrl,
    );
    const messageAttachImages = attachImages
      .map((image) => String(image.previewUrl || "").trim())
      .filter(Boolean);
    const submittedInput = userInput.trim() || "请说明这段内容。";
    const aiSelectionPromptText =
      buildAiSelectionPromptText(aiSelectionContext);

    pendingCenterLatestUserMessageRef.current = {
      sessionId: safeSession.id,
      requestAt: Date.now(),
    };
    setCenteredLatestUserMessageKey(null);
    setCenteredLatestUserMessageSpacerHeight(0);

    // Handle mobile edit mode: resend edited message
    if (editMobileMessageId) {
      const message = sessionMessages.find((m) => m.id === editMobileMessageId);
      if (message) {
        setEditMobileMessageId(null);
        onResend(message, userInput, messageAttachImages, messageAttachedFiles);
        setUserInput("");
        setAiSelectionContext(null);
        clearSubmittedInputDraft();
        setAttachImages([]);
        setAttachedFiles([]);
        resetMobileComposerAfterSubmit();
        if (isMobileScreen) {
          setShowStatusUserPanel(false);
        }
        return;
      }
    }

    const matchCommand = hasAiSelectionContext
      ? { matched: false, invoke: () => {} }
      : chatCommands.match(userInput);
    if (matchCommand.matched) {
      setUserInput("");
      setAiSelectionContext(null);
      setPromptHints([]);
      resetMobileComposerAfterSubmit();
      matchCommand.invoke();
      if (isMobileScreen) {
        setIsMobileInputFocused(false);
        blurMobileKeyboard();
      }
      return;
    }
    const submitPromise = chatStore.onUserInput(
      submittedInput,
      messageAttachImages,
      undefined,
      {
        attachedFiles: messageAttachedFiles,
        attachedFilesPromptText:
          buildAttachedFilesPromptText(messageAttachedFiles),
        aiSelectionText: aiSelectionContext?.text || "",
        aiSelectionPromptText,
      },
    );
    setIsLoading(true);
    submitPromise.finally(() => {
      setIsLoading(false);
    });
    clearComposerAttachments({ preserveServerFiles: true });
    clearSubmittedInputDraft();
    localStorage.removeItem(unfinishedAttachImagesKey);
    localStorage.removeItem(ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY);
    chatStore.setLastInput(submittedInput);
    setUserInput("");
    setAiSelectionContext(null);
    setPromptHints([]);
    resetMobileComposerAfterSubmit();
    if (isMobileScreen) {
      setShowStatusUserPanel(false);
      if (!mobileInputSubmitBlurRef.current) {
        prepareMobileSubmitKeyboardDismiss();
      }
    } else {
      (isMobileScreen ? mobileInputRef.current : inputRef.current)?.focus();
    }
  };

  const onPromptSelect = (prompt: RenderPrompt) => {
    setPromptHints([]);
    setShowPromptPicker(false);
    setTimeout(() => {
      const matchedChatCommand = chatCommands.match(prompt.content);
      if (matchedChatCommand.matched) {
        // if user is selecting a chat command, just trigger it
        matchedChatCommand.invoke();
        setUserInput("");
      } else {
        // or fill the prompt
        setUserInput(sanitizeDraftInputText(prompt.content));
      }
      (isMobileScreen ? mobileInputRef.current : inputRef.current)?.focus();
    }, 30);
  };

  const loadPromptPickerFromDatabase = useCallback(async () => {
    promptPickerLoadAbortRef.current?.abort();
    const abortController = new AbortController();
    promptPickerLoadAbortRef.current = abortController;
    const bootstrap = bootstrapSharedPrompts({
      signal: abortController.signal,
    });
    const hasCachedPrompts =
      !bootstrap.isFirstLoad || hasPromptPickerBootstrapped;
    // 首次加载显示内联状态；之后直接复用本地快照，仅在后台静默更新。
    setIsPromptPickerLoading(!hasCachedPrompts);

    try {
      await bootstrap.revalidatePromise;
      if (!abortController.signal.aborted) {
        setHasPromptPickerBootstrapped(true);
      }
      // 工具栏选择器已有内联加载态，成功时不额外弹出顶部提示。
    } catch (error) {
      if (abortController.signal.aborted || isAbortLikeError(error)) return;
      console.error("[PromptPicker] 从数据库读取提示词失败:", error);
      if (!hasCachedPrompts) {
        showTopNotice("从数据库读取提示词失败，已保留本地数据");
      }
    } finally {
      if (promptPickerLoadAbortRef.current === abortController) {
        promptPickerLoadAbortRef.current = null;
      }
      if (!abortController.signal.aborted) {
        setIsPromptPickerLoading(false);
      }
    }
  }, [hasPromptPickerBootstrapped, showTopNotice]);

  useEffect(() => {
    return () => {
      promptPickerLoadAbortRef.current?.abort();
    };
  }, []);

  const togglePromptHints = useCallback(() => {
    setPromptHints([]);

    if (showPromptPicker) {
      promptPickerLoadAbortRef.current?.abort();
      promptPickerLoadAbortRef.current = null;
      setIsPromptPickerLoading(false);
      setShowPromptPicker(false);
      return;
    }

    // 刷新后先同步恢复持久化快照，弹层立即展示；远端更新在后台进行。
    promptStore.restorePromptCache();
    setShowPromptPicker(true);
    void loadPromptPickerFromDatabase();
  }, [loadPromptPickerFromDatabase, promptStore, showPromptPicker]);

  const openPromptManager = useCallback(() => {
    setPromptHints([]);
    setShowPromptPicker(false);
    navigate(Path.PromptManager);
  }, [navigate]);

  // stop response
  const onUserStop = (messageId: string) => {
    chatStore.updateTargetSession(session, (session) => {
      const targetMessage = session.messages.find(
        (message, index) => String(message.id ?? index) === messageId,
      );
      if (targetMessage && targetMessage.role === "assistant") {
        targetMessage.manualStopped = true;
        // 同步落定停止状态：若停止后立即刷新，持久化的消息也不会残留
        // streaming=true 而被误判为"刷新中断"，从而保留手动停止标识
        targetMessage.streaming = false;
      }
    });
    const stopped = ChatControllerPool.stop(session.id, messageId);
    if (!stopped) {
      ChatControllerPool.stopSession(session.id);
    }
  };

  const onStopAll = () => {
    chatStore.updateTargetSession(session, (session) => {
      for (const m of session.messages) {
        if (m.role === "assistant" && (m.streaming || m.retrying)) {
          m.manualStopped = true;
          m.streaming = false;
          m.content = "";
        }
      }
    });
    ChatControllerPool.stopSession(session.id);
  };

  // Effect A：消息标准化（修复残留 streaming 和空响应）
  useEffect(() => {
    const stopTiming = Date.now() - REQUEST_TIMEOUT_MS;
    const shouldNormalizeMessages = sessionMessages.some((m) => {
      if (m.streaming) {
        return isStaleStreamingMessage(m);
      }
      if (isStaleAssistantLoadingBubble(m)) {
        return true;
      }

      if (!(m.isError || new Date(m.date).getTime() < stopTiming)) {
        return false;
      }

      // 已标记手动停止/刷新中断的空消息无需再标准化（保持幂等）
      return (
        !m.manualStopped && !m.refreshInterrupted && m.content.length === 0
      );
    });

    if (!shouldNormalizeMessages) {
      return;
    }

    const latestSession =
      useChatStore.getState().sessions.find((item) => item.id === session.id) ??
      session;
    let hasNormalizedMessages = false;
    const normalizedMessages = latestSession.messages.reduce<
      typeof latestSession.messages
    >((messages, m) => {
      const hasActiveController =
        Boolean(m.streaming) &&
        Boolean(m.id) &&
        ChatControllerPool.has(latestSession.id, m.id);
      const shouldInterruptStaleStreaming =
        Boolean(m.streaming) && (!m.id || !hasActiveController);

      // 空内容僵尸气泡：preview 占位（未发起请求）才删除；
      // 已发起请求的 streaming 残留要保留并标记为"刷新中断"（即使一字未收）
      if (isStaleAssistantLoadingBubble(m) && !shouldInterruptStaleStreaming) {
        hasNormalizedMessages = true;
        return messages;
      }

      let nextMessage = m;
      const updateMessage = () => {
        if (nextMessage === m) {
          nextMessage = { ...m };
        }
        hasNormalizedMessages = true;
        return nextMessage;
      };

      const shouldNormalizeEmptyResponse =
        !m.manualStopped &&
        !m.refreshInterrupted &&
        !shouldInterruptStaleStreaming &&
        (m.isError || new Date(m.date).getTime() < stopTiming) &&
        m.content.length === 0;

      if (shouldInterruptStaleStreaming) {
        const message = updateMessage();
        // 标记为"刷新中断"，保留已收到的部分正文（可能为空）；
        // 已手动停止的消息不覆盖其语义，仅落定 streaming 状态
        message.streaming = false;
        if (!message.manualStopped) {
          message.refreshInterrupted = true;
        }
      }

      if (shouldNormalizeEmptyResponse) {
        const message = updateMessage();
        message.streaming = false;
        message.isError = true;
        message.content = prettyObject({
          error: true,
          message: "empty response",
        });
      }

      messages.push(nextMessage);
      return messages;
    }, []);

    if (!hasNormalizedMessages) {
      return;
    }

    chatStore.updateTargetSession(latestSession, (session) => {
      session.messages = normalizedMessages;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    chatStore,
    isStaleAssistantLoadingBubble,
    isStaleStreamingMessage,
    session,
    sessionMessages,
  ]);

  // Effect B：模型配置同步（全局配置下发到会话 mask）
  useEffect(() => {
    const session = sessionRef.current;
    const sessionMask = sessionMaskRef.current;
    let nextModelConfig = sessionMask.modelConfig;
    let shouldSyncMaskConfig = false;
    const manualSessionModelSelection = readManualSessionModelSelection(
      session.id,
    );
    const preferredRuntimeModelConfig =
      sessionMask.syncGlobalConfig &&
      !manualSessionModelSelection &&
      !currentSessionHasMessages
        ? getPreferredRuntimeModelConfig(
            allModels,
            sessionMask.modelConfig,
            apiProfiles,
          )
        : undefined;

    const shouldApplySyncedGlobalModelSelection =
      !sessionMask.syncGlobalConfig &&
      !manualSessionModelSelection &&
      !currentSessionHasMessages &&
      Number((config as any).modelSelectionUpdatedAt || 0) > 0 &&
      !areModelConfigValuesEqual(
        sessionMask.modelConfig as Record<string, unknown>,
        config.modelConfig as Record<string, unknown>,
      );

    // 仅在空白会话时把全局模型配置下发到当前会话。
    // 一旦已经开始对话，继续自动回写会把会话模型在发送后覆盖成全局值。
    if (
      manualSessionModelSelection &&
      !areModelConfigValuesEqual(
        sessionMask.modelConfig as Record<string, unknown>,
        {
          ...sessionMask.modelConfig,
          ...manualSessionModelSelection,
        } as Record<string, unknown>,
      )
    ) {
      nextModelConfig = sanitizeModelConfigForCapability({
        ...sessionMask.modelConfig,
        ...(manualSessionModelSelection as Partial<
          typeof sessionMask.modelConfig
        >),
      });
      shouldSyncMaskConfig = true;
    } else if (
      !manualSessionModelSelection &&
      sessionMask.syncGlobalConfig &&
      !currentSessionHasMessages
    ) {
      nextModelConfig = { ...config.modelConfig };
      if (!currentSessionHasMessages) {
        const preferredRuntimeModelConfig = getPreferredRuntimeModelConfig(
          allModels,
          nextModelConfig,
          apiProfiles,
        );
        if (preferredRuntimeModelConfig) {
          nextModelConfig = sanitizeModelConfigForCapability({
            ...nextModelConfig,
            ...preferredRuntimeModelConfig,
          });
        }
      }

      shouldSyncMaskConfig = !areModelConfigValuesEqual(
        sessionMask.modelConfig as Record<string, unknown>,
        nextModelConfig as Record<string, unknown>,
      );
    } else if (shouldApplySyncedGlobalModelSelection) {
      if (suppressGlobalModelApplySessionRef.current === session.id) {
        return;
      }
      nextModelConfig = sanitizeModelConfigForCapability({
        ...sessionMask.modelConfig,
        ...config.modelConfig,
      });
      shouldSyncMaskConfig = true;
    }

    if (
      !shouldSyncMaskConfig &&
      preferredRuntimeModelConfig &&
      !areModelConfigValuesEqual(
        sessionMask.modelConfig as Record<string, unknown>,
        {
          ...sessionMask.modelConfig,
          ...preferredRuntimeModelConfig,
        } as Record<string, unknown>,
      )
    ) {
      nextModelConfig = sanitizeModelConfigForCapability({
        ...sessionMask.modelConfig,
        ...preferredRuntimeModelConfig,
      });
      shouldSyncMaskConfig = true;
    }

    if (!shouldSyncMaskConfig) {
      return;
    }

    const shouldSyncResolvedGlobalConfig =
      shouldSyncMaskConfig &&
      sessionMask.syncGlobalConfig &&
      !manualSessionModelSelection &&
      !currentSessionHasMessages &&
      !areModelConfigValuesEqual(
        config.modelConfig as Record<string, unknown>,
        nextModelConfig as Record<string, unknown>,
      );

    if (shouldSyncResolvedGlobalConfig) {
      config.update((config) => {
        config.modelConfig = nextModelConfig;
      });
    }

    chatStore.updateTargetSession(session, (session) => {
      if (shouldSyncMaskConfig) {
        session.mask.modelConfig = nextModelConfig;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.modelConfig, allModels, apiProfiles, currentSessionHasMessages]);

  // check if should send message
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // disable submit while AI is generating or message is being sent
    if (isLoading || isAssistantStreaming) {
      if (shouldSubmit(e)) e.preventDefault();
      return;
    }
    // if ArrowUp and no userInput, fill with last input
    if (
      e.key === "ArrowUp" &&
      userInput.length <= 0 &&
      !(e.metaKey || e.altKey || e.ctrlKey)
    ) {
      setUserInput(chatStore.lastInput ?? "");
      e.preventDefault();
      return;
    }
    if (shouldSubmit(e) && promptHints.length === 0) {
      if (hasPendingUploads) {
        e.preventDefault();
        return;
      }
      doSubmit(userInput);
      e.preventDefault();
    }
  };

  const onMobileInputKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // disable submit while AI is generating or message is being sent
    if (isLoading || isAssistantStreaming) {
      if (shouldSubmit(e)) e.preventDefault();
      return;
    }
    if (
      e.key === "ArrowUp" &&
      userInput.length <= 0 &&
      !(e.metaKey || e.altKey || e.ctrlKey)
    ) {
      onInput(chatStore.lastInput ?? "");
      e.preventDefault();
      return;
    }
    if (shouldSubmit(e) && promptHints.length === 0) {
      if (hasPendingUploads) {
        e.preventDefault();
        return;
      }
      doSubmit(userInput);
      e.preventDefault();
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      const cleanupEmptyInput = () => {
        const mobileInput = mobileInputRef.current;
        if (!mobileInput) return;
        const nextText = (mobileInput.textContent ?? "").replace(/\u200b/g, "");
        if (nextText.trim().length > 0) {
          syncMobileInputHeight(nextText);
          return;
        }
        resetMobileInputDom("");
        onInput("");
        syncMobileInputHeight("");
        scheduleResetMobileInputViewportToStart();
      };

      requestAnimationFrame(cleanupEmptyInput);
      setTimeout(cleanupEmptyInput, 0);
    }
  };
  const onRightClick = (e: any, message: ChatMessage) => {
    // copy to clipboard
    const copyText = buildMessageCopyText(message);
    if (selectOrCopy(e.currentTarget, copyText)) {
      if (userInput.length === 0) {
        setUserInput(getMessageTextContent(message));
      }

      e.preventDefault();
    }
  };

  const onResend = (
    message: ChatMessage,
    editedContent?: string,
    editedImages?: string[],
    editedFiles?: ChatMessageAttachedFile[],
  ) => {
    // when it is resending a message
    // 1. for a user's message, find the next bot response
    // 2. for a bot's message, find the last user's input
    // 3. delete original bot response only
    // 4. resend by reusing the existing user input

    const resendingIndex = sessionMessages.findIndex(
      (m) => m.id === message.id,
    );

    if (resendingIndex < 0 || resendingIndex >= sessionMessages.length) {
      console.error("[Chat] failed to find resending message", message);
      return;
    }

    let userMessage: ChatMessage | undefined;
    let botMessage: ChatMessage | undefined;

    if (message.role === "assistant") {
      // if it is resending a bot's message, find the user input for it
      botMessage = message;
      for (let i = resendingIndex; i >= 0; i -= 1) {
        if (sessionMessages[i].role === "user") {
          userMessage = sessionMessages[i];
          break;
        }
      }
    } else if (message.role === "user") {
      // if it is resending a user's input, find the bot's response
      userMessage = message;
      for (let i = resendingIndex; i < sessionMessages.length; i += 1) {
        if (sessionMessages[i].role === "assistant") {
          botMessage = sessionMessages[i];
          break;
        }
      }
    }

    if (userMessage === undefined) {
      console.error("[Chat] failed to resend", message);
      return;
    }

    setIsEditingMessage(false);
    setUserInput("");
    setPromptHints([]);
    clearComposerAttachments();
    setIsMobileInputFocused(false);
    localStorage.removeItem(unfinishedInputKey);
    localStorage.removeItem(ACTIVE_UNFINISHED_INPUT_KEY);
    localStorage.removeItem(unfinishedAttachImagesKey);
    localStorage.removeItem(ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY);
    (isMobileScreen ? mobileInputRef.current : inputRef.current)?.blur();

    const botMessageIndex = botMessage?.id
      ? sessionMessages.findIndex((m) => m.id === botMessage!.id)
      : -1;
    const isLatestMessage =
      botMessageIndex >= 0
        ? botMessageIndex === sessionMessages.length - 1
        : resendingIndex === sessionMessages.length - 1;

    // 只有最后一组消息才原地重试；历史消息重试时保留原消息，并在底部追加新的请求和回复。
    if (isLatestMessage && botMessage?.id) {
      chatStore.updateTargetSession(
        session,
        (session) =>
          (session.messages = session.messages.filter(
            (m) => m.id !== botMessage!.id,
          )),
      );
    }

    // resend the message
    setIsLoading(true);
    const textContent = editedContent ?? getMessageTextContent(userMessage);
    const images = editedImages ?? getMessageImages(userMessage);
    const files = (editedFiles ?? userMessage.attachedFiles ?? []).map(
      stripLocalAttachmentPreviewUrl,
    );
    chatStore
      .onUserInput(textContent, images, undefined, {
        ...(isLatestMessage ? { reuseUserMessageId: userMessage.id } : {}),
        attachedFiles: files,
        attachedFilesPromptText: buildAttachedFilesPromptText(files),
      })
      .then(() => setIsLoading(false));
  };

  const onEditSave = (message: ChatMessage) => {
    const content = editContent.trim();
    if (!content) return;
    setEditingMessageId(null);
    setEditContent("");
    setPromptHints([]);
    onResend(message, content);
  };

  const onEditCancel = () => {
    setEditingMessageId(null);
    setEditContent("");
  };

  const [speechStatus, setSpeechStatus] = useState(false);
  const [speechLoading, setSpeechLoading] = useState(false);
  async function openaiSpeech(text: string) {
    if (speechStatus) {
      ttsPlayer.stop();
      setSpeechStatus(false);
    } else {
      var api: ClientApi;
      api = new ClientApi(ModelProvider.GPT);
      const config = useAppConfig.getState();
      setSpeechLoading(true);
      ttsPlayer.init();
      let audioBuffer: ArrayBuffer;
      const { markdownToTxt } = require("markdown-to-txt");
      const textContent = markdownToTxt(text);
      if (config.ttsConfig.engine !== DEFAULT_TTS_ENGINE) {
        const edgeVoiceName = accessStore.edgeVoiceName();
        const tts = new MsEdgeTTS();
        await tts.setMetadata(
          edgeVoiceName,
          OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3,
        );
        audioBuffer = await tts.toArrayBuffer(textContent);
      } else {
        audioBuffer = await api.llm.speech({
          model: config.ttsConfig.model,
          input: textContent,
          voice: config.ttsConfig.voice,
          speed: config.ttsConfig.speed,
        });
      }
      setSpeechStatus(true);
      ttsPlayer
        .play(audioBuffer, () => {
          setSpeechStatus(false);
        })
        .catch((e) => {
          console.error("[OpenAI Speech]", e);
          showToast(prettyObject(e));
          setSpeechStatus(false);
        })
        .finally(() => setSpeechLoading(false));
    }
  }

  const context: RenderMessage[] = useMemo(() => {
    const baseContext = sessionMask?.hideContext ? [] : sessionContext.slice();

    // 未授权时仍显示错误提示；默认欢迎语改为输入框上方标题展示。
    if (baseContext.length === 0 && !accessStore.isAuthorized()) {
      const copiedHello = Object.assign({}, BOT_HELLO);
      copiedHello.content = Locale.Error.Unauthorized;
      baseContext.push(copiedHello);
    }

    // 如果第一条消息是错误提示，但现在已授权，替换为正常的欢迎语
    if (
      baseContext.length > 0 &&
      baseContext[0].content === Locale.Error.Unauthorized &&
      accessStore.isAuthorized()
    ) {
      baseContext[0] = { ...baseContext[0], content: getBotHelloContent() };
    }

    return baseContext;
  }, [sessionContext, sessionMask?.hideContext, accessStore]);

  // preview messages
  const renderMessages = useMemo(() => {
    return context.concat(sessionMessages as RenderMessage[]);
  }, [context, sessionMessages]);
  const renderMessagesLengthRef = useRef(renderMessages.length);
  renderMessagesLengthRef.current = renderMessages.length;

  const [msgRenderIndex, _setMsgRenderIndex] = useState(
    Math.max(0, renderMessages.length - CHAT_PAGE_SIZE),
  );

  const setMsgRenderIndex = useCallback(
    (newIndex: number) => {
      newIndex = Math.min(renderMessages.length - CHAT_PAGE_SIZE, newIndex);
      newIndex = Math.max(0, newIndex);
      _setMsgRenderIndex(newIndex);
    },
    [renderMessages.length],
  );

  const messages = useMemo(() => {
    const endRenderIndex = Math.min(
      msgRenderIndex + 3 * CHAT_PAGE_SIZE,
      renderMessages.length,
    );
    return renderMessages.slice(msgRenderIndex, endRenderIndex);
  }, [msgRenderIndex, renderMessages]);

  const getMessageDomKey = useCallback(
    (message: ChatMessage, index: number) =>
      String(message.id ?? `${message.role}-${message.date}-${index}`),
    [],
  );

  const clearCenteredLatestUserMessage = useCallback(() => {
    pendingCenterLatestUserMessageRef.current = null;
    setCenteredLatestUserMessageKey(null);
    setCenteredLatestUserMessageSpacerHeight(0);
  }, []);

  const getMessageCenterMetrics = useCallback(
    (messageKey: string) => {
      const dom = scrollRef.current;
      if (!dom || !messageKey) return null;
      const latestUserMessageAboveCenterOffset = 64;

      const escapedMessageKey =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(messageKey)
          : messageKey.replace(/["\\]/g, "\\$&");
      const targetMessage = dom.querySelector<HTMLElement>(
        `[data-chat-message-dom-key="${escapedMessageKey}"]`,
      );
      if (!targetMessage) return null;

      const containerRect = dom.getBoundingClientRect();
      const targetRect = targetMessage.getBoundingClientRect();
      const relativeTop = dom.scrollTop + (targetRect.top - containerRect.top);
      // ChatGPT 官方移动 Web 在新回合开始时将用户消息一次性
      // 定位到视口顶部附近，流式生成期间不再持续追踪底部。
      const rawTargetTop = isMobileScreen
        ? relativeTop - 14
        : relativeTop -
          (dom.clientHeight - targetRect.height) / 2 +
          latestUserMessageAboveCenterOffset;
      const maxScrollTopWithoutSpacer = Math.max(
        0,
        dom.scrollHeight -
          centeredLatestUserMessageSpacerHeight -
          dom.clientHeight,
      );
      const requiredBottomSpacer = Math.max(
        0,
        rawTargetTop - maxScrollTopWithoutSpacer,
      );

      return {
        dom,
        targetTop: Math.max(0, rawTargetTop),
        requiredBottomSpacer,
      };
    },
    [centeredLatestUserMessageSpacerHeight, isMobileScreen, scrollRef],
  );

  const firstActionableMessageIndex = useMemo(() => {
    return messages.findIndex((message, i) => {
      const isContext = i < context.length;
      const messageTextContent = getMessageTextContent(message);
      const messageImages = getMessageImages(message);
      const isEmptyUserMessage =
        message.role === "user" &&
        messageTextContent.length === 0 &&
        messageImages.length === 0;

      return !message.preview && !isContext && !isEmptyUserMessage;
    });
  }, [messages, context.length]);

  useLayoutEffect(() => {
    _setMsgRenderIndex(
      Math.max(0, renderMessagesLengthRef.current - CHAT_PAGE_SIZE),
    );
    setAutoScrollEnabled(true);
    setAutoScroll(true);
    setHitBottom(true);
    followStreamingAfterScrollButtonRef.current = true;
    initializedBottomSessionRef.current = "";
  }, [safeSession.id, setAutoScroll]);

  const updateStatusPanelOverlap = useCallback(() => {
    if (typeof window === "undefined") return;

    if (statusPanelOverlapRafRef.current !== null) {
      window.cancelAnimationFrame(statusPanelOverlapRafRef.current);
    }

    statusPanelOverlapRafRef.current = window.requestAnimationFrame(() => {
      statusPanelOverlapRafRef.current = null;

      const panel = statusPanelRef.current;
      const chatBody = scrollRef.current;

      if (!panel || !chatBody || !showStatusUserPanel) {
        setStatusPanelOverlapsMessages(false);
        return;
      }

      const panelRect = panel.getBoundingClientRect();
      const messageParts = chatBody.querySelectorAll(
        `.${styles["chat-message-content"]}, .${styles["chat-message-item"]}`,
      );
      const overlaps = Array.from(messageParts).some((messagePart) => {
        const messageRect = messagePart.getBoundingClientRect();
        if (
          messageRect.bottom < 0 ||
          messageRect.top > window.innerHeight ||
          messageRect.right < 0 ||
          messageRect.left > window.innerWidth
        ) {
          return false;
        }

        const overlapWidth =
          Math.min(panelRect.right, messageRect.right) -
          Math.max(panelRect.left, messageRect.left);
        const overlapHeight =
          Math.min(panelRect.bottom, messageRect.bottom) -
          Math.max(panelRect.top, messageRect.top);

        return isMobileScreen
          ? overlapWidth > 2 && overlapHeight > 2
          : overlapWidth > 8 && overlapHeight > 16;
      });

      setStatusPanelOverlapsMessages(overlaps);
    });
  }, [isMobileScreen, showStatusUserPanel]);

  useEffect(() => {
    updateStatusPanelOverlap();
    window.addEventListener("resize", updateStatusPanelOverlap);

    return () => {
      window.removeEventListener("resize", updateStatusPanelOverlap);
      if (statusPanelOverlapRafRef.current !== null) {
        window.cancelAnimationFrame(statusPanelOverlapRafRef.current);
        statusPanelOverlapRafRef.current = null;
      }
    };
  }, [
    messages.length,
    msgRenderIndex,
    safeSession.id,
    showStatusUserPanel,
    updateStatusPanelOverlap,
  ]);

  useEffect(() => {
    updateStatusPanelOverlap();
  }, [
    isMobileInputFocused,
    isMobileScreen,
    userInput,
    attachImages.length,
    updateStatusPanelOverlap,
  ]);

  const clearStreamingScrollResumeTimer = useCallback(() => {
    if (streamingScrollResumeTimerRef.current) {
      clearTimeout(streamingScrollResumeTimerRef.current);
      streamingScrollResumeTimerRef.current = null;
    }
  }, []);

  const clearForceScrollToBottom = useCallback(() => {
    forceScrollTimeoutsRef.current.forEach((timer) => {
      window.clearTimeout(timer);
    });
    forceScrollTimeoutsRef.current = [];

    forceScrollRafsRef.current.forEach((raf) => {
      window.cancelAnimationFrame(raf);
    });
    forceScrollRafsRef.current = [];

    if (animatedScrollToBottomRafRef.current !== null) {
      window.cancelAnimationFrame(animatedScrollToBottomRafRef.current);
      animatedScrollToBottomRafRef.current = null;
    }
    animatedScrollToBottomRunRef.current += 1;
    setIsScrollToBottomAnimating(false);
  }, []);

  const isScrollDomHitBottom = useCallback(
    (dom?: HTMLElement | null) => {
      if (!dom) return false;
      const bottomHeight = dom.scrollTop + dom.clientHeight;
      return bottomHeight >= dom.scrollHeight - (isMobileScreen ? 4 : 10);
    },
    [isMobileScreen],
  );

  const isScrollDomOverflowing = useCallback((dom?: HTMLElement | null) => {
    if (!dom) return false;
    return dom.scrollHeight > dom.clientHeight + 2;
  }, []);

  const commitScrollMetrics = useCallback(
    (dom?: HTMLElement | null) => {
      const nextHitBottom = isScrollDomHitBottom(dom);
      const nextOverflowing = isScrollDomOverflowing(dom);
      const nextFarFromBottom = dom
        ? dom.scrollHeight - dom.clientHeight - dom.scrollTop >
          (isMobileScreen ? 48 : 64)
        : false;

      if (hitBottomStateRef.current !== nextHitBottom) {
        hitBottomStateRef.current = nextHitBottom;
        setHitBottom(nextHitBottom);
      }
      if (chatBodyOverflowingStateRef.current !== nextOverflowing) {
        chatBodyOverflowingStateRef.current = nextOverflowing;
        setChatBodyOverflowing(nextOverflowing);
      }
      if (isFarFromBottomStateRef.current !== nextFarFromBottom) {
        isFarFromBottomStateRef.current = nextFarFromBottom;
        setIsFarFromBottom(nextFarFromBottom);
      }

      return nextHitBottom;
    },
    [isMobileScreen, isScrollDomHitBottom, isScrollDomOverflowing],
  );

  const scheduleScrollMetricsSync = useCallback(
    (
      dom: HTMLElement,
      options?: { updateMessageWindow?: boolean; programmatic?: boolean },
    ) => {
      const previousPending = pendingScrollMetricsRef.current;
      pendingScrollMetricsRef.current = {
        dom,
        updateMessageWindow:
          previousPending?.updateMessageWindow === true ||
          options?.updateMessageWindow === true,
        programmatic:
          previousPending?.programmatic === true ||
          options?.programmatic === true,
      };
      if (scrollMetricsRafRef.current !== null) return;

      scrollMetricsRafRef.current = window.requestAnimationFrame(() => {
        scrollMetricsRafRef.current = null;
        const pending = pendingScrollMetricsRef.current;
        pendingScrollMetricsRef.current = null;
        if (!pending) return;

        if (
          pending.updateMessageWindow &&
          !pending.programmatic &&
          // 在流式输出期间，完全不调整消息渲染范围，避免滚动位置跳变
          !isAssistantStreaming
        ) {
          const bottomHeight = pending.dom.scrollTop + pending.dom.clientHeight;
          const edgeThreshold = pending.dom.clientHeight;
          const isTouchTopEdge = pending.dom.scrollTop <= edgeThreshold;
          const isTouchBottomEdge =
            bottomHeight >= pending.dom.scrollHeight - edgeThreshold;
          if (isTouchTopEdge && !isTouchBottomEdge) {
            setMsgRenderIndex(msgRenderIndex - CHAT_PAGE_SIZE);
          } else if (isTouchBottomEdge) {
            setMsgRenderIndex(msgRenderIndex + CHAT_PAGE_SIZE);
          }
        }

        commitScrollMetrics(pending.dom);
      });
    },
    [
      commitScrollMetrics,
      isAssistantStreaming,
      msgRenderIndex,
      setMsgRenderIndex,
    ],
  );

  const syncHitBottomFromDom = useCallback(() => {
    const dom = scrollRef.current;
    return commitScrollMetrics(dom);
  }, [commitScrollMetrics, scrollRef]);

  const onChatBodyScroll = (e: HTMLElement) => {
    updateStatusPanelOverlap();

    const previousScrollTop = lastChatBodyScrollTopRef.current;
    const isProgrammaticScrollToBottom =
      Date.now() < programmaticScrollToBottomUntilRef.current;
    const isScrollingUp =
      !isProgrammaticScrollToBottom && e.scrollTop < previousScrollTop - 1;
    lastChatBodyScrollTopRef.current = e.scrollTop;

    const isHitBottom = isScrollDomHitBottom(e);
    scheduleScrollMetricsSync(e, {
      updateMessageWindow: true,
      programmatic: isProgrammaticScrollToBottom,
    });

    if (isScrollingUp) {
      followStreamingAfterScrollButtonRef.current = false;
      clearForceScrollToBottom();
    }

    if (isAssistantStreaming) {
      if (isProgrammaticScrollToBottom) {
        // 用户点击滚动按钮时已经设置了 streamingAutoScrollPausedRef.current = true
        // 这里不要重置它，保持用户的选择
        return;
      }

      const hasRecentUserScrollIntent =
        userScrollIntentRef.current ||
        Date.now() < userScrollIntentUntilRef.current;

      if (hasRecentUserScrollIntent && isScrollingUp) {
        followStreamingAfterScrollButtonRef.current = false;
        streamingAutoScrollPausedRef.current = true;
        setAutoScrollEnabled(false);
        setAutoScroll(false);
        hitBottomStateRef.current = false;
        setHitBottom(false);
        return;
      }

      if (isHitBottom) {
        clearStreamingScrollResumeTimer();
        if (autoScrollEnabled) {
          streamingAutoScrollPausedRef.current = false;
          setAutoScroll(true);
        }
        return;
      }

      if (hasRecentUserScrollIntent) {
        streamingAutoScrollPausedRef.current = true;
        setAutoScroll(false);
      }
      return;
    }

    if (isScrollingUp) {
      setAutoScrollEnabled(false);
      setAutoScroll(false);
      return;
    }
    setAutoScroll(autoScrollEnabledRef.current && isHitBottom);
  };

  const scrollToBottom = useCallback(() => {
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);
    scrollDomToBottom();
  }, [renderMessages.length, scrollDomToBottom, setMsgRenderIndex]);

  const forceScrollToBottom = useCallback(() => {
    if (typeof window === "undefined") return;
    clearForceScrollToBottom();
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);

    const runScroll = () => {
      programmaticScrollToBottomUntilRef.current = Date.now() + 50;
      const dom = scrollRef.current;
      if (dom) {
        const targetTop = Math.max(0, dom.scrollHeight - dom.clientHeight);
        dom.scrollTop = targetTop;
        lastChatBodyScrollTopRef.current = targetTop;
        setHitBottom(isScrollDomHitBottom(dom));
      }
    };

    // 简化动画流程，减少不必要的渲染帧
    const raf = window.requestAnimationFrame(() => {
      forceScrollRafsRef.current = forceScrollRafsRef.current.filter(
        (r) => r !== raf,
      );
      runScroll();
    });
    forceScrollRafsRef.current.push(raf);
  }, [
    clearForceScrollToBottom,
    isScrollDomHitBottom,
    renderMessages.length,
    scrollRef,
    setHitBottom,
    setMsgRenderIndex,
  ]);

  const refreshTouchTriggeredRef = useRef(false);
  const [isRefreshingTitle, setIsRefreshingTitle] = useState(false);
  const handleSessionRefresh = useCallback(async () => {
    if (isRefreshingTitle || isAssistantStreaming) {
      return;
    }
    forceScrollToBottom();
    showTopNotice(Locale.Chat.Actions.RefreshToast);
    setIsRefreshingTitle(true);
    try {
      const success = await chatStore.summarizeSession(true, session);
      if (success) {
        const latestTitle =
          chatStore.getSessionById(session.id)?.topic || session.topic;
        showTopNotice(`标题已更新：${latestTitle}`);
      }
    } finally {
      setIsRefreshingTitle(false);
    }
  }, [
    chatStore,
    forceScrollToBottom,
    isAssistantStreaming,
    isRefreshingTitle,
    session,
    showTopNotice,
  ]);

  const pauseStreamingAutoScrollForUser = useCallback(
    (durationMs = 6000, freezeCurrentPosition = true) => {
      clearStreamingScrollResumeTimer();
      clearForceScrollToBottom();
      cancelScheduledScrollToBottom();
      if (!isMobileScreen) {
        clearCenteredLatestUserMessage();
      }
      followStreamingAfterScrollButtonRef.current = false;
      programmaticScrollToBottomUntilRef.current = 0;
      const dom = scrollRef.current;
      if (dom && freezeCurrentPosition) {
        dom.scrollTo?.({ top: dom.scrollTop, behavior: "auto" });
        lastChatBodyScrollTopRef.current = dom.scrollTop;
      }
      userScrollIntentRef.current = true;
      userScrollIntentUntilRef.current = Date.now() + durationMs;
      streamingAutoScrollPausedRef.current = true;
      setAutoScrollEnabled(false);
      setAutoScroll(false);
      syncHitBottomFromDom();
    },
    [
      clearCenteredLatestUserMessage,
      clearForceScrollToBottom,
      clearStreamingScrollResumeTimer,
      cancelScheduledScrollToBottom,
      isMobileScreen,
      scrollRef,
      setAutoScroll,
      setAutoScrollEnabled,
      syncHitBottomFromDom,
    ],
  );

  const markUserScrollIntent = useCallback(() => {
    if (isAssistantStreaming) {
      userScrollIntentRef.current = true;
      userScrollIntentUntilRef.current = Date.now() + 1200;
      userScrollWindowUpdateUntilRef.current = Date.now() + 180;
    }
  }, [isAssistantStreaming]);

  const prepareTouchScrollTakeover = useCallback(() => {
    chatBodyTouchMovedRef.current = false;
    pendingCenterLatestUserMessageRef.current = null;
    chatBodyTouchPausedFollowRef.current =
      autoScrollEnabledRef.current ||
      followStreamingAfterScrollButtonRef.current ||
      animatedScrollToBottomRafRef.current !== null;
    if (!chatBodyTouchPausedFollowRef.current) return;

    clearForceScrollToBottom();
    cancelScheduledScrollToBottom();
    streamingAutoScrollPausedRef.current = true;
    programmaticScrollToBottomUntilRef.current = 0;
  }, [cancelScheduledScrollToBottom, clearForceScrollToBottom]);

  const finishTouchScrollTakeover = useCallback(() => {
    if (
      chatBodyTouchPausedFollowRef.current &&
      !chatBodyTouchMovedRef.current &&
      autoScrollEnabledRef.current
    ) {
      streamingAutoScrollPausedRef.current = false;
      followStreamingAfterScrollButtonRef.current = true;
    }
    chatBodyTouchPausedFollowRef.current = false;
    chatBodyTouchMovedRef.current = false;
    chatBodyTouchStartYRef.current = null;
  }, []);

  const scrollToBottomLikeMobileTitle = useCallback(() => {
    clearForceScrollToBottom();
    const animationRunId = animatedScrollToBottomRunRef.current + 1;
    animatedScrollToBottomRunRef.current = animationRunId;

    // 只滚动到当前位置，不恢复自动跟随
    // 保持用户滚动意图，之后新内容不会自动跟随
    userScrollIntentRef.current = true;
    userScrollIntentUntilRef.current = Date.now() + 3600000; // 保持1小时
    streamingAutoScrollPausedRef.current = true;
    followStreamingAfterScrollButtonRef.current = false;

    // 不启用自动滚动
    setAutoScrollEnabled(false);
    setAutoScroll(false);
    setIsScrollToBottomAnimating(true);
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);

    const settleToBottom = () => {
      if (animatedScrollToBottomRunRef.current !== animationRunId) return;
      const nextDom = scrollRef.current;
      if (!nextDom) return;
      programmaticScrollToBottomUntilRef.current = Date.now() + 200;
      const targetTop = Math.max(
        0,
        nextDom.scrollHeight - nextDom.clientHeight,
      );
      nextDom.scrollTop = targetTop;
      lastChatBodyScrollTopRef.current = targetTop;
    };

    const finishSettle = () => {
      if (animatedScrollToBottomRunRef.current !== animationRunId) return;
      settleToBottom();
      programmaticScrollToBottomUntilRef.current = Date.now() + 100;
      animatedScrollToBottomRafRef.current = null;
      setIsScrollToBottomAnimating(false);
      syncHitBottomFromDom();
    };

    // 简化动画流程，减少闪烁
    window.requestAnimationFrame(() => {
      if (animatedScrollToBottomRunRef.current !== animationRunId) return;
      settleToBottom();
      animatedScrollToBottomRafRef.current =
        window.requestAnimationFrame(finishSettle);
    });
  }, [
    clearForceScrollToBottom,
    renderMessages.length,
    scrollRef,
    setAutoScroll,
    setAutoScrollEnabled,
    setMsgRenderIndex,
    syncHitBottomFromDom,
  ]);

  const handleScrollToBottomButton = useCallback(() => {
    // 保持用户滚动意图，只滚动到当前位置，不恢复自动跟随
    userScrollIntentRef.current = true;
    userScrollIntentUntilRef.current = Date.now() + 3600000; // 保持1小时
    streamingAutoScrollPausedRef.current = true;
    followStreamingAfterScrollButtonRef.current = false;

    if (isAssistantStreaming) {
      // 流式输出期间只定位到点击这一刻已经存在的底部，后续增量内容
      // 不得继续推动视口，也不启动新的持续跟随状态。
      clearForceScrollToBottom();
      cancelScheduledScrollToBottom();
      animatedScrollToBottomRunRef.current += 1;
      setAutoScrollEnabled(false);
      setAutoScroll(false);

      // 先同步切到最后一个虚拟消息窗口并移除当前回合占位，再读取真实底部。
      // 若先读旧窗口，按钮会把 scrollTop 写到旧窗口的起点，表现为跳回第一行。
      flushSync(() => {
        setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);
        clearCenteredLatestUserMessage();
      });

      const dom = scrollRef.current;
      if (dom) {
        const clickedBottom = Math.max(0, dom.scrollHeight - dom.clientHeight);
        programmaticScrollToBottomUntilRef.current = Date.now() + 100;
        dom.scrollTop = clickedBottom;
        lastChatBodyScrollTopRef.current = clickedBottom;
        syncHitBottomFromDom();
      }
      return;
    }

    scrollToBottomLikeMobileTitle();
  }, [
    cancelScheduledScrollToBottom,
    clearCenteredLatestUserMessage,
    clearForceScrollToBottom,
    isAssistantStreaming,
    renderMessages.length,
    scrollRef,
    scrollToBottomLikeMobileTitle,
    setAutoScroll,
    setMsgRenderIndex,
    syncHitBottomFromDom,
  ]);

  const scrollToTopOnMobile = useCallback(() => {
    mobileInputRef.current?.blur();
    clearStreamingScrollResumeTimer();
    userScrollIntentRef.current = true;
    userScrollIntentUntilRef.current = Date.now() + 1800;
    streamingAutoScrollPausedRef.current = true;
    setAutoScrollEnabled(false);
    setAutoScroll(false);
    setHitBottom(false);
    const dom = scrollRef.current;

    const keepTopScrollPaused = () => {
      userScrollIntentRef.current = true;
      userScrollIntentUntilRef.current = Date.now() + 1800;
      streamingAutoScrollPausedRef.current = true;
      setAutoScrollEnabled(false);
      setAutoScroll(false);
      setHitBottom(false);
    };

    const settleTopWindow = () => {
      keepTopScrollPaused();
      setMsgRenderIndex(0);
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          keepTopScrollPaused();
          const nextDom = scrollRef.current;
          if (!nextDom) return;
          nextDom.scrollTop = 0;
          nextDom.scrollTo?.({
            top: 0,
            behavior: "smooth",
          });
          lastChatBodyScrollTopRef.current = 0;
        });
      });
    };

    if (!dom) {
      settleTopWindow();
      return;
    }

    dom.scrollTo?.({
      top: 0,
      behavior: "smooth",
    });
    lastChatBodyScrollTopRef.current = 0;

    window.setTimeout(settleTopWindow, 260);
    window.setTimeout(() => {
      keepTopScrollPaused();
      const nextDom = scrollRef.current;
      if (!nextDom) return;
      nextDom.scrollTop = 0;
      lastChatBodyScrollTopRef.current = 0;
    }, 520);
  }, [
    clearStreamingScrollResumeTimer,
    setAutoScroll,
    setAutoScrollEnabled,
    setMsgRenderIndex,
  ]);

  const moveInputCursorToEnd = useCallback(() => {
    // 移动端交给浏览器按用户触点定位光标，不再在聚焦、视口变化或内容同步时
    // 自动把光标推到最后一个字符。
    if (isMobileScreen) return;

    const mobileInput = mobileInputRef.current;
    if (mobileInput) {
      const range = document.createRange();
      const endMarker = mobileInputEndRef.current;
      if (endMarker?.isConnected) {
        range.setStartAfter(endMarker);
      } else {
        range.selectNodeContents(mobileInput);
      }
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      mobileInput.scrollTop = mobileInputHasText ? mobileInput.scrollHeight : 0;
      return;
    }

    const textarea = inputRef.current;
    if (!textarea) return;
    const len = textarea.value.length;
    textarea.setSelectionRange(len, len);
    textarea.scrollTop = textarea.scrollHeight;
  }, [isMobileScreen, mobileInputHasText]);

  const scrollMobileInputToBottom = useCallback(() => {
    const mobileInput = mobileInputRef.current;
    if (!mobileInput) return;
    if (!mobileInputHasText) {
      mobileInput.scrollTop = 0;
      syncInputScrollIndicatorRef.current(false);
      return;
    }

    // 计算目标滚动位置，确保底部内容可见
    const targetScrollTop = Math.max(
      0,
      mobileInput.scrollHeight - mobileInput.clientHeight,
    );

    // 先尝试 scrollTo，兼容性更好
    mobileInput.scrollTo({
      top: targetScrollTop,
      behavior: "auto",
    });

    // 确保 scrollTop 正确设置
    if (mobileInput.scrollTop < targetScrollTop) {
      mobileInput.scrollTop = targetScrollTop;
    }

    syncInputScrollIndicatorRef.current(false);
  }, [mobileInputHasText]);

  const scheduleScrollMobileInputToBottom = useCallback(() => {
    if (!mobileInputHasText) {
      const mobileInput = mobileInputRef.current;
      if (mobileInput) {
        mobileInput.scrollTop = 0;
      }
      return;
    }
    requestAnimationFrame(scrollMobileInputToBottom);
    setTimeout(scrollMobileInputToBottom, 60);
    setTimeout(scrollMobileInputToBottom, 180);
    setTimeout(scrollMobileInputToBottom, 360);
    setTimeout(scrollMobileInputToBottom, 520);
  }, [mobileInputHasText, scrollMobileInputToBottom]);

  const resetMobileInputViewportToStart = useCallback(() => {
    const mobileInput = mobileInputRef.current;
    if (!mobileInput) return;
    mobileInput.scrollTop = 0;
    mobileInput.scrollLeft = 0;
    syncInputScrollIndicatorRef.current(false);
  }, []);

  const scheduleResetMobileInputViewportToStart = useCallback(() => {
    requestAnimationFrame(resetMobileInputViewportToStart);
    setTimeout(resetMobileInputViewportToStart, 60);
    setTimeout(resetMobileInputViewportToStart, 180);
  }, [resetMobileInputViewportToStart]);

  const showAttachLimitHint = useCallback(
    (message = `最多只能添加${MAX_ATTACH_IMAGES}个文件`) => {
      showTopNotice(message);
    },
    [showTopNotice],
  );
  const showUploadingPreviewHint = useCallback(() => {
    showTopNotice("文件正在上传，上传完成后再预览");
  }, [showTopNotice]);

  const cancelUploadingAttachment = useCallback(
    async (attachment: ComposerUploadingAttachment) => {
      const confirmed = await showConfirm(
        `确认取消上传“${attachment.file.name || "未命名文件"}”？`,
      );
      if (!confirmed) {
        return;
      }

      ignoredUploadingAttachmentIdsRef.current.add(attachment.id);
      const xhr = uploadingAttachmentXhrRef.current.get(attachment.id);
      if (xhr) {
        xhr.abort();
        uploadingAttachmentXhrRef.current.delete(attachment.id);
      }
      URL.revokeObjectURL(attachment.previewUrl);
      setUploadingAttachments((prev) =>
        prev.filter((item) => item.id !== attachment.id),
      );
    },
    [],
  );

  const removeAttachedImage = useCallback(
    async (index: number) => {
      const confirmed = await showConfirm("确认移除这张图片？");
      if (!confirmed) {
        return;
      }
      setAttachImages((prev) => {
        const target = prev[index];
        if (target) {
          deleteUnsentServerCacheUrl(target.previewUrl);
          revokeLocalComposerAttachedImagePreviewUrl(target);
        }
        const nextImages = prev.filter((_, current) => current !== index);
        if (nextImages.length === 0 && attachedFiles.length === 0) {
          clearComposerAttachmentDraftCache(safeSession.id);
        }
        return nextImages;
      });
    },
    [attachedFiles.length, safeSession.id],
  );

  const removeAttachedFile = useCallback(
    async (file: ChatMessageAttachedFile) => {
      const confirmed = await showConfirm(
        `确认移除“${file.name || "未命名文件"}”？`,
      );
      if (!confirmed) {
        return;
      }
      deleteUnsentServerCacheUrl(file.previewUrl);
      revokeLocalAttachmentPreviewUrl(file);
      setAttachedFiles((prev) => {
        const nextFiles = prev.filter((item) => item.id !== file.id);
        if (attachImages.length === 0 && nextFiles.length === 0) {
          clearComposerAttachmentDraftCache(safeSession.id);
        }
        return nextFiles;
      });
    },
    [attachImages.length, safeSession.id],
  );

  const clearComposerAttachments = useCallback(
    (options?: {
      preserveComposerDraftUrls?: boolean;
      clearDraftCache?: boolean;
      preserveServerFiles?: boolean;
    }) => {
      const preserveComposerDraftUrls = Boolean(
        options?.preserveComposerDraftUrls,
      );
      const preserveServerFiles = Boolean(options?.preserveServerFiles);
      const clearDraftCache = options?.clearDraftCache !== false;
      if (clearDraftCache) {
        clearComposerAttachmentDraftCache(
          composerSnapshotRef.current.safeSessionId,
        );
      }
      setAttachImages((prev) => {
        if (!preserveComposerDraftUrls) {
          prev.forEach((image) => {
            if (!preserveServerFiles) {
              deleteUnsentServerCacheUrl(image.previewUrl);
            }
            revokeLocalComposerAttachedImagePreviewUrl(image);
          });
        }
        return prev.length > 0 ? [] : prev;
      });
      if (!preserveComposerDraftUrls) {
        attachedFiles.forEach((file) => {
          if (!preserveServerFiles) {
            deleteUnsentServerCacheUrl(file.previewUrl);
          }
          revokeLocalAttachmentPreviewUrl(file);
        });
      }
      uploadingAttachments.forEach((attachment) => {
        ignoredUploadingAttachmentIdsRef.current.add(attachment.id);
        const xhr = uploadingAttachmentXhrRef.current.get(attachment.id);
        if (xhr) {
          xhr.abort();
          uploadingAttachmentXhrRef.current.delete(attachment.id);
        }
        URL.revokeObjectURL(attachment.previewUrl);
      });
      setAttachedFiles((prev) => (prev.length > 0 ? [] : prev));
      setUploadingAttachments((prev) => (prev.length > 0 ? [] : prev));
    },
    [attachedFiles, uploadingAttachments],
  );

  const clearComposerAttachmentsRef = useRef(clearComposerAttachments);
  useEffect(() => {
    clearComposerAttachmentsRef.current = clearComposerAttachments;
  }, [clearComposerAttachments]);

  const previousComposerSessionIdRef = useRef(safeSession.id);
  useEffect(() => {
    const previousSessionId = previousComposerSessionIdRef.current;
    if (previousSessionId && previousSessionId !== safeSession.id) {
      clearComposerAttachmentDraftCache(previousSessionId);
      clearComposerAttachmentsRef.current();
    }
    previousComposerSessionIdRef.current = safeSession.id;
  }, [safeSession.id]);

  useEffect(() => {
    return () => {
      clearComposerAttachmentsRef.current();
    };
  }, []);

  const uploadFilesToComposer = useCallback(
    async (incomingFiles: File[]) => {
      const files = await Promise.all(
        incomingFiles.filter(Boolean).map(async (file) => {
          const converted = await convertHeicImage(file);
          if (converted === file) {
            return file;
          }

          const jpegName = `${file.name.replace(/\.(heic|heif)$/i, "")}.jpg`;
          return new File([converted], jpegName, {
            type: "image/jpeg",
            lastModified: file.lastModified,
          });
        }),
      );
      if (files.length === 0) {
        return;
      }

      const remainingSlots = Math.max(
        0,
        MAX_ATTACH_IMAGES -
          (attachImages.length +
            attachedFiles.length +
            uploadingAttachments.length),
      );

      if (files.length > remainingSlots) {
        showAttachLimitHint();
      }

      const existingAttachedFileMetaKeys = new Set(
        attachedFiles.map(
          (file) =>
            `meta:${file.name}|${file.size}|${file.type}|${file.typeKind}`,
        ),
      );
      const seenIncomingMetaKeys = new Set<string>();
      let hasDuplicateExistingFile = false;
      const filteredFiles = files.filter((file) => {
        const metaKey = getComposerPendingFileMetaKey(file);
        if (seenIncomingMetaKeys.has(metaKey)) {
          return false;
        }
        seenIncomingMetaKeys.add(metaKey);

        if (
          !isAttachableImageFile(file) &&
          existingAttachedFileMetaKeys.has(metaKey)
        ) {
          hasDuplicateExistingFile = true;
          console.info("[附件上传] 当前输入框已存在相同文件，跳过追加", {
            name: file.name || "未命名文件",
            size: file.size || 0,
            type: getUploadContentType(file),
            contentMd5: "",
          });
          return false;
        }
        return true;
      });
      if (hasDuplicateExistingFile) {
        showAttachLimitHint("同一个文件只能添加一个");
      }

      const candidateFiles = filteredFiles.slice(0, remainingSlots);
      if (candidateFiles.length === 0) {
        return;
      }

      const pendingAttachments = candidateFiles.map((file) => ({
        id: Math.random().toString(36).slice(2),
        file,
        previewUrl: URL.createObjectURL(file),
        isImage: isAttachableImageFile(file),
        contentMd5: "",
        uploadContentType: getUploadContentType(file),
        typeKind: getAttachmentTypeKind(file),
        typeLabel: getAttachmentTypeLabel(file),
        progress: 0,
        phase: "preparing" as const,
      }));

      setUploadingAttachments((prev) => [...prev, ...pendingAttachments]);

      const existingAttachedFileKeys = new Set(
        attachedFiles.map((file) => getComposerAttachedFileIdentityKey(file)),
      );
      const claimedAttachmentKeys = new Set(existingAttachedFileKeys);

      await Promise.all(
        pendingAttachments.map(async (attachment) => {
          let uploadedUrl = "";
          let shouldKeepLocalPreview = false;
          let contentMd5 = "";

          try {
            try {
              contentMd5 = await computeFileContentMd5(attachment.file);
            } catch {
              contentMd5 = "";
              console.warn("[附件上传] 文件 MD5 计算失败，将继续直接上传", {
                name: attachment.file.name || "未命名文件",
                size: attachment.file.size || 0,
                type: attachment.uploadContentType,
              });
            }

            if (ignoredUploadingAttachmentIdsRef.current.has(attachment.id)) {
              return;
            }

            const identityKey = contentMd5
              ? `md5:${getPreviewContentType(attachment.file)}:${contentMd5}`
              : `meta:${attachment.file.name}|${
                  attachment.file.size
                }|${getPreviewContentType(attachment.file)}|${
                  attachment.typeKind
                }`;

            if (!attachment.isImage && claimedAttachmentKeys.has(identityKey)) {
              console.info("[附件上传] 当前输入框已存在相同文件，跳过追加", {
                name: attachment.file.name || "未命名文件",
                size: attachment.file.size || 0,
                type: attachment.uploadContentType,
                contentMd5: contentMd5 || "",
              });
              return;
            }
            claimedAttachmentKeys.add(identityKey);

            let cachedUrl = "";
            if (contentMd5) {
              cachedUrl = await resolveComposerCachedUploadUrl(
                attachment.file,
                contentMd5,
              ).catch(() => "");
            }

            if (ignoredUploadingAttachmentIdsRef.current.has(attachment.id)) {
              return;
            }

            if (cachedUrl) {
              console.info("[附件上传] 命中已存在文件，跳过上传", {
                name: attachment.file.name || "未命名文件",
                size: attachment.file.size || 0,
                type: attachment.uploadContentType,
                contentMd5: contentMd5 || "",
                url: cachedUrl,
              });
              showAttachLimitHint("已命中已有文件，已直接复用");

              shouldKeepLocalPreview = true;
              if (attachment.isImage) {
                setAttachImages((prev) =>
                  mergeComposerAttachedImages(prev, [
                    createComposerAttachedImage(
                      cachedUrl,
                      attachment.previewUrl,
                    ),
                  ]),
                );
              } else {
                const uploadedFile = createAttachedFileFromUpload(
                  attachment.file,
                  cachedUrl,
                  attachment.previewUrl,
                  contentMd5,
                );
                setAttachedFiles((prev) =>
                  mergeComposerAttachedFiles(prev, [uploadedFile]),
                );
              }
              return;
            }

            console.info("[附件上传] 未命中已有文件，准备上传", {
              name: attachment.file.name || "未命名文件",
              size: attachment.file.size || 0,
              type: attachment.uploadContentType,
              contentMd5: contentMd5 || "",
            });

            setUploadingAttachments((prev) =>
              prev.map((item) =>
                item.id === attachment.id
                  ? {
                      ...item,
                      contentMd5,
                      phase: "uploading",
                      progress: 0,
                    }
                  : item,
              ),
            );

            console.info("[附件上传] 开始上传新文件", {
              name: attachment.file.name || "未命名文件",
              size: attachment.file.size || 0,
              type: attachment.uploadContentType,
            });
            uploadedUrl = await new Promise<string>((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              uploadingAttachmentXhrRef.current.set(attachment.id, xhr);
              xhr.open("POST", UPLOAD_URL);
              xhr.withCredentials = true;
              xhr.responseType = "json";
              xhr.upload.onprogress = (event) => {
                const progress =
                  event.lengthComputable && event.total > 0
                    ? Math.min(1, Math.max(0, event.loaded / event.total))
                    : 0;
                setUploadingAttachments((prev) =>
                  prev.map((item) =>
                    item.id === attachment.id ? { ...item, progress } : item,
                  ),
                );
              };
              xhr.onload = () => {
                try {
                  const res =
                    (xhr.response as any) ??
                    JSON.parse(String(xhr.responseText || "{}"));
                  if (res?.code === 0 && res?.data) {
                    resolve(String(res.data));
                    return;
                  }
                  reject(new Error(`upload Error: ${res?.msg}`));
                } catch (error) {
                  reject(error);
                }
              };
              xhr.onerror = () => reject(new Error("upload_network_error"));
              xhr.onabort = () => reject(new Error("upload_aborted"));
              const formData = new FormData();
              formData.append("file", attachment.file);
              xhr.send(formData);
            });

            if (ignoredUploadingAttachmentIdsRef.current.has(attachment.id)) {
              return;
            }
            console.info("[附件上传] 新文件上传成功", {
              name: attachment.file.name || "未命名文件",
              size: attachment.file.size || 0,
              type: attachment.uploadContentType,
              url: uploadedUrl,
            });

            shouldKeepLocalPreview = true;
            if (attachment.isImage) {
              setAttachImages((prev) =>
                mergeComposerAttachedImages(prev, [
                  createComposerAttachedImage(
                    uploadedUrl,
                    attachment.previewUrl,
                  ),
                ]),
              );
            } else {
              const uploadedFile = createAttachedFileFromUpload(
                attachment.file,
                uploadedUrl,
                attachment.previewUrl,
                contentMd5,
              );
              setAttachedFiles((prev) =>
                mergeComposerAttachedFiles(prev, [uploadedFile]),
              );
            }
          } catch (error) {
            if (!ignoredUploadingAttachmentIdsRef.current.has(attachment.id)) {
              console.error("[附件上传] 新文件上传失败", {
                name: attachment.file.name || "未命名文件",
                size: attachment.file.size || 0,
                type: attachment.uploadContentType,
                error:
                  error instanceof Error ? error.message : String(error || ""),
              });
              showAttachLimitHint("文件上传失败，请重试");
            }
          } finally {
            uploadingAttachmentXhrRef.current.delete(attachment.id);
            setUploadingAttachments((prev) =>
              prev.filter((item) => item.id !== attachment.id),
            );
            if (
              uploadedUrl &&
              ignoredUploadingAttachmentIdsRef.current.has(attachment.id)
            ) {
              deleteUnsentServerCacheUrl(uploadedUrl);
            }
            ignoredUploadingAttachmentIdsRef.current.delete(attachment.id);
            if (!shouldKeepLocalPreview) {
              URL.revokeObjectURL(attachment.previewUrl);
            }
          }
        }),
      );
    },
    [
      attachImages.length,
      attachedFiles,
      showAttachLimitHint,
      uploadingAttachments.length,
    ],
  );

  const updateMobileInputMeasuredHeight = useCallback(() => {
    const mobileInput = mobileInputRef.current;
    if (!mobileInput) return 44;
    const measuredHeight = Math.max(
      44,
      Math.ceil(
        Math.max(
          mobileInput.getBoundingClientRect().height,
          mobileInput.clientHeight,
        ),
      ),
    );
    mobileInputMeasuredHeightRef.current = measuredHeight;
    return measuredHeight;
  }, []);

  const syncMobileInputHeight = useCallback(
    (text = userInput) => {
      const mobileInput = mobileInputRef.current;
      if (!mobileInput) return 44;

      const hasText = text.trim().length > 0;
      if (!hasText) {
        mobileInput.style.height = "44px";
        mobileInput.style.maxHeight = "";
        mobileInput.scrollTop = 0;
        mobileInputMeasuredHeightRef.current = 44;
        syncInputScrollIndicatorRef.current(false);
        return 44;
      }

      // contentEditable 在移动端容易继承上一次布局高度，先压回单行再读 scrollHeight。
      mobileInput.style.height = "44px";
      const nextHeight = Math.max(
        44,
        Math.min(360, Math.ceil(mobileInput.scrollHeight)),
      );
      mobileInput.style.height = `${nextHeight}px`;
      mobileInput.style.maxHeight = "";
      mobileInputMeasuredHeightRef.current = nextHeight;
      return nextHeight;
    },
    [userInput],
  );

  const updateInputScrollIndicator = useCallback(
    (visible: boolean) => {
      const inputEl =
        mobileInputRef.current ?? (inputRef.current as HTMLElement | null);
      const innerEl = chatInputInnerRef.current;
      if (!inputEl || !innerEl) return;

      const clientHeight = Math.max(0, inputEl.clientHeight);
      const scrollHeight = Math.max(0, inputEl.scrollHeight);
      const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
      const isScrollable = clientHeight > 0 && maxScrollTop > 2;

      innerEl.dataset.inputScrollable = isScrollable ? "true" : "false";
      innerEl.style.setProperty(
        "--chat-input-scroll-indicator-opacity",
        visible && isScrollable ? "1" : "0",
      );

      if (!isScrollable) {
        innerEl.style.setProperty("--chat-input-scroll-indicator-size", "0px");
        innerEl.style.setProperty(
          "--chat-input-scroll-indicator-offset",
          "0px",
        );
        return;
      }

      const inputRect = inputEl.getBoundingClientRect();
      const innerRect = innerEl.getBoundingClientRect();
      const trackInset = isMobileScreen ? 6 : 12;
      const trackTop = Math.max(0, inputRect.top - innerRect.top);
      const visibleInputHeight = Math.max(
        0,
        Math.min(clientHeight, Math.round(inputRect.height)),
      );
      const trackHeight = Math.max(
        isMobileScreen ? 24 : 20,
        visibleInputHeight - trackInset * 2,
      );
      const rawThumbHeight = Math.round(
        (clientHeight / scrollHeight) * trackHeight,
      );
      const mobileThumbMin = Math.min(trackHeight, 28);
      const mobileThumbMax = Math.min(trackHeight, 36);
      const thumbHeight = isMobileScreen
        ? Math.max(mobileThumbMin, Math.min(mobileThumbMax, rawThumbHeight))
        : Math.max(16, Math.min(trackHeight, rawThumbHeight));
      const maxThumbOffset = Math.max(0, trackHeight - thumbHeight);
      const thumbOffset =
        maxScrollTop > 0
          ? Math.round((inputEl.scrollTop / maxScrollTop) * maxThumbOffset)
          : 0;

      innerEl.style.setProperty(
        "--chat-input-scroll-indicator-size",
        `${thumbHeight}px`,
      );
      innerEl.style.setProperty(
        "--chat-input-scroll-indicator-offset",
        `${trackTop + trackInset + thumbOffset}px`,
      );
    },
    [isMobileScreen],
  );

  const syncInputScrollIndicator = useCallback(
    (visible = false) => {
      if (typeof window === "undefined") return;
      window.requestAnimationFrame(() => {
        updateInputScrollIndicator(visible);
      });
    },
    [updateInputScrollIndicator],
  );
  syncInputScrollIndicatorRef.current = syncInputScrollIndicator;

  const showInputScrollIndicator = useCallback(() => {
    if (typeof window === "undefined") return;
    updateInputScrollIndicator(true);
    if (inputScrollIndicatorHideTimerRef.current !== null) {
      window.clearTimeout(inputScrollIndicatorHideTimerRef.current);
    }
    inputScrollIndicatorHideTimerRef.current = window.setTimeout(() => {
      updateInputScrollIndicator(false);
      inputScrollIndicatorHideTimerRef.current = null;
    }, 900);
  }, [updateInputScrollIndicator]);

  const stopMobileInputInertiaScroll = useCallback((resetVelocity = true) => {
    if (typeof window !== "undefined" && mobileInputInertiaRafRef.current) {
      window.cancelAnimationFrame(mobileInputInertiaRafRef.current);
    }
    mobileInputInertiaRafRef.current = null;
    if (resetVelocity) {
      mobileInputTouchVelocityRef.current = 0;
    }
  }, []);

  const startMobileInputInertiaScroll = useCallback(() => {
    if (typeof window === "undefined") return;

    const initialVelocity = mobileInputTouchVelocityRef.current;
    if (Math.abs(initialVelocity) < 0.08) {
      mobileInputTouchVelocityRef.current = 0;
      return;
    }

    stopMobileInputInertiaScroll(false);
    let velocity = initialVelocity;
    let lastFrameTime: number | null = null;

    const step = (frameTime: number) => {
      const mobileInput = mobileInputRef.current;
      if (!mobileInput) {
        stopMobileInputInertiaScroll();
        return;
      }

      if (lastFrameTime == null) {
        lastFrameTime = frameTime;
        mobileInputInertiaRafRef.current = window.requestAnimationFrame(step);
        return;
      }

      const deltaTime = Math.min(32, frameTime - lastFrameTime);
      lastFrameTime = frameTime;
      const maxScrollTop = Math.max(
        0,
        mobileInput.scrollHeight - mobileInput.clientHeight,
      );
      if (maxScrollTop <= 0) {
        stopMobileInputInertiaScroll();
        updateInputScrollIndicator(false);
        return;
      }

      const nextScrollTop = Math.min(
        maxScrollTop,
        Math.max(0, mobileInput.scrollTop + velocity * deltaTime),
      );
      const hitEdge =
        nextScrollTop <= 0.5 || nextScrollTop >= maxScrollTop - 0.5;

      mobileInput.scrollTop = nextScrollTop;
      updateInputScrollIndicator(true);
      velocity *= Math.pow(0.94, deltaTime / 16);
      mobileInputTouchVelocityRef.current = velocity;

      if (Math.abs(velocity) < 0.02 || hitEdge) {
        stopMobileInputInertiaScroll();
        showInputScrollIndicator();
        return;
      }

      mobileInputInertiaRafRef.current = window.requestAnimationFrame(step);
    };

    showInputScrollIndicator();
    mobileInputInertiaRafRef.current = window.requestAnimationFrame(step);
  }, [
    showInputScrollIndicator,
    stopMobileInputInertiaScroll,
    updateInputScrollIndicator,
  ]);

  const handleInputScroll = useCallback(() => {
    showInputScrollIndicator();
  }, [showInputScrollIndicator]);

  useLayoutEffect(() => {
    const inputEl =
      mobileInputRef.current ?? (inputRef.current as HTMLElement | null);
    const innerEl = chatInputInnerRef.current;
    if (!inputEl || !innerEl) return;

    const sync = () => {
      syncInputScrollIndicator(false);
    };

    sync();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", sync);
      return () => window.removeEventListener("resize", sync);
    }

    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(inputEl);
    resizeObserver.observe(innerEl);

    return () => resizeObserver.disconnect();
  }, [
    attachImages.length,
    isMobileInputFocused,
    isMobileScreen,
    preserveMobileInputBlurHeight,
    syncInputScrollIndicator,
    userInput,
  ]);

  useEffect(() => {
    return () => {
      if (inputScrollIndicatorHideTimerRef.current !== null) {
        window.clearTimeout(inputScrollIndicatorHideTimerRef.current);
      }
      stopMobileInputInertiaScroll();
    };
  }, [stopMobileInputInertiaScroll]);

  const resetMobileInputBlurLayout = useCallback(() => {
    const mobileInput = mobileInputRef.current;
    const innerEl = chatInputInnerRef.current;
    mobileInputPreservedHeightRef.current = "44px";
    mobileInputMeasuredHeightRef.current = 44;
    preserveMobileInputBlurHeightRef.current = false;
    setPreserveMobileInputBlurHeight(false);
    innerEl?.style.removeProperty("--chat-mobile-input-preserved-height");
    if (!mobileInput) return;
    mobileInput.style.removeProperty("--chat-mobile-input-preserved-height");
    mobileInput.style.height = "44px";
    mobileInput.style.maxHeight = "44px";
    scheduleResetMobileInputViewportToStart();
  }, [scheduleResetMobileInputViewportToStart]);

  const measureMobileInputTextOnlyHeight = useCallback(() => {
    const mobileInput = mobileInputRef.current;
    if (!mobileInput || typeof window === "undefined") return 44;

    const rect = mobileInput.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(mobileInput);
    const probe = document.createElement("div");
    const text =
      userInput || (mobileInput.textContent ?? "").replace(/\u200b/g, "");

    probe.className = mobileInput.className;
    probe.textContent = text || "\u200b";
    probe.setAttribute("aria-hidden", "true");

    Object.assign(probe.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      visibility: "hidden",
      pointerEvents: "none",
      width: `${Math.max(0, rect.width)}px`,
      height: "auto",
      minHeight: "44px",
      maxHeight: "none",
      overflow: "visible",
      boxSizing: "border-box",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
      fontFamily: computedStyle.fontFamily,
      fontSize: computedStyle.fontSize,
      fontWeight: computedStyle.fontWeight,
      fontStyle: computedStyle.fontStyle,
      lineHeight: computedStyle.lineHeight,
      letterSpacing: computedStyle.letterSpacing,
      paddingTop: "11px",
      paddingRight: "50px",
      paddingBottom: "11px",
      paddingLeft: "12px",
    });

    document.body.appendChild(probe);
    const height = Math.max(
      44,
      Math.ceil(
        Math.max(probe.scrollHeight, probe.getBoundingClientRect().height),
      ),
    );
    probe.remove();
    return height;
  }, [userInput]);

  const prepareMobileInputBlurLayout = useCallback(() => {
    const mobileInput = mobileInputRef.current;
    const innerEl = chatInputInnerRef.current;
    if (!mobileInput || !innerEl) return false;

    // 保存当前 scrollTop，在高度调整后恢复
    const currentScrollTop = mobileInput.scrollTop;

    const measuredHeight = Math.max(
      updateMobileInputMeasuredHeight(),
      mobileInputMeasuredHeightRef.current,
    );
    const mobileInputText = (mobileInput.textContent ?? "").replace(
      /\u200b/g,
      "",
    );
    const textOnlyHeight = measureMobileInputTextOnlyHeight();
    const contentHeight = Math.max(
      textOnlyHeight,
      Math.ceil(mobileInput.scrollHeight),
    );
    const hasMobileInputText =
      mobileInputHasText || mobileInputText.trim().length > 0;
    const hasAttachImages = hasComposerAttachments;
    const shouldPreserveExpandedHeight = hasMobileInputText || hasAttachImages;
    if (!shouldPreserveExpandedHeight) {
      resetMobileInputBlurLayout();
      return false;
    }

    // 输入框高度计算逻辑：
    // - 有图片时：纯文本高度 + 固定图片条高度(68px)会在CSS中自动叠加
    // - 无图片时：仅文本高度
    const maxBlurredInputHeight = 360;
    // 计算纯文本高度（不含图片
    let baseTextHeight = Math.max(
      44,
      Math.ceil(Math.min(textOnlyHeight, maxBlurredInputHeight)),
    );
    const preservedHeight = `${baseTextHeight}px`;
    mobileInputPreservedHeightRef.current = preservedHeight;
    preserveMobileInputBlurHeightRef.current = true;
    setPreserveMobileInputBlurHeight(true);
    innerEl.style.setProperty(
      "--chat-mobile-input-preserved-height",
      preservedHeight,
    );
    mobileInput.style.setProperty(
      "--chat-mobile-input-preserved-height",
      preservedHeight,
    );
    mobileInput.style.height = preservedHeight;
    mobileInput.style.maxHeight = preservedHeight;
    const selection = window.getSelection();
    selection?.removeAllRanges();

    // 在设置高度后，重新计算并恢复/设置正确的滚动位置
    // 使用 requestAnimationFrame 确保高度已经应用
    requestAnimationFrame(() => {
      if (mobileInputRef.current) {
        // 重新计算目标滚动位置
        const targetScrollTop = Math.max(
          0,
          mobileInputRef.current.scrollHeight -
            mobileInputRef.current.clientHeight,
        );

        // 如果有图片且有文字，始终滚动到底部
        if (hasComposerAttachments && mobileInputHasText) {
          mobileInputRef.current.scrollTop = targetScrollTop;
        } else if (mobileInputHasText && currentScrollTop > 0) {
          // 有文字但没有图片时，恢复之前的滚动位置，不超过新的最大滚动值
          mobileInputRef.current.scrollTop = Math.min(
            currentScrollTop,
            targetScrollTop,
          );
        } else {
          // 没有文字或其他情况重置到顶部
          mobileInputRef.current.scrollTop = 0;
        }
      }
    });

    return true;
  }, [
    hasComposerAttachments,
    mobileInputHasText,
    resetMobileInputBlurLayout,
    measureMobileInputTextOnlyHeight,
    updateMobileInputMeasuredHeight,
  ]);

  const cancelMobileKeyboardViewportSync = useCallback(() => {
    if (typeof window === "undefined") return;
    if (mobileViewportRafRef.current !== null) {
      window.cancelAnimationFrame(mobileViewportRafRef.current);
      mobileViewportRafRef.current = null;
    }
  }, []);

  const resetMobileDocumentScroll = useCallback(() => {
    if (typeof window === "undefined") return;
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  const clearMobileKeyboardReleaseTimers = useCallback(() => {
    if (typeof window === "undefined") return;
    mobileViewportReleaseTimersRef.current.forEach((timer) => {
      window.clearTimeout(timer);
    });
    mobileViewportReleaseTimersRef.current = [];
  }, []);

  const scheduleMobileKeyboardReleaseStabilize = useCallback(() => {
    if (!isMobileScreen || typeof window === "undefined") return;

    clearMobileKeyboardReleaseTimers();
    setIsMobileKeyboardReleasing(true);

    let lastHeight = -1;
    let stableCount = 0;
    const startedAt = Date.now();
    const stabilize = () => {
      resetMobileDocumentScroll();
      const visualHeight = Math.floor(
        window.visualViewport?.height ?? window.innerHeight,
      );
      const expandedHeight = mobileExpandedViewportHeightRef.current;
      stableCount =
        Math.abs(visualHeight - lastHeight) <= 1 ? stableCount + 1 : 0;
      lastHeight = visualHeight;

      const viewportRestored =
        expandedHeight > 0 && visualHeight >= expandedHeight - 2;
      if (
        (viewportRestored && stableCount >= 2) ||
        Date.now() - startedAt >= 1200
      ) {
        setIsMobileKeyboardReleasing(false);
        resetMobileDocumentScroll();
        mobileViewportReleaseTimersRef.current = [];
        return;
      }

      mobileViewportReleaseTimersRef.current = [
        window.setTimeout(stabilize, 80),
      ];
    };
    stabilize();
  }, [
    clearMobileKeyboardReleaseTimers,
    isMobileScreen,
    resetMobileDocumentScroll,
  ]);

  useEffect(() => {
    return () => {
      clearMobileKeyboardReleaseTimers();
    };
  }, [clearMobileKeyboardReleaseTimers]);

  const collapseMobileInput = useCallback(
    (preserveExpandedHeight = false) => {
      const mobileInput = mobileInputRef.current;
      if (!mobileInput) return;
      // 键盘打开时让 CSS 控制高度（height: auto），避免覆盖 .chat-mobile-keyboard-open 的规则
      const chatEl = mobileInput.closest(".chat-mobile-keyboard-open");
      if (chatEl) {
        mobileInput.style.height = "auto";
        mobileInput.style.maxHeight = "";
        mobileInput.scrollLeft = 0;
        return;
      }

      if (!preserveExpandedHeight) {
        resetMobileInputBlurLayout();
        return;
      }

      // 保存当前滚动位置
      const currentScrollTop = mobileInput.scrollTop;

      const preservedHeight = mobileInputPreservedHeightRef.current;
      const innerEl = chatInputInnerRef.current;
      innerEl?.style.setProperty(
        "--chat-mobile-input-preserved-height",
        preservedHeight,
      );
      mobileInput.style.setProperty(
        "--chat-mobile-input-preserved-height",
        preservedHeight,
      );
      mobileInput.style.height = preservedHeight;
      mobileInput.style.maxHeight = preservedHeight;

      // 在高度应用后重新设置滚动位置
      requestAnimationFrame(() => {
        if (mobileInputRef.current) {
          const targetScrollTop = Math.max(
            0,
            mobileInputRef.current.scrollHeight -
              mobileInputRef.current.clientHeight,
          );

          // 如果有图片且有文字，始终滚动到底部
          if (hasComposerAttachments && mobileInputHasText) {
            mobileInputRef.current.scrollTop = targetScrollTop;
          } else if (mobileInputHasText && currentScrollTop > 0) {
            // 有文字但没有图片时，恢复之前的滚动位置
            mobileInputRef.current.scrollTop = Math.min(
              currentScrollTop,
              targetScrollTop,
            );
          } else {
            // 没有文字或其他情况重置到顶部
            mobileInputRef.current.scrollTop = 0;
          }
        }
      });
    },
    [hasComposerAttachments, mobileInputHasText, resetMobileInputBlurLayout],
  );

  const scheduleCollapseMobileInput = useCallback(
    (preserveExpandedHeight = false) => {
      // 清除之前的定时器，避免残留
      collapseTimersRef.current.forEach(clearTimeout);
      collapseTimersRef.current = [];

      const collapseDelays = preserveExpandedHeight
        ? [120, 260, 420, 620]
        : [360];

      collapseTimersRef.current.push(
        ...collapseDelays.map((delay, index) =>
          window.setTimeout(() => {
            collapseMobileInput(preserveExpandedHeight);
            if (index === collapseDelays.length - 1) {
              collapseTimersRef.current = [];
            }
          }, delay),
        ),
      );
    },
    [collapseMobileInput],
  );

  const resetMobileInputDom = useCallback((text: string) => {
    const mobileInput = mobileInputRef.current;
    if (!mobileInput) return;

    mobileInput.textContent = text;
    const endMarker = document.createElement("span");
    endMarker.textContent = "\u200b";
    endMarker.setAttribute("data-chat-input-end", "true");
    mobileInput.appendChild(endMarker);
    mobileInputEndRef.current = endMarker;
  }, []);

  const finalizeMobileInputBlur = useCallback(
    (blurDom = false) => {
      cancelMobileKeyboardViewportSync();
      collapseTimersRef.current.forEach(clearTimeout);
      collapseTimersRef.current = [];
      if (mobileBlurTimerRef.current !== null) {
        clearTimeout(mobileBlurTimerRef.current);
        mobileBlurTimerRef.current = null;
      }
      const shouldResetAfterSubmit =
        pendingMobileInputResetAfterSubmitRef.current;
      if (shouldResetAfterSubmit) {
        pendingMobileInputResetAfterSubmitRef.current = false;
        setInputRows(1);
        setPreserveMobileInputBlurHeight(false);
        preserveMobileInputBlurHeightRef.current = false;
        resetMobileInputDom("");
        syncMobileInputHeight("");
        resetMobileInputBlurLayout();
      }
      const shouldPreserveExpandedHeight = shouldResetAfterSubmit
        ? false
        : prepareMobileInputBlurLayout();
      mobileKeyboardOpenedSinceFocusRef.current = false;
      setIsMobileInputFocused(false);
      collapseMobileInput(shouldPreserveExpandedHeight);
      if (shouldPreserveExpandedHeight) {
        scheduleCollapseMobileInput(true);
      }
      scheduleMobileKeyboardReleaseStabilize();
      if (blurDom) {
        mobileKeyboardDismissByViewportRef.current = true;
        mobileInputRef.current?.blur();
      }
    },
    [
      cancelMobileKeyboardViewportSync,
      collapseMobileInput,
      prepareMobileInputBlurLayout,
      resetMobileInputBlurLayout,
      resetMobileInputDom,
      scheduleCollapseMobileInput,
      scheduleMobileKeyboardReleaseStabilize,
      syncMobileInputHeight,
    ],
  );

  useLayoutEffect(() => {
    if (isMobileKeyboardReleasing) {
      mobileKeyboardReleaseWasActiveRef.current = true;
      return;
    }
    if (!mobileKeyboardReleaseWasActiveRef.current) return;

    mobileKeyboardReleaseWasActiveRef.current = false;
    // 在浏览器绘制普通态之前同步恢复多行高度，避免先按单行绘制一帧再变高。
    const shouldPreserveExpandedHeight = prepareMobileInputBlurLayout();
    collapseMobileInput(shouldPreserveExpandedHeight);
    resetMobileDocumentScroll();
  }, [
    collapseMobileInput,
    isMobileKeyboardReleasing,
    prepareMobileInputBlurLayout,
    resetMobileDocumentScroll,
  ]);

  const scheduleMoveInputCursorToEnd = useCallback(() => {
    requestAnimationFrame(moveInputCursorToEnd);
    setTimeout(moveInputCursorToEnd, 60);
    setTimeout(moveInputCursorToEnd, 180);
    setTimeout(moveInputCursorToEnd, 360);
    setTimeout(moveInputCursorToEnd, 520);
  }, [moveInputCursorToEnd]);

  const handleAiMessageTextSelection = useCallback(
    (
      messageId: string,
      options: {
        delayMs?: number;
        clearOnEmpty?: boolean;
        showBubble?: boolean;
      } = {},
    ) => {
      const { delayMs = 0, clearOnEmpty = true, showBubble = true } = options;
      if (aiSelectionTouchTimerRef.current !== null) {
        window.clearTimeout(aiSelectionTouchTimerRef.current);
      }
      aiSelectionTouchTimerRef.current = window.setTimeout(() => {
        aiSelectionTouchTimerRef.current = null;
        const selection = window.getSelection?.();
        const rawText = selection?.toString() ?? "";
        const text = rawText.replace(/\s+\n/g, "\n").trim();
        if (!selection || selection.rangeCount === 0 || text.length === 0) {
          if (clearOnEmpty) {
            setAiSelectionBubble(null);
            aiSelectionPendingRef.current = null;
            aiSelectionActiveMessageIdRef.current = "";
          }
          return;
        }

        const range = selection.getRangeAt(0);
        const getSelectionElement = (node: Node) =>
          node.nodeType === Node.ELEMENT_NODE
            ? (node as Element)
            : node.parentNode instanceof Element
            ? node.parentNode
            : null;
        const startElement = getSelectionElement(range.startContainer);
        const endElement = getSelectionElement(range.endContainer);
        const startTextRoot = startElement?.closest(
          `[data-chat-ai-message-text="true"][data-chat-message-id="${messageId}"]`,
        );
        const endTextRoot = endElement?.closest(
          `[data-chat-ai-message-text="true"][data-chat-message-id="${messageId}"]`,
        );
        if (!startTextRoot || startTextRoot !== endTextRoot) {
          if (clearOnEmpty) {
            setAiSelectionBubble(null);
            aiSelectionPendingRef.current = null;
            aiSelectionActiveMessageIdRef.current = "";
          }
          return;
        }

        const rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) {
          if (clearOnEmpty) {
            setAiSelectionBubble(null);
            aiSelectionPendingRef.current = null;
            aiSelectionActiveMessageIdRef.current = "";
          }
          return;
        }

        const bubbleWidth = 112;
        const bubbleHeight = 40;
        const verticalGap = isMobileScreen ? 12 : 8;
        const left = Math.min(
          window.innerWidth - bubbleWidth / 2 - 12,
          Math.max(bubbleWidth / 2 + 12, rect.left + rect.width / 2),
        );
        const preferredTop = rect.top - bubbleHeight - verticalGap;
        const top =
          preferredTop >= 12
            ? preferredTop
            : Math.min(
                window.innerHeight - bubbleHeight - 12,
                rect.bottom + verticalGap,
              );
        const nextSelectionBubble = {
          messageId,
          text: text.slice(0, 4000),
          left,
          top,
        };
        aiSelectionPendingRef.current = nextSelectionBubble;
        if (showBubble) {
          setAiSelectionBubble(nextSelectionBubble);
        }
        aiSelectionActiveMessageIdRef.current = messageId;
      }, delayMs);
    },
    [isMobileScreen],
  );

  const askAiAboutSelection = useCallback(() => {
    if (!aiSelectionBubble?.text.trim()) return;

    setAiSelectionContext({
      messageId: aiSelectionBubble.messageId,
      text: aiSelectionBubble.text,
    });
    aiSelectionActiveMessageIdRef.current = "";
    setAiSelectionBubble(null);
    window.getSelection?.()?.removeAllRanges();
    setPromptHints([]);

    window.requestAnimationFrame(() => {
      const input = isMobileScreen ? mobileInputRef.current : inputRef.current;
      input?.focus();
      scheduleMoveInputCursorToEnd();
    });
  }, [aiSelectionBubble, isMobileScreen, scheduleMoveInputCursorToEnd]);

  useEffect(() => {
    if (!aiSelectionBubble) return;

    const clear = (event?: Event) => {
      const target = event?.target as HTMLElement | null;
      if (target?.closest?.(`.${styles["chat-ai-selection-popover"]}`)) {
        return;
      }
      // 点击/触摸其他位置时，主动清除文字选区高亮，与隐藏"询问 AI"按钮保持一致。
      // 滚动/缩放只隐藏按钮、不动选区，避免滚动时突兀地丢失用户已选中的内容。
      if (event?.type === "mousedown" || event?.type === "touchstart") {
        window.getSelection?.()?.removeAllRanges();
      }
      aiSelectionActiveMessageIdRef.current = "";
      setAiSelectionBubble(null);
    };
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    window.addEventListener("mousedown", clear);
    window.addEventListener("touchstart", clear, { passive: true });
    return () => {
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
      window.removeEventListener("mousedown", clear);
      window.removeEventListener("touchstart", clear);
    };
  }, [aiSelectionBubble, isMobileScreen]);

  const exitMobileEditMode = useCallback(() => {
    setEditMobileMessageId(null);
    setUserInput("");
    setAiSelectionContext(null);
    clearComposerAttachments();
    setPromptHints([]);
    setIsMobileInputFocused(false);
    setPreserveMobileInputBlurHeight(false);
    preserveMobileInputBlurHeightRef.current = false;
    cancelMobileKeyboardViewportSync();
    clearMobileKeyboardReleaseTimers();
    resetMobileInputDom("");
    syncMobileInputHeight("");
    scheduleResetMobileInputViewportToStart();
    resetMobileInputBlurLayout();
    blurMobileKeyboard();
    [50, 180, 420].forEach((delay) => {
      setTimeout(() => scrollDomToBottom(), delay);
    });
  }, [
    blurMobileKeyboard,
    cancelMobileKeyboardViewportSync,
    clearComposerAttachments,
    clearMobileKeyboardReleaseTimers,
    resetMobileInputDom,
    resetMobileInputBlurLayout,
    scheduleResetMobileInputViewportToStart,
    scrollDomToBottom,
    syncMobileInputHeight,
  ]);

  useEffect(() => {
    const mobileInput = mobileInputRef.current;
    if (!isMobileScreen || !mobileInput) return;
    const mobileInputText = (mobileInput.textContent ?? "").replace(
      /\u200b/g,
      "",
    );
    const shouldResetEmptyMobileDom =
      userInput.length === 0 &&
      (mobileInputText.length > 0 ||
        mobileInput.childNodes.length !== 1 ||
        mobileInput.firstChild !== mobileInputEndRef.current ||
        !mobileInputEndRef.current?.isConnected);
    if (mobileInputText === userInput && !shouldResetEmptyMobileDom) return;

    resetMobileInputDom(userInput);
    if (document.activeElement === mobileInput) {
      syncMobileInputHeight(userInput);
      if (mobileInputHasText) {
        scheduleScrollMobileInputToBottom();
      } else {
        scheduleResetMobileInputViewportToStart();
      }
    } else {
      scheduleResetMobileInputViewportToStart();
    }
    if (document.activeElement === mobileInput) {
      moveInputCursorToEnd();
      if (mobileInputHasText) {
        scheduleScrollMobileInputToBottom();
      } else {
        scheduleResetMobileInputViewportToStart();
      }
    }
  }, [
    mobileInputHasText,
    isMobileScreen,
    moveInputCursorToEnd,
    resetMobileInputDom,
    syncMobileInputHeight,
    scheduleResetMobileInputViewportToStart,
    scheduleScrollMobileInputToBottom,
    userInput,
  ]);

  useEffect(() => {
    if (isMobileScreen && !isMobileInputFocused && !mobileInputHasText) {
      resetMobileInputBlurLayout();
    }
  }, [
    isMobileInputFocused,
    isMobileScreen,
    mobileInputHasText,
    resetMobileInputViewportToStart,
    resetMobileInputBlurLayout,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const rafId = window.requestAnimationFrame(() => {
      updateInputScrollIndicator(false);
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [
    totalComposerAttachmentCount,
    isMobileInputFocused,
    isMobileScreen,
    updateInputScrollIndicator,
    userInput,
  ]);

  useEffect(() => {
    if (
      !isMobileScreen ||
      !isMobileInputFocused ||
      !mobileInputHasText ||
      !hasComposerAttachments
    ) {
      return;
    }

    const run = () => {
      updateMobileInputMeasuredHeight();
      scheduleMoveInputCursorToEnd();
      scheduleScrollMobileInputToBottom();
    };

    const timers = [
      window.setTimeout(run, 0),
      window.setTimeout(run, 80),
      window.setTimeout(run, 180),
      window.setTimeout(run, 320),
    ];
    const rafId = window.requestAnimationFrame(run);

    return () => {
      window.cancelAnimationFrame(rafId);
      timers.forEach(window.clearTimeout);
    };
  }, [
    hasComposerAttachments,
    isMobileInputFocused,
    isMobileScreen,
    mobileInputHasText,
    scheduleMoveInputCursorToEnd,
    scheduleScrollMobileInputToBottom,
    updateMobileInputMeasuredHeight,
  ]);

  useEffect(() => {
    const mobileInput = mobileInputRef.current;
    if (!isMobileScreen || !isMobileInputFocused || !mobileInput) {
      mobileInputTouchYRef.current = null;
      mobileInputTouchTimeRef.current = null;
      stopMobileInputInertiaScroll();
      return;
    }

    const onTouchStart = (event: TouchEvent) => {
      if (!mobileInput.contains(event.target as Node)) return;
      stopMobileInputInertiaScroll();
      mobileInputTouchYRef.current = event.touches[0]?.clientY ?? null;
      mobileInputTouchTimeRef.current = event.timeStamp;
      mobileInputTouchVelocityRef.current = 0;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!mobileInput.contains(event.target as Node)) return;
      const currentY = event.touches[0]?.clientY;
      const lastY = mobileInputTouchYRef.current;
      const lastTime = mobileInputTouchTimeRef.current;
      if (currentY == null || lastY == null || lastTime == null) return;

      const deltaY = lastY - currentY;
      const deltaTime = Math.max(1, event.timeStamp - lastTime);
      const maxScrollTop = Math.max(
        0,
        mobileInput.scrollHeight - mobileInput.clientHeight,
      );
      if (maxScrollTop <= 0) {
        mobileInputTouchYRef.current = currentY;
        mobileInputTouchTimeRef.current = event.timeStamp;
        mobileInputTouchVelocityRef.current = 0;
        return;
      }

      const nextScrollTop = Math.min(
        maxScrollTop,
        Math.max(0, mobileInput.scrollTop + deltaY),
      );
      const appliedDelta = nextScrollTop - mobileInput.scrollTop;

      // 到达边界后也继续拦截默认触摸行为，避免 contentEditable 在 iOS 上把手势误判成点击，
      // 触发光标跳转并把视口滚回文本末尾。
      event.preventDefault();
      event.stopPropagation();

      mobileInputTouchYRef.current = currentY;
      mobileInputTouchTimeRef.current = event.timeStamp;
      if (Math.abs(appliedDelta) < 0.1) {
        mobileInputTouchVelocityRef.current = 0;
        return;
      }

      mobileInput.scrollTop = nextScrollTop;
      mobileInputTouchVelocityRef.current =
        mobileInputTouchVelocityRef.current * 0.4 +
        (appliedDelta / deltaTime) * 0.6;
      showInputScrollIndicator();
    };

    const onTouchEnd = () => {
      mobileInputTouchYRef.current = null;
      mobileInputTouchTimeRef.current = null;
      startMobileInputInertiaScroll();
    };

    document.addEventListener("touchstart", onTouchStart, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchmove", onTouchMove, {
      capture: true,
      passive: false,
    });
    document.addEventListener("touchend", onTouchEnd, { capture: true });
    document.addEventListener("touchcancel", onTouchEnd, { capture: true });

    return () => {
      document.removeEventListener("touchstart", onTouchStart, {
        capture: true,
      });
      document.removeEventListener("touchmove", onTouchMove, {
        capture: true,
      });
      document.removeEventListener("touchend", onTouchEnd, { capture: true });
      document.removeEventListener("touchcancel", onTouchEnd, {
        capture: true,
      });
      mobileInputTouchYRef.current = null;
      mobileInputTouchTimeRef.current = null;
      stopMobileInputInertiaScroll();
    };
  }, [
    isMobileInputFocused,
    isMobileScreen,
    showInputScrollIndicator,
    startMobileInputInertiaScroll,
    stopMobileInputInertiaScroll,
  ]);

  const syncMobileKeyboardViewport = useCallback(() => {
    if (!isMobileScreen || typeof window === "undefined") return;

    // 先复位文档滚动，再读取视口偏移，保证变量反映复位后的真实可视视口，减少首次聚焦时的跳动
    resetMobileDocumentScroll();

    const viewport = window.visualViewport;
    const visualHeight = Math.floor(viewport?.height ?? window.innerHeight);
    // iOS 键盘弹出时常把可视视口整体下移（offsetTop>0），而固定面板锚定在布局视口 top:0，
    // 导致面板底部够不到可视区底部，下方露出 .container 的白色背景。用 offsetTop 让面板顶部
    // 跟随可视视口，彻底消除空白；offsetTop 为 0 时等价于原行为。
    const visualTop = Math.max(0, Math.floor(viewport?.offsetTop ?? 0));
    document.documentElement.style.setProperty(
      "--chat-mobile-visual-height",
      `${Math.max(320, visualHeight)}px`,
    );
    document.documentElement.style.setProperty(
      "--chat-mobile-visual-top",
      `${visualTop}px`,
    );

    const layoutViewportHeight = Math.max(
      window.innerHeight,
      document.documentElement.clientHeight,
      visualHeight + visualTop,
    );
    const keyboardObscuredHeight = Math.max(
      0,
      Math.floor(layoutViewportHeight - visualHeight - visualTop),
    );
    if (isMobileInputFocused) {
      if (keyboardObscuredHeight > 140) {
        mobileKeyboardOpenedSinceFocusRef.current = true;
      } else if (
        mobileKeyboardOpenedSinceFocusRef.current &&
        keyboardObscuredHeight < 80 &&
        visualTop === 0
      ) {
        finalizeMobileInputBlur(true);
        return;
      }
    }
    const isViewportMeasurementUsable =
      !isIOSMobile ||
      visualHeight >= Math.max(180, Math.round(layoutViewportHeight * 0.28));
    const stableMetrics = mobileKeyboardStableMetricsRef.current;
    const shouldLockToStableMetrics =
      isIOSMobile &&
      !!stableMetrics &&
      Math.abs(visualHeight - stableMetrics.visualHeight) <= 18;
    const screenShortSide = Math.min(window.screen.width, window.screen.height);
    let dynamicAccessoryInset =
      isIOSMobile && isViewportMeasurementUsable && keyboardObscuredHeight > 140
        ? Math.max(
            40,
            Math.min(
              Math.round(keyboardObscuredHeight * 0.11),
              Math.max(48, Math.round(screenShortSide * 0.14)),
            ),
          )
        : 0;
    if (shouldLockToStableMetrics) {
      dynamicAccessoryInset = stableMetrics.accessoryInset;
    }
    document.documentElement.style.setProperty(
      "--chat-keyboard-accessory-inset",
      `${dynamicAccessoryInset}px`,
    );
    const keyboardBottomGap =
      !isIOSMobile && keyboardObscuredHeight > 140 ? 24 : 0;
    document.documentElement.style.setProperty(
      "--chat-keyboard-bottom-gap",
      `${keyboardBottomGap}px`,
    );

    // 实测输入面板上端位置，计算从工具栏下方一直撑到底部辅助栏上方的填充高度。
    // 不依赖多层 flex-grow（DOM 嵌套较深易失效），直接给输入框一个确定的高度。
    const rootEl = chatRootRef.current;
    const innerEl = chatInputInnerRef.current;
    const panelEl = inputPanelRef.current;
    if (
      isMobileInputFocused &&
      rootEl &&
      innerEl &&
      isViewportMeasurementUsable
    ) {
      const rootRect = rootEl.getBoundingClientRect();
      const headerEl = rootEl.querySelector(
        ".window-header",
      ) as HTMLElement | null;
      const headerBottomInRoot = headerEl
        ? headerEl.getBoundingClientRect().bottom - rootRect.top
        : 0;
      const maxTopGapFromHeader = 24;
      let fill = Math.max(
        180,
        Math.floor(visualHeight - headerBottomInRoot - maxTopGapFromHeader - 2),
      );
      if (shouldLockToStableMetrics) {
        fill = stableMetrics.fillHeight;
      }
      document.documentElement.style.setProperty(
        "--chat-input-fill-height",
        `${fill}px`,
      );

      if (isIOSMobile && panelEl) {
        const panelRect = panelEl.getBoundingClientRect();
        const panelBottomInRoot = panelRect.bottom - rootRect.top;
        const visibleBottomInRoot = visualHeight;
        const measuredBottomGap = visibleBottomInRoot - panelBottomInRoot;
        const targetBottomGap = dynamicAccessoryInset > 0 ? 6 : 2;
        let bottomGapCorrection = Math.max(
          -dynamicAccessoryInset,
          Math.min(120, Math.ceil(targetBottomGap - measuredBottomGap)),
        );
        if (shouldLockToStableMetrics) {
          bottomGapCorrection = stableMetrics.overlapCorrection;
        }
        document.documentElement.style.setProperty(
          "--chat-keyboard-overlap-correction",
          `${bottomGapCorrection}px`,
        );
        mobileKeyboardStableMetricsRef.current = {
          visualHeight,
          accessoryInset: dynamicAccessoryInset,
          overlapCorrection: bottomGapCorrection,
          fillHeight: fill,
        };
        console.debug("[chat-mobile-keyboard]", {
          device: `${window.screen.width}x${window.screen.height}`,
          visualHeight,
          visualTop,
          layoutViewportHeight,
          isViewportMeasurementUsable,
          shouldLockToStableMetrics,
          keyboardObscuredHeight,
          dynamicAccessoryInset,
          headerBottomInRoot,
          maxTopGapFromHeader,
          fill,
          panelBottomInRoot,
          visibleBottomInRoot,
          measuredBottomGap,
          targetBottomGap,
          bottomGapCorrection,
        });
      }
    }

    if (isMobileInputFocused) {
      scheduleMoveInputCursorToEnd();
      if (mobileInputHasText) {
        scheduleScrollMobileInputToBottom();
      }
    }
  }, [
    isMobileScreen,
    isMobileInputFocused,
    isIOSMobile,
    mobileInputHasText,
    resetMobileDocumentScroll,
    scheduleMoveInputCursorToEnd,
    scheduleScrollMobileInputToBottom,
    finalizeMobileInputBlur,
  ]);

  const scheduleMobileKeyboardViewportSync = useCallback(() => {
    if (!isMobileScreen || typeof window === "undefined") return;

    if (mobileViewportRafRef.current !== null) {
      window.cancelAnimationFrame(mobileViewportRafRef.current);
    }

    mobileViewportRafRef.current = window.requestAnimationFrame(() => {
      mobileViewportRafRef.current = null;
      syncMobileKeyboardViewport();
    });
  }, [isMobileScreen, syncMobileKeyboardViewport]);

  const scheduleMobileLatestMessagesIntoView = useCallback(() => {
    if (!isMobileScreen || typeof window === "undefined") return;

    mobileMessageVisibilityTimersRef.current.forEach(window.clearTimeout);
    mobileMessageVisibilityTimersRef.current = [];
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);
    mobileMessageVisibilityTimersRef.current = [0, 80, 180, 320].map((delay) =>
      window.setTimeout(() => {
        const dom = scrollRef.current;
        if (!dom) return;
        programmaticScrollToBottomUntilRef.current = Date.now() + 96;
        const targetTop = Math.max(0, dom.scrollHeight - dom.clientHeight);
        dom.scrollTop = targetTop;
        lastChatBodyScrollTopRef.current = targetTop;
        syncHitBottomFromDom();
      }, delay),
    );
  }, [
    isMobileScreen,
    renderMessages.length,
    scrollRef,
    setMsgRenderIndex,
    syncHitBottomFromDom,
  ]);

  useLayoutEffect(() => {
    if (!isMobileScreen || !isMobileInputFocused) return;
    const mobileInput = mobileInputRef.current;
    if (!mobileInput) return;

    chatInputInnerRef.current?.style.removeProperty(
      "--chat-mobile-input-preserved-height",
    );
    mobileInput.style.removeProperty("--chat-mobile-input-preserved-height");
    mobileInput.style.height = mobileInputHasText ? "auto" : "44px";
    mobileInput.style.maxHeight = "";
    syncMobileInputHeight(userInput);
    scheduleMobileKeyboardViewportSync();
  }, [
    attachImages.length,
    isMobileInputFocused,
    isMobileScreen,
    mobileInputHasText,
    scheduleMobileKeyboardViewportSync,
    syncMobileInputHeight,
    userInput,
  ]);

  useEffect(() => {
    if (!isMobileScreen || !isMobileInputFocused) {
      mobileMessageVisibilityTimersRef.current.forEach(window.clearTimeout);
      mobileMessageVisibilityTimersRef.current = [];
      return;
    }

    scheduleMobileLatestMessagesIntoView();
    return () => {
      mobileMessageVisibilityTimersRef.current.forEach(window.clearTimeout);
      mobileMessageVisibilityTimersRef.current = [];
    };
  }, [
    isMobileInputFocused,
    isMobileScreen,
    safeSession.id,
    scheduleMobileLatestMessagesIntoView,
  ]);

  useEffect(() => {
    const mobileInput = mobileInputRef.current;
    if (!isMobileScreen || !isMobileInputFocused || !mobileInput) return;

    const onPointerDownCapture = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || mobileInput.contains(target)) return;
      if (
        target instanceof Element &&
        (target.closest(`.${styles["chat-input-mobile-actions"]}`) ||
          target.closest(`.${styles["chat-input-send"]}`))
      ) {
        return;
      }
      mobileInputOutsidePointerBlurRef.current = true;
    };

    document.addEventListener("pointerdown", onPointerDownCapture, true);
    return () => {
      mobileInputOutsidePointerBlurRef.current = false;
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
    };
  }, [isMobileInputFocused, isMobileScreen]);

  useEffect(() => {
    if (
      !isMobileScreen ||
      (!isMobileInputFocused && !isMobileKeyboardReleasing) ||
      typeof window === "undefined"
    ) {
      mobileKeyboardStableMetricsRef.current = null;
      document.documentElement.style.removeProperty(
        "--chat-mobile-visual-height",
      );
      document.documentElement.style.removeProperty("--chat-mobile-visual-top");
      document.documentElement.style.removeProperty(
        "--chat-keyboard-accessory-inset",
      );
      document.documentElement.style.removeProperty(
        "--chat-keyboard-overlap-correction",
      );
      document.documentElement.style.removeProperty(
        "--chat-keyboard-panel-lift",
      );
      document.documentElement.style.removeProperty(
        "--chat-keyboard-bottom-gap",
      );
      document.documentElement.style.removeProperty("--chat-input-fill-height");
      cancelMobileKeyboardViewportSync();
      collapseMobileInput(preserveMobileInputBlurHeightRef.current);
      return;
    }

    // iOS 键盘辅助栏高度改为在 sync 中按当前屏幕与视口动态计算；
    // 这里先给默认值，避免首次聚焦前 CSS 变量缺失。
    document.documentElement.style.setProperty(
      "--chat-keyboard-accessory-inset",
      "0px",
    );
    document.documentElement.style.setProperty(
      "--chat-keyboard-overlap-correction",
      "0px",
    );
    document.documentElement.style.setProperty(
      "--chat-keyboard-panel-lift",
      isIOSMobile ? "2px" : "24px",
    );
    document.documentElement.style.setProperty(
      "--chat-keyboard-bottom-gap",
      !isIOSMobile ? "24px" : "0px",
    );

    const viewport = window.visualViewport;
    const sync = () => scheduleMobileKeyboardViewportSync();

    // 首次聚焦时键盘还在动画中，iOS 可能在视口稳定前就停止派发 resize，
    // 导致 --chat-mobile-visual-height 停留在中间值，输入框下方残留空白，
    // 需手动滚动才会触发 scroll 事件重新同步。这里用轮询直到视口高度稳定，
    // 主动补齐键盘完全展开后的最终高度。
    let pollTimer: number | null = null;
    let lastHeight = -1;
    let stableCount = 0;
    let elapsed = 0;
    const POLL_INTERVAL = 80;
    const MAX_POLL_DURATION = 1600;
    const poll = () => {
      const h = Math.floor(window.visualViewport?.height ?? window.innerHeight);
      if (h === lastHeight) {
        stableCount += 1;
      } else {
        stableCount = 0;
        lastHeight = h;
        sync();
      }
      elapsed += POLL_INTERVAL;
      // 连续多次高度不变视为稳定，或超过最长时长后停止轮询
      if (stableCount >= 3 || elapsed >= MAX_POLL_DURATION) {
        sync();
        pollTimer = null;
        return;
      }
      pollTimer = window.setTimeout(poll, POLL_INTERVAL);
    };

    sync();
    pollTimer = window.setTimeout(poll, POLL_INTERVAL);
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);

    return () => {
      mobileKeyboardStableMetricsRef.current = null;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      cancelMobileKeyboardViewportSync();
      document.documentElement.style.removeProperty(
        "--chat-mobile-visual-height",
      );
      document.documentElement.style.removeProperty("--chat-mobile-visual-top");
      document.documentElement.style.removeProperty(
        "--chat-keyboard-accessory-inset",
      );
      document.documentElement.style.removeProperty(
        "--chat-keyboard-overlap-correction",
      );
      document.documentElement.style.removeProperty(
        "--chat-keyboard-panel-lift",
      );
      document.documentElement.style.removeProperty(
        "--chat-keyboard-bottom-gap",
      );
      document.documentElement.style.removeProperty("--chat-input-fill-height");
    };
  }, [
    cancelMobileKeyboardViewportSync,
    isMobileInputFocused,
    isMobileKeyboardReleasing,
    isMobileScreen,
    isIOSMobile,
    collapseMobileInput,
    scheduleMobileKeyboardViewportSync,
  ]);

  useEffect(() => {
    clearCenteredLatestUserMessage();
  }, [clearCenteredLatestUserMessage, safeSession.id]);

  useEffect(() => {
    const lastAssistantMessage = [...sessionMessages]
      .reverse()
      .find((message) => message.role === "assistant");
    const nextSignature = lastAssistantMessage
      ? `${lastAssistantMessage.id}:${
          String(lastAssistantMessage.content).length
        }:${Number(lastAssistantMessage.streaming)}`
      : "";

    if (nextSignature && nextSignature !== lastAssistantSignatureRef.current) {
      if (isAssistantStreaming) {
        const isProgrammaticScrollToBottom =
          Date.now() < programmaticScrollToBottomUntilRef.current;
        if (
          autoScrollEnabledRef.current &&
          !streamingAutoScrollPausedRef.current &&
          !isProgrammaticScrollToBottom
        ) {
          scrollToBottom();
        } else if (isProgrammaticScrollToBottom) {
          setHitBottom(true);
        } else {
          syncHitBottomFromDom();
        }
      } else if (autoScrollEnabled && hitBottom) {
        scrollToBottom();
      } else {
        syncHitBottomFromDom();
      }
    }

    lastAssistantSignatureRef.current = nextSignature;
  }, [
    autoScrollEnabled,
    hitBottom,
    isAssistantStreaming,
    scrollToBottom,
    sessionMessages,
    syncHitBottomFromDom,
  ]);

  // 流式回复状态变化时的处理
  const previousAssistantStreamingRef = useRef(false);

  useEffect(() => {
    const wasAssistantStreaming = previousAssistantStreamingRef.current;
    previousAssistantStreamingRef.current = isAssistantStreaming;

    if (isAssistantStreaming === wasAssistantStreaming) {
      return;
    }

    if (isAssistantStreaming) {
      // 开始流式回复：仅在用户显式开启后，才持续贴住底部。
      clearStreamingScrollResumeTimer();
      if (autoScrollEnabled) {
        userScrollIntentRef.current = false;
        userScrollIntentUntilRef.current = 0;
        streamingAutoScrollPausedRef.current = false;
        setAutoScroll(true);
        scrollToBottom();
      } else {
        streamingAutoScrollPausedRef.current = true;
        setAutoScroll(false);
        syncHitBottomFromDom();
      }
    } else {
      followStreamingAfterScrollButtonRef.current = false;
      clearStreamingScrollResumeTimer();
      userScrollIntentRef.current = false;
      userScrollIntentUntilRef.current = 0;
      streamingAutoScrollPausedRef.current = false;
      // 根据当前是否在底部来决定是否保持自动滚动
      setAutoScroll(autoScrollEnabled && hitBottom);
    }
  }, [
    autoScrollEnabled,
    isAssistantStreaming,
    clearStreamingScrollResumeTimer,
    scrollToBottom,
    syncHitBottomFromDom,
    setAutoScroll,
    hitBottom,
  ]);

  useEffect(
    () => () => {
      clearStreamingScrollResumeTimer();
    },
    [clearStreamingScrollResumeTimer],
  );

  // 统一的打开模型选择器函数
  const openModelSelector = useCallback(() => {
    // 优先使用已切换的 providerId，其次从 session 获取
    const latestProviderId =
      modelSelectorProviderId ||
      resolveModelProviderId(
        allModels,
        sessionMask?.modelConfig,
        apiProfiles,
      ) ||
      String(
        sessionMask?.modelConfig?.providerName || currentProviderName || "",
      ).toLowerCase();

    // 打开选择器时只默认选中当前模型；不再自动选择或补充 OpenAI 最新模型。
    const fallbackDefaultValue = getModelSelectorDefaultValue({
      providerId: latestProviderId,
      currentModel: sessionMask?.modelConfig?.model || currentRawModel,
    });

    modelSelectorOpenStartedAtRef.current = nowMs();
    setModelSelectorProviderId(latestProviderId);
    modelSelectorRequiresSelectionRef.current = false;
    setModelSelectorDefaultValue(fallbackDefaultValue);
    setModelSelectorResetKey((key) => key + 1);
    setShowModelSelector(true);
  }, [
    allModels,
    apiProfiles,
    currentRawModel,
    currentProviderName,
    modelSelectorProviderId,
    sessionMask,
  ]);

  // 切换供应商
  const handleProviderChange = useCallback(
    (profileName: string) => {
      const profile = apiProfiles.find((p) => p.name === profileName);

      if (profile) {
        const selectedProviderId =
          profile.provider === ServiceProvider.Custom
            ? `custom_${profile.name}`.toLowerCase()
            : profile.provider === ServiceProvider.Local
            ? `${String(profile.provider).toLowerCase()}_${
                profile.name
              }`.toLowerCase()
            : String(profile.provider).toLowerCase();

        if (
          selectedProviderId !== "custom_aihubmix" &&
          !isAiHubMixOrderingReady
        ) {
          setModelSelectorNotice(
            "AihubMix 排序基准同步中，请稍后再切换其他供应商",
          );
          if (modelSelectorNoticeTimerRef.current) {
            clearTimeout(modelSelectorNoticeTimerRef.current);
          }
          modelSelectorNoticeTimerRef.current = setTimeout(() => {
            setModelSelectorNotice("");
            modelSelectorNoticeTimerRef.current = null;
          }, 2200);
          return;
        }

        // 移除 rebuildManagedModelsFromCache 调用 - 它会导致卡顿，且不影响供应商切换功能
        // 模型选择器数据来源于 useAppConfig().models，不需要额外处理
        if (modelSelectorItemsCacheRef.current[selectedProviderId]) {
          const next = { ...modelSelectorItemsCacheRef.current };
          delete next[selectedProviderId];
          modelSelectorItemsCacheRef.current = next;
        }

        const {
          addedProviderModels,
          cachedProviderModels,
          initialProviderModels,
        } = collectProviderModelsForProfile(profile as any, "provider-switch");

        const commitProviderSwitch = (
          providerModels: typeof initialProviderModels,
        ) => {
          const switchStartedAt = nowMs();

          // 供应商选中态不依赖后续模型选择，立即反映到顶部按钮和菜单勾选。
          setModelSelectorProviderId(selectedProviderId);

          // 使用 startTransition 批量处理非紧急状态更新，减少重渲染次数
          startTransition(() => {
            setIsProviderSelectorOpen(false);
            modelSelectorRequiresSelectionRef.current = true;
            resetModelSelectorGroupToAll();
            setModelSelectorResetKey((key) => key + 1);
            setModelSelectorDefaultValue("");
          });

          // 紧急更新单独同步执行
          localStorage.setItem(
            MODEL_SELECTOR_PROVIDER_STORAGE_KEY,
            profileName,
          );

          setModelSelectorNotice(`请选择 ${profileName} 的模型`);
          if (modelSelectorNoticeTimerRef.current) {
            clearTimeout(modelSelectorNoticeTimerRef.current);
          }

          console.info("[模型选择器] 供应商列表已切换，等待手动选择模型", {
            配置名称: profileName,
            供应商类型: profile.provider,
            供应商ID: selectedProviderId,
          });

          logPerfSummary("ModelSelector", {
            providerSwitchDurationMs: Number(
              (nowMs() - switchStartedAt).toFixed(2),
            ),
            providerName: profileName,
            providerModelCount: providerModels.length,
          });
        };

        const rebuiltProviderModels = (
          useAppConfig.getState().models || []
        ).filter(
          (model) =>
            model.available &&
            String(model.provider?.id || "").toLowerCase() ===
              selectedProviderId,
        );
        if (addedProviderModels.length > 0) {
          commitProviderSwitch(
            addedProviderModels as typeof initialProviderModels,
          );
          return;
        }

        if (rebuiltProviderModels.length > 0) {
          commitProviderSwitch(
            rebuiltProviderModels as typeof initialProviderModels,
          );
          return;
        }

        if (cachedProviderModels.length > 0) {
          commitProviderSwitch(
            cachedProviderModels as typeof initialProviderModels,
          );
          return;
        }

        // 无模型时直接切换供应商
        commitProviderSwitch([] as typeof initialProviderModels);
      }
    },
    [
      apiProfiles,
      collectProviderModelsForProfile,
      resetModelSelectorGroupToAll,
      isAiHubMixOrderingReady,
    ],
  );

  // clear context index = context length + index in messages
  const clearContextIndex =
    (safeSession.clearContextIndex ?? -1) >= 0
      ? safeSession.clearContextIndex! + context.length - msgRenderIndex
      : -1;

  const hasUserInputContent = userInput.trim().length > 0;
  const autoFocus = !isMobileScreen && !hasUserInputContent; // wont auto focus on mobile screen
  const useHeaderIconOnly = windowWidth < 1000;
  const useCompactInputHint = !isMobileScreen && windowWidth <= 1100;
  const chatInputHint = isChatUnavailableForSync
    ? "正在同步模型配置，输入内容已保留，请稍候..."
    : Locale.Chat.Input(submitKey);
  const mobileChatInputHint = isChatUnavailableForSync
    ? "正在同步模型配置，输入内容已保留，请稍候..."
    : "回车发送，长按回车换行，/ 选择预设提示词，：触发命令";
  const shouldUseCompactInputHint = useCompactInputHint || isInputHintOverflow;

  const enterLoading = hasOnlyEmptyHistoryPlaceholders;

  // 已有本地会话缓存时立即展示正文；模型配置和远端会话在后台更新，
  // 仅限制发送能力，不再用同步加载态遮住已缓存的聊天记录。
  const shouldHideChatMessages = sessionLoading || enterLoading;
  const shouldShowChatRestoreNotice = sessionLoading || enterLoading;
  const shouldShowScrollToBottomButton =
    chatBodyOverflowing &&
    !hitBottom &&
    isFarFromBottom &&
    !shouldShowChatRestoreNotice;

  useLayoutEffect(() => {
    if (shouldHideChatMessages) {
      chatBodyOverflowingStateRef.current = false;
      setChatBodyOverflowing(false);
      return;
    }

    const dom = scrollRef.current;
    if (!dom) return;

    const scheduleSync = () => {
      scheduleScrollMetricsSync(dom);
    };

    scheduleSync();

    const resizeObserver = new ResizeObserver(() => {
      scheduleSync();
    });
    resizeObserver.observe(dom);

    const mutationObserver = new MutationObserver(() => {
      scheduleSync();
    });
    mutationObserver.observe(dom, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    window.addEventListener("resize", scheduleSync);

    return () => {
      window.removeEventListener("resize", scheduleSync);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      if (scrollMetricsRafRef.current !== null) {
        window.cancelAnimationFrame(scrollMetricsRafRef.current);
        scrollMetricsRafRef.current = null;
      }
      pendingScrollMetricsRef.current = null;
    };
  }, [scheduleScrollMetricsSync, shouldHideChatMessages, scrollRef]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (shouldHideChatMessages) return;
    if (!currentSessionHasMessages) return;
    if (sessionMessages.length === 0) return;
    if (initializedBottomSessionRef.current === safeSession.id) return;

    // 消息是异步加载的（hydrateSessionIntoMemory），切换会话瞬间 renderMessages 尚不完整，
    // msgRenderIndex 可能仍停留在旧渲染窗口（例如 0）。必须先把它修正到末尾窗口并等待下一帧
    // 渲染，否则 DOM 中尚无最新消息，即使把 scrollTop 滚到底部也看不到最新内容
    // （表现为打开会话后需要手动点一次"回到底部"才显示最新消息）。
    const targetRenderIndex = Math.max(
      0,
      renderMessages.length - CHAT_PAGE_SIZE,
    );
    if (msgRenderIndex !== targetRenderIndex) {
      setMsgRenderIndex(targetRenderIndex);
      return;
    }

    initializedBottomSessionRef.current = safeSession.id;

    // 渲染窗口已就位、最新消息已渲染到 DOM 后，直接复用"回到底部"按钮的逻辑，
    // 等价于打开会话自动点了一次滚动按钮，保证落到最底部。
    scrollToBottomLikeMobileTitle();

    // Markdown 是动态导入组件，chunk 加载完成前消息先显示省略号（three-dots），
    // 随后才替换成真实文字并撑高内容。仅滚一次会停在"省略号高度"的位置，看起来没到底。
    // 这里挂一个短时守护：内容 DOM 变化时，只要用户没主动上滑，就补滚到最底部，
    // 覆盖省略号 -> 真实文字 的渲染过程。
    const guard = initialBottomGuardRef.current;
    if (guard.observer) guard.observer.disconnect();
    if (guard.timeout !== null) window.clearTimeout(guard.timeout);
    if (guard.raf !== null) window.cancelAnimationFrame(guard.raf);

    const dom = scrollRef.current;
    if (dom) {
      const snapToBottom = () => {
        // 用户已上滑（按钮跟随标记被清除）则不再强制贴底
        if (!followStreamingAfterScrollButtonRef.current) return;
        const target = Math.max(0, dom.scrollHeight - dom.clientHeight);
        if (Math.abs(dom.scrollTop - target) <= 1) return;
        programmaticScrollToBottomUntilRef.current = Date.now() + 96;
        dom.scrollTop = target;
        lastChatBodyScrollTopRef.current = target;
        syncHitBottomFromDom();
      };

      const observer = new MutationObserver(() => {
        if (guard.raf !== null) window.cancelAnimationFrame(guard.raf);
        guard.raf = window.requestAnimationFrame(() => {
          guard.raf = null;
          snapToBottom();
        });
      });
      observer.observe(dom, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      guard.observer = observer;

      // 守护窗口足够覆盖 markdown chunk 加载，超时后自动停止避免长期干预滚动
      guard.timeout = window.setTimeout(() => {
        observer.disconnect();
        guard.observer = null;
        if (guard.raf !== null) {
          window.cancelAnimationFrame(guard.raf);
          guard.raf = null;
        }
        guard.timeout = null;
      }, 2500);
    }
  }, [
    currentSessionHasMessages,
    msgRenderIndex,
    renderMessages.length,
    safeSession.id,
    scrollRef,
    scrollToBottomLikeMobileTitle,
    sessionMessages.length,
    setMsgRenderIndex,
    shouldHideChatMessages,
    syncHitBottomFromDom,
  ]);

  // 切换会话或卸载时，停止上一个会话遗留的"内容撑高补滚"守护，避免资源泄漏与误触发
  useEffect(() => {
    const guard = initialBottomGuardRef.current;
    return () => {
      if (guard.observer) {
        guard.observer.disconnect();
        guard.observer = null;
      }
      if (guard.timeout !== null) {
        window.clearTimeout(guard.timeout);
        guard.timeout = null;
      }
      if (guard.raf !== null) {
        window.cancelAnimationFrame(guard.raf);
        guard.raf = null;
      }
    };
  }, [safeSession.id]);

  useLayoutEffect(() => {
    const pendingCenter = pendingCenterLatestUserMessageRef.current;
    if (!pendingCenter || pendingCenter.sessionId !== safeSession.id) return;
    if (shouldHideChatMessages) return;
    if (sessionMessages.length <= 1) {
      if (!isAssistantStreaming && !isLoading) {
        clearCenteredLatestUserMessage();
      }
      return;
    }

    let latestUserMessageIndex = -1;
    for (let i = sessionMessages.length - 1; i >= 0; i -= 1) {
      if (sessionMessages[i]?.role === "user") {
        latestUserMessageIndex = i;
        break;
      }
    }

    if (latestUserMessageIndex < 0) {
      clearCenteredLatestUserMessage();
      return;
    }

    const targetRenderIndex = Math.max(
      0,
      renderMessages.length - CHAT_PAGE_SIZE,
    );
    if (msgRenderIndex !== targetRenderIndex) {
      setMsgRenderIndex(targetRenderIndex);
    }

    const latestUserMessage = sessionMessages[latestUserMessageIndex];
    const messageKey = getMessageDomKey(
      latestUserMessage,
      latestUserMessageIndex,
    );
    const centerMetrics = getMessageCenterMetrics(messageKey);
    if (!centerMetrics) return;

    // 必须在新消息完成渲染后判断；发送前可能尚未溢出，新增消息后才超出屏幕。
    if (!isMobileScreen && !isScrollDomOverflowing(centerMetrics.dom)) {
      if (!isAssistantStreaming && !isLoading) {
        clearCenteredLatestUserMessage();
      }
      return;
    }

    if (
      Math.abs(
        centerMetrics.requiredBottomSpacer -
          centeredLatestUserMessageSpacerHeight,
      ) > 1
    ) {
      setCenteredLatestUserMessageSpacerHeight(
        centerMetrics.requiredBottomSpacer,
      );
      return;
    }

    pendingCenterLatestUserMessageRef.current = null;
    setCenteredLatestUserMessageKey(messageKey);
    followStreamingAfterScrollButtonRef.current = false;
    streamingAutoScrollPausedRef.current = true;
    programmaticScrollToBottomUntilRef.current = Date.now() + 32;
    centerMetrics.dom.scrollTop = centerMetrics.targetTop;
    lastChatBodyScrollTopRef.current = centerMetrics.targetTop;
    setAutoScrollEnabled(false);
    setAutoScroll(false);
    setHitBottom(isScrollDomHitBottom(centerMetrics.dom));
    setChatBodyOverflowing(isScrollDomOverflowing(centerMetrics.dom));
  }, [
    centeredLatestUserMessageSpacerHeight,
    clearCenteredLatestUserMessage,
    getMessageCenterMetrics,
    getMessageDomKey,
    isScrollDomHitBottom,
    isScrollDomOverflowing,
    isAssistantStreaming,
    isLoading,
    isMobileScreen,
    msgRenderIndex,
    renderMessages.length,
    safeSession.id,
    sessionMessages,
    setAutoScroll,
    setMsgRenderIndex,
    shouldHideChatMessages,
  ]);

  useLayoutEffect(() => {
    if (!centeredLatestUserMessageKey) return;
    if (shouldHideChatMessages) return;

    // 移动端将当前回合的布局空间保持到用户显式点击“回到底部”。
    // 不在流式结束或触摸时回收，避免 scrollHeight 突变导致跳转。
    if (isMobileScreen) return;

    // 首次定位完成后冻结 spacer。流式正文每增加一行都会减少等量的
    // requiredBottomSpacer；若在输出期间持续同步这个高度，正文和 spacer
    // 会在临界一屏附近交替触发布局，移动端表现为整页抖动。
    if (isAssistantStreaming) return;

    const centerMetrics = getMessageCenterMetrics(centeredLatestUserMessageKey);
    if (!centerMetrics) {
      setCenteredLatestUserMessageSpacerHeight(0);
      return;
    }

    if (
      Math.abs(
        centerMetrics.requiredBottomSpacer -
          centeredLatestUserMessageSpacerHeight,
      ) > 1
    ) {
      setCenteredLatestUserMessageSpacerHeight(
        centerMetrics.requiredBottomSpacer,
      );
      return;
    }

    // 只用 spacer 维持首次定位，不在流式换行时反复改写 scrollTop。
    // 服务器端分片较慢时，每次 Markdown 高度变化都会触发绝对回中，
    // 与手机原生滚动和用户触摸争抢 scrollTop，表现为换行抖动或偶发跳转。
  }, [
    centeredLatestUserMessageKey,
    centeredLatestUserMessageSpacerHeight,
    getMessageCenterMetrics,
    isAssistantStreaming,
    isMobileScreen,
    sessionMessages,
    shouldHideChatMessages,
  ]);

  const [inputPanelHeight, setInputPanelHeight] = useState<number>(100);
  useLayoutEffect(() => {
    const el = inputPanelRef.current;
    if (!el || typeof window === "undefined") return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (!Number.isFinite(rect.height) || rect.height <= 0) return;
      setInputPanelHeight(rect.height);
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, [currentSessionHasMessages, isMobileScreen, promptHints.length]);

  const sanitizeBoundaryInput = useCallback(() => {
    const sanitizedInput = sanitizeDraftInputText(userInput ?? "");
    if (sanitizedInput !== userInput) {
      setUserInput(sanitizedInput);
    }
    return sanitizedInput;
  }, [userInput]);

  useLayoutEffect(() => {
    if (isMobileScreen) {
      setIsInputHintOverflow(false);
      return;
    }

    if (userInput) {
      return;
    }

    const placeholder = inputPlaceholderRef.current;
    if (!placeholder) return;

    const measureHintOverflow = () => {
      setIsInputHintOverflow(
        placeholder.scrollWidth > placeholder.clientWidth + 1,
      );
    };

    measureHintOverflow();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measureHintOverflow);
      return () => window.removeEventListener("resize", measureHintOverflow);
    }

    const resizeObserver = new ResizeObserver(measureHintOverflow);
    resizeObserver.observe(placeholder);
    return () => resizeObserver.disconnect();
  }, [
    chatInputHint,
    config.fontFamily,
    inputFontSize,
    isMobileScreen,
    userInput,
    windowWidth,
  ]);

  useCommand({
    fill: setUserInput,
    submit: (text) => {
      doSubmit(text);
    },
    code: (text) => {
      if (accessStore.disableFastLink) return;
      // URL 中的访问码属于敏感信息，不能写入浏览器控制台。
      showConfirm(Locale.URLCommand.Code + `code = ${text}`).then((res) => {
        if (res) {
          accessStore.update((access: any) => (access.accessCode = text));
        }
      });
    },
    settings: (text) => {
      if (accessStore.disableFastLink) return;

      try {
        const payload = JSON.parse(text) as {
          key?: string;
          url?: string;
        };

        // payload 可能包含 API Key；只在确认弹窗中展示，不记录到控制台。

        if (payload.key || payload.url) {
          showConfirm(
            Locale.URLCommand.Settings +
              `\n${JSON.stringify(payload, null, 4)}`,
          ).then((res) => {
            if (!res) return;
            if (payload.key) {
              accessStore.update(
                (access: any) => (access.openaiApiKey = payload.key!),
              );
            }
            if (payload.url) {
              accessStore.update(
                (access: any) => (access.openaiUrl = payload.url!),
              );
            }
            accessStore.update(
              (access: any) => (access.useCustomConfig = true),
            );
          });
        }
      } catch {
        console.error("[Command] failed to parse settings from url");
      }
    },
  });

  // edit / insert message modal
  const [isEditingMessage, setIsEditingMessage] = useState(false);

  useEffect(() => {
    const handler = () => setIsEditingMessage(true);
    window.addEventListener("openEditModal", handler);
    return () => window.removeEventListener("openEditModal", handler);
  }, []);

  // remember unfinished input
  const unfinishedInputKey = useMemo(
    () => UNFINISHED_INPUT(safeSession.id),
    [safeSession.id],
  );
  const unfinishedAttachImagesKey = useMemo(
    () => UNFINISHED_ATTACH_IMAGES(safeSession.id),
    [safeSession.id],
  );
  const restoredInputDraftKeyRef = useRef<string>("");
  const pendingDraftRestoreRef = useRef<{
    input: string;
    sessionId: string;
  } | null>(null);

  useEffect(() => {
    if (!safeSession.id) {
      clearComposerAttachmentDraftCache(safeSession.id);
      return;
    }

    if (attachImages.length === 0 && attachedFiles.length === 0) {
      if (!sessionComposerAttachmentDrafts.has(safeSession.id)) {
        clearComposerAttachmentDraftCache(safeSession.id);
      }
      return;
    }

    const nextDraft = {
      images: attachImages.map((image) => ({ ...image })),
      files: attachedFiles.map((file) => ({ ...file })),
    };
    sessionComposerAttachmentDrafts.set(safeSession.id, nextDraft);
    currentPageComposerAttachmentDraft = nextDraft;
    currentPageComposerAttachmentDraftSessionId = safeSession.id;
  }, [attachImages, attachedFiles, safeSession.id]);

  useEffect(() => {
    if (currentSessionHasMessages) {
      localStorage.removeItem(unfinishedInputKey);
      localStorage.removeItem(unfinishedAttachImagesKey);
      restoredInputDraftKeyRef.current = unfinishedInputKey;
      return;
    }

    if (restoredInputDraftKeyRef.current === unfinishedInputKey) {
      return;
    }
    restoredInputDraftKeyRef.current = unfinishedInputKey;

    const mayBeUnfinishedInput = sanitizeDraftInputText(
      localStorage.getItem(unfinishedInputKey) ||
        localStorage.getItem(ACTIVE_UNFINISHED_INPUT_KEY) ||
        "",
    );
    if (mayBeUnfinishedInput && userInput.length === 0) {
      if (isChatUnavailableForSync) {
        pendingDraftRestoreRef.current = {
          input: mayBeUnfinishedInput,
          sessionId: safeSession.id,
        };
        setUserInput("");
        return;
      }
      setUserInput(mayBeUnfinishedInput);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    clearComposerAttachments,
    currentSessionHasMessages,
    hasComposerAttachments,
    isChatUnavailableForSync,
    safeSession.id,
    unfinishedAttachImagesKey,
    unfinishedInputKey,
  ]);

  useEffect(() => {
    if (!unfinishedInputKey) {
      return;
    }

    if (currentSessionHasMessages) {
      localStorage.removeItem(unfinishedInputKey);
      return;
    }

    if (isChatUnavailableForSync) {
      return;
    }

    const draftValue = sanitizeDraftInputText(userInput ?? "");
    if (draftValue.length > 0) {
      localStorage.setItem(unfinishedInputKey, draftValue);
      localStorage.setItem(ACTIVE_UNFINISHED_INPUT_KEY, draftValue);
      return;
    }

    localStorage.removeItem(unfinishedInputKey);
    localStorage.removeItem(ACTIVE_UNFINISHED_INPUT_KEY);
  }, [
    currentSessionHasMessages,
    isChatUnavailableForSync,
    unfinishedInputKey,
    userInput,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (currentSessionHasMessages) {
      void indexedDbStateStorage.removeRawItem(unfinishedAttachImagesKey);
      void indexedDbStateStorage.removeRawItem(
        ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY,
      );
      localStorage.removeItem(unfinishedAttachImagesKey);
      localStorage.removeItem(ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY);
      return;
    }

    void (async () => {
      await Promise.all([
        indexedDbStateStorage.removeRawItem(unfinishedAttachImagesKey),
        indexedDbStateStorage.removeRawItem(
          ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY,
        ),
      ]);
      localStorage.removeItem(unfinishedAttachImagesKey);
      localStorage.removeItem(ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY);
      if (cancelled) return;

      const restoredDraft = sessionComposerAttachmentDrafts.get(safeSession.id);

      if (isChatUnavailableForSync) {
        if (composerSnapshotRef.current.hasComposerAttachments) {
          return;
        }
        setAttachImages([]);
        setAttachedFiles([]);
        return;
      }

      if (composerSnapshotRef.current.hasComposerAttachments) {
        return;
      }
      if (!restoredDraft) {
        setAttachImages([]);
        setAttachedFiles([]);
        return;
      }
      const nextImages = restoredDraft.images.map((image) => ({ ...image }));
      const nextFiles = restoredDraft.files.map((file) => ({ ...file }));
      sessionComposerAttachmentDrafts.set(safeSession.id, {
        images: nextImages,
        files: nextFiles,
      });
      setAttachImages(nextImages);
      setAttachedFiles(mergeComposerAttachedFiles([], nextFiles));
    })();

    return () => {
      cancelled = true;
    };
  }, [
    clearComposerAttachments,
    currentSessionHasMessages,
    isChatUnavailableForSync,
    safeSession.id,
    unfinishedAttachImagesKey,
  ]);

  useEffect(() => {
    if (isChatUnavailableForSync) {
      return;
    }

    const pendingDraft = pendingDraftRestoreRef.current;
    if (!pendingDraft || pendingDraft.sessionId !== safeSession.id) {
      return;
    }

    pendingDraftRestoreRef.current = null;
    if (pendingDraft.input) {
      setUserInput(pendingDraft.input);
    }

    if (!pendingDraft.input.trim()) {
      window.requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
      });
    }
  }, [isChatUnavailableForSync, safeSession.id]);

  const handlePaste = useCallback(
    async (
      event: React.ClipboardEvent<HTMLTextAreaElement | HTMLDivElement>,
    ) => {
      const inputEl = event.currentTarget;
      const textarea =
        inputEl instanceof HTMLTextAreaElement ? inputEl : undefined;
      const text = event.clipboardData.getData("text/plain");
      const html = event.clipboardData.getData("text/html");
      const pastedFiles: File[] = [];
      const imageUrlsFromHtml: string[] = [];
      const clipboardItems = Array.from(event.clipboardData.items);
      const clipboardFiles = Array.from(event.clipboardData.files);
      let hasUnsupportedDirectoryItem = false;
      const isLikelyDirectoryPlaceholder = (file: File) =>
        file.size === 0 &&
        !file.type &&
        !/\.[^./\\]+$/.test(String(file.name || "").trim());
      const isImageFile = (file: File) =>
        file.type.startsWith("image/") ||
        /\.(png|jpe?g|webp|gif|heic|heif|bmp|avif)$/i.test(file.name);
      const appendClipboardFile = (file: File) => {
        const duplicated = pastedFiles.some(
          (item) =>
            item.name === file.name &&
            item.size === file.size &&
            item.type === file.type &&
            item.lastModified === file.lastModified,
        );
        if (!duplicated) pastedFiles.push(file);
      };
      const appendImageBlob = (blob: Blob, type: string) => {
        if (!type.startsWith("image/")) return;
        const ext = type.split("/")[1] || "png";
        appendClipboardFile(new File([blob], `clipboard.${ext}`, { type }));
      };

      for (const file of clipboardFiles) {
        if (isLikelyDirectoryPlaceholder(file)) {
          hasUnsupportedDirectoryItem = true;
          continue;
        }
        appendClipboardFile(file);
      }

      for (const item of clipboardItems) {
        if (item.kind !== "file") continue;
        const entry = (
          item as DataTransferItem & {
            webkitGetAsEntry?: () => FileSystemEntry | null;
          }
        ).webkitGetAsEntry?.();
        if (entry?.isDirectory) {
          hasUnsupportedDirectoryItem = true;
          continue;
        }
        const file = item.getAsFile();
        if (file && isLikelyDirectoryPlaceholder(file)) {
          hasUnsupportedDirectoryItem = true;
          continue;
        }
        if (file) appendClipboardFile(file);
      }

      if (html) {
        try {
          const doc = new DOMParser().parseFromString(html, "text/html");
          doc.querySelectorAll("img[src]").forEach((img) => {
            const src = img.getAttribute("src")?.trim();
            if (src && !imageUrlsFromHtml.includes(src)) {
              imageUrlsFromHtml.push(src);
            }
          });
        } catch {
          // 非标准 HTML 剪贴板内容，忽略图片恢复。
        }
      }

      const hasFileLikeClipboardData =
        clipboardFiles.length > 0 ||
        clipboardItems.some((item) => item.kind === "file");

      if (
        pastedFiles.length > 0 ||
        imageUrlsFromHtml.length > 0 ||
        hasFileLikeClipboardData ||
        text
      ) {
        event.preventDefault();
      }

      if (pastedFiles.length === 0 && navigator.clipboard?.read) {
        try {
          const clipboardItems = await navigator.clipboard.read();
          for (const item of clipboardItems) {
            for (const type of item.types) {
              if (type.startsWith("image/")) {
                const blob = await item.getType(type);
                if (blob) {
                  appendImageBlob(blob, type);
                }
              }
            }
          }
        } catch {
          // navigator.clipboard.read() 需要用户授权或 HTTPS，静默失败
        }
      }

      const hasImages =
        pastedFiles.some((file) => isImageFile(file)) ||
        imageUrlsFromHtml.length > 0;

      if (text && !hasImages && !hasFileLikeClipboardData) {
        if (textarea) {
          const start = textarea.selectionStart ?? userInput.length;
          const end = textarea.selectionEnd ?? userInput.length;
          setUserInput((input) => {
            const before = input.substring(0, start);
            const after = input.substring(end);
            return before + text + after;
          });
          requestAnimationFrame(() => {
            textarea.selectionStart = textarea.selectionEnd =
              start + text.length;
          });
        } else {
          document.execCommand("insertText", false, text);
          const nextText = (inputEl.textContent ?? "").replace(/\u200b/g, "");
          onInput(nextText);
        }
      }

      if (hasUnsupportedDirectoryItem) {
        showAttachLimitHint("不支持文件夹上传，请选择具体文件");
        return;
      }

      if (pastedFiles.length > 0) {
        try {
          await uploadFilesToComposer(pastedFiles);
        } catch {
          showAttachLimitHint("文件粘贴失败，请重试");
        }
      }

      if (imageUrlsFromHtml.length > 0) {
        setAttachImages((prev) => {
          const availableSlots = Math.max(
            0,
            MAX_ATTACH_IMAGES - (prev.length + attachedFiles.length),
          );
          return mergeComposerAttachedImages(
            prev,
            imageUrlsFromHtml.map((url) => createComposerAttachedImage(url)),
          ).slice(0, prev.length + availableSlots);
        });
      }
    },
    [
      attachedFiles.length,
      onInput,
      showAttachLimitHint,
      uploadFilesToComposer,
      userInput,
    ],
  );

  async function uploadImage() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept =
      "image/png, image/jpeg, image/webp, image/heic, image/heif";
    fileInput.multiple = true;
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);
    const cleanupFileInput = () => {
      if (fileInput.isConnected) {
        document.body.removeChild(fileInput);
      }
    };

    fileInput.onchange = async (event: Event) => {
      const target = event.target as HTMLInputElement;
      const files = Array.from(target.files ?? []);
      if (files.length === 0) {
        cleanupFileInput();
        return;
      }

      try {
        const shouldPreserveBlurHeight =
          isMobileScreen && !isMobileInputFocused && mobileInputHasText;
        await uploadFilesToComposer(files);
        if (shouldPreserveBlurHeight) {
          requestAnimationFrame(() => {
            const shouldPreserveExpandedHeight = prepareMobileInputBlurLayout();
            collapseMobileInput(shouldPreserveExpandedHeight);
          });
        }
      } catch {
        showAttachLimitHint("文件上传失败，请重试");
      } finally {
        cleanupFileInput();
      }
    };
    fileInput.oncancel = cleanupFileInput;

    fileInput.click();
  }

  // 快捷键 shortcut keys
  const [showShortcutKeyModal, setShowShortcutKeyModal] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 打开新聊天 command + shift + o
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "o"
      ) {
        event.preventDefault();
        setTimeout(() => navigate(Path.NewChat), 10);
      }
      // 聚焦聊天输入 shift + esc
      else if (event.shiftKey && event.key.toLowerCase() === "escape") {
        event.preventDefault();
        inputRef.current?.focus();
      }
      // 复制最后一个代码块 command + shift + ;
      else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.code === "Semicolon"
      ) {
        event.preventDefault();
        const copyCodeButton =
          document.querySelectorAll<HTMLElement>(".copy-code-button");
        if (copyCodeButton.length > 0) {
          copyCodeButton[copyCodeButton.length - 1].click();
        }
      }
      // 复制最后一个回复 command + shift + c
      else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        const lastNonUserMessage = messages
          .filter((message) => message.role !== "user")
          .pop();
        if (lastNonUserMessage) {
          const lastMessageContent = getMessageTextContent(lastNonUserMessage);
          void copyToClipboard(lastMessageContent, { silent: true }).then(
            showCopyNotice,
          );
        }
      }
      // 展示快捷键 command + /
      else if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        setShowShortcutKeyModal(true);
      }
      // 清除上下文 command + shift + backspace
      else if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "backspace"
      ) {
        event.preventDefault();
        chatStore.updateTargetSession(session, (session) => {
          if (session.clearContextIndex === session.messages.length) {
            session.clearContextIndex = undefined;
          } else {
            session.clearContextIndex = session.messages.length;
            session.memoryPrompt = ""; // will clear memory
          }
        });
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [messages, chatStore, navigate, session, showCopyNotice]);

  const [showChatSidePanel, setShowChatSidePanel] = useState(false);

  useEffect(() => {
    if (
      isMobileScreen ||
      isChatUnavailableForSync ||
      !safeSession.id ||
      syncReadyFocusSessionRef.current === safeSession.id ||
      hasUserInputContent
    ) {
      return;
    }

    syncReadyFocusSessionRef.current = safeSession.id;
    const timer = window.setTimeout(() => {
      if (inputRef.current?.value.trim()) {
        return;
      }
      inputRef.current?.focus({ preventScroll: true });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [
    hasUserInputContent,
    isChatUnavailableForSync,
    isMobileScreen,
    safeSession.id,
  ]);

  if (!session) {
    return null;
  }

  return (
    <>
      <div
        ref={chatRootRef}
        className={clsx(styles.chat, {
          [styles["chat-mobile-keyboard-open"]]:
            isMobileScreen &&
            (isMobileInputFocused || isMobileKeyboardReleasing),
        })}
        data-top-notice-anchor="true"
        data-mobile-input-empty={
          isMobileScreen && userInput.trim().length === 0 ? "true" : undefined
        }
        data-mobile-input-preserved={
          isMobileScreen && preserveMobileInputBlurHeight ? "true" : undefined
        }
        key={safeSession.id}
      >
        <div className="window-header">
          {isMobileScreen && location.pathname !== Path.Home && (
            <div className="window-actions">
              <div
                className={clsx(
                  "window-action-button",
                  styles["chat-window-action-button"],
                )}
              >
                <IconButton
                  icon={<ReturnIcon />}
                  title={Locale.Chat.Actions.ChatList}
                  onClick={() => {
                    console.clear();
                    navigate(Path.Home);
                  }}
                />
              </div>
            </div>
          )}

          <div
            className={clsx("window-header-title", styles["chat-body-title"])}
            data-tauri-drag-region={isMobileScreen ? undefined : true}
            onClick={scrollToTopOnMobile}
          >
            <div
              className={clsx(
                "window-header-main-title",
                styles["chat-body-main-title"],
              )}
            >
              {!safeSession.topic ? DEFAULT_TOPIC : safeSession.topic}
            </div>
            <div className="window-header-sub-title">
              {Locale.Chat.SubTitle(sessionMessages.length)}
            </div>
          </div>
          <div
            className={clsx("window-actions", styles["chat-window-actions"])}
          >
            <div
              className={clsx(
                "window-action-button",
                styles["chat-window-action-button"],
              )}
            >
              <IconButton
                icon={<RobotIcon />}
                text={useHeaderIconOnly ? undefined : modelSelectorButtonText}
                title={modelSelectorButtonTitle}
                aria={modelSelectorButtonTitle}
                onClick={openModelSelector}
                disabled={isChatUnavailableForSync}
              />
            </div>
            <div
              className={clsx(
                "window-action-button",
                styles["chat-window-action-button"],
              )}
              data-chat-prompt-action="true"
            >
              <IconButton
                icon={<PromptIcon />}
                text={
                  useHeaderIconOnly
                    ? undefined
                    : Locale.Chat.InputActions.Prompt
                }
                title={Locale.Chat.InputActions.Prompt}
                aria={Locale.Chat.InputActions.Prompt}
                onClick={togglePromptHints}
                disabled={isChatUnavailableForSync}
              />
            </div>
            {isMobileScreen && (
              <div
                className={clsx(
                  "window-action-button",
                  styles["chat-window-action-button"],
                )}
              >
                <IconButton
                  icon={<UserIcon />}
                  text={
                    useHeaderIconOnly
                      ? undefined
                      : showStatusUserPanel
                      ? "隐藏状态"
                      : "显示状态"
                  }
                  title="显示或隐藏用户状态"
                  aria="显示或隐藏用户状态"
                  onClick={() => {
                    setShowStatusUserPanel((show) => !show);
                  }}
                  disabled={false}
                />
              </div>
            )}
            <div
              className={clsx(
                "window-action-button",
                styles["chat-window-action-button"],
              )}
            >
              <div
                className={styles["chat-backup-menu"]}
                onMouseEnter={
                  isMobileScreen ? undefined : handleBackupMenuEnter
                }
                onMouseLeave={
                  isMobileScreen ? undefined : handleBackupMenuLeave
                }
              >
                <IconButton
                  icon={<ConfigIcon />}
                  text={useHeaderIconOnly ? undefined : "配置管理"}
                  title="配置管理"
                  aria="配置管理"
                  onClick={() => {
                    setShowBackupMenu((visible) => !visible);
                  }}
                  disabled={false}
                />
                {showBackupMenu && (
                  <div
                    className={styles["chat-backup-dropdown"]}
                    onMouseEnter={
                      isMobileScreen ? undefined : handleBackupMenuEnter
                    }
                    onMouseLeave={
                      isMobileScreen ? undefined : handleBackupMenuLeave
                    }
                  >
                    {CHAT_BACKUP_ENTRIES.map((item) => (
                      <button
                        type="button"
                        key={item.path}
                        className={styles["chat-backup-option"]}
                        onClick={() => {
                          setShowBackupMenu(false);
                          navigate(item.path);
                        }}
                      >
                        <span className={styles["chat-backup-option-icon"]}>
                          {item.icon}
                        </span>
                        <span>{item.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div
              className={clsx(
                "window-action-button",
                styles["chat-window-action-button"],
              )}
              style={isMobileScreen ? undefined : { display: "none" }}
            >
              <IconButton
                icon={isMobileScreen ? <AddIcon /> : <ReloadIcon />}
                text={
                  useHeaderIconOnly
                    ? undefined
                    : isMobileScreen
                    ? Locale.Home.NewChat
                    : isRefreshingTitle
                    ? "刷新中"
                    : "刷新标题"
                }
                title={isMobileScreen ? Locale.Home.NewChat : "刷新标题"}
                onTouchStart={(e) => {
                  if (isMobileScreen) return;
                  refreshTouchTriggeredRef.current = true;
                  e.preventDefault();
                  handleSessionRefresh();
                  window.setTimeout(() => {
                    refreshTouchTriggeredRef.current = false;
                  }, 600);
                }}
                onClick={() => {
                  if (isMobileScreen) {
                    navigate(Path.NewChat);
                    return;
                  }
                  if (refreshTouchTriggeredRef.current) {
                    return;
                  }
                  handleSessionRefresh();
                }}
                disabled={
                  !isMobileScreen &&
                  (isRefreshingTitle ||
                    isAssistantStreaming ||
                    !currentSessionHasMessages)
                }
              />
            </div>
            <div
              className={clsx(
                "window-action-button",
                styles["chat-window-action-button"],
              )}
            >
              <IconButton
                icon={<ChatHeaderExportIcon />}
                className={styles["chat-export-action"]}
                text={
                  useHeaderIconOnly ? undefined : Locale.Chat.Actions.Export
                }
                title={Locale.Chat.Actions.Export}
                onClick={() => {
                  if (!currentSessionHasMessages || isChatUnavailableForSync)
                    return;
                  setShowExport(true);
                }}
                disabled={
                  !currentSessionHasMessages || isChatUnavailableForSync
                }
              />
            </div>
          </div>

          <PromptToast
            showToast={!hitBottom}
            onClick={() => setIsEditingMessage(true)}
          />
        </div>
        <div className={styles["chat-main"]}>
          {shouldHideChatMessages ? (
            <div className={styles["chat-main-loading"]}>
              <LoadingView size="splash" className="no-dark" />
            </div>
          ) : (
            <>
              <div className={styles["chat-body-container"]}>
                {showStatusUserPanel && (
                  <div
                    ref={statusPanelRef}
                    className={clsx(styles["chat-status-user-panel"], {
                      [styles["chat-status-user-panel-dimmed"]]:
                        !isMobileScreen && statusPanelOverlapsMessages,
                    })}
                  >
                    {isMobileScreen ? (
                      <div className={styles["chat-status-user-panel-mobile"]}>
                        <div className={styles["chat-panel-model-info"]}>
                          {currentModelName}
                          {!isModelSelectorSyncing && (
                            <>
                              <span className={styles["chat-panel-model-at"]}>
                                @
                              </span>
                              {activeModelSelectorProviderDisplayName}
                            </>
                          )}
                        </div>
                        <UserMenu
                          variant="chat-floating"
                          balanceProfileId={balanceProfileId}
                          balanceProviderName={balanceProviderDisplayName}
                          balanceRefreshSignal={balanceRefreshSignal}
                        />
                      </div>
                    ) : (
                      <>
                        <UserMenu
                          variant="chat-floating"
                          balanceProfileId={balanceProfileId}
                          balanceProviderName={balanceProviderDisplayName}
                          balanceRefreshSignal={balanceRefreshSignal}
                        />
                      </>
                    )}
                  </div>
                )}
                <div
                  className={clsx(styles["chat-body"], {
                    [styles["chat-body-loading"]]: shouldHideChatMessages,
                  })}
                  ref={scrollRef}
                  onScroll={(e) => onChatBodyScroll(e.currentTarget)}
                  onWheel={(e) => {
                    markUserScrollIntent();
                    if (Math.abs(e.deltaY) > 1) {
                      clearCenteredLatestUserMessage();
                      pauseStreamingAutoScrollForUser();
                    }
                  }}
                  onMouseDown={() =>
                    (isMobileScreen
                      ? mobileInputRef.current
                      : inputRef.current
                    )?.blur()
                  }
                  onTouchStart={(e) => {
                    chatBodyTouchStartYRef.current =
                      e.touches[0]?.clientY ?? null;
                    if (isMobileScreen) {
                      const mobileInput = mobileInputRef.current;
                      const shouldDismissMobileKeyboard =
                        isMobileInputFocused ||
                        mobileKeyboardOpenedSinceFocusRef.current ||
                        document.activeElement === mobileInput;
                      if (shouldDismissMobileKeyboard) {
                        mobileInputOutsidePointerBlurRef.current = false;
                        finalizeMobileInputBlur(true);
                        blurMobileKeyboard();
                      }
                    } else {
                      inputRef.current?.blur();
                    }
                  }}
                  onTouchMove={(e) => {
                    const startY = chatBodyTouchStartYRef.current;
                    const currentY = e.touches[0]?.clientY;
                    if (
                      !chatBodyTouchMovedRef.current &&
                      startY != null &&
                      currentY != null &&
                      Math.abs(currentY - startY) > 3
                    ) {
                      prepareTouchScrollTakeover();
                      chatBodyTouchMovedRef.current = true;
                      markUserScrollIntent();
                      pauseStreamingAutoScrollForUser(6000, false);
                      return;
                    }
                    if (chatBodyTouchMovedRef.current) {
                      markUserScrollIntent();
                    }
                  }}
                  onTouchEnd={() => {
                    finishTouchScrollTakeover();
                  }}
                  onTouchCancel={() => {
                    finishTouchScrollTakeover();
                  }}
                >
                  <>
                    {isMobileScreen &&
                      !currentSessionHasMessages &&
                      !isMobileInputFocused &&
                      promptHints.length === 0 &&
                      (() => {
                        const hints = mobileChatInputHint
                          .replace(/，\//, "\n/")
                          .replace(/, \//, "\n/")
                          .split("\n");
                        return (
                          <div className={styles["chat-input-mobile-hint"]}>
                            {hints.map((line, i) => (
                              <div
                                key={i}
                                className={
                                  styles["chat-input-mobile-hint-line"]
                                }
                              >
                                {line}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    {messages
                      // TODO
                      // .filter((m) => !m.isMcpResponse)
                      .map((message, i) => {
                        const messageDomKey = getMessageDomKey(
                          message,
                          msgRenderIndex + i,
                        );
                        const isUser = message.role === "user";
                        const messageModelName = String(
                          message.model || sessionMask.modelConfig.model || "",
                        );
                        const messageProviderId = String(
                          message.providerId || "",
                        ).toLowerCase();
                        const messageRuntimeModel =
                          messageModelLookup.byProviderAndName.get(
                            `${messageProviderId}\u0000${messageModelName.toLowerCase()}`,
                          ) ||
                          messageModelLookup.byName.get(
                            messageModelName.toLowerCase(),
                          );
                        const messageProviderDisplayName =
                          getMessageProviderDisplayName(message, apiProfiles) ||
                          currentProviderDisplayName;
                        const messageModelGroup = getModelGroup(
                          messageModelName,
                          messageProviderDisplayName || message.providerName,
                          messageRuntimeModel?.vendor?.name,
                          message.modelDisplay,
                        );
                        const messageAvatarModel =
                          messageModelGroup && messageModelGroup !== "Other"
                            ? messageModelGroup
                            : message.modelIcon ||
                              messageProviderDisplayName ||
                              messageModelName;
                        const isContext = i < context.length;
                        const messageTextContent =
                          getMessageTextContent(message);
                        const messageImages = getMessageImages(message);
                        const messageAttachedFiles =
                          message.attachedFiles || [];
                        const isEmptyUserMessage =
                          isUser &&
                          messageTextContent.length === 0 &&
                          messageImages.length === 0 &&
                          messageAttachedFiles.length === 0;
                        const showActions =
                          !message.preview && !isContext && !isEmptyUserMessage;
                        const showTyping =
                          !isUser && (message.preview || message.streaming);
                        const messageUsageText = formatMessageUsage(
                          message.usage,
                        );
                        const shouldStackMessageActions =
                          messageTextContent.trim().length > 12 ||
                          messageImages.length > 0 ||
                          messageAttachedFiles.length > 0 ||
                          editingMessageId === message.id;
                        const shouldInlineMobileActions =
                          isMobileScreen &&
                          (messageImages.length > 0 ||
                            messageAttachedFiles.length > 0 ||
                            (i === firstActionableMessageIndex &&
                              messageImages.length === 0 &&
                              messageTextContent.trim().length > 12));
                        const shouldLeftMobileActions =
                          isMobileScreen &&
                          i === firstActionableMessageIndex &&
                          messageImages.length === 0 &&
                          messageTextContent.trim().length > 0 &&
                          !shouldInlineMobileActions;
                        const uniqueMessageTools = Array.from(
                          new Map(
                            (message.tools || []).map((tool) => [
                              tool.function?.name,
                              tool,
                            ]),
                          ).values(),
                        );
                        const showSearchToolLoading =
                          Boolean(message.streaming) &&
                          uniqueMessageTools.some((tool) =>
                            SEARCH_TOOL_NAME_PATTERN.test(
                              String(tool.function?.name || ""),
                            ),
                          );
                        const messageActions = showActions ? (
                          <div className={styles["chat-input-actions"]}>
                            {message.streaming ? (
                              <ChatAction
                                text={Locale.Chat.Actions.Stop}
                                icon={<StopIcon />}
                                onClick={() =>
                                  onUserStop(String(message.id ?? i))
                                }
                              />
                            ) : editingMessageId === message.id && isUser ? (
                              <>
                                <ChatAction
                                  text={Locale.UI.Confirm}
                                  icon={<ConfirmIcon />}
                                  onClick={() => onEditSave(message)}
                                />
                                <ChatAction
                                  text={Locale.UI.Cancel}
                                  icon={<CancelIcon />}
                                  onClick={onEditCancel}
                                />
                              </>
                            ) : (
                              <>
                                {isUser && !editMobileMessageId && (
                                  <ChatAction
                                    text={Locale.Chat.Actions.Edit}
                                    icon={<RenameIcon />}
                                    onClick={() => {
                                      if (isMobileScreen) {
                                        const nextText =
                                          messageTextContent.trim();
                                        const nextImages = messageImages
                                          .filter(Boolean)
                                          .map((image) =>
                                            createComposerAttachedImage(image),
                                          );
                                        const nextFiles =
                                          mergeComposerAttachedFiles(
                                            [],
                                            messageAttachedFiles.slice(),
                                          );
                                        setEditMobileMessageId(
                                          message.id ?? null,
                                        );
                                        setUserInput(nextText);
                                        setAttachImages(nextImages);
                                        setAttachedFiles(nextFiles);
                                        setPromptHints([]);
                                        resetMobileInputDom(nextText);
                                        syncMobileInputHeight(nextText);
                                        scheduleResetMobileInputViewportToStart();
                                        const focusMobileEditInput = () => {
                                          const mobileInput =
                                            mobileInputRef.current;
                                          if (!mobileInput) return;
                                          mobileInput.focus();
                                          setIsMobileInputFocused(true);
                                          syncMobileInputHeight(nextText);
                                          scheduleMoveInputCursorToEnd();
                                          if (nextText.length > 0) {
                                            scheduleScrollMobileInputToBottom();
                                          }
                                          scheduleMobileKeyboardViewportSync();
                                        };
                                        focusMobileEditInput();
                                        window.requestAnimationFrame(
                                          focusMobileEditInput,
                                        );
                                        window.setTimeout(
                                          focusMobileEditInput,
                                          80,
                                        );
                                      } else {
                                        setEditingMessageId(message.id ?? null);
                                        setEditContent(
                                          messageTextContent.trim(),
                                        );
                                        setPromptHints([]);
                                      }
                                    }}
                                  />
                                )}

                                <ChatAction
                                  text={Locale.Chat.Actions.Retry}
                                  icon={<ResetIcon />}
                                  onClick={() => onResend(message)}
                                />

                                <ChatAction
                                  text={Locale.Chat.Actions.Copy}
                                  icon={<CopyIcon />}
                                  onClick={() => {
                                    void copyMessageToClipboard(message, {
                                      silent: true,
                                    }).then(showCopyNotice);
                                  }}
                                />
                                {config.ttsConfig.enable && (
                                  <ChatAction
                                    text={
                                      speechStatus
                                        ? Locale.Chat.Actions.StopSpeech
                                        : Locale.Chat.Actions.Speech
                                    }
                                    icon={
                                      speechStatus ? (
                                        <SpeakStopIcon />
                                      ) : (
                                        <SpeakIcon />
                                      )
                                    }
                                    onClick={() =>
                                      openaiSpeech(
                                        getMessageTextContent(message),
                                      )
                                    }
                                  />
                                )}
                              </>
                            )}
                          </div>
                        ) : null;

                        const shouldShowClearContextDivider =
                          i === clearContextIndex - 1;

                        return (
                          <Fragment key={messageDomKey}>
                            <div
                              className={
                                isUser
                                  ? styles["chat-message-user"]
                                  : styles["chat-message"]
                              }
                              data-chat-message-dom-key={messageDomKey}
                            >
                              <div className={styles["chat-message-container"]}>
                                <div className={styles["chat-message-header"]}>
                                  <div
                                    className={styles["chat-message-avatar"]}
                                  >
                                    {isUser ? (
                                      <Avatar avatar={FIXED_USER_AVATAR} />
                                    ) : (
                                      <>
                                        {["system"].includes(message.role) ? (
                                          <Avatar avatar="2699-fe0f" />
                                        ) : (
                                          <Avatar
                                            model={
                                              messageAvatarModel as ModelType
                                            }
                                          />
                                        )}
                                      </>
                                    )}
                                  </div>
                                  {!isUser && (
                                    <div className={styles["chat-model-name"]}>
                                      {normalizeModelProviderDisplayLabel(
                                        message.model ||
                                          sessionMask.modelConfig.model,
                                        messageProviderDisplayName,
                                      )}
                                    </div>
                                  )}
                                  {showActions && !isMobileScreen && (
                                    <div
                                      className={clsx(
                                        styles["chat-message-actions"],
                                        styles["chat-message-actions-header"],
                                      )}
                                    >
                                      {messageActions}
                                    </div>
                                  )}
                                </div>

                                {!isUser &&
                                  ((message.retryAttempts?.length || 0) > 0 ||
                                    (message.tools?.length || 0) > 0) && (
                                    <div
                                      className={styles["chat-message-tools"]}
                                      aria-live={
                                        message.retrying ||
                                        (message.streaming &&
                                          uniqueMessageTools.length > 0)
                                          ? "polite"
                                          : "off"
                                      }
                                    >
                                      {message.retryAttempts?.map((attempt) => (
                                        <div
                                          key={`${attempt.attempt}-${attempt.providerId}-${attempt.model}`}
                                          className={clsx(
                                            styles["chat-message-tool"],
                                            styles[
                                              "chat-message-retry-attempt"
                                            ],
                                          )}
                                        >
                                          <span>
                                            &lt;
                                            {attempt.status === "trying"
                                              ? "对话尝试中"
                                              : attempt.status === "success"
                                              ? "对话尝试成功"
                                              : "对话尝试失败"}
                                            &gt;
                                          </span>
                                          <span>
                                            {attempt.provider} / {attempt.model}
                                          </span>
                                        </div>
                                      ))}
                                      {uniqueMessageTools.map((tool) => (
                                        <div
                                          key={tool.id}
                                          title={tool?.errorMsg}
                                          className={
                                            styles["chat-message-tool"]
                                          }
                                        >
                                          {tool.isError === true ? (
                                            <CloseIcon />
                                          ) : (
                                            <span>&lt;插件&gt;</span>
                                          )}
                                          <span>{tool?.function?.name}</span>
                                          {showSearchToolLoading &&
                                            SEARCH_TOOL_NAME_PATTERN.test(
                                              String(tool.function?.name || ""),
                                            ) && (
                                              <span
                                                className={
                                                  styles[
                                                    "chat-message-search-loading"
                                                  ]
                                                }
                                                role="status"
                                                aria-label="搜索中"
                                              >
                                                <LoadingIcon />
                                              </span>
                                            )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                <div
                                  className={clsx(
                                    styles["chat-message-content"],
                                    {
                                      [styles[
                                        "chat-message-content-mobile-actions-left"
                                      ]]: shouldLeftMobileActions,
                                      [styles[
                                        "chat-message-content-mobile-actions-inline"
                                      ]]: shouldInlineMobileActions,
                                      [styles[
                                        "chat-message-content-stack-actions"
                                      ]]: shouldStackMessageActions,
                                      [styles["chat-message-content-editing"]]:
                                        editingMessageId === message.id &&
                                        !isMobileScreen,
                                    },
                                  )}
                                >
                                  <div
                                    className={clsx(
                                      styles["chat-message-item"],
                                      {
                                        [styles[
                                          "chat-message-item-with-images"
                                        ]]: messageImages.length > 0,
                                        [styles[
                                          "chat-message-item-with-attached-files"
                                        ]]: messageAttachedFiles.length > 0,
                                      },
                                    )}
                                    data-chat-message-id={message.id}
                                  >
                                    {showActions &&
                                      isMobileScreen &&
                                      shouldInlineMobileActions && (
                                        <div
                                          className={clsx(
                                            styles["chat-message-actions"],
                                            styles[
                                              "chat-message-actions-inline"
                                            ],
                                            {
                                              [styles[
                                                "chat-message-actions-streaming"
                                              ]]: message.streaming,
                                            },
                                          )}
                                        >
                                          {messageActions}
                                        </div>
                                      )}
                                    {editingMessageId === message.id &&
                                    !isMobileScreen ? (
                                      <textarea
                                        ref={editInputRef}
                                        className={
                                          styles["chat-message-edit-input"]
                                        }
                                        value={editContent}
                                        rows={editInputRows}
                                        onChange={(e) => {
                                          setEditContent(e.target.value);
                                        }}
                                        onKeyDown={(e) => {
                                          if (
                                            e.key === "Enter" &&
                                            !e.shiftKey
                                          ) {
                                            e.preventDefault();
                                            onEditSave(message);
                                          }
                                          if (e.key === "Escape") {
                                            onEditCancel();
                                          }
                                        }}
                                      />
                                    ) : (
                                      <>
                                        {messageAttachedFiles.length > 0 && (
                                          <div
                                            className={
                                              styles[
                                                "chat-message-attached-files"
                                              ]
                                            }
                                          >
                                            {messageImages.map((image, index) =>
                                              renderGeneratedMedia(
                                                image,
                                                styles[
                                                  "chat-message-attached-image"
                                                ],
                                                `image-${index}`,
                                              ),
                                            )}
                                            {messageAttachedFiles.map(
                                              (file) => {
                                                const previewUrl = String(
                                                  file.previewUrl || "",
                                                ).trim();
                                                const cardClassName = clsx(
                                                  styles[
                                                    "chat-message-attached-file"
                                                  ],
                                                  styles[
                                                    `attach-file-${file.typeKind}`
                                                  ],
                                                );

                                                const cardContent = (
                                                  <>
                                                    <div
                                                      className={
                                                        styles[
                                                          "attach-file-icon"
                                                        ]
                                                      }
                                                    >
                                                      <span
                                                        className={
                                                          styles[
                                                            "attach-file-glyph"
                                                          ]
                                                        }
                                                      ></span>
                                                    </div>
                                                    <div
                                                      className={
                                                        styles[
                                                          "chat-message-attached-file-info"
                                                        ]
                                                      }
                                                    >
                                                      <div
                                                        className={
                                                          styles[
                                                            "chat-message-attached-file-name"
                                                          ]
                                                        }
                                                      >
                                                        {file.name}
                                                      </div>
                                                      <div
                                                        className={
                                                          styles[
                                                            "chat-message-attached-file-type"
                                                          ]
                                                        }
                                                      >
                                                        {file.typeLabel} ·{" "}
                                                        {formatAttachmentSize(
                                                          file.size,
                                                        )}
                                                      </div>
                                                    </div>
                                                  </>
                                                );

                                                if (previewUrl) {
                                                  return (
                                                    <button
                                                      key={file.id}
                                                      type="button"
                                                      className={cardClassName}
                                                      onClick={() =>
                                                        openMessageAttachedFilePreview(
                                                          file,
                                                        )
                                                      }
                                                      title={`${file.name}\n${
                                                        file.typeLabel
                                                      } · ${formatAttachmentSize(
                                                        file.size,
                                                      )}`}
                                                    >
                                                      {cardContent}
                                                    </button>
                                                  );
                                                }

                                                return (
                                                  <div
                                                    key={file.id}
                                                    className={cardClassName}
                                                    title={`${file.name}\n${
                                                      file.typeLabel
                                                    } · ${formatAttachmentSize(
                                                      file.size,
                                                    )}`}
                                                  >
                                                    {cardContent}
                                                  </div>
                                                );
                                              },
                                            )}
                                          </div>
                                        )}
                                        <div
                                          className={
                                            styles["chat-message-text"]
                                          }
                                          data-chat-ai-message-text={
                                            !isUser ? "true" : undefined
                                          }
                                          data-chat-message-id={
                                            !isUser ? message.id : undefined
                                          }
                                          onMouseUpCapture={() => {
                                            if (isUser || isMobileScreen)
                                              return;
                                            handleAiMessageTextSelection(
                                              message.id,
                                            );
                                          }}
                                        >
                                          {isUser &&
                                            message.aiSelectionText?.trim() && (
                                              <div
                                                className={
                                                  styles[
                                                    "chat-message-ai-selection-quote"
                                                  ]
                                                }
                                              >
                                                <ReturnIcon
                                                  className={
                                                    styles[
                                                      "chat-message-ai-selection-quote-icon"
                                                    ]
                                                  }
                                                />
                                                <span
                                                  className={
                                                    styles[
                                                      "chat-message-ai-selection-quote-text"
                                                    ]
                                                  }
                                                >
                                                  “{message.aiSelectionText}”
                                                </span>
                                              </div>
                                            )}
                                          <Markdown
                                            key={
                                              message.manualStopped ||
                                              message.refreshInterrupted
                                                ? "stopped"
                                                : message.streaming
                                                ? "loading"
                                                : "done"
                                            }
                                            content={messageTextContent}
                                            loading={
                                              !isUser &&
                                              !message.manualStopped &&
                                              !message.refreshInterrupted &&
                                              !message.isError &&
                                              ((message as any).preview ||
                                                message.streaming) &&
                                              !messageTextContent
                                            }
                                            onDoubleClickCapture={() => {
                                              if (!isMobileScreen || !isUser)
                                                return;
                                              setUserInput(
                                                getMessageTextContent(message),
                                              );
                                            }}
                                            fontSize={fontSize}
                                            fontFamily={fontFamily}
                                            parentRef={scrollRef}
                                            defaultShow={
                                              i >= messages.length - 6
                                            }
                                          />
                                        </div>
                                      </>
                                    )}
                                    {messageAttachedFiles.length === 0 &&
                                      messageImages.length == 1 &&
                                      renderGeneratedMedia(
                                        messageImages[0],
                                        styles["chat-message-item-image"],
                                      )}
                                    {messageAttachedFiles.length === 0 &&
                                      messageImages.length > 1 && (
                                        <div
                                          className={
                                            styles["chat-message-item-images"]
                                          }
                                          style={
                                            {
                                              "--image-count":
                                                messageImages.length,
                                            } as React.CSSProperties
                                          }
                                        >
                                          {messageImages.map((image, index) => {
                                            return renderGeneratedMedia(
                                              image,
                                              styles[
                                                "chat-message-item-image-multi"
                                              ],
                                              index,
                                            );
                                          })}
                                        </div>
                                      )}
                                    {(message.manualStopped ||
                                      message.refreshInterrupted) && (
                                      <div
                                        className={styles["manual-stop-marker"]}
                                      >
                                        {message.refreshInterrupted
                                          ? "【刷新中断】"
                                          : "【手动停止】"}
                                      </div>
                                    )}
                                  </div>
                                  {showActions &&
                                    isMobileScreen &&
                                    !shouldInlineMobileActions && (
                                      <div
                                        className={clsx(
                                          styles["chat-message-actions"],
                                          {
                                            [styles[
                                              "chat-message-actions-streaming"
                                            ]]: message.streaming,
                                          },
                                        )}
                                      >
                                        {messageActions}
                                      </div>
                                    )}
                                </div>
                                {message?.audio_url && (
                                  <div className={styles["chat-message-audio"]}>
                                    <audio src={message.audio_url} controls />
                                  </div>
                                )}

                                <div
                                  className={styles["chat-message-action-date"]}
                                >
                                  {isContext
                                    ? Locale.Chat.IsContext
                                    : formatChinaDateTime(message.date)}
                                </div>
                                {!isContext &&
                                  !isUser &&
                                  !!messageUsageText && (
                                    <div
                                      className={styles["chat-message-usage"]}
                                    >
                                      {messageUsageText}
                                    </div>
                                  )}
                              </div>
                            </div>
                            {shouldShowClearContextDivider && (
                              <ClearContextDivider />
                            )}
                          </Fragment>
                        );
                      })}
                    {centeredLatestUserMessageSpacerHeight > 0 && (
                      <div
                        aria-hidden="true"
                        style={{
                          height: centeredLatestUserMessageSpacerHeight,
                        }}
                      />
                    )}
                  </>
                </div>
                <button
                  type="button"
                  aria-label={Locale.Chat.InputActions.ToBottom}
                  title={Locale.Chat.InputActions.ToBottom}
                  className={clsx(styles["scroll-to-bottom"], {
                    [styles["scroll-to-bottom-visible"]]:
                      shouldShowScrollToBottomButton,
                  })}
                  style={{
                    bottom: `calc(${Math.max(
                      0,
                      Math.round(inputPanelHeight + 10),
                    )}px + env(safe-area-inset-bottom) + var(--chat-keyboard-accessory-inset, 0px) + var(--chat-keyboard-overlap-correction, 0px))`,
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onTouchStart={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={() => {
                    handleScrollToBottomButton();
                  }}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {aiSelectionBubble && (
                  <button
                    type="button"
                    className={clsx(styles["chat-ai-selection-popover"], {
                      [styles["chat-ai-selection-popover-mobile"]]:
                        isMobileScreen,
                    })}
                    style={
                      {
                        left: aiSelectionBubble.left,
                        top: aiSelectionBubble.top,
                      } as React.CSSProperties
                    }
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onTouchStart={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onTouchEnd={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      askAiAboutSelection();
                    }}
                    onClick={askAiAboutSelection}
                  >
                    询问 AI
                  </button>
                )}
                <div
                  ref={inputPanelRef}
                  className={clsx(styles["chat-input-panel"], {
                    [styles["chat-input-panel-empty-desktop"]]:
                      !isMobileScreen && !currentSessionHasMessages,
                    [styles["chat-input-panel-with-prompts"]]:
                      !isMobileScreen && promptHints.length > 0,
                    [styles["chat-input-panel-compact-hint"]]:
                      shouldUseCompactInputHint,
                  })}
                >
                  <PromptHints
                    prompts={promptHints}
                    onPromptSelect={onPromptSelect}
                  />
                  {showPromptPicker && (
                    <PromptPickerModal
                      prompts={pickerPrompts}
                      isLoading={isPromptPickerLoading}
                      onClose={() => {
                        promptPickerLoadAbortRef.current?.abort();
                        promptPickerLoadAbortRef.current = null;
                        setIsPromptPickerLoading(false);
                        setShowPromptPicker(false);
                      }}
                      onManage={openPromptManager}
                      onPromptSelect={onPromptSelect}
                    />
                  )}

                  {!isMobileScreen && !currentSessionHasMessages && (
                    <div
                      className={clsx(styles["chat-input-empty-title"], {
                        [styles["chat-input-empty-title-reserved-hidden"]]:
                          hasComposerAttachments,
                      })}
                    >
                      {getBotHelloContent()}
                    </div>
                  )}

                  {editMobileMessageId && isMobileScreen && (
                    <div className={styles["chat-edit-mode-header"]}>
                      <span>编辑消息</span>
                    </div>
                  )}
                  <div
                    className={styles["chat-input-row"]}
                    style={
                      !isMobileScreen && hasImageOnlyComposerAttachments
                        ? ({
                            ["--chat-attach-strip-visual-height" as any]:
                              "116px",
                          } as React.CSSProperties)
                        : undefined
                    }
                  >
                    {!isMobileScreen &&
                      !currentSessionHasMessages &&
                      hasComposerAttachments && (
                        <div
                          className={clsx(
                            styles["chat-input-empty-title"],
                            styles["chat-input-empty-title-floating"],
                          )}
                        >
                          {getBotHelloContent()}
                        </div>
                      )}
                    {hasComposerAttachments && (
                      <div className={styles["chat-attach-strip"]}>
                        <div
                          className={clsx(styles["attach-images"], {
                            [styles["attach-images-mixed-kinds"]]:
                              hasMixedComposerAttachmentKinds,
                          })}
                        >
                          {attachImages.map((image, index) => {
                            const previewUrl =
                              getComposerAttachedImagePreviewUrl(image);
                            return (
                              <div
                                key={image.id}
                                className={styles["attach-image"]}
                                style={{
                                  backgroundImage: `url("${previewUrl}")`,
                                }}
                                role="button"
                                tabIndex={0}
                                title="点击预览"
                                onClick={() => showImageModal(previewUrl, true)}
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    showImageModal(previewUrl, true);
                                  }
                                }}
                              >
                                <div className={styles["attach-image-mask"]}>
                                  <DeleteImageButton
                                    deleteImage={() =>
                                      void removeAttachedImage(index)
                                    }
                                  />
                                </div>
                              </div>
                            );
                          })}
                          {attachedFiles.map((file) => {
                            return (
                              <div
                                key={file.id}
                                className={clsx(
                                  styles["attach-file"],
                                  styles[`attach-file-${file.typeKind}`],
                                )}
                                title={`${file.name}\n${
                                  file.typeLabel
                                } · ${formatAttachmentSize(file.size)}`}
                                role="button"
                                tabIndex={0}
                                onClick={() =>
                                  openMessageAttachedFilePreview(file)
                                }
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    openMessageAttachedFilePreview(file);
                                  }
                                }}
                              >
                                <div className={styles["attach-file-icon"]}>
                                  <span
                                    className={styles["attach-file-glyph"]}
                                  ></span>
                                </div>
                                <div className={styles["attach-file-info"]}>
                                  <div className={styles["attach-file-name"]}>
                                    {file.name}
                                  </div>
                                  <div className={styles["attach-file-type"]}>
                                    {file.typeLabel} ·{" "}
                                    {formatAttachmentSize(file.size)}
                                  </div>
                                </div>
                                <DeleteImageButton
                                  deleteImage={() =>
                                    void removeAttachedFile(file)
                                  }
                                />
                              </div>
                            );
                          })}
                          {uploadingAttachments.map((attachment) => {
                            if (!attachment.isImage) {
                              return (
                                <div
                                  key={attachment.id}
                                  className={clsx(
                                    styles["attach-file"],
                                    styles[
                                      `attach-file-${attachment.typeKind}`
                                    ],
                                  )}
                                  title={`${attachment.file.name}\n${
                                    attachment.typeLabel
                                  } · ${formatAttachmentSize(
                                    attachment.file.size,
                                  )}`}
                                  role="button"
                                  tabIndex={0}
                                  onClick={showUploadingPreviewHint}
                                  onKeyDown={(event) => {
                                    if (
                                      event.key === "Enter" ||
                                      event.key === " "
                                    ) {
                                      event.preventDefault();
                                      showUploadingPreviewHint();
                                    }
                                  }}
                                >
                                  <div
                                    className={clsx(
                                      styles["attach-file-icon"],
                                      styles["attach-file-icon-uploading"],
                                    )}
                                  >
                                    <span
                                      className={styles["attach-file-glyph"]}
                                    ></span>
                                    <div
                                      className={
                                        styles["attach-file-icon-mask"]
                                      }
                                    >
                                      <span
                                        className={
                                          styles["attachment-upload-spinner"]
                                        }
                                        style={{
                                          ["--upload-progress" as any]:
                                            attachment.progress,
                                        }}
                                      ></span>
                                      <span
                                        className={
                                          styles["attachment-upload-percent"]
                                        }
                                      >
                                        {Math.round(
                                          Math.min(
                                            1,
                                            Math.max(0, attachment.progress),
                                          ) * 100,
                                        )}
                                        %
                                      </span>
                                    </div>
                                  </div>
                                  <div className={styles["attach-file-info"]}>
                                    <div className={styles["attach-file-name"]}>
                                      {attachment.file.name}
                                    </div>
                                    <div className={styles["attach-file-type"]}>
                                      {attachment.phase === "uploading"
                                        ? "上传中"
                                        : "准备上传"}{" "}
                                      {Math.round(
                                        Math.min(
                                          1,
                                          Math.max(0, attachment.progress),
                                        ) * 100,
                                      )}
                                      %
                                    </div>
                                  </div>
                                  <DeleteImageButton
                                    deleteImage={() =>
                                      void cancelUploadingAttachment(attachment)
                                    }
                                  />
                                </div>
                              );
                            }

                            return (
                              <div
                                key={attachment.id}
                                className={styles["attach-image"]}
                                style={{
                                  backgroundImage: `url("${attachment.previewUrl}")`,
                                }}
                                role="button"
                                tabIndex={0}
                                title="文件正在上传，上传完成后再预览"
                                onClick={showUploadingPreviewHint}
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    showUploadingPreviewHint();
                                  }
                                }}
                              >
                                <div className={styles["attach-image-mask"]}>
                                  <DeleteImageButton
                                    deleteImage={() =>
                                      void cancelUploadingAttachment(attachment)
                                    }
                                  />
                                </div>
                                <div
                                  className={
                                    styles["attach-image-uploading-overlay"]
                                  }
                                >
                                  <span
                                    className={
                                      styles["attachment-upload-spinner"]
                                    }
                                    style={{
                                      ["--upload-progress" as any]:
                                        attachment.progress,
                                    }}
                                  ></span>
                                  <span
                                    className={
                                      styles["attachment-upload-percent"]
                                    }
                                  >
                                    {Math.round(
                                      Math.min(
                                        1,
                                        Math.max(0, attachment.progress),
                                      ) * 100,
                                    )}
                                    %
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {isMobileScreen && (
                      <div className={styles["chat-input-mobile-actions"]}>
                        {editMobileMessageId && (
                          <IconButton
                            icon={<LogOutDoorIcon />}
                            className={clsx(
                              styles["chat-input-mobile-add"],
                              styles["chat-edit-mode-exit"],
                            )}
                            style={MOBILE_INPUT_ACTION_BUTTON_STYLE}
                            title="退出编辑"
                            aria="退出编辑模式"
                            disabled={isChatUnavailableForSync}
                            onMouseDown={(e) => e.preventDefault()}
                            onTouchStart={(e) => e.preventDefault()}
                            onClick={exitMobileEditMode}
                          />
                        )}
                        {(userInput.length > 0 || hasComposerAttachments) && (
                          <IconButton
                            icon={<MobileClearIcon />}
                            className={styles["chat-input-mobile-add"]}
                            style={MOBILE_INPUT_ACTION_BUTTON_STYLE}
                            title="清空输入"
                            aria="清空输入"
                            disabled={isChatUnavailableForSync}
                            onMouseDown={(e) => e.preventDefault()}
                            onTouchStart={(e) => e.preventDefault()}
                            onClick={() => {
                              mobileInputOutsidePointerBlurRef.current = false;
                              setPromptHints([]);
                              setUserInput("");
                              setAiSelectionContext(null);
                              clearComposerAttachments();
                              localStorage.removeItem(unfinishedInputKey);
                              localStorage.removeItem(
                                ACTIVE_UNFINISHED_INPUT_KEY,
                              );
                              localStorage.removeItem(
                                unfinishedAttachImagesKey,
                              );
                              localStorage.removeItem(
                                ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY,
                              );
                              if (isMobileScreen && !isMobileInputFocused) {
                                setIsMobileInputFocused(false);
                                cancelMobileKeyboardViewportSync();
                                mobileInputRef.current?.blur();
                              }
                            }}
                          />
                        )}
                        <IconButton
                          icon={<MobileAddIcon />}
                          className={styles["chat-input-mobile-add"]}
                          style={MOBILE_INPUT_ACTION_BUTTON_STYLE}
                          title="添加照片"
                          aria="添加照片"
                          disabled={isChatUnavailableForSync || uploading}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            const shouldPreserveBlurHeight =
                              isMobileScreen && !isMobileInputFocused;
                            if (
                              totalComposerAttachmentCount >= MAX_ATTACH_IMAGES
                            ) {
                              showAttachLimitHint();
                              return;
                            }
                            if (shouldPreserveBlurHeight) {
                              prepareMobileInputBlurLayout();
                            }
                            uploadImage();
                          }}
                        />
                      </div>
                    )}
                    <label
                      ref={chatInputInnerRef}
                      className={clsx(styles["chat-input-panel-inner"], {
                        [styles["chat-input-panel-inner-multiline"]]:
                          !isMobileScreen &&
                          (inputRows > 1 || !!aiSelectionContext),
                        [styles["chat-input-panel-inner-with-ai-selection"]]:
                          !!aiSelectionContext,
                      })}
                      htmlFor="chat-input"
                    >
                      {aiSelectionContext && (
                        <div className={styles["chat-ai-selection-context"]}>
                          <ReturnIcon
                            className={styles["chat-ai-selection-context-icon"]}
                          />
                          <div
                            className={styles["chat-ai-selection-context-text"]}
                          >
                            “{aiSelectionContext.text}”
                          </div>
                          <button
                            type="button"
                            data-close-button="true"
                            className={
                              styles["chat-ai-selection-context-close"]
                            }
                            aria-label="移除选中文本"
                            onMouseDown={(event) => event.preventDefault()}
                            onTouchStart={(event) => event.preventDefault()}
                            onClick={() => setAiSelectionContext(null)}
                          >
                            <CloseIcon />
                          </button>
                        </div>
                      )}
                      {!isMobileScreen && (
                        <span
                          ref={inputPlaceholderRef}
                          className={clsx(styles["chat-input-placeholder"], {
                            [styles["chat-input-placeholder-hidden"]]:
                              shouldUseCompactInputHint ||
                              isChatUnavailableForSync ||
                              !!userInput ||
                              !!aiSelectionContext ||
                              hasComposerAttachments,
                          })}
                          style={{
                            fontSize: inputFontSize,
                            fontFamily: config.fontFamily,
                          }}
                        >
                          {chatInputHint}
                        </span>
                      )}
                      <div className={styles["chat-input-text-wrap"]}>
                        {isMobileScreen ? (
                          <div
                            id="chat-input"
                            ref={mobileInputRef}
                            className={styles["chat-input"]}
                            contentEditable={!isChatUnavailableForSync}
                            suppressContentEditableWarning
                            role="textbox"
                            aria-multiline="true"
                            aria-disabled={isChatUnavailableForSync}
                            onInput={(e) => {
                              if (!mobileInputEndRef.current?.isConnected) {
                                const endMarker =
                                  document.createElement("span");
                                endMarker.textContent = "\u200b";
                                endMarker.setAttribute(
                                  "data-chat-input-end",
                                  "true",
                                );
                                e.currentTarget.appendChild(endMarker);
                                mobileInputEndRef.current = endMarker;
                              }
                              const nextText = (
                                e.currentTarget.textContent ?? ""
                              ).replace(/\u200b/g, "");
                              if (
                                nextText.length > 0 &&
                                nextText.trim() === ""
                              ) {
                                resetMobileInputDom("");
                                onInput("");
                                syncMobileInputHeight("");
                                scheduleResetMobileInputViewportToStart();
                                return;
                              }
                              onInput(nextText);
                              syncMobileInputHeight(nextText);
                              if (nextText.trim().length === 0) {
                                scheduleResetMobileInputViewportToStart();
                              }
                            }}
                            onKeyDown={onMobileInputKeyDown}
                            onPointerDown={() => {
                              inputFocusedBeforePointerRef.current =
                                document.activeElement ===
                                mobileInputRef.current;
                            }}
                            onFocus={() => {
                              clearCenteredLatestUserMessage();
                              mobileExpandedViewportHeightRef.current =
                                Math.max(
                                  window.visualViewport?.height ?? 0,
                                  window.innerHeight,
                                  document.documentElement.clientHeight,
                                );
                              // 清除 collapse 残留定时器，防止聚焦后被重置为 44px
                              collapseTimersRef.current.forEach(clearTimeout);
                              collapseTimersRef.current = [];
                              clearMobileKeyboardReleaseTimers();
                              setIsMobileKeyboardReleasing(false);
                              mobileKeyboardReleaseWasActiveRef.current = false;
                              if (mobileBlurTimerRef.current !== null) {
                                clearTimeout(mobileBlurTimerRef.current);
                                mobileBlurTimerRef.current = null;
                              }
                              preserveMobileInputBlurHeightRef.current = false;
                              mobileKeyboardOpenedSinceFocusRef.current = false;
                              mobileKeyboardDismissByViewportRef.current =
                                false;
                              setPreserveMobileInputBlurHeight(false);
                              chatInputInnerRef.current?.style.removeProperty(
                                "--chat-mobile-input-preserved-height",
                              );
                              if (mobileInputRef.current) {
                                mobileInputRef.current.style.removeProperty(
                                  "--chat-mobile-input-preserved-height",
                                );
                                mobileInputRef.current.style.height =
                                  mobileInputHasText ? "auto" : "44px";
                                mobileInputRef.current.style.maxHeight = "";
                              }
                              syncMobileInputHeight(userInput);
                              setIsMobileInputFocused(true);
                              scheduleMoveInputCursorToEnd();
                              if (mobileInputHasText) {
                                scheduleScrollMobileInputToBottom();
                              }
                              scheduleMobileKeyboardViewportSync();
                            }}
                            onBlur={() => {
                              if (mobileInputSubmitBlurRef.current) {
                                mobileInputSubmitBlurRef.current = false;
                                mobileInputOutsidePointerBlurRef.current =
                                  false;
                                sanitizeBoundaryInput();
                                mobileBlurTimerRef.current = window.setTimeout(
                                  () => {
                                    finalizeMobileInputBlur();
                                  },
                                  50,
                                );
                                return;
                              }
                              if (mobileKeyboardDismissByViewportRef.current) {
                                mobileKeyboardDismissByViewportRef.current =
                                  false;
                                return;
                              }
                              if (mobileInputOutsidePointerBlurRef.current) {
                                mobileInputOutsidePointerBlurRef.current =
                                  false;
                                sanitizeBoundaryInput();
                                mobileBlurTimerRef.current = window.setTimeout(
                                  () => {
                                    finalizeMobileInputBlur();
                                  },
                                  50,
                                );
                                return;
                              }

                              sanitizeBoundaryInput();
                              mobileBlurTimerRef.current = window.setTimeout(
                                () => {
                                  finalizeMobileInputBlur();
                                },
                                50,
                              );
                            }}
                            onClick={() => {
                              if (inputFocusedBeforePointerRef.current) return;
                              inputFocusedBeforePointerRef.current = true;
                              scheduleMoveInputCursorToEnd();
                              if (mobileInputHasText) {
                                scheduleScrollMobileInputToBottom();
                              }
                            }}
                            onPaste={handlePaste}
                            onScroll={handleInputScroll}
                            style={{
                              fontSize: inputFontSize,
                              fontFamily: config.fontFamily,
                            }}
                          >
                            <span
                              ref={mobileInputEndRef}
                              data-chat-input-end="true"
                            >
                              {"\u200b"}
                            </span>
                          </div>
                        ) : (
                          <textarea
                            id="chat-input"
                            ref={inputRef}
                            className={styles["chat-input"]}
                            placeholder={
                              isChatUnavailableForSync ? chatInputHint : ""
                            }
                            onInput={(e) => onInput(e.currentTarget.value)}
                            value={userInput}
                            onKeyDown={onInputKeyDown}
                            onPointerDown={() => {
                              // 在浏览器定位光标之前，记录输入框当前是否已聚焦
                              inputFocusedBeforePointerRef.current =
                                document.activeElement === inputRef.current;
                            }}
                            onFocus={() => {
                              setIsMobileInputFocused(true);
                              scheduleMoveInputCursorToEnd();
                              // 键盘打开时不强制滚动，由 scheduleMobileKeyboardViewportSync 处理视口调整
                              scheduleMobileKeyboardViewportSync();
                            }}
                            onBlur={() => {
                              sanitizeBoundaryInput();
                              setTimeout(
                                () => setIsMobileInputFocused(false),
                                50,
                              );
                            }}
                            onClick={() => {
                              // 仅在“之前未聚焦”的首次点击时，把光标移动到文本末尾；
                              // 已聚焦时保留用户点击的位置
                              if (inputFocusedBeforePointerRef.current) return;
                              inputFocusedBeforePointerRef.current = true;
                              scheduleMoveInputCursorToEnd();
                            }}
                            onPaste={handlePaste}
                            onScroll={handleInputScroll}
                            rows={inputRows}
                            autoFocus={autoFocus}
                            disabled={isChatUnavailableForSync}
                            style={{
                              fontSize: inputFontSize,
                              fontFamily: config.fontFamily,
                            }}
                          />
                        )}
                        {isLoading || isAssistantStreaming ? (
                          <IconButton
                            icon={<StopIcon />}
                            className={styles["chat-input-send"]}
                            onClick={onStopAll}
                          />
                        ) : (
                          <IconButton
                            icon={<SendUpIcon />}
                            className={styles["chat-input-send"]}
                            disabled={
                              isChatUnavailableForSync || hasPendingUploads
                            }
                            onMouseDown={() => {
                              if (hasPendingUploads) return;
                              if (userInput.trim() || hasComposerAttachments) {
                                prepareMobileSubmitKeyboardDismiss();
                              }
                            }}
                            onTouchStart={(e) => {
                              if (hasPendingUploads) return;
                              if (userInput.trim() || hasComposerAttachments) {
                                e.preventDefault();
                                e.stopPropagation();
                                mobileSubmitTouchHandledRef.current = true;
                                prepareMobileSubmitKeyboardDismiss();
                                doSubmit(userInput);
                              }
                            }}
                            onClick={() => {
                              if (hasPendingUploads) return;
                              if (mobileSubmitTouchHandledRef.current) {
                                mobileSubmitTouchHandledRef.current = false;
                                return;
                              }
                              doSubmit(userInput);
                            }}
                          />
                        )}
                      </div>
                    </label>
                  </div>
                  {!isMobileScreen && (
                    <div
                      className={clsx(styles["chat-input-compact-hint"], {
                        [styles["chat-input-compact-hint-hidden"]]:
                          !shouldUseCompactInputHint || !!userInput,
                      })}
                    >
                      {chatInputHint}
                    </div>
                  )}
                  {currentSessionHasMessages && (
                    <div className={styles["chat-input-footer-note"]}>
                      专属于你的AI，也专属于我的偏爱。
                    </div>
                  )}
                </div>
              </div>
              <div
                className={clsx(styles["chat-side-panel"], {
                  [styles["mobile"]]: isMobileScreen,
                  [styles["chat-side-panel-show"]]: showChatSidePanel,
                })}
              >
                {showChatSidePanel && (
                  <RealtimeChat
                    onClose={() => {
                      setShowChatSidePanel(false);
                    }}
                    onStartVoice={async () => {
                      console.log("start voice");
                    }}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {showExport && (
        <ExportMessageModal
          key={`export-${safeSession.id}`}
          onClose={() => setShowExport(false)}
        />
      )}

      {isEditingMessage && (
        <EditMessageModal
          onClose={() => {
            setIsEditingMessage(false);
          }}
        />
      )}

      {showShortcutKeyModal && (
        <ShortcutKeyModal onClose={() => setShowShortcutKeyModal(false)} />
      )}

      {showModelSelector && (
        <Selector
          className="model-selector-panel"
          disableHoverAnimation={true}
          resetKey={modelSelectorResetKey}
          defaultSelectedValue={
            modelSelectorDefaultValue ?? currentDisplaySelectorValue
          }
          defaultGroup={modelSelectorDefaultGroup}
          headerHint={
            <>
              {modelSelectorNotice ? (
                <div className={"model-selector-notice"}>
                  <NoticePill content={modelSelectorNotice} />
                </div>
              ) : null}
              <div className={"model-selector-hint"}>
                <span className={"model-selector-hint-label"}>当前供应商</span>
                <button
                  type="button"
                  className={clsx(
                    "model-selector-hint-provider-button",
                    "nextchat-default-button",
                    "nextchat-pill-button",
                    "nextchat-no-hover-motion",
                    isProviderSelectorOpen && "model-selector-provider-open",
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onClick={() => {
                    setIsProviderSelectorOpen((isOpen) => {
                      const willOpen = !isOpen;
                      if (willOpen && !modelSelectorProviderId) {
                        setModelSelectorProviderId(currentProviderId);
                      }
                      return willOpen;
                    });
                  }}
                >
                  <span>
                    {activeModelSelectorProviderDisplayName}
                    <span className={"model-selector-hint-count-inline"}>
                      {models.length > 0
                        ? `（共 ${models.length} 个模型）`
                        : "（无模型）"}
                    </span>
                  </span>
                  <DownIcon />
                </button>
                <span className={"model-selector-hint-count"}>
                  {models.length > 0 ? `${models.length} 个模型可用` : "无模型"}
                </span>
              </div>
              {isProviderSelectorOpen && (
                <div
                  data-provider-selector-root="true"
                  className={clsx(
                    "model-selector-provider-menu",
                    "nextchat-selector-menu",
                    "nextchat-no-hover-motion",
                  )}
                >
                  {availableProviders.length === 0 ? (
                    <div
                      className={clsx(
                        "model-selector-provider-empty",
                        "nextchat-selector-empty",
                      )}
                    >
                      没有可用的供应商配置
                    </div>
                  ) : (
                    availableProviders.map((providerOption) => {
                      const optionProviderId = getProfileProviderId({
                        provider: providerOption.provider as ServiceProvider,
                        name: providerOption.label,
                      } as any).toLowerCase();
                      const isActive =
                        optionProviderId === activeModelSelectorProviderId;
                      return (
                        <button
                          type="button"
                          key={providerOption.label}
                          className={clsx(
                            "model-selector-provider-option",
                            "nextchat-menu-option",
                            "nextchat-menu-option-bordered",
                            "nextchat-no-hover-motion",
                            "nextchat-selector-menu-option",
                            isActive && "model-selector-provider-option-active",
                            isActive && "nextchat-menu-option-active",
                            isActive && "nextchat-selector-menu-option-active",
                          )}
                          data-full-label={providerOption.label}
                          onMouseEnter={(event) => {
                            const text = event.currentTarget.querySelector(
                              ".model-selector-provider-option-text",
                            );
                            if (text && text.scrollWidth > text.clientWidth) {
                              event.currentTarget.setAttribute(
                                "data-show-full-label",
                                "true",
                              );
                            }
                          }}
                          onMouseLeave={(event) => {
                            event.currentTarget.removeAttribute(
                              "data-show-full-label",
                            );
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            const providerLabel = providerOption.label;
                            localStorage.setItem(
                              MODEL_SELECTOR_PROVIDER_STORAGE_KEY,
                              providerLabel,
                            );
                            // 处理供应商切换（函数内部会关闭供应商菜单）
                            handleProviderChange(providerLabel);
                          }}
                        >
                          <span
                            className={clsx(
                              "model-selector-provider-option-leading",
                              "nextchat-selector-menu-option-leading",
                            )}
                          >
                            <div className="no-dark">
                              <NextImage
                                className={clsx(
                                  "model-selector-provider-default-icon",
                                  "nextchat-selector-menu-icon-image",
                                )}
                                src="/llm-icons/default.png"
                                alt="model icon"
                                width={30}
                                height={30}
                              />
                            </div>
                          </span>
                          <span
                            className={clsx(
                              "model-selector-provider-option-text",
                            )}
                          >
                            {providerOption.label}
                          </span>
                          {isActive ? (
                            <div
                              className="model-selector-provider-option-selected"
                              style={{ color: "var(--primary)" }}
                            >
                              <SelectorCheckIcon
                                style={{
                                  color: "var(--primary)",
                                  stroke: "var(--primary)",
                                  filter: "none",
                                }}
                              />
                            </div>
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </>
          }
          footer={null}
          items={modelSelectorItems}
          itemsArePreSorted={true}
          disableOpenAnimation={true}
          enableVirtualization={isPerfFeatureEnabled(
            "PERF_ENABLE_MODEL_SELECTOR_VIRTUAL_LIST",
          )}
          virtualizationThreshold={60}
          searchDebounceMs={120}
          perfScope="ModelSelector"
          perfStartedAt={modelSelectorOpenStartedAtRef.current || undefined}
          showGroupFilter={true}
          sortGroupsAlphabetically={true}
          groupFilterAction={
            isProviderSelectorOpen
              ? undefined
              : ({ buttonClassName }) => (
                  <button
                    type="button"
                    className={clsx(
                      buttonClassName,
                      "nextchat-selector-manage-button",
                      "nextchat-no-hover-motion",
                    )}
                    style={{
                      flex: "0 0 auto",
                      width: "auto",
                      minWidth: 0,
                      paddingLeft: 14,
                      paddingRight: 14,
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddModelProfile({
                        profiles: apiProfiles,
                        currentProviderId: activeModelSelectorProviderId,
                      });
                      setShowAddModelModal(true);
                    }}
                  >
                    <span>管理模型</span>
                  </button>
                )
          }
          showSearch={true}
          onGroupChange={(group) => {
            setModelSelectorDefaultGroup(group);
            localStorage.setItem(MODEL_SELECTOR_GROUP_STORAGE_KEY, group);
          }}
          onClose={() => {
            modelSelectorRequiresSelectionRef.current = false;
            setModelSelectorProviderId(currentProviderId);
            setModelSelectorDefaultValue(currentDisplaySelectorValue);
            setModelSelectorNotice("");
            if (currentProfile?.name) {
              localStorage.setItem(
                MODEL_SELECTOR_PROVIDER_STORAGE_KEY,
                currentProfile.name,
              );
            }
            setShowModelSelector(false);
          }}
          onSelection={async (s) => {
            if (s.length === 0) return;

            modelSelectorRequiresSelectionRef.current = false;
            setModelSelectorDefaultValue(s[0]);
            if (isMobileScreen) {
              setShowStatusUserPanel(false);
            }
            const [model, selectedProviderIdRaw] = getModelProvider(s[0]);
            const selectedProviderId = String(
              selectedProviderIdRaw || currentProviderId || "",
            ).toLowerCase();
            setModelSelectorProviderId(selectedProviderId);
            const selectedModel = allModels.find(
              (item) =>
                item.available &&
                item.name === model &&
                String(item.provider?.id || "").toLowerCase() ===
                  selectedProviderId,
            );
            const selectedProfile = apiProfiles.find(
              (profile) =>
                getProfileProviderId(profile).toLowerCase() ===
                selectedProviderId,
            );
            const actualProviderName = (selectedProfile?.provider ||
              selectedModel?.provider?.providerName ||
              currentProfile?.provider ||
              currentProviderName) as ServiceProvider;
            const selectedProviderModels = allModels.filter(
              (item) =>
                item.available &&
                String(item.provider?.id || "").toLowerCase() ===
                  selectedProviderId,
            );
            if (selectedProfile) {
              useAccessStore.getState().update((access) => {
                access.useCustomConfig = true;
                applyProfileToAccessStore(access, selectedProfile as any);
              });
            }

            const nextModelConfig = sanitizeModelConfigForCapability({
              ...session.mask.modelConfig,
              model: model as ModelType,
              providerName: actualProviderName as ServiceProvider,
            });
            (nextModelConfig as any).providerId = selectedProviderId;
            (nextModelConfig as any).profileId = selectedProfile?.id || "";
            const selectedAt = Date.now();
            (nextModelConfig as any).modelSelectionUpdatedAt = selectedAt;
            const shouldUpdateGlobalDefault = session.id === latestSessionId;

            // 手动选择先落 localStorage，再更新 store 并在后台同步。
            // 即使同步返回较慢，当前会话也不会被旧快照覆盖。
            saveManualSessionModelSelection(session.id, {
              ...nextModelConfig,
              providerId: selectedProviderId,
              profileId: selectedProfile?.id || "",
            });
            if (selectedProfile?.name) {
              localStorage.setItem(
                MODEL_SELECTOR_PROVIDER_STORAGE_KEY,
                selectedProfile.name,
              );
            }
            localStorage.setItem(
              LAST_MODEL_SELECTION_STORAGE_KEY,
              `${nextModelConfig.model}@${selectedProviderId}`,
            );
            console.info("[模型选择器] 模型选择已保存到 localStorage", {
              对话ID: session.id,
              模型: nextModelConfig.model,
              供应商ID: selectedProviderId,
              作用域: shouldUpdateGlobalDefault
                ? "最新对话 + 全局默认"
                : "当前老对话",
            });
            // 手动切换模型必须立即写回当前会话。
            // Effect B 仅会在空白会话时把全局配置同步到会话，
            // 已有消息的会话如果不在这里更新，会继续沿用旧模型发起请求。
            chatStore.updateTargetSession(session, (session) => {
              session.mask.modelConfig = nextModelConfig;
              (session.mask as any).modelSelectionUpdatedAt = selectedAt;
              session.mask.syncGlobalConfig = shouldUpdateGlobalDefault;
            });

            // 最新对话无论是空白还是正在对话，都会改变全局默认；
            // 从历史打开的老对话只更新自身。
            if (shouldUpdateGlobalDefault) {
              runWithImmediateStoreSyncPausedSync(() => {
                useAppConfig.getState().update((config) => {
                  config.modelConfig = sanitizeModelConfigForCapability({
                    ...config.modelConfig,
                    model: nextModelConfig.model,
                    providerName: nextModelConfig.providerName,
                  });
                  (config.modelConfig as any).providerId = selectedProviderId;
                  (config.modelConfig as any).profileId =
                    selectedProfile?.id || "";
                  (config as any).modelSelectionUpdatedAt = selectedAt;
                  markPendingModelSelection({
                    ...config.modelConfig,
                    modelSelectionUpdatedAt: selectedAt,
                  });
                });
              });
              useChatStore.getState().refreshFreshDefaultSessionModel?.();
            }
            // 持久化全局模型配置，跨用户、跨页面生效
            if (shouldUpdateGlobalDefault) {
              saveGlobalModelConfig(nextModelConfig as any);
            }
            syncModelSelectionNow(shouldUpdateGlobalDefault);

            console.info("[模型选择器] 模型已切换", {
              对话ID: session.id,
              模型: nextModelConfig.model,
              供应商类型: nextModelConfig.providerName,
              供应商ID: selectedProviderId,
              配置名称: selectedProfile?.name,
            });
            console.log(
              `[Sync] 📤 模型选择已变更，等待上传：${
                nextModelConfig.model
              }@${selectedProviderId.replace(/^custom_/, "")}`,
            );

            // 只有在非供应商切换后的1秒内才显示提示
            const timeSinceProviderSwitch =
              Date.now() - lastProviderSwitchTimeRef.current;
            if (timeSinceProviderSwitch > 1000) {
              showTopNotice(`已选择 ${model}`);
            }
          }}
        />
      )}

      {showAddModelModal && addModelProfile && (
        <AddModelSelector
          onClose={() => {
            const managedProfile = addModelProfile.profiles.find(
              (profile) =>
                getProfileProviderId(profile).toLowerCase() ===
                addModelProfile.currentProviderId,
            );
            if (managedProfile) {
              collectProviderModelsForProfile(
                managedProfile as any,
                "model-manager-close",
              );
            }
            setShowAddModelModal(false);
            setAddModelProfile(null);
            setShowModelSelector(true);
            setModelSelectorResetKey((k) => k + 1);
            modelSelectorItemsCacheRef.current = {};
            resetModelSelectorGroupToAll();
          }}
          profiles={addModelProfile.profiles}
          initialProviderId={addModelProfile.currentProviderId}
          onRemoveModel={(keys) => {
            const currentValue = `${currentRawModel}@${currentProviderId}`;
            const removedCurrentModel = keys.some(
              (key) => key.toLowerCase() === currentValue.toLowerCase(),
            );

            if (!removedCurrentModel) {
              return;
            }

            setModelSelectorProviderId(currentProviderId);
            setModelSelectorDefaultValue("");
            setModelSelectorResetKey((key) => key + 1);
            modelSelectorRequiresSelectionRef.current = true;
            setModelSelectorNotice("当前使用的模型已删除，请重新选择一个模型");
            if (modelSelectorNoticeTimerRef.current) {
              clearTimeout(modelSelectorNoticeTimerRef.current);
              modelSelectorNoticeTimerRef.current = null;
            }
          }}
        />
      )}
    </>
  );
}

export function Chat() {
  const session = useChatStore(
    (state) => state.sessions[state.currentSessionIndex],
  );
  const sessionIdListKey = useChatStore((state) =>
    state.sessions.map((item) => item.id).join(","),
  );
  const { id: urlSessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isMobileScreen = useMobileScreen();
  const isNavigatingFromUrl = useRef(false);

  // 从 URL 恢复对话选中
  useEffect(() => {
    if (urlSessionId) {
      const store = useChatStore.getState();
      const currentSession = store.sessions[store.currentSessionIndex];
      const currentId = currentSession?.id;
      if (currentId !== urlSessionId) {
        isNavigatingFromUrl.current = true;
        selectChatSessionById(urlSessionId);
      }
    }
  }, [sessionIdListKey, urlSessionId]);

  // 首页默认显示新对话（仅桌面端：首页同时展示列表与对话面板，
  // 需保证面板停在新对话。移动端首页只是列表，返回列表时应保留刚查看的会话选中态，不可重置）
  useEffect(() => {
    if (isMobileScreen) return;
    if (location.pathname !== Path.Home) return;
    const store = useChatStore.getState();
    const currentSession = store.currentSession();
    if (!currentSession) return;
    const normalizedTopic = String(currentSession.topic || "").trim();
    const isFresh =
      currentSession.messages.length === 0 &&
      !currentSession.memoryPrompt &&
      (!normalizedTopic ||
        normalizedTopic === DEFAULT_TOPIC ||
        normalizedTopic === "New Chat" ||
        normalizedTopic === "新的聊天");
    if (!isFresh) {
      store.newSession();
    }
  }, [location.pathname, isMobileScreen]);

  // 对话变化时同步 URL
  useEffect(() => {
    if (isNavigatingFromUrl.current) {
      isNavigatingFromUrl.current = false;
      return;
    }
    if (
      location.pathname !== Path.Home &&
      location.pathname !== Path.NewChat &&
      session?.id &&
      session.messages.length > 0
    ) {
      navigate(`/chat/${session.id}`, { replace: true });
    }
  }, [location.pathname, navigate, session?.id, session?.messages.length]);

  if (!session?.id) {
    return null;
  }

  return <_Chat key={session.id}></_Chat>;
}
