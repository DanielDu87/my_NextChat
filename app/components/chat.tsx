import { useDebouncedCallback } from "use-debounce";
import React, {
  Fragment,
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import SendUpIcon from "../icons/send-up.svg";
import BrainIcon from "../icons/brain.svg";
import RenameIcon from "../icons/rename.svg";
import ExportIcon from "../icons/share.svg";
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
import ConfigIcon from "../icons/config.svg";
import UserIcon from "../icons/user.svg";
import DeleteIcon from "../icons/clear.svg";
import CloseIcon from "../icons/close.svg";
import CancelIcon from "../icons/cancel.svg";
import LogOutDoorIcon from "../icons/log-out-door.svg";
import ImageIcon from "../icons/image.svg";

import StopIcon from "../icons/pause.svg";
import PlayIcon from "../icons/play.svg";
import RobotIcon from "../icons/robot.svg";
import SizeIcon from "../icons/size.svg";
import QualityIcon from "../icons/hd.svg";
import BotIconOpenAI from "../icons/llm-icons/openai.svg";
import McpToolIcon from "../icons/tool.svg";
import {
  BOT_HELLO,
  ChatMessage,
  createMessage,
  createEmptySession,
  normalizeSession,
  useChatStore,
} from "../store/chat";
import { DEFAULT_TOPIC, getBotHelloContent } from "../store/chat-defaults";
import { useAccessStore } from "../store/access";
import {
  AutoModelSeriesKey,
  ModelType,
  SubmitKey,
  useAppConfig,
} from "../store/config";
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
import {
  buildAutoModelCandidates,
  getAutoModelSeriesLabel,
} from "../utils/auto-model";
import {
  matchModelCategory,
  ModelCategoryMetadata,
} from "../utils/model-category-rules";
import { resolveModelProviderId } from "../utils/model";
import { getPreferredDefaultChatModel } from "../utils/model";
import { applyAutoModeModelConfig } from "../utils/chat-session-model";
import { uploadImage as uploadImageRemote } from "@/app/utils/chat";
import { ensureProviderModelsReady } from "../utils/provider-sync";
import { rebuildManagedModelsFromCache } from "../utils/managed-model-rebuild";
import { isPerfFeatureEnabled, logPerfSummary, nowMs } from "../utils/perf";
import {
  getActiveModelSelectorProviderId,
  getModelSelectorDefaultValue,
} from "../utils/model-selector-provider";

import dynamic from "next/dynamic";

import { ChatControllerPool } from "../client/controller";
import { Prompt, usePromptStore } from "../store/prompt";
import {
  buildBalanceCacheKey,
  type BalanceAwareProfile,
} from "../store/update";
import Locale from "../locales";

import { IconButton } from "./button";
import styles from "./chat.module.scss";

import {
  List,
  ListItem,
  Modal,
  Selector,
  compareSelectorItems,
  showConfirm,
  showPrompt,
  showToast,
} from "./ui-lib";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  CHAT_PAGE_SIZE,
  DEFAULT_TTS_ENGINE,
  ModelProvider,
  Path,
  REQUEST_TIMEOUT_MS,
  ServiceProvider,
  StoreKey,
  UNFINISHED_INPUT,
} from "../constant";

import { useSyncStore, waitForSyncIdle } from "../store/sync";
import { ProviderType } from "../utils/cloud";

function syncModelSelectionNow() {
  const syncStore = useSyncStore.getState();
  if (!syncStore.cloudSync?.()) {
    return;
  }
  // 只同步模型选择，API 配置由后台防抖同步处理
  void syncStore
    .sync([StoreKey.Config], {
      force: true,
      isolateQueue: true,
    })
    .catch((error: unknown) => {
      console.error("[模型选择器] 模型选择立即同步失败", error);
    });
}
import { Avatar, FIXED_USER_AVATAR } from "./emoji";
import { ContextPrompts, MaskAvatar, MaskConfig } from "./mask";
import { useMaskStore } from "../store/mask";
import { ChatCommandPrefix, useChatCommand, useCommand } from "../command";
import { parseStoreStatePayload } from "../utils/sync-store-keys";
import {
  runWithImmediateStoreSyncPaused,
  runWithImmediateStoreSyncPausedSync,
} from "../utils/store";
import { prettyObject } from "../utils/format";
import {
  readManualSessionModelSelection,
  saveManualSessionModelSelection,
} from "../utils/manual-model-selection";
import { ExportMessageModal } from "./exporter";
import { getProviderIcon } from "../config/provider-icons";
import { ClientApi, MultimodalContent } from "../client/api";
import { isRememberedRuntimeBlobUrl } from "../client/platforms/openai";
import { createTTSPlayer } from "../utils/audio";
import { MsEdgeTTS, OUTPUT_FORMAT } from "../utils/ms_edge_tts";
import {
  getModelParameterSupport,
  sanitizeModelConfigForCapability,
} from "../client/model-parameter-rules";

import { isEmpty } from "lodash-es";
import {
  AIHUBMIX_PREFERRED_OPENAI_CHAT_MODEL_NAME,
  LATEST_OPENAI_CHAT_MODEL_NAME,
  getLatestOpenAIModelName,
  getLatestOpenAIModelForCurrentSupplier,
  getLatestOpenAIModelForProviderId,
  getModelProvider,
  getPreferredRuntimeModelConfig,
  normalizeReservedDisplayModelName,
} from "../utils/model";
import { RealtimeChat } from "@/app/components/realtime-chat";
import { useAuthStore } from "../store/auth";
import { UserMenu } from "./user-menu";
import { AddModelSelector } from "./add-model-modal";

type RemoteModelRefreshArtifact = {
  updatedAt?: string;
  modelCount?: number;
  providers?: Array<{
    profileId?: string;
    providerId?: string;
    profileName?: string;
    fetchedCount?: number;
    updatedAt?: string;
  }>;
};

async function loadRemoteModelRefreshArtifact() {
  if (useSyncStore.getState().provider !== ProviderType.Database) {
    return null;
  }

  const latestRes = await fetch("/api/db/models/latest", {
    cache: "no-store",
    headers: withSyncUserHeaders(),
  });

  if (!latestRes.ok) {
    return null;
  }

  const latestData = await latestRes.json();
  return latestData?.ok ? latestData.latest ?? null : null;
}

function areSelectorItemsEqual(
  left: Array<{
    title: string;
    value: string;
    disable?: boolean;
    order?: number;
    publishedAt?: number;
    catalogRank?: number;
    group?: string;
  }>,
  right: Array<{
    title: string;
    value: string;
    disable?: boolean;
    order?: number;
    publishedAt?: number;
    catalogRank?: number;
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
      current.group !== next.group
    ) {
      return false;
    }
  }

  return true;
}

function isAiHubMixProviderId(providerId: string | undefined) {
  return String(providerId || "").toLowerCase() === "custom_aihubmix";
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

async function copyMessageToClipboard(message: ChatMessage) {
  const text = trimMessageBoundaryText(getMessageTextContent(message));
  const images = getMessageImages(message).filter(Boolean);
  if (
    images.length === 0 ||
    typeof ClipboardItem === "undefined" ||
    !navigator.clipboard?.write
  ) {
    return copyToClipboard(buildMessageCopyText(message));
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
    showToast(Locale.Copy.Success);
    return true;
  } catch {
    return copyToClipboard(buildMessageCopyText(message));
  }
}

function getProfileProviderId(profile: { provider: string; name: string }) {
  return profile.provider === ServiceProvider.Custom
    ? `custom_${profile.name}`
    : profile.provider === ServiceProvider.Local
    ? `${String(profile.provider).toLowerCase()}_${profile.name}`.toLowerCase()
    : String(profile.provider).toLowerCase();
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

function hasProviderModel(
  models: Array<{ name: string; provider?: { id?: string } }>,
  modelName: string,
  providerId: string,
) {
  const normalizedModelName = String(modelName || "").toLowerCase();
  const normalizedProviderId = String(providerId || "").toLowerCase();

  return models.some(
    (model) =>
      String(model.name || "").toLowerCase() === normalizedModelName &&
      String(model.provider?.id || "").toLowerCase() === normalizedProviderId,
  );
}

function addCustomModelEntry(
  customModels: string,
  modelName: string,
  providerId: string,
) {
  const entry = `+${modelName}@${providerId}`;
  const existingEntries = customModels
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const targetKey = `${modelName}@${providerId}`.toLowerCase();
  let changed = false;
  const normalizedEntries = existingEntries.map((item) => {
    const key = item.replace(/^[+-]/, "").toLowerCase();
    if (key !== targetKey) {
      return item;
    }
    if (item !== entry) {
      changed = true;
      return entry;
    }
    return item;
  });
  const existingKeys = new Set(
    normalizedEntries.map((item) => item.replace(/^[+-]/, "").toLowerCase()),
  );

  if (existingKeys.has(targetKey)) {
    return {
      customModels: changed ? normalizedEntries.join(",") : customModels,
      added: changed,
    };
  }

  return {
    customModels: [...normalizedEntries, entry].join(","),
    added: true,
  };
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

  switch (profile.provider) {
    case ServiceProvider.Custom:
      access.customUrl = profile.baseUrl || "";
      access.customApiKey = profile.apiKey || "";
      access.customOpenAICompatible = profile.openAICompatible ?? true;
      break;
    case ServiceProvider.OpenAI:
      access.openaiUrl = profile.baseUrl || access.openaiUrl;
      access.openaiApiKey = profile.apiKey || access.openaiApiKey;
      break;
    case ServiceProvider.Azure:
      access.azureUrl = profile.baseUrl || access.azureUrl;
      access.azureApiKey = profile.apiKey || access.azureApiKey;
      break;
    case ServiceProvider.Google:
      access.googleUrl = profile.baseUrl || access.googleUrl;
      access.googleApiKey = profile.apiKey || access.googleApiKey;
      break;
    case ServiceProvider.Anthropic:
      access.anthropicUrl = profile.baseUrl || access.anthropicUrl;
      access.anthropicApiKey = profile.apiKey || access.anthropicApiKey;
      break;
    case ServiceProvider.Baidu:
      access.baiduUrl = profile.baseUrl || access.baiduUrl;
      access.baiduApiKey = profile.apiKey || access.baiduApiKey;
      break;
    case ServiceProvider.ByteDance:
      access.bytedanceUrl = profile.baseUrl || access.bytedanceUrl;
      access.bytedanceApiKey = profile.apiKey || access.bytedanceApiKey;
      break;
    case ServiceProvider.Alibaba:
      access.alibabaUrl = profile.baseUrl || access.alibabaUrl;
      access.alibabaApiKey = profile.apiKey || access.alibabaApiKey;
      break;
    case ServiceProvider.Moonshot:
      access.moonshotUrl = profile.baseUrl || access.moonshotUrl;
      access.moonshotApiKey = profile.apiKey || access.moonshotApiKey;
      break;
    case ServiceProvider.Stability:
      access.stabilityUrl = profile.baseUrl || access.stabilityUrl;
      access.stabilityApiKey = profile.apiKey || access.stabilityApiKey;
      break;
    case ServiceProvider.Iflytek:
      access.iflytekUrl = profile.baseUrl || access.iflytekUrl;
      access.iflytekApiKey = profile.apiKey || access.iflytekApiKey;
      break;
    case ServiceProvider.XAI:
      access.xaiUrl = profile.baseUrl || access.xaiUrl;
      access.xaiApiKey = profile.apiKey || access.xaiApiKey;
      break;
    case ServiceProvider.ChatGLM:
      access.chatglmUrl = profile.baseUrl || access.chatglmUrl;
      access.chatglmApiKey = profile.apiKey || access.chatglmApiKey;
      break;
    case ServiceProvider.DeepSeek:
      access.deepseekUrl = profile.baseUrl || access.deepseekUrl;
      access.deepseekApiKey = profile.apiKey || access.deepseekApiKey;
      break;
    case ServiceProvider.SiliconFlow:
      access.siliconflowUrl = profile.baseUrl || access.siliconflowUrl;
      access.siliconflowApiKey = profile.apiKey || access.siliconflowApiKey;
      break;
    case ServiceProvider["302.AI"]:
      access.ai302Url = profile.baseUrl || access.ai302Url;
      access.ai302ApiKey = profile.apiKey || access.ai302ApiKey;
      break;
    case ServiceProvider.Local:
      access.localUrl = profile.baseUrl || access.localUrl;
      access.localApiKey = profile.apiKey || access.localApiKey;
      break;
    default:
      break;
  }
}

function countManagedCloudModels(
  models: Array<{ provider?: { id?: string } }> = [],
  profiles: Array<{ provider: string; name: string }> = [],
) {
  const managedProviderIds = new Set(
    profiles.map((profile) => getProfileProviderId(profile).toLowerCase()),
  );

  return models.filter((model) => {
    const providerId = String(model.provider?.id || "").toLowerCase();
    return providerId && managedProviderIds.has(providerId);
  }).length;
}

function getManagedProviderIds(
  profiles: Array<{ provider: string; name: string }> = [],
) {
  return new Set(
    profiles.map((profile) => getProfileProviderId(profile).toLowerCase()),
  );
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

async function reconcileRemoteModelStoresInternal() {
  const syncStoreState = useSyncStore.getState();
  const client = syncStoreState.getClient() as any;

  await runWithImmediateStoreSyncPaused(async () => {
    const currentProfiles = useAccessStore.getState().apiProfiles || [];
    const managedProviderIds = getManagedProviderIds(currentProfiles);
    const allowedProviderIds = [...managedProviderIds];

    const remoteConfigJson = await client.get(StoreKey.Config);
    if (remoteConfigJson) {
      const remoteConfig = parseStoreStatePayload<any>(remoteConfigJson);
      const remoteModels = (remoteConfig?.models || []).filter((model: any) => {
        const providerId = String(model?.provider?.id || "").toLowerCase();
        return providerId && managedProviderIds.has(providerId);
      });
      if (remoteModels.length > 0) {
        useAppConfig.getState().mergeModels(remoteModels, {
          silent: true,
          allowedProviderIds,
        });
      }
    }

    const remoteAccessJson = await client.get(StoreKey.Access);
    if (remoteAccessJson) {
      const remoteAccess = parseStoreStatePayload<any>(remoteAccessJson);
      const remoteProfiles = Array.isArray(remoteAccess?.apiProfiles)
        ? remoteAccess.apiProfiles
        : [];

      if (remoteProfiles.length > 0) {
        useAccessStore.getState().update((state) => {
          const localProfileMap = new Map(
            (state.apiProfiles || []).map((profile: any) => [
              String(profile?.id || ""),
              profile,
            ]),
          );

          remoteProfiles.forEach((remoteProfile: any) => {
            const remoteProfileId = String(remoteProfile?.id || "");
            if (!remoteProfileId) {
              return;
            }

            if (!localProfileMap.has(remoteProfileId)) {
              // 不在聊天页自动恢复远端独有 profile，避免用户已删除的配置被旧远端快照重新写回本地。
              return;
            }

            const localProfile = localProfileMap.get(remoteProfileId) as any;
            const localModels = new Set(
              String(localProfile?.cachedModels || "")
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            );
            String(remoteProfile.cachedModels || "")
              .split(",")
              .map((item: string) => item.trim())
              .filter(Boolean)
              .forEach((modelName: string) => localModels.add(modelName));

            useModelCacheStore.getState().upsertProfileCache(remoteProfileId, {
              cachedModels: [...localModels].join(","),
              modelCount: Math.max(
                Number(localProfile?.modelCount || 0),
                Number(remoteProfile?.modelCount || 0),
              ),
            });
          });
        });
        useModelCacheStore.getState().migrateFromAccessProfiles?.();
      }
    }
  });
}

function ChatModelUpdateNotice() {
  const authUser = useAuthStore((state) => state.user);
  const authInitialized = useAuthStore((state) => state.initialized);
  const navigate = useNavigate();
  const accessStore = useAccessStore();
  const modelCacheStore = useModelCacheStore();
  const syncStore = useSyncStore();
  const config = useAppConfig();
  const [remoteModelRefresh, setRemoteModelRefresh] =
    useState<RemoteModelRefreshArtifact | null>(null);
  const [remoteSignalsLoaded, setRemoteSignalsLoaded] = useState(false);
  const [autoReconciling, setAutoReconciling] = useState(false);
  const lastAutoSyncedRevisionRef = useRef("");
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enableAutomaticModelReconcile = false;

  const reconcileRemoteModelStores = useCallback(
    async () => reconcileRemoteModelStoresInternal(),
    [],
  );

  const refreshRemoteSignals = useCallback(async () => {
    if (!authInitialized || !authUser) {
      setRemoteModelRefresh(null);
      setRemoteSignalsLoaded(true);
      return;
    }

    if (useSyncStore.getState().provider !== ProviderType.Database) {
      setRemoteModelRefresh(null);
      setRemoteSignalsLoaded(true);
      return;
    }

    try {
      setRemoteModelRefresh(await loadRemoteModelRefreshArtifact());
    } catch {
      setRemoteModelRefresh(null);
    } finally {
      setRemoteSignalsLoaded(true);
    }
  }, [authInitialized, authUser]);

  useEffect(() => {
    void refreshRemoteSignals();
    const timer = window.setInterval(() => {
      void refreshRemoteSignals();
    }, 120000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshRemoteSignals, syncStore.provider]);

  const localTotalCount = countManagedCloudModels(
    useAppConfig.getState().models || [],
    accessStore.apiProfiles || [],
  );
  const hasExactModelCountMatch = useMemo(
    () =>
      remoteModelRefresh?.modelCount !== undefined &&
      remoteModelRefresh.modelCount === localTotalCount,
    [remoteModelRefresh?.modelCount, localTotalCount],
  );

  const hasStaleModels = useMemo(
    () =>
      (accessStore.apiProfiles || []).some((profile) => {
        const providerId = getProfileProviderId(profile).toLowerCase();
        const remote = remoteModelRefresh?.providers?.find(
          (item) =>
            item.profileId === profile.id ||
            String(item.providerId || "").toLowerCase() === providerId ||
            item.profileName === profile.name,
        );

        // 只比较模型数量，数量一致则不显示提醒
        const localModelCount =
          modelCacheStore.profiles?.[profile.id]?.modelCount;
        if (localModelCount === undefined) {
          return false;
        }

        // 云端统计已清空，或存在但缺少当前平台记录时，视为需要手动刷新
        if (!remote) {
          return true;
        }

        return remote.fetchedCount !== localModelCount;
      }),
    [
      accessStore.apiProfiles,
      remoteModelRefresh?.providers,
      modelCacheStore.profiles,
    ],
  );

  const remoteRevision = useMemo(() => {
    if (!remoteModelRefresh) {
      return "";
    }

    return JSON.stringify({
      updatedAt: remoteModelRefresh.updatedAt || "",
      modelCount: remoteModelRefresh.modelCount ?? 0,
      providers: (remoteModelRefresh.providers || []).map((provider) => ({
        profileId: provider.profileId || "",
        providerId: provider.providerId || "",
        profileName: provider.profileName || "",
        fetchedCount: provider.fetchedCount ?? 0,
        updatedAt: provider.updatedAt || "",
      })),
    });
  }, [remoteModelRefresh]);

  useEffect(() => {
    if (!enableAutomaticModelReconcile) {
      return;
    }

    if (
      !remoteSignalsLoaded ||
      useSyncStore.getState().provider !== ProviderType.Database ||
      !remoteRevision ||
      hasExactModelCountMatch ||
      !hasStaleModels ||
      autoReconciling ||
      lastAutoSyncedRevisionRef.current === remoteRevision
    ) {
      return;
    }

    let cancelled = false;
    lastAutoSyncedRevisionRef.current = remoteRevision;

    // 30 秒防抖：避免短时间内多次触发 reconcile
    if (reconcileTimerRef.current) {
      clearTimeout(reconcileTimerRef.current);
    }
    reconcileTimerRef.current = setTimeout(async () => {
      reconcileTimerRef.current = null;
      if (cancelled) return;
      setAutoReconciling(true);

      try {
        await waitForSyncIdle();
        await reconcileRemoteModelStores();
        if (!cancelled) {
          await refreshRemoteSignals();
        }
      } catch (error) {
        console.error("[Chat] 自动对齐模型缓存失败:", error);
        lastAutoSyncedRevisionRef.current = "";
      } finally {
        if (!cancelled) {
          setAutoReconciling(false);
        }
      }
    }, 30000);

    return () => {
      cancelled = true;
      if (reconcileTimerRef.current) {
        clearTimeout(reconcileTimerRef.current);
        reconcileTimerRef.current = null;
      }
    };
  }, [
    autoReconciling,
    enableAutomaticModelReconcile,
    hasExactModelCountMatch,
    hasStaleModels,
    reconcileRemoteModelStores,
    refreshRemoteSignals,
    remoteRevision,
    remoteSignalsLoaded,
  ]);

  return null;
}

function ChatProviderBalance(props: {
  providerName: ServiceProvider;
  providerDisplayName: string;
  refreshSignal: string;
  balanceCacheKey: string;
  profile?: BalanceAwareProfile;
  deferInitialRefresh?: boolean;
  suppressAutoRefresh?: boolean;
}) {
  const authUser = useAuthStore((state) => state.user);
  const authInitialized = useAuthStore((state) => state.initialized);
  const syncProvider = useSyncStore((state) => state.provider);
  const criticalSyncReady = useSyncStore(
    (state: any) => state.criticalSyncReady,
  );
  const criticalSyncInProgress = useSyncStore(
    (state: any) => state.criticalSyncInProgress,
  );
  function formatUsageCurrency(value: number) {
    if (!Number.isFinite(value)) {
      return "--";
    }
    if (value === 0) {
      return "$0.00";
    }
    return `$${value.toFixed(4)}`;
  }

  const updateUsage = useUpdateStore((state) => state.updateUsage);
  const balance = useUpdateStore(
    (state) => state.balances[props.balanceCacheKey],
  );
  const [displayedBalance, setDisplayedBalance] = useState(balance);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const lastAutoRefreshKeyRef = useRef("");
  const showUsage = true;
  const supportsBalance =
    props.providerName === ServiceProvider.Custom ||
    props.providerName === ServiceProvider.Local;

  useEffect(() => {
    if (balance) {
      setDisplayedBalance(balance);
    }
  }, [balance]);

  const refreshUsage = useCallback(
    async (force = false) => {
      if (
        !authInitialized ||
        !authUser ||
        (syncProvider === ProviderType.Database &&
          (!criticalSyncReady || criticalSyncInProgress)) ||
        !supportsBalance ||
        !showUsage
      ) {
        return;
      }

      setLoadingUsage(true);
      try {
        await updateUsage(force, props.providerName, props.profile);
      } finally {
        setLoadingUsage(false);
      }
    },
    [
      authInitialized,
      authUser,
      criticalSyncInProgress,
      criticalSyncReady,
      props.profile,
      props.providerName,
      showUsage,
      syncProvider,
      supportsBalance,
      updateUsage,
    ],
  );

  useEffect(() => {
    if (!props.refreshSignal) {
      return;
    }
    refreshUsage(true);
  }, [props.refreshSignal, refreshUsage]);

  useEffect(() => {
    if (!supportsBalance || !props.balanceCacheKey) {
      return;
    }
    if (props.deferInitialRefresh) {
      return;
    }
    if (props.suppressAutoRefresh) {
      return;
    }
    if (
      syncProvider === ProviderType.Database &&
      (!criticalSyncReady || criticalSyncInProgress)
    ) {
      return;
    }

    const refreshKey = `${props.balanceCacheKey}:${props.profile?.id || ""}`;
    const lastRefreshAt = recentBalanceAutoRefresh.get(refreshKey) || 0;
    if (
      lastAutoRefreshKeyRef.current === refreshKey ||
      Date.now() - lastRefreshAt < 5000
    ) {
      return;
    }
    lastAutoRefreshKeyRef.current = refreshKey;
    recentBalanceAutoRefresh.set(refreshKey, Date.now());

    void refreshUsage(false);
  }, [
    props.balanceCacheKey,
    props.deferInitialRefresh,
    props.profile?.id,
    props.providerName,
    props.suppressAutoRefresh,
    criticalSyncInProgress,
    criticalSyncReady,
    refreshUsage,
    syncProvider,
    supportsBalance,
  ]);

  if (
    !authInitialized ||
    !authUser ||
    props.deferInitialRefresh ||
    !displayedBalance ||
    !supportsBalance
  ) {
    return null;
  }

  const remaining =
    typeof displayedBalance?.remaining === "number"
      ? displayedBalance.remaining
      : null;
  const totalUsed =
    typeof displayedBalance?.used === "number" ? displayedBalance.used : null;
  const displayValue =
    typeof displayedBalance?.displayValue === "number"
      ? displayedBalance.displayValue
      : totalUsed;
  const balanceDisplay =
    props.providerName === ServiceProvider.Local
      ? displayedBalance?.metricType === "requests"
        ? displayValue !== null
          ? `${Math.round(displayValue).toLocaleString()} 次`
          : "--"
        : displayedBalance?.metricType === "tokens"
        ? displayValue !== null
          ? `${Math.round(displayValue).toLocaleString()} Tokens`
          : "--"
        : displayValue !== null
        ? formatUsageCurrency(displayValue)
        : "--"
      : remaining !== null
      ? `$${remaining.toFixed(2)}`
      : "--";
  const balanceLabel =
    props.providerName === ServiceProvider.Local
      ? displayedBalance?.displayLabel ||
        `${props.providerDisplayName} 总使用量`
      : `${props.providerDisplayName} 余额`;

  return (
    <div className={styles["chat-provider-balance"]}>
      <div className={styles["chat-provider-balance-label"]}>
        {balanceLabel}
      </div>
      <div className={styles["chat-provider-balance-value"]}>
        {showUsage ? balanceDisplay : Locale.Settings.Usage.NoAccess}
      </div>
    </div>
  );
}
import clsx from "clsx";
import { getAvailableClientsCount, isMcpEnabled } from "../mcp/actions";

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
const recentBalanceAutoRefresh = new Map<string, number>();

type AttachImagesDraftPayload = {
  version: 1;
  images: string[];
  updatedAt: number;
  expiresAt: number;
};

function trimBoundaryInvisibleChars(text: string) {
  return String(text || "").replace(
    /^[\s\u200B-\u200D\u2060\uFEFF]+|[\s\u200B-\u200D\u2060\uFEFF]+$/g,
    "",
  );
}

function sanitizeDraftInputText(text: string) {
  return trimBoundaryInvisibleChars(text);
}

function sanitizeDraftAttachImages(images: unknown) {
  return Array.isArray(images)
    ? images
        .filter((item): item is string => typeof item === "string" && !!item)
        .slice(0, MAX_ATTACH_IMAGES)
    : [];
}

function createAttachImagesDraftPayload(
  images: string[],
): AttachImagesDraftPayload {
  const now = Date.now();
  return {
    version: 1,
    images: sanitizeDraftAttachImages(images),
    updatedAt: now,
    expiresAt: now + UNFINISHED_ATTACH_IMAGES_TTL_MS,
  };
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

function formatModelSelectorReason(reason: string) {
  const labels: Record<string, string> = {
    "page-refresh": "页面刷新",
    "model-selector-open": "打开模型选择器",
    "model-manager-open": "打开模型管理器",
    "model-manager-close": "关闭模型管理器",
    "provider-switch": "切换供应商",
  };
  return labels[reason] || reason || "未知原因";
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
  profiles: Array<{ id?: string; name: string; provider: ServiceProvider }>,
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

  return (
    String(message.profileName || "").trim() ||
    extractProviderDisplayNameFromModelLabel(
      message.modelDisplay || message.model,
    )
  );
}

function resolveMessageModelSelection(
  message: ChatMessage | undefined,
  profiles: Array<{ id?: string; name: string; provider: ServiceProvider }>,
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
    getMessageProviderDisplayName(message, profiles) ||
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

  const resolvedProviderName =
    message.providerName ||
    matchedProfile?.provider ||
    (providerId.startsWith("custom_")
      ? ServiceProvider.Custom
      : providerId.startsWith("local_")
      ? ServiceProvider.Local
      : (providerId as ServiceProvider));
  const resolvedProviderId =
    providerId || (matchedProfile ? getProfileProviderId(matchedProfile) : "");

  if (!resolvedProviderName || !resolvedProviderId) {
    return null;
  }

  return {
    model: model as ModelType,
    providerName: resolvedProviderName as ServiceProvider,
    providerId: resolvedProviderId.toLowerCase(),
    profileId: profileId || matchedProfile?.id || "",
  };
}

const ttsPlayer = createTTSPlayer();

const Markdown = dynamic(async () => (await import("./markdown")).Markdown, {
  loading: () => <LoadingIcon />,
});

const MCPAction = () => {
  const navigate = useNavigate();
  const [count, setCount] = useState<number>(0);
  const [mcpEnabled, setMcpEnabled] = useState(false);

  useEffect(() => {
    const checkMcpStatus = async () => {
      const enabled = await isMcpEnabled();
      setMcpEnabled(enabled);
      if (enabled) {
        const count = await getAvailableClientsCount();
        setCount(count);
      }
    };
    checkMcpStatus();
  }, []);

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
  const maskStore = useMaskStore();
  const navigate = useNavigate();

  if (!session) {
    return null;
  }

  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Context.Edit}
        onClose={() => props.onClose()}
        actions={[
          <IconButton
            key="reset"
            icon={<ResetIcon />}
            bordered
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
          <IconButton
            key="copy"
            icon={<CopyIcon />}
            bordered
            text={Locale.Chat.Config.SaveAs}
            onClick={() => {
              navigate(Path.Masks);
              setTimeout(() => {
                maskStore.create(session.mask);
              }, 500);
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
        <div
          className={clsx(styles["prompt-toast-inner"], "clickable")}
          role="button"
          onClick={props.onClick}
        >
          <BrainIcon />
          <span className={styles["prompt-toast-content"]}>
            {Locale.Context.Toast(context.length)}
          </span>
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
      className={clsx(styles["chat-input-action"], "clickable", {
        [styles["chat-input-action-disabled"]]: props.disabled,
      })}
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
      <div ref={iconRef} className={styles["icon"]}>
        {props.icon}
      </div>
      <div className={styles["text"]} ref={textRef}>
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

function useScrollToBottom(
  scrollRef: RefObject<HTMLDivElement>,
  detach: boolean = false,
  messages: ChatMessage[],
) {
  // for auto-scroll
  const [autoScroll, setAutoScroll] = useState(false);
  const fallbackScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const scrollDomToBottom = useCallback(() => {
    const dom = scrollRef.current;
    if (dom) {
      const runScroll = () => {
        setAutoScroll(true);
        dom.scrollTop = dom.scrollHeight;
      };

      requestAnimationFrame(runScroll);

      if (fallbackScrollTimerRef.current) {
        clearTimeout(fallbackScrollTimerRef.current);
      }
      fallbackScrollTimerRef.current = setTimeout(runScroll, 48);
    }
  }, [scrollRef]);

  // auto scroll when messages length changes (非流式期间)
  const lastMessagesLength = useRef(messages.length);
  useEffect(() => {
    if (autoScroll && messages.length > lastMessagesLength.current && !detach) {
      scrollDomToBottom();
    }
    lastMessagesLength.current = messages.length;
  }, [autoScroll, messages.length, detach, scrollDomToBottom]);

  useEffect(() => {
    return () => {
      if (fallbackScrollTimerRef.current) {
        clearTimeout(fallbackScrollTimerRef.current);
      }
    };
  }, []);

  return {
    scrollRef,
    autoScroll,
    setAutoScroll,
    scrollDomToBottom,
  };
}

export function ChatActions(props: {
  uploadImage: () => void;
  setAttachImages: (images: string[]) => void;
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
        return vendorName.trim();
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
        groupByKeywords("豆包", [
          "doubao",
          "seed",
          "bytedance",
          "volc",
          "字节",
        ]) ||
        groupByKeywords("千问", ["qwen", "alibaba", "tongyi", "阿里"]) ||
        groupByKeywords("Xiaomi", ["xiaomi", "mimo", "mi-mo"]) ||
        groupByKeywords("讯飞星火", ["iflytek", "xfyun", "spark", "讯飞"]) ||
        groupByKeywords("万物", ["01-ai", "01.ai", "yi-", "lingyi", "万物"]) ||
        groupByKeywords("StepFun", ["stepfun", "step-", "阶跃"]) ||
        groupByKeywords("混元", ["hunyuan", "tencent", "腾讯"]) ||
        groupByKeywords("文心", ["baidu", "ernie", "wenxin", "qianfan"]) ||
        groupByKeywords("智谱", ["z.ai", "z-ai", "zhipu", "chatglm", "glm-"]) ||
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
  const matchesModelCategory = (
    item: {
      title: string;
      meta?: ModelCategoryMetadata;
    },
    category: "image" | "video" | "web" | "thinking",
  ) => matchModelCategory(category, item);

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
  const latestOpenAIModel = useMemo(() => {
    const openAIModels = config.models.filter(
      (item) => item?.provider?.providerName === ServiceProvider.OpenAI,
    );
    const preferredPatterns = [
      /^gpt-5/i,
      /^gpt-4\.1/i,
      /^o4-mini/i,
      /^o3/i,
      /^gpt-4o$/i,
      /^gpt-4o-mini$/i,
      /^o1/i,
    ];

    for (const pattern of preferredPatterns) {
      const matched = openAIModels.find((item) => pattern.test(item.name));
      if (matched) {
        return matched;
      }
    }

    return openAIModels[0];
  }, [config.models]);
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
    const isSessionActivation = previousSessionIdRef.current !== sessionId;
    previousSessionIdRef.current = sessionId;
    const shouldShowCompatibilityToast =
      !sessionLoading && !isSessionActivation;

    if (supportsSizeControl && sessionModelConfigSize !== currentSize) {
      const previousSize = sessionModelConfigSize;
      chatStore.updateTargetSession(sessionRef.current, (session) => {
        session.mask.modelConfig.size = currentSize;
      });
      const adjustKey = `${currentModel}:${previousSize ?? ""}->${currentSize}`;
      if (
        shouldShowCompatibilityToast &&
        autoAdjustedSizeRef.current !== adjustKey
      ) {
        autoAdjustedSizeRef.current = adjustKey;
        showToast(`当前模型仅支持 ${currentSize}，已自动切换到兼容尺寸`);
      }
    }
    const normalizedQuality = normalizeImageQuality(
      currentModel,
      sessionModelConfigQuality,
    );
    if (
      supportsQualityControl &&
      sessionModelConfigQuality !== normalizedQuality
    ) {
      chatStore.updateTargetSession(sessionRef.current, (session) => {
        session.mask.modelConfig.quality = normalizedQuality as any;
      });
    }
  }, [
    chatStore,
    currentModel,
    currentSize,
    sessionId,
    sessionLoading,
    sessionModelConfigQuality,
    sessionModelConfigSize,
    supportsQualityControl,
    supportsSizeControl,
  ]);

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
                showToast(
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
            showToast(size);
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
            showToast(quality);
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
            showToast(style);
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
            showToast(`${seconds} 秒`);
          }}
        />
      )}
    </div>
  );
}

export function EditMessageModal(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const maskStore = useMaskStore();
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
    <div className={styles["delete-image"]} onClick={props.deleteImage}>
      <DeleteIcon />
    </div>
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

  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} key={key} src={url} alt="" />;
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

  const location = useLocation();
  const chatStore = useChatStore();
  const emptySessionRef = useRef(createEmptySession());
  const currentSessionSnapshot = useChatStore(
    (state) => state.sessions[state.currentSessionIndex],
  );
  const { session: loadedSession, loading: sessionLoading } =
    useCurrentSession();
  const session = loadedSession ?? currentSessionSnapshot;
  const liveSession = currentSessionSnapshot ?? session;
  const safeSession = session ?? emptySessionRef.current;

  useEffect(() => {
    if (!safeSession?.id || typeof window === "undefined") {
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
  const autoModelSeries = useAppConfig((state) => state.autoModelSeries);

  const [showExport, setShowExport] = useState(false);
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
  const attachLimitHintTimerRef = useRef<number | null>(null);
  const inputScrollIndicatorHideTimerRef = useRef<number | null>(null);
  const syncInputScrollIndicatorRef = useRef<(visible?: boolean) => void>(
    () => {},
  );
  const mobileInputPreservedHeightRef = useRef("44px");
  const mobileInputMeasuredHeightRef = useRef(44);
  const preserveMobileInputBlurHeightRef = useRef(false);
  const collapseTimersRef = useRef<number[]>([]);
  const mobileBlurTimerRef = useRef<number | null>(null);
  const pendingMobileSubmitScrollRestoreRef = useRef(false);
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
  const balancePanelRef = useRef<HTMLDivElement>(null);
  const balancePanelOverlapRafRef = useRef<number | null>(null);
  const mobileViewportRafRef = useRef<number | null>(null);
  const mobileViewportReleaseTimersRef = useRef<number[]>([]);
  const mobileKeyboardOpenedSinceFocusRef = useRef(false);
  const mobileKeyboardDismissByViewportRef = useRef(false);
  const mobileKeyboardStableMetricsRef = useRef<{
    visualHeight: number;
    accessoryInset: number;
    overlapCorrection: number;
    fillHeight: number;
  } | null>(null);
  const syncReadyFocusSessionRef = useRef("");
  const [userInput, setUserInput] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editInputRows, setEditInputRows] = useState(1);
  const [editMobileMessageId, setEditMobileMessageId] = useState<string | null>(
    null,
  );
  const [isInputHintOverflow, setIsInputHintOverflow] = useState(false);
  const [isMobileInputFocused, setIsMobileInputFocused] = useState(false);
  const [preserveMobileInputBlurHeight, setPreserveMobileInputBlurHeight] =
    useState(false);
  const [balancePanelOverlapsMessages, setBalancePanelOverlapsMessages] =
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
  const effectiveAuthUser = useAuthStore((state) => state.effectiveUser);
  const { submitKey, shouldSubmit } = useSubmitHandler();
  const scrollRef = useRef<HTMLDivElement>(null);
  const historyAutoBottomSessionRef = useRef("");
  const pendingInitialBottomSessionRef = useRef<string | null>(null);
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
  const { setAutoScroll, scrollDomToBottom } = useScrollToBottom(
    scrollRef,
    false,
    sessionMessages,
  );
  const [hitBottom, setHitBottom] = useState(true);
  const isMobileScreen = useMobileScreen();
  const isIOSMobile = useMemo(
    () => isMobileScreen && isIOS(),
    [isMobileScreen],
  );
  const { width: windowWidth } = useWindowSize();
  const [showBalanceUserPanel, setShowBalanceUserPanel] = useState(
    () => !isMobileScreen,
  );

  useEffect(() => {
    setShowBalanceUserPanel(!isMobileScreen);
  }, [isMobileScreen]);

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
  const [attachImages, setAttachImages] = useState<string[]>([]);
  const [attachLimitHint, setAttachLimitHint] = useState("");
  const [uploading, setUploading] = useState(false);
  const lastAssistantSignatureRef = useRef("");
  const streamingScrollResumeTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const streamingAutoScrollPausedRef = useRef(false);
  const userScrollIntentRef = useRef(false);
  const inputFontSize = isMobileScreen
    ? Math.max(Number(config.fontSize) || 16, 16)
    : config.fontSize;
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
  const hasAssistantLoadingBubbles = useMemo(
    () => sessionMessages.some(isStaleAssistantLoadingBubble),
    [isStaleAssistantLoadingBubble, sessionMessages],
  );

  // current model name
  const currentRawModel = sessionMask?.modelConfig?.model || "";
  const currentModel = normalizeReservedDisplayModelName(
    sessionMask?.modelConfig?.model || "",
  );
  const currentProviderName =
    sessionMask?.modelConfig?.providerName || ServiceProvider.OpenAI;

  // 模型选择器所需变量
  const allModels = useAllModels();
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
  const currentProviderDisplayName =
    currentProviderName === ServiceProvider.Custom ||
    currentProviderName === ServiceProvider.Local
      ? currentProfile?.name ||
        currentActiveProviderProfile?.name ||
        currentProviderName
      : currentProfile?.name || currentProviderName;
  const activeModelSelectorProviderId = getActiveModelSelectorProviderId({
    showModelSelector,
    modelSelectorProviderId,
    currentProviderId,
  });
  const activeModelSelectorProfile = useMemo(
    () =>
      apiProfiles.find(
        (profile) =>
          getProfileProviderId(profile).toLowerCase() ===
          activeModelSelectorProviderId,
      ),
    [activeModelSelectorProviderId, apiProfiles],
  );
  const activeModelSelectorProviderDisplayName =
    activeModelSelectorProfile?.name || currentProviderDisplayName;
  const autoModeEnabled = autoModelSeries.length > 0;
  const latestAutoModeProviderMessage = useMemo(() => {
    if (!autoModeEnabled) {
      return null;
    }

    return (
      [...sessionMessages]
        .reverse()
        .find(
          (message) =>
            message?.role === "assistant" &&
            !message.isError &&
            Boolean(
              message.profileId ||
                message.providerId ||
                getMessageProviderDisplayName(message, apiProfiles),
            ),
        ) || null
    );
  }, [apiProfiles, autoModeEnabled, sessionMessages]);
  const latestAutoModeProviderDisplayName = useMemo(() => {
    if (!latestAutoModeProviderMessage) {
      return "";
    }

    return getMessageProviderDisplayName(
      latestAutoModeProviderMessage,
      apiProfiles,
    );
  }, [apiProfiles, latestAutoModeProviderMessage]);
  const autoModeBalanceProfile = useMemo(() => {
    if (!autoModeEnabled || !latestAutoModeProviderMessage) {
      return undefined;
    }

    const latestProfileId = String(
      latestAutoModeProviderMessage.profileId || "",
    );
    const latestProviderKeys = [
      latestAutoModeProviderMessage.providerId,
      latestAutoModeProviderMessage.providerName,
      latestAutoModeProviderDisplayName,
    ]
      .map(normalizeProviderLookup)
      .filter(Boolean);
    const matchProfileByProviderIdentity = (profile: {
      provider: string;
      name: string;
    }) => {
      const profileProviderId = getProfileProviderId(profile);
      const profileKeys = [
        profile.name,
        profile.provider,
        profileProviderId,
        profileProviderId.replace(/^(custom|local)_/i, ""),
      ]
        .map(normalizeProviderLookup)
        .filter(Boolean);

      return latestProviderKeys.some((key) => profileKeys.includes(key));
    };

    return apiProfiles.find((profile) => {
      if (!profile.enabled) {
        return false;
      }

      return (
        (!!latestProfileId && profile.id === latestProfileId) ||
        matchProfileByProviderIdentity(profile)
      );
    });
  }, [
    apiProfiles,
    autoModeEnabled,
    latestAutoModeProviderMessage,
    latestAutoModeProviderDisplayName,
  ]);
  const latestAutoModeProviderId = String(
    latestAutoModeProviderMessage?.providerId || "",
  )
    .toLowerCase()
    .trim();
  const fallbackBalanceProfile = useMemo(
    () =>
      apiProfiles.find((profile) => {
        if (!profile.enabled) {
          return false;
        }

        if (profile.provider === ServiceProvider.Custom) {
          return !!profile.baseUrl && !!profile.apiKey;
        }

        return profile.provider === ServiceProvider.Local;
      }),
    [apiProfiles],
  );
  const balanceProviderName = autoModeEnabled
    ? autoModeBalanceProfile?.provider ||
      (latestAutoModeProviderId.startsWith("custom_")
        ? ServiceProvider.Custom
        : undefined)
    : currentProviderName === ServiceProvider.Custom ||
      currentProviderName === ServiceProvider.Local
    ? currentProviderName
    : fallbackBalanceProfile?.provider;
  const balanceProfile = autoModeEnabled
    ? autoModeBalanceProfile
    : balanceProviderName === currentProviderName
    ? currentProfile || currentActiveProviderProfile
    : fallbackBalanceProfile;
  const balanceProviderDisplayName = autoModeEnabled
    ? balanceProfile?.name || latestAutoModeProviderDisplayName
    : balanceProfile?.name || balanceProviderName || currentProviderDisplayName;
  const currentBalanceCacheKey = useMemo(
    () =>
      balanceProviderName
        ? buildBalanceCacheKey(balanceProviderName, balanceProfile)
        : "",
    [balanceProfile, balanceProviderName],
  );

  useEffect(() => {
    if (!currentSessionHasMessages || !latestAssistantModelSelection) {
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
    sessionMask.modelConfig,
  ]);

  const selectedAutoModelSeries = autoModelSeries[0];
  const selectedAutoModelSeriesLabel = selectedAutoModelSeries
    ? getAutoModelSeriesLabel(selectedAutoModelSeries)
    : "";
  const manualModelSelectionDisabled = autoModeEnabled;
  const autoModeDefaultCandidate = useMemo(() => {
    if (!autoModeEnabled) {
      return null;
    }

    const candidates = buildAutoModelCandidates(
      allModels,
      apiProfiles,
      autoModelSeries as AutoModelSeriesKey[],
    );

    return candidates[0] ?? null;
  }, [allModels, apiProfiles, autoModeEnabled, autoModelSeries]);
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
        return vendorName.trim();
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
        groupByKeywords("豆包", [
          "doubao",
          "seed",
          "bytedance",
          "volc",
          "字节",
        ]) ||
        groupByKeywords("千问", ["qwen", "alibaba", "tongyi", "阿里"]) ||
        groupByKeywords("Xiaomi", ["xiaomi", "mimo", "mi-mo"]) ||
        groupByKeywords("讯飞星火", ["iflytek", "xfyun", "spark", "讯飞"]) ||
        groupByKeywords("万物", ["01-ai", "01.ai", "yi-", "lingyi", "万物"]) ||
        groupByKeywords("StepFun", ["stepfun", "step-", "阶跃"]) ||
        groupByKeywords("混元", ["hunyuan", "tencent", "腾讯"]) ||
        groupByKeywords("文心", ["baidu", "ernie", "wenxin", "qianfan"]) ||
        groupByKeywords("智谱", ["z.ai", "z-ai", "zhipu", "chatglm", "glm-"]) ||
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
  const matchesModelCategory = (
    item: {
      title: string;
      meta?: ModelCategoryMetadata;
    },
    category: "image" | "video" | "web" | "thinking",
  ) => matchModelCategory(category, item);
  const isImageGenerationModel = useCallback(
    (item: any) => matchesModelCategory(item, "image"),
    [],
  );
  const isVideoGenerationModel = useCallback(
    (item: any) => matchesModelCategory(item, "video"),
    [],
  );
  const isWebSearchModel = useCallback(
    (item: any) => matchesModelCategory(item, "web"),
    [],
  );
  const isThinkingModel = useCallback(
    (item: any) => matchesModelCategory(item, "thinking"),
    [],
  );
  const models = useMemo(() => {
    // 只显示用户手动添加的模型（customModels 中 + 前缀的条目）
    const customModels = String(config.customModels || "");
    const userAddedKeys = new Set(
      customModels
        .split(",")
        .map((m) => m.trim())
        .filter((m) => m.startsWith("+"))
        .map((m) => {
          const cleaned = m.substring(1);
          return cleaned.toLowerCase();
        }),
    );
    if (userAddedKeys.size === 0) return [];

    const result = allModels.filter((model) => {
      const modelKey = `${model.name}@${String(
        model?.provider?.id || "",
      ).toLowerCase()}`;
      return (
        model.available &&
        userAddedKeys.has(modelKey) &&
        String(model?.provider?.id || "").toLowerCase() ===
          activeModelSelectorProviderId
      );
    });

    // 调试：检查为什么某些供应商模型不显示
    const matchedKeys = [...userAddedKeys].filter((k) =>
      k.includes(activeModelSelectorProviderId),
    );
    if (matchedKeys.length > 0 && result.length === 0) {
      console.log(
        "[模型选择器调试] 当前供应商：",
        activeModelSelectorProviderId,
      );
      console.log(
        "[模型选择器调试] 用户已添加模型中匹配该供应商的条目：",
        matchedKeys,
      );
      console.log(
        "[模型选择器调试] 全部模型中该供应商的模型：",
        allModels
          .filter(
            (m) =>
              String(m?.provider?.id || "").toLowerCase() ===
              activeModelSelectorProviderId,
          )
          .map((m) => `${m.name}@${m?.provider?.id} available=${m.available}`),
      );
    }

    return result;
  }, [activeModelSelectorProviderId, allModels, config.customModels]);
  const providerModelSelectorItems = useMemo(() => {
    return models
      .map((model) => ({
        title: `${model.displayName}`,
        searchText: [
          model.name,
          model.displayName,
          model.provider?.providerName,
          model.vendor?.name,
          ...(model.capabilities || []),
          ...(model.features || []),
          ...(model.types || []),
          ...(model.categories || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
        sortKey: model.name,
        value: `${model.name}@${String(
          model?.provider?.id || "",
        ).toLowerCase()}`,
        disable: manualModelSelectionDisabled,
        order: model.sorted,
        publishedAt: model.publishedAt,
        publishedAtSource: model.publishedAtSource,
        catalogRank: model.catalogRank,
        group: globalCustomModelValueSet.has(
          `${model.name}@${model?.provider?.providerName}`,
        )
          ? "自定义模型"
          : getModelGroup(
              model.name,
              model?.provider?.providerName,
              model?.vendor?.name,
              model.displayName,
            ),
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
      }))
      .sort(compareSelectorItems);
  }, [
    globalCustomModelValueSet,
    getModelGroup,
    manualModelSelectionDisabled,
    models,
  ]);

  const modelSelectorItems = useMemo(() => {
    const effectiveProviderItems = providerModelSelectorItems;

    if (!manualModelSelectionDisabled) {
      return effectiveProviderItems;
    }

    return effectiveProviderItems.map((item) => ({
      ...item,
      disable: true,
    }));
  }, [manualModelSelectionDisabled, providerModelSelectorItems]);
  const currentModelName = useMemo(() => {
    const matchedModel = models.find(
      (model) =>
        model.name === currentModel &&
        String(model?.provider?.id || "").toLowerCase() ===
          activeModelSelectorProviderId,
    );
    return matchedModel?.displayName ?? currentModel;
  }, [activeModelSelectorProviderId, currentModel, models]);
  const modelSelectionDisabledToast = "自动模式已启用，模型选择禁用";
  const handleManualModelSelectionDisabled = () => {
    setModelSelectorNotice(modelSelectionDisabledToast);
    if (modelSelectorNoticeTimerRef.current) {
      clearTimeout(modelSelectorNoticeTimerRef.current);
    }
    modelSelectorNoticeTimerRef.current = setTimeout(() => {
      setModelSelectorNotice("");
      modelSelectorNoticeTimerRef.current = null;
    }, 2200);
  };
  const autoModeButtonText = autoModeEnabled
    ? `自动模式（${selectedAutoModelSeriesLabel}）`
    : "自动模式（未开启）";
  const modelSelectorButtonText = autoModeEnabled ? (
    <>{autoModeButtonText}</>
  ) : (
    <>
      <span className={styles["provider-button-name"]}>
        {activeModelSelectorProviderDisplayName}
      </span>{" "}
      {isModelConfigSyncConfirmed && (
        <span className={styles["provider-button-model"]}>
          {currentModelName}
        </span>
      )}
    </>
  );
  const modelSelectorButtonTitle = autoModeEnabled
    ? autoModeButtonText
    : `${activeModelSelectorProviderDisplayName} ${currentModelName}`;
  const currentDisplaySelectorValue = `${currentRawModel}@${
    activeModelSelectorProviderId || String(currentProviderName).toLowerCase()
  }`;
  // 供应商选择器相关
  const [isProviderSelectorOpen, setIsProviderSelectorOpen] = useState(false);
  const [modelSelectorResetKey, setModelSelectorResetKey] = useState(0);
  const [providerSwitchToast, setProviderSwitchToast] = useState<{
    show: boolean;
    message: string;
  }>({ show: false, message: "" });
  const [suppressBalanceAutoRefresh, setSuppressBalanceAutoRefresh] =
    useState(false);
  const [modelSelectorNotice, setModelSelectorNotice] = useState("");
  const lastProviderSwitchTimeRef = useRef(0);
  const latestOpenAIAutoCheckKeyRef = useRef("");
  const modelSelectorOpenStartedAtRef = useRef(0);
  const modelSelectorNoticeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const balanceAutoRefreshResumeTimerRef = useRef<NodeJS.Timeout | null>(null);
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

    return providers.length > 0 ? providers : [];
  }, [apiProfiles]);

  const ensureLatestOpenAIModelForProfile = useCallback(
    (
      profile: {
        id?: string;
        name: string;
        provider: ServiceProvider;
        cachedModels?: string;
      },
      reason: string,
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
      const appConfigState = useAppConfig.getState();
      let latestCustomModels = appConfigState.customModels || "";
      let addedProviderModels = buildProviderModelsFromAddedCustomModels(
        latestCustomModels,
        selectedProviderId,
        profile.provider,
      );
      const cachedProviderModels = buildProviderModelsFromCachedNames(
        cachedProfileModels,
        selectedProviderId,
        profile.provider,
      );
      const providerModelCandidates = [
        ...initialProviderModels,
        ...addedProviderModels,
        ...cachedProviderModels,
      ];
      const latestOpenAIModelName = isAiHubMixProviderId(selectedProviderId)
        ? AIHUBMIX_PREFERRED_OPENAI_CHAT_MODEL_NAME
        : getLatestOpenAIModelForProviderId(
            providerModelCandidates,
            selectedProviderId,
          )?.model ||
          getLatestOpenAIModelName([
            ...allModels,
            ...providerModelCandidates,
          ]) ||
          LATEST_OPENAI_CHAT_MODEL_NAME;

      if (
        latestOpenAIModelName &&
        !hasProviderModel(
          addedProviderModels,
          latestOpenAIModelName,
          selectedProviderId,
        )
      ) {
        const nextCustomModels = addCustomModelEntry(
          latestCustomModels,
          latestOpenAIModelName,
          selectedProviderId,
        );
        if (nextCustomModels.added) {
          latestCustomModels = nextCustomModels.customModels;
          useAppConfig.getState().update((state) => {
            state.customModels = nextCustomModels.customModels;
            (state as any).customModelsUpdatedAt = Date.now();
          });
          console.info("[模型选择器] 已自动补充最新 OpenAI 模型", {
            原因: formatModelSelectorReason(reason),
            配置名称: profile.name,
            供应商ID: selectedProviderId,
            模型: latestOpenAIModelName,
          });
        }
        addedProviderModels = buildProviderModelsFromAddedCustomModels(
          latestCustomModels,
          selectedProviderId,
          profile.provider,
        );
      }

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

  const ensureLatestOpenAIModelsForAllProfiles = useCallback(
    (reason: string) => {
      apiProfiles.forEach((profile) => {
        ensureLatestOpenAIModelForProfile(profile as any, reason);
      });
    },
    [apiProfiles, ensureLatestOpenAIModelForProfile],
  );

  const applyLatestOpenAIModelForProfile = useCallback(
    (
      profile: {
        id?: string;
        name: string;
        provider: ServiceProvider;
        cachedModels?: string;
      },
      reason: string,
    ) => {
      const {
        addedProviderModels,
        cachedProviderModels,
        initialProviderModels,
        selectedProviderId,
      } = ensureLatestOpenAIModelForProfile(profile, reason);
      const providerModels = [
        ...initialProviderModels,
        ...addedProviderModels,
        ...cachedProviderModels,
      ];
      const latestOpenAIModel = isAiHubMixProviderId(selectedProviderId)
        ? ({
            model: AIHUBMIX_PREFERRED_OPENAI_CHAT_MODEL_NAME,
            providerName: profile.provider,
          } as const)
        : getLatestOpenAIModelForProviderId(
            providerModels,
            selectedProviderId,
          ) ||
          ({
            model: LATEST_OPENAI_CHAT_MODEL_NAME,
            providerName: profile.provider,
          } as const);
      const latestSession = chatStore.currentSession();
      if (!latestSession) {
        return;
      }
      const latestSessionSummary = useChatStore
        .getState()
        .sessionSummaries.find((summary) => summary.id === latestSession.id);
      const latestSessionHasMessages =
        latestSession.messages.length > 0 ||
        Number(latestSessionSummary?.messageCount || 0) > 0;
      if (reason === "page-refresh" && latestSessionHasMessages) {
        return;
      }
      const shouldDeferAutoApplyUntilSyncReady =
        syncProvider === ProviderType.Database &&
        (!criticalSyncReady || criticalSyncInProgress) &&
        [
          "page-refresh",
          "model-selector-open",
          "model-manager-open",
          "model-manager-close",
        ].includes(reason);
      if (shouldDeferAutoApplyUntilSyncReady) {
        console.info("[模型选择器] 最新 OpenAI 模型应用已延后", {
          原因: formatModelSelectorReason(reason),
          配置名称: profile.name,
          供应商类型: profile.provider,
          供应商ID: selectedProviderId,
          模型: latestOpenAIModel.model,
        });
        return;
      }

      const nextModelConfig = sanitizeModelConfigForCapability({
        ...latestSession.mask.modelConfig,
        model: latestOpenAIModel.model as ModelType,
        providerName: latestOpenAIModel.providerName as ServiceProvider,
      });
      (nextModelConfig as any).providerId = selectedProviderId;
      (nextModelConfig as any).profileId = profile.id || "";

      if (
        !areModelConfigValuesEqual(
          latestSession.mask.modelConfig as Record<string, unknown>,
          nextModelConfig as Record<string, unknown>,
        )
      ) {
        chatStore.updateTargetSession(latestSession, (session) => {
          session.mask.modelConfig = nextModelConfig;
          session.mask.syncGlobalConfig = true;
        });
      }

      localStorage.setItem(MODEL_SELECTOR_PROVIDER_STORAGE_KEY, profile.name);
      localStorage.setItem(
        LAST_MODEL_SELECTION_STORAGE_KEY,
        `${latestOpenAIModel.model}@${selectedProviderId}`,
      );
      console.info("[模型选择器] 已应用最新 OpenAI 模型", {
        原因: formatModelSelectorReason(reason),
        对话ID: latestSession.id,
        配置名称: profile.name,
        供应商类型: profile.provider,
        供应商ID: selectedProviderId,
        模型: latestOpenAIModel.model,
      });
    },
    [
      chatStore,
      criticalSyncInProgress,
      criticalSyncReady,
      ensureLatestOpenAIModelForProfile,
      syncProvider,
    ],
  );

  useEffect(() => {
    if (!currentProfile || !currentProviderId || allModels.length === 0) {
      return;
    }

    const latestOpenAIModelName = getLatestOpenAIModelName(allModels);
    const checkKey = [
      currentProfile.id || currentProfile.name,
      currentProviderId,
      latestOpenAIModelName || "",
      useAppConfig.getState().customModels || "",
    ].join("|");

    if (latestOpenAIAutoCheckKeyRef.current === checkKey) {
      return;
    }
    latestOpenAIAutoCheckKeyRef.current = checkKey;

    ensureLatestOpenAIModelsForAllProfiles("page-refresh");
    applyLatestOpenAIModelForProfile(currentProfile as any, "page-refresh");
  }, [
    allModels,
    applyLatestOpenAIModelForProfile,
    currentProfile,
    currentProviderId,
    ensureLatestOpenAIModelsForAllProfiles,
  ]);

  useEffect(() => {
    if (!showModelSelector) {
      setModelSelectorProviderId("");
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
    if (!autoModeEnabled) return;
    setIsProviderSelectorOpen(false);
  }, [autoModeEnabled]);

  useEffect(() => {
    return () => {
      if (modelSelectorNoticeTimerRef.current) {
        clearTimeout(modelSelectorNoticeTimerRef.current);
      }
      if (balanceAutoRefreshResumeTimerRef.current) {
        clearTimeout(balanceAutoRefreshResumeTimerRef.current);
      }
    };
  }, []);

  const providerSwitchDisabled = useMemo(() => {
    return false;
  }, []);

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

  const handleModelSelectorBlockedDuringSync = useCallback(() => {
    setProviderSwitchToast({
      show: true,
      message: "模型同步中，完成后再打开模型选择器",
    });
    window.setTimeout(() => {
      setProviderSwitchToast((prev) => ({ ...prev, show: false }));
    }, 2200);
  }, []);

  const openAIModels = models.filter(
    (m) => m?.provider?.providerName === ServiceProvider.OpenAI,
  );
  const latestOpenAIModel = useMemo(() => {
    if (openAIModels.length === 0) return undefined;

    const preferredPatterns = [/^gpt-4o/, /^gpt-4/, /^gpt-3.5-turbo/, /^o1/];

    for (const pattern of preferredPatterns) {
      const matched = openAIModels.find((item) => pattern.test(item.name));
      if (matched) {
        return matched;
      }
    }

    return openAIModels[0];
  }, [openAIModels]);
  const modelSelectorQuickFilters = useMemo(
    () => [
      {
        key: "image",
        label: "图片模型",
        match: (item: any) => isImageGenerationModel(item),
      },
      {
        key: "video",
        label: "视频模型",
        match: (item: any) => isVideoGenerationModel(item),
      },
      {
        key: "web-search",
        label: "联网模型",
        match: (item: any) => isWebSearchModel(item),
      },
      {
        key: "thinking",
        label: "思考模型",
        match: (item: any) => isThinkingModel(item),
      },
    ],
    [
      isImageGenerationModel,
      isThinkingModel,
      isVideoGenerationModel,
      isWebSearchModel,
    ],
  );

  // prompt hints
  const promptStore = usePromptStore();
  const [promptHints, setPromptHints] = useState<RenderPrompt[]>([]);
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
    new: () => chatStore.newSession(),
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
      mobileInputRef.current?.blur();
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
  }, []);

  const doSubmit = (userInput: string) => {
    if (userInput.trim() === "" && isEmpty(attachImages)) return;

    // Handle mobile edit mode: resend edited message
    if (editMobileMessageId) {
      const message = sessionMessages.find((m) => m.id === editMobileMessageId);
      if (message) {
        setEditMobileMessageId(null);
        onResend(message, userInput, attachImages);
        setAttachImages([]);
        return;
      }
    }

    const matchCommand = chatCommands.match(userInput);
    if (matchCommand.matched) {
      setUserInput("");
      setPromptHints([]);
      matchCommand.invoke();
      if (isMobileScreen) {
        setIsMobileInputFocused(false);
        blurMobileKeyboard();
      }
      return;
    }
    setIsLoading(true);
    chatStore.onUserInput(userInput, attachImages).then(() => {
      setIsLoading(false);
      if (isMobileScreen) {
        scrollDomToBottom();
      }
    });
    setAttachImages([]);
    localStorage.removeItem(unfinishedAttachImagesKey);
    localStorage.removeItem(ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY);
    chatStore.setLastInput(userInput);
    setUserInput("");
    setPromptHints([]);
    if (isMobileScreen) {
      pendingMobileSubmitScrollRestoreRef.current = true;
      setIsMobileInputFocused(false);
      blurMobileKeyboard();
      setAutoScroll(true);
      setHitBottom(true);
      [50, 180, 420, 760].forEach((delay) => {
        window.setTimeout(() => {
          window.scrollTo(0, 0);
          forceScrollToBottom();
        }, delay);
      });
    } else {
      (isMobileScreen ? mobileInputRef.current : inputRef.current)?.focus();
    }
  };

  const onPromptSelect = (prompt: RenderPrompt) => {
    setPromptHints([]);
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

  const togglePromptHints = useCallback(() => {
    if (promptHints.length > 0) {
      setPromptHints([]);
      return;
    }

    if (!isMobileScreen) {
      inputRef.current?.focus();
    }
    onSearch("");
  }, [onSearch, promptHints.length, isMobileScreen]);

  // stop response
  const onUserStop = (messageId: string) => {
    ChatControllerPool.stop(session.id, messageId);
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

      return m.content.length === 0;
    });

    if (!shouldNormalizeMessages) {
      return;
    }

    chatStore.updateTargetSession(session, (session) => {
      session.messages = session.messages.filter(
        (m) => !isStaleAssistantLoadingBubble(m),
      );
      session.messages.forEach((m) => {
        const hasActiveController =
          Boolean(m.streaming) &&
          Boolean(m.id) &&
          ChatControllerPool.has(session.id, m.id);
        const shouldInterruptStaleStreaming =
          Boolean(m.streaming) && (!m.id || !hasActiveController);
        const shouldNormalizeEmptyResponse =
          (m.isError || new Date(m.date).getTime() < stopTiming) &&
          m.content.length === 0;

        if (!shouldInterruptStaleStreaming && !shouldNormalizeEmptyResponse) {
          return;
        }

        if (shouldInterruptStaleStreaming) {
          const interruptedSuffix = "\n\n响应因页面刷新而中断";
          const currentContent = getMessageTextContent(m).trimEnd();
          m.streaming = false;
          m.isError = true;
          m.content = currentContent
            ? currentContent.endsWith("响应因页面刷新而中断")
              ? currentContent
              : `${currentContent}${interruptedSuffix}`
            : "响应因页面刷新而中断";
        }

        if (shouldNormalizeEmptyResponse) {
          m.streaming = false;
          m.isError = true;
          m.content = prettyObject({
            error: true,
            message: "empty response",
          });
        }
      });
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
      !autoModeEnabled &&
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
      !autoModeEnabled &&
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
      if (
        autoModeEnabled &&
        autoModeDefaultCandidate &&
        !currentSessionHasMessages
      ) {
        nextModelConfig = sanitizeModelConfigForCapability(
          applyAutoModeModelConfig(nextModelConfig, {
            model: autoModeDefaultCandidate.model as ModelType,
            providerName: autoModeDefaultCandidate.providerName,
          }),
        );
      } else if (!autoModeEnabled && !currentSessionHasMessages) {
        nextModelConfig = sanitizeModelConfigForCapability({
          ...nextModelConfig,
          ...(getPreferredDefaultChatModel(
            allModels,
            nextModelConfig,
            apiProfiles,
          ) || {}),
        });
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
      !autoModeEnabled &&
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
  }, [
    autoModeDefaultCandidate,
    autoModeEnabled,
    config.modelConfig,
    allModels,
    apiProfiles,
    currentSessionHasMessages,
  ]);

  // check if should send message
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
      doSubmit(userInput);
      e.preventDefault();
    }
  };

  const onMobileInputKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
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
    setAttachImages([]);
    setIsMobileInputFocused(false);
    localStorage.removeItem(unfinishedInputKey);
    localStorage.removeItem(ACTIVE_UNFINISHED_INPUT_KEY);
    localStorage.removeItem(unfinishedAttachImagesKey);
    localStorage.removeItem(ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY);
    (isMobileScreen ? mobileInputRef.current : inputRef.current)?.blur();

    // 保留原用户消息，只移除旧的 AI 回复，避免重试时用户输入闪烁。
    if (botMessage?.id) {
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
    chatStore
      .onUserInput(textContent, images, undefined, {
        reuseUserMessageId: userMessage.id,
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
    _setMsgRenderIndex(Math.max(0, renderMessages.length - CHAT_PAGE_SIZE));
    setHitBottom(true);
  }, [safeSession.id, renderMessages.length]);

  useLayoutEffect(() => {
    pendingInitialBottomSessionRef.current = safeSession.id || null;
  }, [safeSession.id]);

  const updateBalancePanelOverlap = useCallback(() => {
    if (typeof window === "undefined") return;

    if (balancePanelOverlapRafRef.current !== null) {
      window.cancelAnimationFrame(balancePanelOverlapRafRef.current);
    }

    balancePanelOverlapRafRef.current = window.requestAnimationFrame(() => {
      balancePanelOverlapRafRef.current = null;

      const panel = balancePanelRef.current;
      const chatBody = scrollRef.current;

      if (!panel || !chatBody || !showBalanceUserPanel) {
        setBalancePanelOverlapsMessages(false);
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

      setBalancePanelOverlapsMessages(overlaps);
    });
  }, [isMobileScreen, showBalanceUserPanel]);

  useEffect(() => {
    updateBalancePanelOverlap();
    window.addEventListener("resize", updateBalancePanelOverlap);

    return () => {
      window.removeEventListener("resize", updateBalancePanelOverlap);
      if (balancePanelOverlapRafRef.current !== null) {
        window.cancelAnimationFrame(balancePanelOverlapRafRef.current);
        balancePanelOverlapRafRef.current = null;
      }
    };
  }, [
    messages.length,
    msgRenderIndex,
    safeSession.id,
    showBalanceUserPanel,
    updateBalancePanelOverlap,
  ]);

  useEffect(() => {
    updateBalancePanelOverlap();
  }, [
    isMobileInputFocused,
    isMobileScreen,
    userInput,
    attachImages.length,
    updateBalancePanelOverlap,
  ]);

  const clearStreamingScrollResumeTimer = useCallback(() => {
    if (streamingScrollResumeTimerRef.current) {
      clearTimeout(streamingScrollResumeTimerRef.current);
      streamingScrollResumeTimerRef.current = null;
    }
  }, []);

  const onChatBodyScroll = (e: HTMLElement) => {
    updateBalancePanelOverlap();

    const bottomHeight = e.scrollTop + e.clientHeight;
    const edgeThreshold = e.clientHeight;

    const isTouchTopEdge = e.scrollTop <= edgeThreshold;
    const isTouchBottomEdge = bottomHeight >= e.scrollHeight - edgeThreshold;
    const isHitBottom =
      bottomHeight >= e.scrollHeight - (isMobileScreen ? 4 : 10);

    const prevPageMsgIndex = msgRenderIndex - CHAT_PAGE_SIZE;
    const nextPageMsgIndex = msgRenderIndex + CHAT_PAGE_SIZE;

    if (isTouchTopEdge && !isTouchBottomEdge) {
      setMsgRenderIndex(prevPageMsgIndex);
    } else if (isTouchBottomEdge) {
      setMsgRenderIndex(nextPageMsgIndex);
    }

    setHitBottom(isHitBottom);
    if (isAssistantStreaming) {
      if (isHitBottom) {
        clearStreamingScrollResumeTimer();
        streamingAutoScrollPausedRef.current = false;
        setAutoScroll(true);
        return;
      }

      if (userScrollIntentRef.current) {
        streamingAutoScrollPausedRef.current = true;
        setAutoScroll(false);
      }
      return;
    }

    setAutoScroll(isHitBottom);
  };

  const scrollToBottom = useCallback(() => {
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);
    scrollDomToBottom();
  }, [renderMessages.length, scrollDomToBottom, setMsgRenderIndex]);

  const jumpToBottom = useCallback(() => {
    setAutoScroll(true);
    setHitBottom(true);
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);

    const dom = scrollRef.current;
    if (dom) {
      dom.scrollTop = dom.scrollHeight;
    }
  }, [
    renderMessages.length,
    scrollRef,
    setAutoScroll,
    setHitBottom,
    setMsgRenderIndex,
  ]);

  const forceScrollToBottom = useCallback(() => {
    if (typeof window === "undefined") return;
    setAutoScroll(true);
    setHitBottom(true);
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);

    const runScroll = () => {
      setAutoScroll(true);
      setHitBottom(true);
      scrollDomToBottom();
    };

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(runScroll);
    });
    [48, 120, 260, 420].forEach((delay) => {
      window.setTimeout(runScroll, delay);
    });
  }, [
    renderMessages.length,
    scrollDomToBottom,
    setAutoScroll,
    setHitBottom,
    setMsgRenderIndex,
  ]);

  const refreshTouchTriggeredRef = useRef(false);
  const handleSessionRefresh = useCallback(() => {
    forceScrollToBottom();
    showToast(Locale.Chat.Actions.RefreshToast);
    chatStore.summarizeSession(true, session);
  }, [chatStore, forceScrollToBottom, session]);

  const scrollToBottomTouchTriggeredRef = useRef(false);
  const markUserScrollIntent = useCallback(() => {
    if (isAssistantStreaming) {
      userScrollIntentRef.current = true;
    }
  }, [isAssistantStreaming]);
  const handleScrollToBottomButton = useCallback(
    (immediate: boolean) => {
      userScrollIntentRef.current = false;
      streamingAutoScrollPausedRef.current = false;
      setAutoScroll(true);
      setHitBottom(true);

      if (immediate) {
        forceScrollToBottom();
        return;
      }

      setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    },
    [
      forceScrollToBottom,
      renderMessages.length,
      setAutoScroll,
      setHitBottom,
      setMsgRenderIndex,
    ],
  );

  const scrollToTopOnIOS = useCallback(() => {
    if (!isIOSMobile) return;

    mobileInputRef.current?.blur();
    setAutoScroll(false);
    setHitBottom(false);
    setMsgRenderIndex(0);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: 0,
          behavior: "smooth",
        });
      });
    });
  }, [isIOSMobile, setAutoScroll, setMsgRenderIndex]);

  const moveInputCursorToEnd = useCallback(() => {
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
  }, [mobileInputHasText]);

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
    (message = `最多只能添加${MAX_ATTACH_IMAGES}张图片`) => {
      if (typeof window === "undefined") {
        return;
      }

      setAttachLimitHint(message);
      if (attachLimitHintTimerRef.current !== null) {
        window.clearTimeout(attachLimitHintTimerRef.current);
      }
      attachLimitHintTimerRef.current = window.setTimeout(() => {
        setAttachLimitHint("");
        attachLimitHintTimerRef.current = null;
      }, 1800);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (
        typeof window !== "undefined" &&
        attachLimitHintTimerRef.current !== null
      ) {
        window.clearTimeout(attachLimitHintTimerRef.current);
      }
    };
  }, []);

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
    const hasAttachImages = attachImages.length > 0;
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
        if (attachImages.length > 0 && mobileInputHasText) {
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
    attachImages.length,
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

    const stabilize = () => {
      resetMobileDocumentScroll();
      if (pendingMobileSubmitScrollRestoreRef.current) {
        forceScrollToBottom();
      }
    };
    const delays = [0, 80, 180, 360, 700];

    mobileViewportReleaseTimersRef.current = delays.map((delay, index) =>
      window.setTimeout(() => {
        stabilize();
        if (index === delays.length - 1) {
          pendingMobileSubmitScrollRestoreRef.current = false;
          mobileViewportReleaseTimersRef.current = [];
        }
      }, delay),
    );
  }, [
    clearMobileKeyboardReleaseTimers,
    forceScrollToBottom,
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
          if (attachImages.length > 0 && mobileInputHasText) {
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
    [attachImages.length, mobileInputHasText, resetMobileInputBlurLayout],
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

  const finalizeMobileInputBlur = useCallback(
    (blurDom = false) => {
      cancelMobileKeyboardViewportSync();
      collapseTimersRef.current.forEach(clearTimeout);
      collapseTimersRef.current = [];
      if (mobileBlurTimerRef.current !== null) {
        clearTimeout(mobileBlurTimerRef.current);
        mobileBlurTimerRef.current = null;
      }
      const shouldPreserveExpandedHeight = prepareMobileInputBlurLayout();
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
      scheduleCollapseMobileInput,
      scheduleMobileKeyboardReleaseStabilize,
    ],
  );

  const scheduleMoveInputCursorToEnd = useCallback(() => {
    requestAnimationFrame(moveInputCursorToEnd);
    setTimeout(moveInputCursorToEnd, 60);
    setTimeout(moveInputCursorToEnd, 180);
    setTimeout(moveInputCursorToEnd, 360);
    setTimeout(moveInputCursorToEnd, 520);
  }, [moveInputCursorToEnd]);

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

  const exitMobileEditMode = useCallback(() => {
    setEditMobileMessageId(null);
    setUserInput("");
    setAttachImages([]);
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
    attachImages.length,
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
      attachImages.length === 0
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
    attachImages.length,
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

    scrollToBottom();
  }, [
    isMobileScreen,
    isMobileInputFocused,
    isIOSMobile,
    mobileInputHasText,
    resetMobileDocumentScroll,
    scheduleMoveInputCursorToEnd,
    scheduleScrollMobileInputToBottom,
    scrollToBottom,
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

    [0, 80, 180, 320].forEach((delay) => {
      window.setTimeout(() => {
        setAutoScroll(true);
        setHitBottom(true);
        scrollDomToBottom();
      }, delay);
    });
  }, [isMobileScreen, scrollDomToBottom, setAutoScroll, setHitBottom]);

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
    scheduleMobileLatestMessagesIntoView();
    scheduleMobileKeyboardViewportSync();
  }, [
    attachImages.length,
    isMobileInputFocused,
    isMobileScreen,
    mobileInputHasText,
    scheduleMobileLatestMessagesIntoView,
    scheduleMobileKeyboardViewportSync,
    syncMobileInputHeight,
    userInput,
  ]);

  useEffect(() => {
    const mobileInput = mobileInputRef.current;
    if (!isMobileScreen || !isMobileInputFocused || !mobileInput) return;

    const onPointerDownCapture = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || mobileInput.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(`.${styles["chat-input-mobile-actions"]}`)
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
      !isMobileInputFocused ||
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
      document.documentElement.style.removeProperty("--chat-input-fill-height");
      cancelMobileKeyboardViewportSync();
      collapseMobileInput(preserveMobileInputBlurHeightRef.current);
      if (isMobileScreen) {
        scheduleMobileKeyboardReleaseStabilize();
      }
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
      isIOSMobile ? "2px" : "0px",
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
      document.documentElement.style.removeProperty("--chat-input-fill-height");
    };
  }, [
    cancelMobileKeyboardViewportSync,
    isMobileInputFocused,
    isMobileScreen,
    isIOSMobile,
    collapseMobileInput,
    scheduleMobileKeyboardViewportSync,
    scheduleMobileKeyboardReleaseStabilize,
  ]);

  useLayoutEffect(() => {
    if (
      sessionLoading ||
      !safeSession.id ||
      historyAutoBottomSessionRef.current === safeSession.id ||
      !currentSessionHasMessages ||
      sessionMessages.length === 0
    ) {
      return;
    }

    historyAutoBottomSessionRef.current = safeSession.id;
    pendingInitialBottomSessionRef.current = safeSession.id;
    jumpToBottom();
    const rafId = window.requestAnimationFrame(jumpToBottom);
    const timer = window.setTimeout(jumpToBottom, 80);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timer);
    };
  }, [
    currentSessionHasMessages,
    jumpToBottom,
    safeSession.id,
    sessionLoading,
    sessionMessages.length,
  ]);

  useEffect(() => {
    const lastAssistantMessage = [...sessionMessages]
      .reverse()
      .find((message) => message.role === "assistant");
    const nextSignature = lastAssistantMessage
      ? `${lastAssistantMessage.id}:${
          String(lastAssistantMessage.content).length
        }:${Number(lastAssistantMessage.streaming)}`
      : "";

    if (
      nextSignature &&
      lastAssistantSignatureRef.current &&
      nextSignature !== lastAssistantSignatureRef.current
    ) {
      if (isAssistantStreaming) {
        if (!streamingAutoScrollPausedRef.current) {
          scrollToBottom();
        }
      } else if (hitBottom) {
        scrollToBottom();
      }
    }

    lastAssistantSignatureRef.current = nextSignature;
  }, [hitBottom, isAssistantStreaming, scrollToBottom, sessionMessages]);

  // 流式回复状态变化时的处理
  const streamingScrollIntervalRef = useRef<ReturnType<
    typeof setInterval
  > | null>(null);
  const previousAssistantStreamingRef = useRef(false);

  useEffect(() => {
    const wasAssistantStreaming = previousAssistantStreamingRef.current;
    previousAssistantStreamingRef.current = isAssistantStreaming;

    if (isAssistantStreaming === wasAssistantStreaming) {
      return;
    }

    if (isAssistantStreaming) {
      // 开始流式回复：只要用户不滑动，就持续贴住底部。
      clearStreamingScrollResumeTimer();
      userScrollIntentRef.current = false;
      streamingAutoScrollPausedRef.current = false;
      setAutoScroll(true);
      scrollToBottom();

      // 启动持续滚动定时器
      if (streamingScrollIntervalRef.current) {
        clearInterval(streamingScrollIntervalRef.current);
      }
      streamingScrollIntervalRef.current = setInterval(() => {
        if (!streamingAutoScrollPausedRef.current) {
          const dom = scrollRef.current;
          if (dom) {
            const currentScroll = dom.scrollTop;
            const maxScroll = dom.scrollHeight - dom.clientHeight;
            // 只有当不在最底部时才滚动
            if (currentScroll < maxScroll) {
              dom.scrollTop = dom.scrollHeight;
            }
          }
        }
      }, 100); // 每 100ms 检查一次
    } else {
      // 结束流式回复：清除所有定时器
      clearStreamingScrollResumeTimer();
      userScrollIntentRef.current = false;
      streamingAutoScrollPausedRef.current = false;
      if (streamingScrollIntervalRef.current) {
        clearInterval(streamingScrollIntervalRef.current);
        streamingScrollIntervalRef.current = null;
      }
      // 根据当前是否在底部来决定是否保持自动滚动
      setAutoScroll(hitBottom);
    }
  }, [
    isAssistantStreaming,
    clearStreamingScrollResumeTimer,
    scrollToBottom,
    setAutoScroll,
    hitBottom,
  ]);

  useEffect(() => {
    return () => {
      clearStreamingScrollResumeTimer();
      if (streamingScrollIntervalRef.current) {
        clearInterval(streamingScrollIntervalRef.current);
        streamingScrollIntervalRef.current = null;
      }
    };
  }, [clearStreamingScrollResumeTimer]);

  // 统一的打开模型选择器函数
  const openModelSelector = useCallback(() => {
    ensureLatestOpenAIModelsForAllProfiles("model-selector-open");

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

    // 打开选择器时默认选中按钮当前展示的模型，避免按钮与勾选项不一致。
    const latestOpenAIModel = getLatestOpenAIModelForProviderId(
      allModels,
      latestProviderId,
    );
    const fallbackDefaultValue = getModelSelectorDefaultValue({
      providerId: latestProviderId,
      currentModel: sessionMask?.modelConfig?.model || currentRawModel,
      latestModel: latestOpenAIModel?.model,
    });

    modelSelectorOpenStartedAtRef.current = nowMs();
    setModelSelectorProviderId(latestProviderId);
    setModelSelectorDefaultValue(fallbackDefaultValue);
    setModelSelectorResetKey((key) => key + 1);
    setShowModelSelector(true);
  }, [
    allModels,
    apiProfiles,
    currentRawModel,
    currentProviderName,
    ensureLatestOpenAIModelsForAllProfiles,
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

        rebuildManagedModelsFromCache({
          force: true,
          providerIds: [selectedProviderId],
        });
        if (modelSelectorItemsCacheRef.current[selectedProviderId]) {
          const next = { ...modelSelectorItemsCacheRef.current };
          delete next[selectedProviderId];
          modelSelectorItemsCacheRef.current = next;
        }

        const {
          addedProviderModels,
          cachedProfileModels,
          cachedProviderModels,
          initialProviderModels,
        } = ensureLatestOpenAIModelForProfile(
          profile as any,
          "provider-switch",
        );
        const hasLoadedProviderModels = initialProviderModels.length > 0;

        const commitProviderSwitch = (
          providerModels: typeof initialProviderModels,
        ) => {
          const switchStartedAt = nowMs();
          const latestSession = chatStore.currentSession();
          if (!latestSession) {
            console.error("[模型选择器] 切换供应商失败：当前对话不存在");
            return;
          }
          const preferredProviderModelConfig =
            getLatestOpenAIModelForCurrentSupplier(
              providerModels,
              {
                ...latestSession.mask.modelConfig,
                providerName: profile.provider as ServiceProvider,
                ...(latestSession.mask.modelConfig as any),
                providerId: selectedProviderId,
                profileId: profile.id,
              } as any,
              apiProfiles,
            ) ||
            getPreferredDefaultChatModel(
              providerModels,
              {
                ...latestSession.mask.modelConfig,
                providerName: profile.provider as ServiceProvider,
                ...(latestSession.mask.modelConfig as any),
                providerId: selectedProviderId,
                profileId: profile.id,
              } as any,
              apiProfiles,
            );
          const nextModel =
            providerModels.find(
              (model) => model.name === preferredProviderModelConfig?.model,
            ) ??
            providerModels.find((model) => model.isDefault) ??
            providerModels[0];

          if (!nextModel) {
            setModelSelectorNotice(
              `${profileName} 没有已添加模型，无法自动切换`,
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

          setIsProviderSelectorOpen(false);
          lastProviderSwitchTimeRef.current = Date.now();
          setModelSelectorProviderId(selectedProviderId);

          const accessStoreState = useAccessStore.getState();
          runWithImmediateStoreSyncPausedSync(() => {
            accessStoreState.update((access) => {
              access.useCustomConfig = true;
              applyProfileToAccessStore(access, profile as any);
            });
          });
          useSyncStore
            .getState()
            .triggerDebounceSync([StoreKey.Access], { delayMs: 0 });
          setSuppressBalanceAutoRefresh(true);
          if (balanceAutoRefreshResumeTimerRef.current) {
            clearTimeout(balanceAutoRefreshResumeTimerRef.current);
          }
          balanceAutoRefreshResumeTimerRef.current = setTimeout(() => {
            setSuppressBalanceAutoRefresh(false);
            balanceAutoRefreshResumeTimerRef.current = null;
          }, 3000);

          chatStore.updateTargetSession(latestSession, (session) => {
            session.mask.modelConfig.providerName =
              profile.provider as ServiceProvider;
            session.mask.modelConfig.model = nextModel.name as ModelType;
            (session.mask.modelConfig as any).providerId = selectedProviderId;
            (session.mask.modelConfig as any).profileId = profile.id;
            session.mask.modelConfig = sanitizeModelConfigForCapability(
              session.mask.modelConfig,
            );
            session.mask.syncGlobalConfig = true;
          });
          saveManualSessionModelSelection(latestSession.id, {
            ...latestSession.mask.modelConfig,
            model: nextModel.name,
            providerName: profile.provider,
            providerId: selectedProviderId,
            profileId: profile.id || "",
          });

          // 同步写回全局 appConfig.modelConfig，使新建会话默认采用本次切换的供应商/模型，
          // 并通过 Config store 跨浏览器同步当前模型/供应商。
          runWithImmediateStoreSyncPausedSync(() => {
            useAppConfig.getState().update((config) => {
              config.modelConfig = sanitizeModelConfigForCapability({
                ...config.modelConfig,
                model: nextModel.name as ModelType,
                providerName: profile.provider as ServiceProvider,
              });
              (config.modelConfig as any).providerId = selectedProviderId;
              (config.modelConfig as any).profileId = profile.id || "";
              (config as any).modelSelectionUpdatedAt = Date.now();
            });
          });
          syncModelSelectionNow();

          console.info("[模型选择器] 供应商已切换", {
            对话ID: latestSession.id,
            配置名称: profileName,
            供应商类型: profile.provider,
            模型: nextModel.name,
            供应商ID: selectedProviderId,
          });
          console.log(
            `[Sync] 📤 模型选择已变更，等待上传：${
              nextModel.name
            }@${selectedProviderId.replace(/^custom_/, "")}`,
          );
          localStorage.setItem(
            MODEL_SELECTOR_PROVIDER_STORAGE_KEY,
            profileName,
          );
          localStorage.setItem(
            LAST_MODEL_SELECTION_STORAGE_KEY,
            `${nextModel.name}@${selectedProviderId}`,
          );

          setModelSelectorNotice(`已切换到 ${profileName}`);
          if (modelSelectorNoticeTimerRef.current) {
            clearTimeout(modelSelectorNoticeTimerRef.current);
          }
          modelSelectorNoticeTimerRef.current = setTimeout(() => {
            setModelSelectorNotice("");
            modelSelectorNoticeTimerRef.current = null;
          }, 1600);
          resetModelSelectorGroupToAll();
          setModelSelectorResetKey((key) => key + 1);
          setModelSelectorDefaultValue(
            `${nextModel.name}@${selectedProviderId}`,
          );

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
      chatStore,
      ensureLatestOpenAIModelForProfile,
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

  const isInitialLoading = useMemo(() => {
    if (sessionLoading || isChatUnavailableForSync) return false;
    return hasAssistantLoadingBubbles;
  }, [hasAssistantLoadingBubbles, isChatUnavailableForSync, sessionLoading]);

  const [enterLoadingMin, setEnterLoadingMin] = useState(false);
  const enterLoadingSessionIdRef = useRef("");
  useEffect(() => {
    if (!currentSessionHasMessages) {
      enterLoadingSessionIdRef.current = safeSession.id;
      setEnterLoadingMin(false);
      return;
    }

    if (enterLoadingSessionIdRef.current === safeSession.id) {
      setEnterLoadingMin(false);
      return;
    }

    enterLoadingSessionIdRef.current = safeSession.id;
    setEnterLoadingMin(true);
    const timer = window.setTimeout(() => setEnterLoadingMin(false), 420);
    return () => window.clearTimeout(timer);
  }, [currentSessionHasMessages, safeSession.id]);

  const enterLoading = enterLoadingMin || isInitialLoading;

  const shouldHideChatMessages =
    sessionLoading || isChatUnavailableForSync || enterLoading;
  const shouldShowChatRestoreNotice =
    sessionLoading ||
    enterLoading ||
    (isChatUnavailableForSync && currentSessionHasMessages);
  const shouldShowScrollToBottomButton =
    !hitBottom && !shouldShowChatRestoreNotice;

  useLayoutEffect(() => {
    if (
      sessionLoading ||
      shouldHideChatMessages ||
      !safeSession.id ||
      !currentSessionHasMessages ||
      sessionMessages.length === 0
    ) {
      return;
    }
    if (pendingInitialBottomSessionRef.current !== safeSession.id) {
      return;
    }

    jumpToBottom();
    const rafId = window.requestAnimationFrame(jumpToBottom);
    const timer = window.setTimeout(() => {
      jumpToBottom();
      if (pendingInitialBottomSessionRef.current === safeSession.id) {
        pendingInitialBottomSessionRef.current = null;
      }
    }, 160);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timer);
    };
  }, [
    currentSessionHasMessages,
    jumpToBottom,
    msgRenderIndex,
    safeSession.id,
    sessionLoading,
    sessionMessages.length,
    shouldHideChatMessages,
  ]);

  const chatRestoreNoticeTitle = sessionLoading
    ? "正在载入这段对话"
    : "正在恢复这段对话";
  const chatRestoreNoticeDescription = sessionLoading
    ? "正在恢复完整消息内容，完成后会自动显示。"
    : isChatUnavailableForSync
    ? "模型配置同步完成后，对话内容会自动显示。"
    : "对话内容即将显示。";

  const initialAutoScrollSessionIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    if (shouldHideChatMessages) return;
    if (!currentSessionHasMessages) return;
    if (initialAutoScrollSessionIdRef.current === safeSession.id) return;

    initialAutoScrollSessionIdRef.current = safeSession.id;
    jumpToBottom();
  }, [
    currentSessionHasMessages,
    jumpToBottom,
    safeSession.id,
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
      console.log("[Command] got code from url: ", text);
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

        console.log("[Command] got settings from url: ", payload);

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
        console.error("[Command] failed to get settings from url: ", text);
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
  const skipNextAttachImagesPersistKeyRef = useRef<string>("");
  const pendingDraftRestoreRef = useRef<{
    input: string;
    images: string[];
    sessionId: string;
  } | null>(null);

  useEffect(() => {
    if (currentSessionHasMessages) {
      localStorage.removeItem(unfinishedInputKey);
      localStorage.removeItem(unfinishedAttachImagesKey);
      setUserInput("");
      setAttachImages([]);
      return;
    }

    const mayBeUnfinishedInput = sanitizeDraftInputText(
      localStorage.getItem(unfinishedInputKey) ||
        localStorage.getItem(ACTIVE_UNFINISHED_INPUT_KEY) ||
        "",
    );
    if (mayBeUnfinishedInput && userInput.length === 0) {
      if (isChatUnavailableForSync) {
        pendingDraftRestoreRef.current = {
          input: mayBeUnfinishedInput,
          images: pendingDraftRestoreRef.current?.images ?? [],
          sessionId: safeSession.id,
        };
        setUserInput("");
        return;
      }
      setUserInput(mayBeUnfinishedInput);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentSessionHasMessages,
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
    skipNextAttachImagesPersistKeyRef.current = unfinishedAttachImagesKey;
    let cancelled = false;
    if (currentSessionHasMessages) {
      void indexedDbStateStorage.removeRawItem(unfinishedAttachImagesKey);
      void indexedDbStateStorage.removeRawItem(
        ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY,
      );
      localStorage.removeItem(unfinishedAttachImagesKey);
      localStorage.removeItem(ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY);
      setAttachImages([]);
      return;
    }

    void (async () => {
      const restoredDraft: Awaited<ReturnType<typeof readAttachImagesDraft>> =
        await readAttachImagesDraft([
          unfinishedAttachImagesKey,
          ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY,
        ]);
      if (cancelled) return;

      if (!restoredDraft) {
        setAttachImages([]);
        return;
      }

      const nextImages = restoredDraft.images;
      if (restoredDraft.fromLegacy) {
        const draftImages = JSON.stringify(
          createAttachImagesDraftPayload(nextImages),
        );
        await Promise.all([
          indexedDbStateStorage.setRawItem(
            unfinishedAttachImagesKey,
            draftImages,
          ),
          indexedDbStateStorage.setRawItem(
            ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY,
            draftImages,
          ),
        ]);
        localStorage.removeItem(unfinishedAttachImagesKey);
        localStorage.removeItem(ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY);
        if (cancelled) return;
      }

      if (isChatUnavailableForSync) {
        pendingDraftRestoreRef.current = {
          input: pendingDraftRestoreRef.current?.input ?? "",
          images: nextImages,
          sessionId: safeSession.id,
        };
        setAttachImages([]);
        return;
      }

      setAttachImages(nextImages);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    currentSessionHasMessages,
    isChatUnavailableForSync,
    safeSession.id,
    unfinishedAttachImagesKey,
  ]);

  useEffect(() => {
    if (
      skipNextAttachImagesPersistKeyRef.current === unfinishedAttachImagesKey
    ) {
      skipNextAttachImagesPersistKeyRef.current = "";
      return;
    }

    if (currentSessionHasMessages) {
      void indexedDbStateStorage.removeRawItem(unfinishedAttachImagesKey);
      void indexedDbStateStorage.removeRawItem(
        ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY,
      );
      localStorage.removeItem(unfinishedAttachImagesKey);
      localStorage.removeItem(ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY);
      return;
    }

    if (isChatUnavailableForSync) {
      return;
    }

    if (attachImages.length > 0) {
      const draftImages = JSON.stringify(
        createAttachImagesDraftPayload(attachImages),
      );
      void indexedDbStateStorage.setRawItem(
        unfinishedAttachImagesKey,
        draftImages,
      );
      void indexedDbStateStorage.setRawItem(
        ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY,
        draftImages,
      );
      localStorage.removeItem(unfinishedAttachImagesKey);
      localStorage.removeItem(ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY);
      return;
    }

    void indexedDbStateStorage.removeRawItem(unfinishedAttachImagesKey);
    void indexedDbStateStorage.removeRawItem(
      ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY,
    );
    localStorage.removeItem(unfinishedAttachImagesKey);
    localStorage.removeItem(ACTIVE_UNFINISHED_ATTACH_IMAGES_KEY);
  }, [
    attachImages,
    currentSessionHasMessages,
    isChatUnavailableForSync,
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
    setAttachImages(pendingDraft.images);

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
      const imageFiles: File[] = [];
      const imageUrlsFromHtml: string[] = [];
      const clipboardItems = Array.from(event.clipboardData.items);
      const clipboardFiles = Array.from(event.clipboardData.files);
      const isImageFile = (file: File) =>
        file.type.startsWith("image/") ||
        /\.(png|jpe?g|webp|gif|heic|heif|bmp|avif)$/i.test(file.name);
      const appendImageFile = (file: File) => {
        if (!isImageFile(file)) return;
        const duplicated = imageFiles.some(
          (item) =>
            item.name === file.name &&
            item.size === file.size &&
            item.type === file.type &&
            item.lastModified === file.lastModified,
        );
        if (!duplicated) imageFiles.push(file);
      };
      const appendImageBlob = (blob: Blob, type: string) => {
        if (!type.startsWith("image/")) return;
        const ext = type.split("/")[1] || "png";
        appendImageFile(new File([blob], `clipboard.${ext}`, { type }));
      };

      for (const file of clipboardFiles) {
        appendImageFile(file);
      }

      for (const item of clipboardItems) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file) appendImageFile(file);
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
        imageFiles.length > 0 ||
        imageUrlsFromHtml.length > 0 ||
        hasFileLikeClipboardData ||
        text
      ) {
        event.preventDefault();
      }

      if (imageFiles.length === 0 && navigator.clipboard?.read) {
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

      const hasImages = imageFiles.length > 0 || imageUrlsFromHtml.length > 0;

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

      if (imageFiles.length > 0) {
        try {
          setUploading(true);
          const uploadedUrls = await Promise.all(
            imageFiles.map((file) => uploadImageRemote(file)),
          );
          setAttachImages((prev) => {
            const all = [...prev, ...uploadedUrls];
            return all.length > MAX_ATTACH_IMAGES
              ? all.slice(0, MAX_ATTACH_IMAGES)
              : all;
          });
        } catch {
          showToast("图片粘贴失败，请重试");
        } finally {
          setUploading(false);
        }
      }

      if (imageUrlsFromHtml.length > 0) {
        setAttachImages((prev) => {
          const all = [...prev, ...imageUrlsFromHtml];
          return [...new Set(all)].slice(0, MAX_ATTACH_IMAGES);
        });
      }
    },
    [onInput, userInput],
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
      const selectedFiles = Array.from(target.files ?? []);
      const remainingSlots = Math.max(
        0,
        MAX_ATTACH_IMAGES - attachImages.length,
      );
      if (selectedFiles.length > remainingSlots) {
        showAttachLimitHint();
      }
      const files = selectedFiles.slice(0, remainingSlots);

      if (files.length === 0) {
        cleanupFileInput();
        return;
      }

      setUploading(true);
      try {
        const uploadedImages = await Promise.all(
          files.map((file) => uploadImageRemote(file)),
        );
        const shouldPreserveBlurHeight =
          isMobileScreen && !isMobileInputFocused && mobileInputHasText;
        setAttachImages((prev) =>
          [...prev, ...uploadedImages].slice(0, MAX_ATTACH_IMAGES),
        );
        if (shouldPreserveBlurHeight) {
          requestAnimationFrame(() => {
            const shouldPreserveExpandedHeight = prepareMobileInputBlurLayout();
            collapseMobileInput(shouldPreserveExpandedHeight);
          });
        }
      } catch {
        showToast("图片上传失败，请重试");
      } finally {
        setUploading(false);
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
        setTimeout(() => {
          chatStore.newSession();
          navigate(Path.Chat);
        }, 10);
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
          copyToClipboard(lastMessageContent);
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
  }, [messages, chatStore, navigate, session]);

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
      {/* 自定义供应商切换提示 */}
      {providerSwitchToast.show && (
        <div className={styles["provider-switch-toast"]}>
          <div className={styles["provider-switch-toast-content"]}>
            {providerSwitchToast.message}
          </div>
        </div>
      )}

      <div
        ref={chatRootRef}
        className={clsx(styles.chat, {
          [styles["chat-mobile-keyboard-open"]]:
            isMobileScreen && isMobileInputFocused,
        })}
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
                  bordered
                  className={styles["chat-window-icon-button"]}
                  title={Locale.Chat.Actions.ChatList}
                  onClick={() => navigate(Path.Home)}
                />
              </div>
            </div>
          )}

          <div
            className={clsx("window-header-title", styles["chat-body-title"])}
            data-tauri-drag-region
            onClick={scrollToTopOnIOS}
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
                bordered
                className={styles["chat-window-icon-button"]}
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
                bordered
                className={styles["chat-window-icon-button"]}
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
            <div
              className={clsx(
                "window-action-button",
                styles["chat-window-action-button"],
              )}
            >
              <IconButton
                icon={isMobileScreen ? <UserIcon /> : <ConfigIcon />}
                bordered
                className={styles["chat-window-icon-button"]}
                text={
                  useHeaderIconOnly
                    ? undefined
                    : isMobileScreen
                    ? showBalanceUserPanel
                      ? "隐藏状态"
                      : "显示状态"
                    : "API 配置"
                }
                title={isMobileScreen ? "显示或隐藏用户和余额" : "API 配置"}
                aria={isMobileScreen ? "显示或隐藏用户和余额" : "API 配置"}
                onClick={() => {
                  if (isMobileScreen) {
                    setShowBalanceUserPanel((show) => !show);
                    return;
                  }
                  navigate(Path.ApiConfig);
                }}
                disabled={false}
              />
            </div>
            <div
              className={clsx(
                "window-action-button",
                styles["chat-window-action-button"],
              )}
            >
              <IconButton
                icon={<ReloadIcon />}
                bordered
                className={styles["chat-window-icon-button"]}
                text={
                  useHeaderIconOnly
                    ? undefined
                    : Locale.Chat.Actions.RefreshTitle
                }
                title={Locale.Chat.Actions.RefreshTitle}
                onTouchStart={(e) => {
                  if (!isMobileScreen) return;
                  refreshTouchTriggeredRef.current = true;
                  e.preventDefault();
                  handleSessionRefresh();
                  window.setTimeout(() => {
                    refreshTouchTriggeredRef.current = false;
                  }, 600);
                }}
                onClick={() => {
                  if (isMobileScreen && refreshTouchTriggeredRef.current) {
                    return;
                  }
                  handleSessionRefresh();
                }}
                disabled={false}
              />
            </div>
            <div
              className={clsx(
                "window-action-button",
                styles["chat-window-action-button"],
              )}
            >
              <IconButton
                icon={<ExportIcon />}
                bordered
                className={styles["chat-window-icon-button"]}
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
          <div className={styles["chat-body-container"]}>
            <ChatModelUpdateNotice />
            {showBalanceUserPanel && (
              <div
                ref={balancePanelRef}
                className={clsx(styles["chat-balance-user-panel"], {
                  [styles["chat-balance-user-panel-dimmed"]]:
                    !isMobileScreen && balancePanelOverlapsMessages,
                })}
              >
                {isMobileScreen ? (
                  <div className={styles["chat-balance-user-panel-mobile"]}>
                    {isModelConfigSyncConfirmed && (
                      <div className={styles["chat-panel-model-info"]}>
                        {currentModelName}
                        <span className={styles["chat-panel-model-at"]}>@</span>
                        {activeModelSelectorProviderDisplayName}
                      </div>
                    )}
                    <UserMenu variant="chat-floating" />
                  </div>
                ) : (
                  <>
                    {balanceProviderName ? (
                      <ChatProviderBalance
                        providerName={balanceProviderName as ServiceProvider}
                        providerDisplayName={balanceProviderDisplayName}
                        refreshSignal=""
                        balanceCacheKey={currentBalanceCacheKey}
                        profile={
                          balanceProfile as BalanceAwareProfile | undefined
                        }
                        deferInitialRefresh={sessionMessages.length === 0}
                        suppressAutoRefresh={suppressBalanceAutoRefresh}
                      />
                    ) : null}
                    <UserMenu variant="chat-floating" />
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
              onWheel={markUserScrollIntent}
              onTouchMove={markUserScrollIntent}
              onMouseDown={() =>
                (isMobileScreen
                  ? mobileInputRef.current
                  : inputRef.current
                )?.blur()
              }
              onTouchStart={() => {
                (isMobileScreen
                  ? mobileInputRef.current
                  : inputRef.current
                )?.blur();
              }}
            >
              {shouldShowChatRestoreNotice && (
                <div className={styles["chat-session-loading"]}>
                  <div className={styles["chat-session-loading-card"]}>
                    <div className={styles["chat-session-loading-icon"]}>
                      <LoadingIcon />
                    </div>
                    <div className={styles["chat-session-loading-content"]}>
                      <div className={styles["chat-session-loading-badge"]}>
                        历史对话
                      </div>
                      <div className={styles["chat-session-loading-text"]}>
                        <strong>{chatRestoreNoticeTitle}</strong>
                        <span>{chatRestoreNoticeDescription}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
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
                          className={styles["chat-input-mobile-hint-line"]}
                        >
                          {line}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              {!shouldHideChatMessages &&
                messages
                  // TODO
                  // .filter((m) => !m.isMcpResponse)
                  .map((message, i) => {
                    const isUser = message.role === "user";
                    const isContext = i < context.length;
                    const messageTextContent = getMessageTextContent(message);
                    const messageImages = getMessageImages(message);
                    const isEmptyUserMessage =
                      isUser &&
                      messageTextContent.length === 0 &&
                      messageImages.length === 0;
                    const showActions =
                      !message.preview && !isContext && !isEmptyUserMessage;
                    const showTyping = message.preview || message.streaming;
                    const messageUsageText = formatMessageUsage(message.usage);
                    const shouldStackMessageActions =
                      messageTextContent.trim().length > 12 ||
                      messageImages.length > 0 ||
                      editingMessageId === message.id;
                    const shouldInlineMobileActions =
                      isMobileScreen &&
                      i === firstActionableMessageIndex &&
                      messageImages.length === 0 &&
                      messageTextContent.trim().length > 12;
                    const shouldLeftMobileActions =
                      isMobileScreen &&
                      i === firstActionableMessageIndex &&
                      messageImages.length === 0 &&
                      messageTextContent.trim().length > 0 &&
                      !shouldInlineMobileActions;
                    const messageActions = showActions ? (
                      <div className={styles["chat-input-actions"]}>
                        {message.streaming ? (
                          <ChatAction
                            text={Locale.Chat.Actions.Stop}
                            icon={<StopIcon />}
                            onClick={() => onUserStop(message.id ?? i)}
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
                                    const nextText = messageTextContent.trim();
                                    const nextImages =
                                      messageImages.filter(Boolean);
                                    setEditMobileMessageId(message.id ?? null);
                                    setUserInput(nextText);
                                    setAttachImages(nextImages);
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
                                    window.setTimeout(focusMobileEditInput, 80);
                                  } else {
                                    setEditingMessageId(message.id ?? null);
                                    setEditContent(messageTextContent.trim());
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
                              onClick={() => copyMessageToClipboard(message)}
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
                                  openaiSpeech(getMessageTextContent(message))
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
                      <Fragment key={message.id ?? i}>
                        <div
                          className={
                            isUser
                              ? styles["chat-message-user"]
                              : styles["chat-message"]
                          }
                        >
                          <div className={styles["chat-message-container"]}>
                            <div className={styles["chat-message-header"]}>
                              <div className={styles["chat-message-avatar"]}>
                                {isUser ? (
                                  <Avatar avatar={FIXED_USER_AVATAR} />
                                ) : (
                                  <>
                                    {["system"].includes(message.role) ? (
                                      <Avatar avatar="2699-fe0f" />
                                    ) : (
                                      <MaskAvatar
                                        avatar={sessionMask.avatar}
                                        model={
                                          message.modelIcon ||
                                          message.model ||
                                          sessionMask.modelConfig.model
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
                                    getMessageProviderDisplayName(
                                      message,
                                      apiProfiles,
                                    ) || currentProviderDisplayName,
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
                            {message?.tools?.length == 0 && showTyping && (
                              <div className={styles["chat-message-status"]}>
                                {Locale.Chat.Typing}
                              </div>
                            )}
                            {/*@ts-ignore*/}
                            {message?.tools?.length > 0 && (
                              <div className={styles["chat-message-tools"]}>
                                {message?.tools?.map((tool) => (
                                  <div
                                    key={tool.id}
                                    title={tool?.errorMsg}
                                    className={styles["chat-message-tool"]}
                                  >
                                    {tool.isError === false ? (
                                      <ConfirmIcon />
                                    ) : tool.isError === true ? (
                                      <CloseIcon />
                                    ) : (
                                      <LoadingButtonIcon />
                                    )}
                                    <span>{tool?.function?.name}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div
                              className={clsx(styles["chat-message-content"], {
                                [styles[
                                  "chat-message-content-mobile-actions-left"
                                ]]: shouldLeftMobileActions,
                                [styles[
                                  "chat-message-content-mobile-actions-inline"
                                ]]: shouldInlineMobileActions,
                                [styles["chat-message-content-stack-actions"]]:
                                  shouldStackMessageActions,
                                [styles["chat-message-content-editing"]]:
                                  editingMessageId === message.id &&
                                  !isMobileScreen,
                              })}
                            >
                              <div className={styles["chat-message-item"]}>
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
                                      if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        onEditSave(message);
                                      }
                                      if (e.key === "Escape") {
                                        onEditCancel();
                                      }
                                    }}
                                  />
                                ) : (
                                  <Markdown
                                    key={message.streaming ? "loading" : "done"}
                                    content={messageTextContent}
                                    loading={
                                      (message.preview || message.streaming) &&
                                      messageTextContent.length === 0 &&
                                      !isUser
                                    }
                                    onDoubleClickCapture={() => {
                                      if (!isMobileScreen || !isUser) return;
                                      setUserInput(
                                        getMessageTextContent(message),
                                      );
                                    }}
                                    fontSize={fontSize}
                                    fontFamily={fontFamily}
                                    parentRef={scrollRef}
                                    defaultShow={i >= messages.length - 6}
                                  />
                                )}
                                {messageImages.length == 1 &&
                                  renderGeneratedMedia(
                                    messageImages[0],
                                    styles["chat-message-item-image"],
                                  )}
                                {messageImages.length > 1 && (
                                  <div
                                    className={
                                      styles["chat-message-item-images"]
                                    }
                                    style={
                                      {
                                        "--image-count": messageImages.length,
                                      } as React.CSSProperties
                                    }
                                  >
                                    {messageImages.map((image, index) => {
                                      return renderGeneratedMedia(
                                        image,
                                        styles["chat-message-item-image-multi"],
                                        index,
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                              {showActions && isMobileScreen && (
                                <div className={styles["chat-message-actions"]}>
                                  {messageActions}
                                </div>
                              )}
                            </div>
                            {message?.audio_url && (
                              <div className={styles["chat-message-audio"]}>
                                <audio src={message.audio_url} controls />
                              </div>
                            )}

                            <div className={styles["chat-message-action-date"]}>
                              {isContext
                                ? Locale.Chat.IsContext
                                : formatChinaDateTime(message.date)}
                            </div>
                            {!isContext && !isUser && !!messageUsageText && (
                              <div className={styles["chat-message-usage"]}>
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
            </div>
            <div
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
              onTouchStart={(e) => {
                if (!isMobileScreen) return;
                scrollToBottomTouchTriggeredRef.current = true;
                e.preventDefault();
                handleScrollToBottomButton(true);
                window.setTimeout(() => {
                  scrollToBottomTouchTriggeredRef.current = false;
                }, 600);
              }}
              onClick={() => {
                if (isMobileScreen && scrollToBottomTouchTriggeredRef.current) {
                  return;
                }
                handleScrollToBottomButton(isMobileScreen);
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
            </div>
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
              {attachLimitHint && (
                <div className={styles["chat-input-limit-hint"]}>
                  {attachLimitHint}
                </div>
              )}

              {!isMobileScreen && !currentSessionHasMessages && (
                <div className={styles["chat-input-empty-title"]}>
                  {getBotHelloContent()}
                </div>
              )}

              {editMobileMessageId && isMobileScreen && (
                <div className={styles["chat-edit-mode-header"]}>
                  <span>编辑消息</span>
                </div>
              )}
              <div className={styles["chat-input-row"]}>
                {isMobileScreen && (
                  <div className={styles["chat-input-mobile-actions"]}>
                    {editMobileMessageId && (
                      <IconButton
                        icon={<LogOutDoorIcon />}
                        className={clsx(
                          styles["chat-input-mobile-add"],
                          styles["chat-edit-mode-exit"],
                        )}
                        title="退出编辑"
                        aria="退出编辑模式"
                        disabled={isChatUnavailableForSync}
                        onMouseDown={(e) => e.preventDefault()}
                        onTouchStart={(e) => e.preventDefault()}
                        onClick={exitMobileEditMode}
                      />
                    )}
                    {(userInput.length > 0 || attachImages.length > 0) && (
                      <IconButton
                        icon={<MobileClearIcon />}
                        className={styles["chat-input-mobile-add"]}
                        title="清空输入"
                        aria="清空输入"
                        disabled={isChatUnavailableForSync}
                        onMouseDown={(e) => e.preventDefault()}
                        onTouchStart={(e) => e.preventDefault()}
                        onClick={() => {
                          mobileInputOutsidePointerBlurRef.current = false;
                          setPromptHints([]);
                          setUserInput("");
                          setAttachImages([]);
                          localStorage.removeItem(unfinishedInputKey);
                          localStorage.removeItem(ACTIVE_UNFINISHED_INPUT_KEY);
                          localStorage.removeItem(unfinishedAttachImagesKey);
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
                      title="添加照片"
                      aria="添加照片"
                      disabled={isChatUnavailableForSync || uploading}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const shouldPreserveBlurHeight =
                          isMobileScreen && !isMobileInputFocused;
                        if (attachImages.length >= MAX_ATTACH_IMAGES) {
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
                    [styles["chat-input-panel-inner-attach"]]:
                      attachImages.length !== 0,
                    [styles["chat-input-panel-inner-multiline"]]:
                      !isMobileScreen && inputRows > 1,
                  })}
                  htmlFor="chat-input"
                >
                  {!isMobileScreen && (
                    <span
                      ref={inputPlaceholderRef}
                      className={clsx(styles["chat-input-placeholder"], {
                        [styles["chat-input-placeholder-hidden"]]:
                          shouldUseCompactInputHint ||
                          isChatUnavailableForSync ||
                          !!userInput ||
                          attachImages.length > 0,
                      })}
                      style={{
                        fontSize: inputFontSize,
                        fontFamily: config.fontFamily,
                      }}
                    >
                      {chatInputHint}
                    </span>
                  )}
                  {attachImages.length != 0 && (
                    <div className={styles["attach-images"]}>
                      {attachImages.map((image, index) => {
                        return (
                          <div
                            key={index}
                            className={styles["attach-image"]}
                            style={{ backgroundImage: `url("${image}")` }}
                          >
                            <div className={styles["attach-image-mask"]}>
                              <DeleteImageButton
                                deleteImage={() => {
                                  setAttachImages(
                                    attachImages.filter((_, i) => i !== index),
                                  );
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
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
                            const endMarker = document.createElement("span");
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
                          if (nextText.length > 0 && nextText.trim() === "") {
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
                            document.activeElement === mobileInputRef.current;
                        }}
                        onFocus={() => {
                          // 清除 collapse 残留定时器，防止聚焦后被重置为 44px
                          collapseTimersRef.current.forEach(clearTimeout);
                          collapseTimersRef.current = [];
                          clearMobileKeyboardReleaseTimers();
                          if (mobileBlurTimerRef.current !== null) {
                            clearTimeout(mobileBlurTimerRef.current);
                            mobileBlurTimerRef.current = null;
                          }
                          preserveMobileInputBlurHeightRef.current = false;
                          mobileKeyboardOpenedSinceFocusRef.current = false;
                          mobileKeyboardDismissByViewportRef.current = false;
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
                          if (mobileKeyboardDismissByViewportRef.current) {
                            mobileKeyboardDismissByViewportRef.current = false;
                            return;
                          }
                          if (mobileInputOutsidePointerBlurRef.current) {
                            mobileInputOutsidePointerBlurRef.current = false;
                            requestAnimationFrame(() => {
                              const mobileInput = mobileInputRef.current;
                              if (!mobileInput) return;
                              if (document.activeElement !== mobileInput) {
                                mobileInput.focus();
                              }
                              setIsMobileInputFocused(true);
                              scheduleMoveInputCursorToEnd();
                              if (mobileInputHasText) {
                                scheduleScrollMobileInputToBottom();
                              }
                              scheduleMobileKeyboardViewportSync();
                            });
                            return;
                          }

                          sanitizeBoundaryInput();
                          mobileBlurTimerRef.current = window.setTimeout(() => {
                            finalizeMobileInputBlur();
                          }, 50);
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
                          setTimeout(() => setIsMobileInputFocused(false), 50);
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
                    <IconButton
                      icon={<SendUpIcon />}
                      className={styles["chat-input-send"]}
                      type="primary"
                      disabled={isChatUnavailableForSync}
                      onClick={() => doSubmit(userInput)}
                    />
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
          className={clsx({
            [styles["model-selector-auto-mode-enabled"]]: autoModeEnabled,
          })}
          dataAutoModelEnabled={autoModeEnabled}
          resetKey={modelSelectorResetKey}
          defaultSelectedValue={
            modelSelectorDefaultValue ?? currentDisplaySelectorValue
          }
          defaultGroup={modelSelectorDefaultGroup}
          headerHint={
            <>
              {modelSelectorNotice ? (
                <div className={styles["model-selector-notice"]}>
                  <div className={styles["provider-switch-toast-content"]}>
                    {modelSelectorNotice}
                  </div>
                </div>
              ) : null}
              <div className={styles["model-selector-hint"]}>
                <span className={styles["model-selector-hint-label"]}>
                  当前供应商
                </span>
                <button
                  type="button"
                  className={clsx(
                    styles["model-selector-hint-provider-button"],
                    {
                      [styles["model-selector-provider-open"]]:
                        isProviderSelectorOpen,
                    },
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (manualModelSelectionDisabled) {
                      return;
                    }
                  }}
                  onClick={() => {
                    if (manualModelSelectionDisabled) {
                      handleManualModelSelectionDisabled();
                      return;
                    }
                    setModelSelectorProviderId(currentProviderId);
                    setIsProviderSelectorOpen(!isProviderSelectorOpen);
                  }}
                >
                  <span>
                    {activeModelSelectorProviderDisplayName}
                    <span
                      className={styles["model-selector-hint-count-inline"]}
                    >
                      （共 {models.length} 个模型）
                    </span>
                  </span>
                  <DownIcon />
                </button>
                <span className={styles["model-selector-hint-count"]}>
                  共 {models.length} 个模型可用
                </span>
              </div>
              {isProviderSelectorOpen && (
                <div
                  data-provider-selector-root="true"
                  className={styles["model-selector-provider-menu"]}
                >
                  {availableProviders.length === 0 ? (
                    <div
                      style={{
                        gridColumn: "1 / -1",
                        textAlign: "center",
                        padding: "20px",
                        color: "#999",
                      }}
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
                      const providerIcon =
                        getProviderIcon(providerOption.provider) ||
                        getProviderIcon(providerOption.label);
                      return (
                        <button
                          type="button"
                          key={providerOption.label}
                          className={clsx(
                            styles["model-selector-provider-option"],
                            {
                              [styles["model-selector-provider-option-active"]]:
                                isActive,
                            },
                          )}
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
                            className={
                              styles["model-selector-provider-option-leading"]
                            }
                          >
                            {providerIcon ? (
                              <span
                                className={
                                  styles["model-selector-option-icon-frame"]
                                }
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  alt={`${providerOption.label} icon`}
                                  className={
                                    styles["model-selector-option-icon-image"]
                                  }
                                  src={providerIcon}
                                />
                              </span>
                            ) : (
                              <div className="no-dark">
                                <BotIconOpenAI
                                  className="user-avatar"
                                  width={16}
                                  height={16}
                                />
                              </div>
                            )}
                          </span>
                          <span>{providerOption.label}</span>
                          {isActive ? <ConfirmIcon /> : null}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </>
          }
          footer={null}
          filterControlsDisabled={manualModelSelectionDisabled}
          onFilterControlsDisabledClick={handleManualModelSelectionDisabled}
          groupFilterDisabled={manualModelSelectionDisabled}
          onGroupFilterDisabledClick={handleManualModelSelectionDisabled}
          onDisabledItemClick={handleManualModelSelectionDisabled}
          items={modelSelectorItems}
          itemsArePreSorted={false}
          enableVirtualization={isPerfFeatureEnabled(
            "PERF_ENABLE_MODEL_SELECTOR_VIRTUAL_LIST",
          )}
          virtualizationThreshold={60}
          searchDebounceMs={120}
          perfScope="ModelSelector"
          perfStartedAt={modelSelectorOpenStartedAtRef.current || undefined}
          showGroupFilter={true}
          groupFilterAction={({ buttonClassName }) => (
            <button
              type="button"
              className={buttonClassName}
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
                ensureLatestOpenAIModelsForAllProfiles("model-manager-open");
                setAddModelProfile({
                  profiles: apiProfiles,
                  currentProviderId: activeModelSelectorProviderId,
                });
                setShowAddModelModal(true);
              }}
            >
              <span>管理模型</span>
            </button>
          )}
          quickFilters={modelSelectorQuickFilters}
          showSearch={true}
          onGroupChange={(group) => {
            setModelSelectorDefaultGroup(group);
            localStorage.setItem(MODEL_SELECTOR_GROUP_STORAGE_KEY, group);
          }}
          onClose={() => {
            setShowModelSelector(false);
          }}
          onSelection={async (s) => {
            if (manualModelSelectionDisabled || s.length === 0) return;

            setModelSelectorDefaultValue(s[0]);
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
            const latestOpenAIModelForSyncedSelection = selectedProfile
              ? (() => {
                  const {
                    addedProviderModels,
                    cachedProviderModels,
                    initialProviderModels,
                  } = ensureLatestOpenAIModelForProfile(
                    selectedProfile as any,
                    "manual-model-selection",
                  );
                  const latestOpenAIModel =
                    getLatestOpenAIModelForProviderId(
                      [
                        ...initialProviderModels,
                        ...addedProviderModels,
                        ...cachedProviderModels,
                        ...selectedProviderModels,
                      ],
                      selectedProviderId,
                    ) ||
                    ({
                      model: LATEST_OPENAI_CHAT_MODEL_NAME,
                      providerName: selectedProfile.provider,
                    } as const);

                  return latestOpenAIModel;
                })()
              : undefined;

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
            const syncedSelectionDiffersFromCurrent =
              !!latestOpenAIModelForSyncedSelection &&
              (String(latestOpenAIModelForSyncedSelection.model || "") !==
                String(nextModelConfig.model || "") ||
                String(
                  latestOpenAIModelForSyncedSelection.providerName || "",
                ) !== String(nextModelConfig.providerName || ""));
            if (syncedSelectionDiffersFromCurrent) {
              suppressGlobalModelApplySessionRef.current = session.id;
            }

            // 手动切换模型必须立即写回当前会话。
            // Effect B 仅会在空白会话时把全局配置同步到会话，
            // 已有消息的会话如果不在这里更新，会继续沿用旧模型发起请求。
            chatStore.updateTargetSession(session, (session) => {
              session.mask.modelConfig = nextModelConfig;
              session.mask.syncGlobalConfig = true;
            });
            saveManualSessionModelSelection(session.id, {
              ...nextModelConfig,
              providerId: selectedProviderId,
              profileId: selectedProfile?.id || "",
            });

            // 同步写回全局 appConfig.modelConfig，使新建会话默认采用本次手动选择，
            // 并通过 Config store 跨浏览器同步当前供应商/模型。
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
                (config as any).modelSelectionUpdatedAt = Date.now();
              });
            });
            syncModelSelectionNow();

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

            // 只有在非供应商切换后的1秒内才显示提示
            const timeSinceProviderSwitch =
              Date.now() - lastProviderSwitchTimeRef.current;
            if (timeSinceProviderSwitch > 1000) {
              showToast(`已选择 ${model}`);
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
              ensureLatestOpenAIModelForProfile(
                managedProfile as any,
                "model-manager-close",
              );
            }
            ensureLatestOpenAIModelsForAllProfiles("model-manager-close");
            setShowAddModelModal(false);
            setAddModelProfile(null);
            setShowModelSelector(true);
            setModelSelectorResetKey((k) => k + 1);
            modelSelectorItemsCacheRef.current = {};
            resetModelSelectorGroupToAll();
          }}
          profiles={addModelProfile.profiles}
          initialProviderId={addModelProfile.currentProviderId}
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
  const isNavigatingFromUrl = useRef(false);

  // 从 URL 恢复对话选中
  useEffect(() => {
    if (urlSessionId) {
      const store = useChatStore.getState();
      const currentId = store.sessions[store.currentSessionIndex]?.id;
      if (currentId !== urlSessionId) {
        const isNewTab =
          typeof window !== "undefined" &&
          window.sessionStorage?.getItem("nextchat_tab_initialized") !== "1";
        if (isNewTab) {
          navigate("/", { replace: true });
          return;
        }
        isNavigatingFromUrl.current = true;
        store.selectSessionById(urlSessionId);
      }
    }
  }, [navigate, sessionIdListKey, urlSessionId]);

  // 对话变化时同步 URL
  useEffect(() => {
    if (isNavigatingFromUrl.current) {
      isNavigatingFromUrl.current = false;
      return;
    }
    if (
      location.pathname !== Path.Home &&
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
