import { useDebouncedCallback } from "use-debounce";
import React, {
  Fragment,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import SendWhiteIcon from "../icons/send-white.svg";
import BrainIcon from "../icons/brain.svg";
import RenameIcon from "../icons/rename.svg";
import EditIcon from "../icons/rename.svg";
import ExportIcon from "../icons/share.svg";
import ReturnIcon from "../icons/return.svg";
import CopyIcon from "../icons/copy.svg";
import SpeakIcon from "../icons/speak.svg";
import SpeakStopIcon from "../icons/speak-stop.svg";
import LoadingIcon from "../icons/three-dots.svg";
import LoadingButtonIcon from "../icons/loading.svg";
import PromptIcon from "../icons/prompt.svg";
import MaskIcon from "../icons/mask.svg";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";
import ResetIcon from "../icons/reload.svg";
import ReloadIcon from "../icons/reload.svg";
import BreakIcon from "../icons/break.svg";
import SettingsIcon from "../icons/chat-settings.svg";
import DownIcon from "../icons/down.svg";
import ConfirmIcon from "../icons/confirm.svg";
import ConfigIcon from "../icons/config.svg";
import DeleteIcon from "../icons/clear.svg";
import PinIcon from "../icons/pin.svg";
import CloseIcon from "../icons/close.svg";
import CancelIcon from "../icons/cancel.svg";
import ImageIcon from "../icons/image.svg";

import LightIcon from "../icons/light.svg";
import DarkIcon from "../icons/dark.svg";
import AutoIcon from "../icons/auto.svg";
import BottomIcon from "../icons/bottom.svg";
import StopIcon from "../icons/pause.svg";
import PlayIcon from "../icons/play.svg";
import RobotIcon from "../icons/robot.svg";
import SizeIcon from "../icons/size.svg";
import QualityIcon from "../icons/hd.svg";
import PluginIcon from "../icons/plugin.svg";
import ShortcutkeyIcon from "../icons/shortcutkey.svg";
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
  Theme,
  useAppConfig,
} from "../store/config";
import { useCurrentSession } from "../store/chat-session";
import { useModelCacheStore } from "../store/model-cache";
import { usePluginStore } from "../store/plugin";
import { useUpdateStore } from "../store/update";

import {
  autoGrowTextArea,
  copyToClipboard,
  formatChinaDateTime,
  getMessageImages,
  getMessageTextContent,
  isVisionModel,
  getModelSizes,
  getSupportedVideoDurations,
  getSupportedImageQualityOptions,
  getSupportedImageStyleOptions,
  normalizeModelSize,
  normalizeImageQuality,
  supportsCustomSize,
  supportsImageQualityControl,
  supportsImageStyleControl,
  supportsVideoDurationControl,
  supportsVideoImageReference,
  useMobileScreen,
  selectOrCopy,
} from "../utils";
import { safeLocalStorage } from "../utils/safe-local-storage";
import { withSyncUserHeaders } from "../utils/sync-user-client";

import { useAllModels } from "../utils/hooks";
import {
  buildAutoModelCandidates,
  getAutoModelSeriesLabel,
  normalizeAutoModelSeries,
} from "../utils/auto-model";
import {
  matchModelCategory,
  ModelCategoryMetadata,
} from "../utils/model-category-rules";
import { resolveModelProviderId } from "../utils/model";
import { getPreferredDefaultChatModel } from "../utils/model";
import { useModelFetcher } from "../utils/useModelFetcher";
import { applyAutoModeModelConfig } from "../utils/chat-session-model";
import { uploadImage as uploadImageRemote } from "@/app/utils/chat";
import {
  ensureProviderModelsReady,
  syncAllProfilesToDatabase,
} from "../utils/provider-sync";
import { rebuildManagedModelsFromCache } from "../utils/managed-model-rebuild";
import { isPerfFeatureEnabled, logPerfSummary, nowMs } from "../utils/perf";
import { getActiveModelSelectorProviderId } from "../utils/model-selector-provider";

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
import { useNavigate, useParams } from "react-router-dom";
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

const LOG_SEPARATOR = "=".repeat(5);
import { useSyncStore, waitForSyncIdle } from "../store/sync";
import { ProviderType } from "../utils/cloud";
import { Avatar } from "./emoji";
import { ContextPrompts, MaskAvatar, MaskConfig } from "./mask";
import { useMaskStore } from "../store/mask";
import { ChatCommandPrefix, useChatCommand, useCommand } from "../command";
import { parseStoreStatePayload } from "../utils/sync-store-keys";
import {
  runWithImmediateStoreSyncPaused,
  runWithImmediateStoreSyncPausedSync,
} from "../utils/store";
import { prettyObject } from "../utils/format";
import { ExportMessageModal } from "./exporter";
import { getClientConfig } from "../config/client";
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
  getLatestOpenAIModelForCurrentSupplier,
  getModelProvider,
  getPreferredRuntimeModelConfig,
  normalizeReservedDisplayModelName,
} from "../utils/model";
import { RealtimeChat } from "@/app/components/realtime-chat";
import { useAuthStore } from "../store/auth";
import { UserMenu } from "./user-menu";

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

function formatMessageUsage(
  usage?: Partial<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens: number;
    reasoningTokens: number;
  }>,
) {
  if (!usage) {
    return "";
  }

  const parts: string[] = [];

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

function AutoModeCrossIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M7 7L17 17" />
      <path d="M17 7L7 17" />
    </svg>
  );
}

function getProfileProviderId(profile: { provider: string; name: string }) {
  return profile.provider === ServiceProvider.Custom
    ? `custom_${profile.name}`
    : profile.provider === ServiceProvider.Local
    ? `${String(profile.provider).toLowerCase()}_${profile.name}`.toLowerCase()
    : String(profile.provider).toLowerCase();
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
          const mergedProfiles = [...(state.apiProfiles || [])];

          remoteProfiles.forEach((remoteProfile: any) => {
            const remoteProfileId = String(remoteProfile?.id || "");
            if (!remoteProfileId) {
              return;
            }

            if (!localProfileMap.has(remoteProfileId)) {
              if (
                remoteProfile.cachedModels ||
                Number(remoteProfile.modelCount || 0) > 0
              ) {
                useModelCacheStore
                  .getState()
                  .upsertProfileCache(remoteProfileId, {
                    cachedModels: String(remoteProfile.cachedModels || ""),
                    modelCount: Number(remoteProfile.modelCount || 0),
                  });
              }
              mergedProfiles.push(remoteProfile);
              return;
            }

            const localIndex = mergedProfiles.findIndex(
              (profile: any) => String(profile?.id || "") === remoteProfileId,
            );
            if (localIndex < 0) {
              return;
            }

            const localProfile = mergedProfiles[localIndex] as any;
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

          state.apiProfiles = mergedProfiles;
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
  autoModeEnabled: boolean;
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
        props.autoModeEnabled ||
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
      props.autoModeEnabled,
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
    if (props.autoModeEnabled || !supportsBalance || !props.balanceCacheKey) {
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
    props.autoModeEnabled,
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
    props.autoModeEnabled ||
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
const MODEL_SELECTOR_GROUP_STORAGE_KEY = "nextchat:model-selector-group";
const MODEL_SELECTOR_PROVIDER_STORAGE_KEY = "nextchat:model-selector-provider";
const LAST_MODEL_SELECTION_STORAGE_KEY = "nextchat:last-model-selection";
const recentBalanceAutoRefresh = new Map<string, number>();

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

function PromptToast(props: {
  showToast?: boolean;
  showModal?: boolean;
  setShowModal: (_: boolean) => void;
}) {
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
          onClick={() => props.setShowModal(true)}
        >
          <BrainIcon />
          <span className={styles["prompt-toast-content"]}>
            {Locale.Context.Toast(context.length)}
          </span>
        </div>
      )}
      {props.showModal && (
        <SessionConfigModel onClose={() => props.setShowModal(false)} />
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

  const shouldSubmit = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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

function AutoModeStateIcon(props: { enabled: boolean }) {
  if (props.enabled) {
    return <ConfirmIcon />;
  }

  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.2 3.2L12.8 11.8L11.8 12.8L3.2 4.2Z" fill="currentColor" />
      <path d="M11.8 3.2L12.8 4.2L4.2 12.8L3.2 11.8Z" fill="currentColor" />
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
        dom.scrollTo(0, dom.scrollHeight);
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
  currentModelButtonText: string;
  showPromptModal: () => void;
  scrollToBottom: () => void;
  showPromptHints: () => void;
  hitBottom: boolean;
  uploading: boolean;
  setShowShortcutKeyModal: React.Dispatch<React.SetStateAction<boolean>>;
  setUserInput: (input: string) => void;
  setShowChatSidePanel: React.Dispatch<React.SetStateAction<boolean>>;
  showModelSelector: boolean;
  setShowModelSelector: React.Dispatch<React.SetStateAction<boolean>>;
  modelSelectorDefaultValue: string | undefined;
  setModelSelectorDefaultValue: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
  modelSelectorDefaultGroup: string | undefined;
  setModelSelectorDefaultGroup: React.Dispatch<
    React.SetStateAction<string | undefined>
  >;
  openModelSelector: () => void;
  modelSelectorDisabled?: boolean;
}) {
  const config = useAppConfig();
  const navigate = useNavigate();
  const chatStore = useChatStore();
  const currentSessionSnapshot = useChatStore(
    (state) => state.sessions[state.currentSessionIndex],
  );
  const pluginStore = usePluginStore();
  const { session: loadedSession } = useCurrentSession();
  const session = loadedSession ?? currentSessionSnapshot;
  const autoModeEnabled = (config.autoModelSeries?.length || 0) > 0;
  const autoModeButtonText = `自动模式（${autoModeEnabled ? "✓" : "✗"}）`;

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

  // switch themes
  const theme = config.theme;

  function nextTheme() {
    const themes = [Theme.Auto, Theme.Light, Theme.Dark];
    const themeIndex = themes.indexOf(theme);
    const nextIndex = (themeIndex + 1) % themes.length;
    config.setTheme(themes[nextIndex]);
  }

  // stop all responses
  const couldStop = ChatControllerPool.hasPending();
  const stopAll = () => ChatControllerPool.stopAll();

  // switch model
  const currentModel = normalizeReservedDisplayModelName(
    session.mask.modelConfig.model,
  );
  const currentProviderName =
    session.mask.modelConfig?.providerName || ServiceProvider.OpenAI;

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
  const [showPluginSelector, setShowPluginSelector] = useState(false);
  const [showUploadImage, setShowUploadImage] = useState(false);

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
  const autoAdjustedQualityRef = useRef<string>("");
  const currentQuality = session.mask.modelConfig?.quality ?? "standard";
  const currentStyle = session.mask.modelConfig?.style ?? "vivid";
  const currentSeconds = session.mask.modelConfig?.seconds ?? "4";
  const currentModelSupport = getModelParameterSupport(currentModel);
  const supportsImageGenerationControls =
    currentModelSupport.capability === "image";
  const supportsVideoGenerationControls =
    currentModelSupport.capability === "video";
  const canUseImageAttachments =
    isVisionModel(currentModel) && !supportsImageGenerationControls;
  const previousShowUploadImageRef = useRef<boolean>(canUseImageAttachments);
  const supportsSizeControl = supportsCustomSize(currentModel);
  const supportsQualityControl = supportsImageQualityControl(currentModel);
  const supportsStyleControl = supportsImageStyleControl(currentModel);
  const supportsVideoDuration = supportsVideoDurationControl(currentModel);
  const supportsVideoReference = supportsVideoImageReference(currentModel);

  const isMobileScreen = useMobileScreen();

  useEffect(() => {
    const show = canUseImageAttachments;
    if (showUploadImage !== show) {
      setShowUploadImage(show);
    }
    if (!show && previousShowUploadImageRef.current) {
      props.setAttachImages([]);
      props.setUploading(false);
    }
    previousShowUploadImageRef.current = show;
    if (session.mask.modelConfig.size !== currentSize) {
      const previousSize = session.mask.modelConfig.size;
      chatStore.updateTargetSession(session, (session) => {
        session.mask.modelConfig.size = currentSize;
      });
      const adjustKey = `${currentModel}:${previousSize ?? ""}->${currentSize}`;
      if (autoAdjustedSizeRef.current !== adjustKey) {
        autoAdjustedSizeRef.current = adjustKey;
        showToast(`当前模型仅支持 ${currentSize}，已自动切换到兼容尺寸`);
      }
    }
    const normalizedQuality = normalizeImageQuality(
      currentModel,
      session.mask.modelConfig.quality,
    );
    if (session.mask.modelConfig.quality !== normalizedQuality) {
      const previousQuality = session.mask.modelConfig.quality ?? "standard";
      chatStore.updateTargetSession(session, (session) => {
        session.mask.modelConfig.quality = normalizedQuality as any;
      });
      const adjustKey = `${currentModel}:${previousQuality}->${normalizedQuality}`;
      if (autoAdjustedQualityRef.current !== adjustKey) {
        autoAdjustedQualityRef.current = adjustKey;
        if (normalizedQuality) {
          showToast(
            `当前模型仅支持 ${normalizedQuality} 质量，已自动切换到兼容质量`,
          );
        }
      }
    }
  }, [
    canUseImageAttachments,
    chatStore,
    currentModel,
    currentSize,
    props,
    session,
    showUploadImage,
  ]);

  return (
    <div
      className={clsx(
        styles["chat-input-actions"],
        styles["chat-input-actions-main"],
        styles["chat-actions-row-container"],
      )}
    >
      {/* 模型设置 - 第一个按钮，始终显示模型名称 */}
      <div className={clsx(styles["chat-action-always-show-text"])}>
        <ChatAction
          onClick={props.openModelSelector}
          text={
            autoModeEnabled ? autoModeButtonText : props.currentModelButtonText
          }
          icon={<RobotIcon />}
          disabled={props.modelSelectorDisabled}
        />
      </div>

      {/* 其他功能按钮 */}
      {couldStop && (
        <ChatAction
          onClick={stopAll}
          text={Locale.Chat.InputActions.Stop}
          icon={<StopIcon />}
        />
      )}
      {!props.hitBottom && (
        <ChatAction
          onClick={props.scrollToBottom}
          text={Locale.Chat.InputActions.ToBottom}
          icon={<BottomIcon />}
        />
      )}
      {props.hitBottom && (
        <ChatAction
          onClick={props.showPromptModal}
          text={Locale.Chat.InputActions.Settings}
          icon={<SettingsIcon />}
        />
      )}

      {showUploadImage && (
        <ChatAction
          onClick={props.uploadImage}
          text={Locale.Chat.InputActions.UploadImage}
          icon={props.uploading ? <LoadingButtonIcon /> : <ImageIcon />}
        />
      )}
      <ChatAction
        onClick={props.showPromptHints}
        text={Locale.Chat.InputActions.Prompt}
        icon={<PromptIcon />}
      />

      <ChatAction
        onClick={() => {
          navigate(Path.Masks);
        }}
        text={Locale.Chat.InputActions.Masks}
        icon={<MaskIcon />}
      />

      <ChatAction
        onClick={nextTheme}
        text={Locale.Chat.InputActions.Theme[theme]}
        icon={
          <>
            {theme === Theme.Auto ? (
              <AutoIcon />
            ) : theme === Theme.Light ? (
              <LightIcon />
            ) : theme === Theme.Dark ? (
              <DarkIcon />
            ) : null}
          </>
        }
      />
      <ChatAction
        text={Locale.Chat.InputActions.Clear}
        icon={<BreakIcon />}
        onClick={async () => {
          if (await showConfirm("确认清除当前对话的所有消息？")) {
            chatStore.updateTargetSession(session, (session) => {
              session.messages = [];
              session.memoryPrompt = "";
              session.clearContextIndex = undefined;
            });
          }
        }}
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
          {supportsVideoReference && (
            <ChatAction
              onClick={props.uploadImage}
              text={
                props.uploading
                  ? "上传参考图中"
                  : props.hitBottom
                  ? "参考图 / i2v"
                  : "参考图 / i2v"
              }
              icon={props.uploading ? <LoadingButtonIcon /> : <ImageIcon />}
            />
          )}
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

      {!supportsImageGenerationControls && (
        <ChatAction
          onClick={() => {
            if (pluginStore.getAll().length == 0) {
              navigate(Path.Plugins);
            } else {
              setShowPluginSelector(true);
            }
          }}
          text={Locale.Plugin.Name}
          icon={<PluginIcon />}
        />
      )}

      <ChatAction
        onClick={() => props.setShowShortcutKeyModal(true)}
        text={Locale.Chat.ShortcutKey.Title}
        icon={<ShortcutkeyIcon />}
      />

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

      {showPluginSelector && (
        <Selector
          centerContent={true}
          multiple
          defaultSelectedValue={session.mask?.plugin}
          items={pluginStore.getAll().map((item) => ({
            title: `${item?.title}@${item?.version}`,
            value: item?.id,
          }))}
          onClose={() => setShowPluginSelector(false)}
          onSelection={(s) => {
            chatStore.updateTargetSession(session, (session) => {
              session.mask.plugin = s as string[];
            });
          }}
        />
      )}
    </div>
  );
}

export function EditMessageModal(props: { onClose: () => void }) {
  const chatStore = useChatStore();
  const currentSessionSnapshot = useChatStore(
    (state) => state.sessions[state.currentSessionIndex],
  );
  const { session: loadedSession } = useCurrentSession();
  const session = loadedSession ?? currentSessionSnapshot;
  const [messages, setMessages] = useState(
    Array.isArray(session?.messages) ? session.messages.slice() : [],
  );

  if (!session) {
    return null;
  }

  return (
    <div className="modal-mask">
      <Modal
        title={Locale.Chat.EditMessage.Title}
        onClose={props.onClose}
        actions={[
          <IconButton
            text={Locale.UI.Cancel}
            icon={<CancelIcon />}
            key="cancel"
            onClick={() => {
              props.onClose();
            }}
          />,
          <IconButton
            type="primary"
            text={Locale.UI.Confirm}
            icon={<ConfirmIcon />}
            key="ok"
            onClick={() => {
              chatStore.updateTargetSession(
                session,
                (session) => (session.messages = messages),
              );
              props.onClose();
            }}
          />,
        ]}
      >
        <List>
          <ListItem
            title={Locale.Chat.EditMessage.Topic.Title}
            subTitle={Locale.Chat.EditMessage.Topic.SubTitle}
          >
            <input
              type="text"
              value={session.topic}
              onInput={(e) =>
                chatStore.updateTargetSession(
                  session,
                  (session) => (session.topic = e.currentTarget.value),
                )
              }
            ></input>
          </ListItem>
        </List>
        <ContextPrompts
          context={messages}
          updateContext={(updater) => {
            const newMessages = messages.slice();
            updater(newMessages);
            setMessages(newMessages);
          }}
        />
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
  const [showAutoModelSelector, setShowAutoModelSelector] = useState(false);
  const [showModelSelector, setShowModelSelector] = useState(false);

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
  const [modelSelectorItemsCache, setModelSelectorItemsCache] = useState<
    Record<string, any[]>
  >({});
  const resetModelSelectorGroupToAll = useCallback(() => {
    setModelSelectorDefaultGroup("All");
    localStorage.setItem(MODEL_SELECTOR_GROUP_STORAGE_KEY, "All");
  }, []);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const criticalSyncReady = useSyncStore(
    (state: any) => state.criticalSyncReady,
  );
  const criticalSyncInProgress = useSyncStore(
    (state: any) => state.criticalSyncInProgress,
  );
  const syncProvider = useSyncStore((state) => state.provider);
  const { submitKey, shouldSubmit } = useSubmitHandler();
  const scrollRef = useRef<HTMLDivElement>(null);
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
  const sessionMask =
    liveSession?.mask ?? safeSession.mask ?? emptySessionRef.current.mask;
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
  const navigate = useNavigate();
  const [attachImages, setAttachImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [modelUpdateDone, setModelUpdateDone] = useState(false);
  const lastAssistantSignatureRef = useRef("");
  const lastCompletedAssistantRef = useRef("");
  const streamingScrollResumeTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const streamingAutoScrollPausedRef = useRef(false);
  const modelUpdateDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [balanceRefreshSignal, setBalanceRefreshSignal] = useState("");
  const staleStreamingStateRef = useRef<{
    sessionId: string;
    messageIds: Set<string>;
  }>({
    sessionId: "",
    messageIds: new Set<string>(),
  });

  if (staleStreamingStateRef.current.sessionId !== session.id) {
    staleStreamingStateRef.current = {
      sessionId: session.id,
      messageIds: new Set(
        sessionMessages
          .filter((message) => message.streaming)
          .map((message) => message.id ?? "")
          .filter(Boolean),
      ),
    };
  }

  // current model name
  const currentRawModel = sessionMask?.modelConfig?.model || "";
  const currentModel = normalizeReservedDisplayModelName(
    sessionMask?.modelConfig?.model || "",
  );
  const currentProviderName =
    sessionMask?.modelConfig?.providerName || ServiceProvider.OpenAI;
  const currentModelSupport = getModelParameterSupport(currentModel);
  const isCurrentImageGenerationModel =
    currentModelSupport.capability === "image";

  // 模型选择器所需变量
  const allModels = useAllModels();
  const globalCustomModels = useAppConfig((state) => state.customModels);
  const apiProfiles = useAccessStore((state) => state.apiProfiles);
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
      ? currentActiveProviderProfile?.name ||
        currentProfile?.name ||
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
  const balanceProviderName =
    currentProviderName === ServiceProvider.Custom ||
    currentProviderName === ServiceProvider.Local
      ? currentProviderName
      : fallbackBalanceProfile?.provider;
  const balanceProfile =
    balanceProviderName === currentProviderName
      ? currentActiveProviderProfile || currentProfile
      : fallbackBalanceProfile;
  const balanceProviderDisplayName =
    balanceProfile?.name || balanceProviderName || currentProviderDisplayName;
  const currentBalanceCacheKey = useMemo(
    () =>
      balanceProviderName
        ? buildBalanceCacheKey(balanceProviderName, balanceProfile)
        : "",
    [balanceProfile, balanceProviderName],
  );
  const autoModeEnabled = autoModelSeries.length > 0;
  const selectedAutoModelSeries = autoModelSeries[0];
  const selectedAutoModelSeriesLabel = selectedAutoModelSeries
    ? getAutoModelSeriesLabel(selectedAutoModelSeries)
    : "";
  const autoModelSelectionEmpty = showAutoModelSelector && !autoModeEnabled;
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
  const models = useMemo(
    () =>
      allModels.filter(
        (model) =>
          model.available &&
          String(model?.provider?.id || "").toLowerCase() ===
            activeModelSelectorProviderId,
      ),
    [activeModelSelectorProviderId, allModels],
  );
  const modelSelectorItems = useMemo(() => {
    const providerItems = models
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

    const cachedProviderItems =
      modelSelectorItemsCache[activeModelSelectorProviderId] || [];
    const effectiveProviderItems =
      providerItems.length > 0 ? providerItems : cachedProviderItems;

    if (!manualModelSelectionDisabled) {
      return effectiveProviderItems;
    }

    return effectiveProviderItems.map((item) => ({
      ...item,
      disable: true,
    }));
  }, [
    allModels,
    activeModelSelectorProviderId,
    globalCustomModelValueSet,
    getModelGroup,
    manualModelSelectionDisabled,
    modelSelectorItemsCache,
    models,
  ]);
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
      <span className={styles["provider-button-model"]}>
        {currentModelName}
      </span>
    </>
  );
  const modelSelectorButtonTitle = autoModeEnabled
    ? autoModeButtonText
    : `${activeModelSelectorProviderDisplayName} ${currentModelName}`;
  const currentDisplaySelectorValue = `${currentRawModel}@${
    activeModelSelectorProviderId || String(currentProviderName).toLowerCase()
  }`;
  const autoModelSeriesItems = useMemo(
    () =>
      (["gpt", "deepseek", "doubao"] as AutoModelSeriesKey[]).map((value) => ({
        title: getAutoModelSeriesLabel(value),
        value,
      })),
    [],
  );
  const { fetchFromProvider } = useModelFetcher();

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
  const modelSelectorOpenStartedAtRef = useRef(0);
  const modelSelectorNoticeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const balanceAutoRefreshResumeTimerRef = useRef<NodeJS.Timeout | null>(null);
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

  useEffect(() => {
    if (!showModelSelector) {
      setModelSelectorProviderId("");
      setModelSelectorItemsCache({});
      return;
    }
    setIsProviderSelectorOpen(false);
    setShowAutoModelSelector(false);
    setModelSelectorNotice("");
  }, [showModelSelector]);

  useEffect(() => {
    if (!showModelSelector || modelSelectorItems.length === 0) {
      return;
    }

    if (!activeModelSelectorProviderId) {
      return;
    }

    setModelSelectorItemsCache((prev) => {
      const previousItems = prev[activeModelSelectorProviderId] || [];
      if (areSelectorItemsEqual(previousItems, modelSelectorItems)) {
        return prev;
      }

      return {
        ...prev,
        [activeModelSelectorProviderId]: modelSelectorItems,
      };
    });
  }, [activeModelSelectorProviderId, modelSelectorItems, showModelSelector]);

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
    if (apiProfiles.length <= 1) {
      return false;
    }
    const currentProfile = apiProfiles.find(
      (profile) =>
        getProfileProviderId(profile).toLowerCase() === currentProviderId,
    );
    if (!currentProfile) {
      return false;
    }

    const hasLoadedModels = allModels.some(
      (model) =>
        model.available &&
        String(model?.provider?.id || "").toLowerCase() === currentProviderId,
    );
    const cache = modelCacheProfiles?.[currentProfile.id];
    const syncStatus = String(cache?.syncStatus || "").toLowerCase();
    const hasCache = Boolean(
      cache?.cachedModels || currentProfile.cachedModels,
    );

    if (
      syncStatus === "first_sync" ||
      syncStatus === "syncing" ||
      syncStatus === "checking_remote"
    ) {
      return true;
    }

    if (hasLoadedModels) {
      return false;
    }

    return !hasCache && !["ready", "using_cache", "error"].includes(syncStatus);
  }, [allModels, apiProfiles, currentProviderId, modelCacheProfiles]);

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

  useEffect(() => {
    if (!autoModelSelectionEmpty) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest('[data-auto-model-selector-toggle="true"]') ||
        target?.closest('[data-auto-model-selector-menu="true"]') ||
        target?.closest('[data-selector-group-filter-root="true"]') ||
        target?.closest('[data-selector-group-filter-extra-root="true"]')
      ) {
        return;
      }
      setShowAutoModelSelector(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [autoModelSelectionEmpty]);
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
  const measure = useDebouncedCallback(
    () => {
      const rows = inputRef.current ? autoGrowTextArea(inputRef.current) : 1;
      const inputRows = Math.min(
        20,
        Math.max(2 + Number(!isMobileScreen), rows),
      );
      setInputRows(inputRows);
    },
    100,
    {
      leading: true,
      trailing: true,
    },
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(measure, [userInput]);

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
  const onInput = (text: string) => {
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
  };

  // auto close prompt hints when clicking outside
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (promptHints.length === 0) return;
      // if click on input or prompt hints, do nothing
      const target = e.target as HTMLElement;
      const isClickOnInput = inputRef.current?.contains(target);
      if (isClickOnInput) return;

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

  const doSubmit = (userInput: string) => {
    if (readOnly) {
      showToast("管理员查看他人数据时为只读模式，不能发送消息");
      return;
    }
    if (userInput.trim() === "" && isEmpty(attachImages)) return;
    const matchCommand = chatCommands.match(userInput);
    if (matchCommand.matched) {
      setUserInput("");
      setPromptHints([]);
      matchCommand.invoke();
      return;
    }
    setIsLoading(true);
    chatStore
      .onUserInput(userInput, attachImages)
      .then(() => setIsLoading(false));
    setAttachImages([]);
    chatStore.setLastInput(userInput);
    setUserInput("");
    setPromptHints([]);
    if (!isMobileScreen) inputRef.current?.focus();
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
        setUserInput(prompt.content);
      }
      inputRef.current?.focus();
    }, 30);
  };

  // stop response
  const onUserStop = (messageId: string) => {
    ChatControllerPool.stop(session.id, messageId);
  };

  // Effect A：消息标准化（修复残留 streaming 和空响应）
  useEffect(() => {
    const stopTiming = Date.now() - REQUEST_TIMEOUT_MS;
    const shouldNormalizeMessages = sessionMessages.some((m) => {
      if (m.streaming) {
        return (
          staleStreamingStateRef.current.messageIds.has(m.id ?? "") &&
          !ChatControllerPool.has(session.id, m.id ?? "")
        );
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
      session.messages.forEach((m) => {
        const hasActiveController =
          Boolean(m.streaming) &&
          ChatControllerPool.has(session.id, m.id ?? "");
        const shouldInterruptStaleStreaming =
          Boolean(m.streaming) &&
          staleStreamingStateRef.current.messageIds.has(m.id ?? "") &&
          !hasActiveController;
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
          staleStreamingStateRef.current.messageIds.delete(m.id ?? "");
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
  }, [chatStore, session, sessionMessages]);

  // Effect B：模型配置同步（全局配置下发到会话 mask）
  useEffect(() => {
    let nextModelConfig = sessionMask.modelConfig;
    let shouldSyncMaskConfig = false;
    const preferredRuntimeModelConfig =
      sessionMask.syncGlobalConfig &&
      !autoModeEnabled &&
      sessionMessages.length === 0
        ? getPreferredRuntimeModelConfig(
            allModels,
            sessionMask.modelConfig,
            apiProfiles,
          )
        : undefined;

    // 仅在空白会话时把全局模型配置下发到当前会话。
    // 一旦已经开始对话，继续自动回写会把会话模型在发送后覆盖成全局值。
    if (sessionMask.syncGlobalConfig && sessionMessages.length === 0) {
      nextModelConfig = { ...config.modelConfig };
      if (
        autoModeEnabled &&
        autoModeDefaultCandidate &&
        sessionMessages.length === 0
      ) {
        nextModelConfig = sanitizeModelConfigForCapability(
          applyAutoModeModelConfig(nextModelConfig, {
            model: autoModeDefaultCandidate.model as ModelType,
            providerName: autoModeDefaultCandidate.providerName,
          }),
        );
      } else if (!autoModeEnabled && sessionMessages.length === 0) {
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
      sessionMessages.length === 0 &&
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
        console.log("[Mask] syncing from global, name = ", session.mask.name);
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
    session,
    sessionMask,
    sessionMessages.length,
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
  const onRightClick = (e: any, message: ChatMessage) => {
    // copy to clipboard
    if (selectOrCopy(e.currentTarget, getMessageTextContent(message))) {
      if (userInput.length === 0) {
        setUserInput(getMessageTextContent(message));
      }

      e.preventDefault();
    }
  };

  const deleteMessage = (msgId?: string) => {
    chatStore.updateTargetSession(
      session,
      (session) =>
        (session.messages = session.messages.filter((m) => m.id !== msgId)),
    );
  };

  const onDelete = (msgId: string) => {
    deleteMessage(msgId);
  };

  const onResend = (message: ChatMessage) => {
    // when it is resending a message
    // 1. for a user's message, find the next bot response
    // 2. for a bot's message, find the last user's input
    // 3. delete original user input and bot's message
    // 4. resend the user's input

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

    // delete the original messages
    deleteMessage(userMessage.id);
    deleteMessage(botMessage?.id);

    // resend the message
    setIsLoading(true);
    const textContent = getMessageTextContent(userMessage);
    const images = getMessageImages(userMessage);
    chatStore.onUserInput(textContent, images).then(() => setIsLoading(false));
    inputRef.current?.focus();
  };

  const onPinMessage = (message: ChatMessage) => {
    chatStore.updateTargetSession(session, (session) =>
      session.mask.context.push(message),
    );

    showToast(Locale.Chat.Actions.PinToastContent, {
      text: Locale.Chat.Actions.PinToastAction,
      onClick: () => {
        setShowPromptModal(true);
      },
    });
  };

  const [speechStatus, setSpeechStatus] = useState(false);
  const [speechLoading, setSpeechLoading] = useState(false);
  const reconcileRemoteModelStores = useCallback(
    async () => reconcileRemoteModelStoresInternal(),
    [],
  );
  const refreshRemoteSignals = useCallback(async () => {
    try {
      await loadRemoteModelRefreshArtifact();
    } catch {}
  }, []);

  const syncAllProfilesFromChat = useCallback(async () => {
    if (syncingAll) return;

    try {
      setSyncingAll(true);
      const { results, totalFetched } = await syncAllProfilesToDatabase({
        fetchFromProvider,
      });
      await reconcileRemoteModelStores();
      await refreshRemoteSignals();
      if (modelUpdateDoneTimerRef.current) {
        clearTimeout(modelUpdateDoneTimerRef.current);
      }
      setModelUpdateDone(true);
      modelUpdateDoneTimerRef.current = setTimeout(() => {
        setModelUpdateDone(false);
        modelUpdateDoneTimerRef.current = null;
      }, 1800);

      console.log(LOG_SEPARATOR);
      console.log(`[API Config] 📊 模型同步汇总`);
      results.forEach(({ name, count, success }) => {
        console.log(`[API Config] - ${name}: ${success ? count : "失败"} 个`);
      });
      console.log(`[API Config] ✅ 所有平台同步完成，共 ${totalFetched} 个`);
      console.log(LOG_SEPARATOR);
      showToast("已同步全部配置、模型和对话记录到 PostgreSQL");
    } catch (error) {
      console.error("[Chat] 同步失败:", error);
      if (modelUpdateDoneTimerRef.current) {
        clearTimeout(modelUpdateDoneTimerRef.current);
        modelUpdateDoneTimerRef.current = null;
      }
      setModelUpdateDone(false);
      showToast("同步到 PostgreSQL 失败，请检查数据库连接");
    } finally {
      setSyncingAll(false);
    }
  }, [
    fetchFromProvider,
    reconcileRemoteModelStores,
    refreshRemoteSignals,
    syncingAll,
  ]);

  useEffect(() => {
    return () => {
      if (modelUpdateDoneTimerRef.current) {
        clearTimeout(modelUpdateDoneTimerRef.current);
      }
    };
  }, []);

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

    // 动态检查是否需要显示欢迎消息或错误提示
    if (
      baseContext.length === 0 &&
      sessionMessages.at(0)?.content !== getBotHelloContent()
    ) {
      const copiedHello = Object.assign({}, BOT_HELLO);
      copiedHello.content = getBotHelloContent();
      // 动态检查授权状态
      if (!accessStore.isAuthorized()) {
        copiedHello.content = Locale.Error.Unauthorized;
      }
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
  }, [sessionContext, sessionMask?.hideContext, sessionMessages, accessStore]);

  // preview messages
  const renderMessages = useMemo(() => {
    return context.concat(sessionMessages as RenderMessage[]).concat(
      userInput.length > 0 && config.sendPreviewBubble
        ? [
            {
              ...createMessage({
                role: "user",
                content: userInput,
              }),
              preview: true,
            },
          ]
        : [],
    );
  }, [config.sendPreviewBubble, context, sessionMessages, userInput]);

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

  useEffect(() => {
    _setMsgRenderIndex(Math.max(0, renderMessages.length - CHAT_PAGE_SIZE));
    setHitBottom(true);
  }, [safeSession.id, renderMessages.length]);

  const clearStreamingScrollResumeTimer = useCallback(() => {
    if (streamingScrollResumeTimerRef.current) {
      clearTimeout(streamingScrollResumeTimerRef.current);
      streamingScrollResumeTimerRef.current = null;
    }
  }, []);

  const onChatBodyScroll = (e: HTMLElement) => {
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

      streamingAutoScrollPausedRef.current = true;
      setAutoScroll(false);
      clearStreamingScrollResumeTimer();
      streamingScrollResumeTimerRef.current = setTimeout(() => {
        streamingAutoScrollPausedRef.current = false;
        setAutoScroll(true);
        scrollToBottom();
      }, 2000);
      return;
    }

    setAutoScroll(isHitBottom);
  };

  const scrollToBottom = useCallback(() => {
    setMsgRenderIndex(renderMessages.length - CHAT_PAGE_SIZE);
    scrollDomToBottom();
  }, [renderMessages.length, scrollDomToBottom, setMsgRenderIndex]);

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

  useEffect(() => {
    if (isAssistantStreaming) {
      // 开始流式回复：清除暂停，启用自动滚动，滚动到底部
      clearStreamingScrollResumeTimer();
      streamingAutoScrollPausedRef.current = false;
      setAutoScroll(true);
      scrollToBottom();

      // 启动持续滚动定时器
      streamingScrollIntervalRef.current = setInterval(() => {
        if (!streamingAutoScrollPausedRef.current) {
          const dom = scrollRef.current;
          if (dom) {
            const currentScroll = dom.scrollTop;
            const maxScroll = dom.scrollHeight - dom.clientHeight;
            // 只有当不在最底部时才滚动
            if (currentScroll < maxScroll) {
              dom.scrollTo(0, dom.scrollHeight);
            }
          }
        }
      }, 100); // 每 100ms 检查一次
    } else {
      // 结束流式回复：清除所有定时器
      clearStreamingScrollResumeTimer();
      streamingAutoScrollPausedRef.current = false;
      if (streamingScrollIntervalRef.current) {
        clearInterval(streamingScrollIntervalRef.current);
        streamingScrollIntervalRef.current = null;
      }
      // 根据当前是否在底部来决定是否保持自动滚动
      setAutoScroll(hitBottom);
    }

    // 清理函数
    return () => {
      if (streamingScrollIntervalRef.current) {
        clearInterval(streamingScrollIntervalRef.current);
        streamingScrollIntervalRef.current = null;
      }
    };
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
    };
  }, [clearStreamingScrollResumeTimer]);

  const lastCompletedAssistantMessage = useMemo(
    () =>
      [...sessionMessages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" &&
            !message.streaming &&
            String(message.content).length > 0,
        ) || null,
    [sessionMessages],
  );

  const completedAssistantRefreshSignal = useMemo(() => {
    if (
      !lastCompletedAssistantMessage ||
      lastCompletedAssistantMessage.isError
    ) {
      return "";
    }

    return `${lastCompletedAssistantMessage.id}:${lastCompletedAssistantMessage.date}:${currentBalanceCacheKey}`;
  }, [currentBalanceCacheKey, lastCompletedAssistantMessage]);

  useEffect(() => {
    if (
      completedAssistantRefreshSignal &&
      completedAssistantRefreshSignal !== lastCompletedAssistantRef.current
    ) {
      if (lastCompletedAssistantRef.current) {
        setBalanceRefreshSignal(completedAssistantRefreshSignal);
      }
      lastCompletedAssistantRef.current = completedAssistantRefreshSignal;
      return;
    }

    lastCompletedAssistantRef.current = completedAssistantRefreshSignal;
  }, [completedAssistantRefreshSignal]);

  // 统一的打开模型选择器函数
  const openModelSelector = useCallback(() => {
    if (providerSwitchDisabled) {
      handleModelSelectorBlockedDuringSync();
      return;
    }

    const latestModelName = sessionMask?.modelConfig?.model || currentRawModel;
    const latestProviderName =
      sessionMask?.modelConfig?.providerName || currentProviderName;
    const latestProviderId =
      resolveModelProviderId(
        allModels,
        sessionMask?.modelConfig,
        apiProfiles,
      ) || String(latestProviderName || "").toLowerCase();
    const fallbackDefaultValue = latestProviderId
      ? `${latestModelName}@${latestProviderId}`
      : undefined;
    const currentSelectedItem = modelSelectorItems.find(
      (item) => item.value === fallbackDefaultValue,
    );
    const storedDefaultGroup = String(
      localStorage.getItem(MODEL_SELECTOR_GROUP_STORAGE_KEY) || "",
    ).trim();
    const fallbackDefaultGroup =
      storedDefaultGroup ||
      currentSelectedItem?.group ||
      getModelGroup(
        latestModelName,
        currentProfile?.provider || latestProviderName,
        undefined,
        currentSelectedItem?.title || latestModelName,
      );
    const activeProfile = apiProfiles.find(
      (profile) =>
        getProfileProviderId(profile).toLowerCase() === latestProviderId,
    );
    const hasLoadedProviderModels = allModels.some(
      (model) =>
        model.available &&
        String(model.provider?.id || "").toLowerCase() === latestProviderId,
    );
    const hasCachedProviderModels = Boolean(
      activeProfile &&
        ((useModelCacheStore.getState() as any).profiles?.[activeProfile.id]
          ?.cachedModels ||
          activeProfile.cachedModels),
    );

    if (hasCachedProviderModels && latestProviderId) {
      rebuildManagedModelsFromCache({
        force: true,
        providerIds: [latestProviderId],
      });
    }

    modelSelectorOpenStartedAtRef.current = nowMs();
    setShowAutoModelSelector(false);
    setModelSelectorProviderId(latestProviderId);
    setModelSelectorDefaultGroup(fallbackDefaultGroup);
    setModelSelectorDefaultValue(fallbackDefaultValue);
    setShowModelSelector(true);
    setModelSelectorResetKey((key) => key + 1);
  }, [
    allModels,
    apiProfiles,
    currentRawModel,
    currentProfile?.provider,
    currentProviderName,
    getModelGroup,
    handleModelSelectorBlockedDuringSync,
    modelSelectorItems,
    providerSwitchDisabled,
    session.id,
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

        const cachedProfileModels =
          useModelCacheStore.getState().profiles?.[profile.id]?.cachedModels ||
          "";
        const initialProviderModels = allModels.filter(
          (model) =>
            model.available &&
            String(model.provider?.id || "").toLowerCase() ===
              selectedProviderId,
        );
        const hasLoadedProviderModels = initialProviderModels.length > 0;
        const hasCachedProviderModels = Boolean(cachedProfileModels);

        const commitProviderSwitch = (
          providerModels: typeof initialProviderModels,
        ) => {
          const switchStartedAt = nowMs();
          const preferredProviderModelConfig =
            getLatestOpenAIModelForCurrentSupplier(
              providerModels,
              {
                ...session.mask.modelConfig,
                providerName: profile.provider as ServiceProvider,
                ...(session.mask.modelConfig as any),
                providerId: selectedProviderId,
                profileId: profile.id,
              } as any,
              apiProfiles,
            ) ||
            getPreferredDefaultChatModel(
              providerModels,
              {
                ...session.mask.modelConfig,
                providerName: profile.provider as ServiceProvider,
                ...(session.mask.modelConfig as any),
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

          setIsProviderSelectorOpen(false);
          setShowAutoModelSelector(false);
          lastProviderSwitchTimeRef.current = Date.now();
          setModelSelectorProviderId(selectedProviderId);

          const accessStoreState = useAccessStore.getState();
          runWithImmediateStoreSyncPausedSync(() => {
            accessStoreState.update((access) => {
              access.useCustomConfig = true;
              applyProfileToAccessStore(access, profile as any);
            });
          });
          setSuppressBalanceAutoRefresh(true);
          if (balanceAutoRefreshResumeTimerRef.current) {
            clearTimeout(balanceAutoRefreshResumeTimerRef.current);
          }
          balanceAutoRefreshResumeTimerRef.current = setTimeout(() => {
            setSuppressBalanceAutoRefresh(false);
            balanceAutoRefreshResumeTimerRef.current = null;
          }, 3000);

          const latestSession = chatStore.currentSession();
          if (!latestSession) {
            console.error(
              "[handleProviderChange] currentSession() returned null",
            );
            return;
          }
          chatStore.updateTargetSession(latestSession, (session) => {
            session.mask.modelConfig.providerName =
              profile.provider as ServiceProvider;
            if (nextModel) {
              session.mask.modelConfig.model = nextModel.name as ModelType;
            }
            (session.mask.modelConfig as any).providerId = selectedProviderId;
            (session.mask.modelConfig as any).profileId = profile.id;
            session.mask.modelConfig = sanitizeModelConfigForCapability(
              session.mask.modelConfig,
            );
            session.mask.syncGlobalConfig = false;
          });

          console.info("[Model Selector] provider changed", {
            sessionId: latestSession.id,
            profileName,
            providerName: profile.provider,
            model: nextModel?.name || latestSession.mask.modelConfig.model,
            providerId: selectedProviderId,
          });
          localStorage.setItem(
            MODEL_SELECTOR_PROVIDER_STORAGE_KEY,
            profileName,
          );
          if (nextModel) {
            localStorage.setItem(
              LAST_MODEL_SELECTION_STORAGE_KEY,
              `${nextModel.name}@${selectedProviderId}`,
            );
          }

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

          logPerfSummary("ModelSelector", {
            providerSwitchDurationMs: Number(
              (nowMs() - switchStartedAt).toFixed(2),
            ),
            providerName: profileName,
            providerModelCount: providerModels.length,
          });
        };

        if (hasCachedProviderModels) {
          rebuildManagedModelsFromCache({
            force: true,
            providerIds: [selectedProviderId],
          });
        }

        const rebuiltProviderModels = (
          useAppConfig.getState().models || []
        ).filter(
          (model) =>
            model.available &&
            String(model.provider?.id || "").toLowerCase() ===
              selectedProviderId,
        );

        if (rebuiltProviderModels.length > 0) {
          commitProviderSwitch(rebuiltProviderModels);
          return;
        }

        setModelSelectorNotice(
          hasCachedProviderModels
            ? `正在载入 ${profileName} 模型`
            : `正在同步 ${profileName} 模型`,
        );

        void ensureProviderModelsReady(profile.id, {
          background: hasCachedProviderModels,
          silent: true,
          reason: "switch",
        })
          .then(() => {
            const latestModels = useAppConfig.getState().models || [];
            const readyProviderModels = latestModels.filter(
              (item) =>
                item.available &&
                String(item.provider?.id || "").toLowerCase() ===
                  selectedProviderId,
            );

            if (readyProviderModels.length === 0) {
              setModelSelectorNotice("模型同步失败，请重试");
              return;
            }

            commitProviderSwitch(readyProviderModels);
          })
          .catch((error) => {
            console.error("[Chat] provider 模型同步失败:", error);
            setModelSelectorNotice("模型同步失败，请重试");
          });
      }
    },
    [
      allModels,
      apiProfiles,
      chatStore,
      config,
      resetModelSelectorGroupToAll,
      isAiHubMixOrderingReady,
    ],
  );

  // clear context index = context length + index in messages
  const clearContextIndex =
    (safeSession.clearContextIndex ?? -1) >= 0
      ? safeSession.clearContextIndex! + context.length - msgRenderIndex
      : -1;

  const [showPromptModal, setShowPromptModal] = useState(false);

  const clientConfig = useMemo(() => getClientConfig(), []);

  const autoFocus = !isMobileScreen; // wont auto focus on mobile screen
  const showMaxIcon = !isMobileScreen && !clientConfig?.isApp;

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

  // remember unfinished input
  const unfinishedInputKey = useMemo(
    () => UNFINISHED_INPUT(safeSession.id),
    [safeSession.id],
  );

  useEffect(() => {
    const mayBeUnfinishedInput =
      localStorage.getItem(unfinishedInputKey) ||
      localStorage.getItem(ACTIVE_UNFINISHED_INPUT_KEY);
    if (mayBeUnfinishedInput && userInput.length === 0) {
      setUserInput(mayBeUnfinishedInput);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unfinishedInputKey]);

  useEffect(() => {
    if (!unfinishedInputKey) {
      return;
    }

    const draftValue = userInput ?? "";
    if (draftValue.length > 0) {
      localStorage.setItem(unfinishedInputKey, draftValue);
      localStorage.setItem(ACTIVE_UNFINISHED_INPUT_KEY, draftValue);
      return;
    }

    localStorage.removeItem(unfinishedInputKey);
    localStorage.removeItem(ACTIVE_UNFINISHED_INPUT_KEY);
  }, [unfinishedInputKey, userInput]);

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const currentModel = sessionMask.modelConfig.model;
      if (!isVisionModel(currentModel) || isCurrentImageGenerationModel) {
        return;
      }
      const items = (event.clipboardData || window.clipboardData).items;
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          event.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const images: string[] = [];
            images.push(...attachImages);
            images.push(
              ...(await new Promise<string[]>((res, rej) => {
                setUploading(true);
                const imagesData: string[] = [];
                uploadImageRemote(file)
                  .then((dataUrl) => {
                    imagesData.push(dataUrl);
                    setUploading(false);
                    res(imagesData);
                  })
                  .catch((e) => {
                    setUploading(false);
                    rej(e);
                  });
              })),
            );
            const imagesLength = images.length;

            if (imagesLength > 3) {
              images.splice(3, imagesLength - 3);
            }
            setAttachImages(images);
          }
        }
      }
    },
    [
      attachImages,
      isCurrentImageGenerationModel,
      sessionMask.modelConfig.model,
    ],
  );

  async function uploadImage() {
    const images: string[] = [];
    images.push(...attachImages);

    images.push(
      ...(await new Promise<string[]>((res, rej) => {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept =
          "image/png, image/jpeg, image/webp, image/heic, image/heif";
        fileInput.multiple = true;
        fileInput.onchange = (event: any) => {
          setUploading(true);
          const files = event.target.files;
          const imagesData: string[] = [];
          for (let i = 0; i < files.length; i++) {
            const file = event.target.files[i];
            uploadImageRemote(file)
              .then((dataUrl) => {
                imagesData.push(dataUrl);
                if (
                  imagesData.length === 3 ||
                  imagesData.length === files.length
                ) {
                  setUploading(false);
                  res(imagesData);
                }
              })
              .catch((e) => {
                setUploading(false);
                rej(e);
              });
          }
        };
        fileInput.click();
      })),
    );

    const imagesLength = images.length;
    if (imagesLength > 3) {
      images.splice(3, imagesLength - 3);
    }
    setAttachImages(images);
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
  const readOnly = useAuthStore((state) => state.readOnly);
  const effectiveAuthUser = useAuthStore((state) => state.effectiveUser);

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

      <div className={styles.chat} key={safeSession.id}>
        <div className="window-header" data-tauri-drag-region>
          {isMobileScreen && (
            <div className="window-actions">
              <div className={"window-action-button"}>
                <IconButton
                  icon={<ReturnIcon />}
                  bordered
                  title={Locale.Chat.Actions.ChatList}
                  onClick={() => navigate(Path.Home)}
                />
              </div>
            </div>
          )}

          <div
            className={clsx("window-header-title", styles["chat-body-title"])}
          >
            <div
              className={clsx(
                "window-header-main-title",
                styles["chat-body-main-title"],
              )}
              onClickCapture={() => {
                if (!readOnly) {
                  setIsEditingMessage(true);
                }
              }}
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
                text={modelSelectorButtonText}
                title={modelSelectorButtonTitle}
                aria={modelSelectorButtonTitle}
                onClick={openModelSelector}
                disabled={readOnly}
              />
            </div>
            <div
              className={clsx(
                "window-action-button",
                styles["chat-window-action-button"],
              )}
            >
              <IconButton
                icon={
                  syncingAll ? (
                    <LoadingButtonIcon />
                  ) : modelUpdateDone ? (
                    <ConfirmIcon />
                  ) : (
                    <ReloadIcon />
                  )
                }
                bordered
                text={
                  syncingAll
                    ? "同步中..."
                    : modelUpdateDone
                    ? "同步完成"
                    : "一键同步"
                }
                title={
                  syncingAll
                    ? "同步中..."
                    : modelUpdateDone
                    ? "同步完成"
                    : "一键同步"
                }
                aria={
                  syncingAll
                    ? "同步中..."
                    : modelUpdateDone
                    ? "同步完成"
                    : "一键同步"
                }
                onClick={() => {
                  void syncAllProfilesFromChat();
                }}
                disabled={syncingAll || readOnly}
              />
            </div>
            <div
              className={clsx(
                "window-action-button",
                styles["chat-window-action-button"],
              )}
            >
              <IconButton
                icon={<ConfigIcon />}
                bordered
                text="API 配置"
                title="API 配置"
                aria="API 配置"
                onClick={() => navigate(Path.ApiConfig)}
                disabled={readOnly || effectiveAuthUser?.role !== "admin"}
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
                text={Locale.Chat.Actions.RefreshTitle}
                title={Locale.Chat.Actions.RefreshTitle}
                onClick={() => {
                  showToast(Locale.Chat.Actions.RefreshToast);
                  chatStore.summarizeSession(true, session);
                }}
                disabled={readOnly}
              />
            </div>
            {!isMobileScreen && (
              <div
                className={clsx(
                  "window-action-button",
                  styles["chat-window-action-button"],
                )}
              >
                <IconButton
                  icon={<RenameIcon />}
                  bordered
                  text={Locale.Chat.EditMessage.Title}
                  title={Locale.Chat.EditMessage.Title}
                  aria={Locale.Chat.EditMessage.Title}
                  onClick={() => setIsEditingMessage(true)}
                  disabled={readOnly}
                />
              </div>
            )}
            <div
              className={clsx(
                "window-action-button",
                styles["chat-window-action-button"],
              )}
            >
              <IconButton
                icon={<ExportIcon />}
                bordered
                text={Locale.Chat.Actions.Export}
                title={Locale.Chat.Actions.Export}
                onClick={() => {
                  setShowExport(true);
                }}
              />
            </div>
            {showMaxIcon && (
              <div
                className={clsx(
                  "window-action-button",
                  styles["chat-window-action-button"],
                )}
              >
                <IconButton
                  icon={config.tightBorder ? <MinIcon /> : <MaxIcon />}
                  bordered
                  text={Locale.Chat.Actions.FullScreen}
                  title={Locale.Chat.Actions.FullScreen}
                  aria={Locale.Chat.Actions.FullScreen}
                  onClick={() => {
                    config.setTightBorder(!config.tightBorder);
                  }}
                />
              </div>
            )}
          </div>

          <PromptToast
            showToast={!hitBottom}
            showModal={showPromptModal}
            setShowModal={setShowPromptModal}
          />
        </div>
        <div className={styles["chat-main"]}>
          <div className={styles["chat-body-container"]}>
            <ChatModelUpdateNotice />
            <div className={styles["chat-balance-user-panel"]}>
              <ChatProviderBalance
                providerName={balanceProviderName || currentProviderName}
                providerDisplayName={balanceProviderDisplayName}
                autoModeEnabled={autoModeEnabled}
                refreshSignal={balanceRefreshSignal}
                balanceCacheKey={currentBalanceCacheKey}
                profile={balanceProfile as BalanceAwareProfile | undefined}
                deferInitialRefresh={sessionMessages.length === 0}
                suppressAutoRefresh={suppressBalanceAutoRefresh}
              />
              <UserMenu variant="chat-floating" />
            </div>
            <div
              className={styles["chat-body"]}
              ref={scrollRef}
              onScroll={(e) => onChatBodyScroll(e.currentTarget)}
              onMouseDown={() => inputRef.current?.blur()}
              onTouchStart={() => {
                inputRef.current?.blur();
              }}
            >
              {sessionLoading && (
                <div className={styles["chat-session-loading"]}>
                  <LoadingIcon />
                  <span>正在加载会话内容...</span>
                </div>
              )}
              {!sessionLoading &&
                messages
                  // TODO
                  // .filter((m) => !m.isMcpResponse)
                  .map((message, i) => {
                    const isUser = message.role === "user";
                    const isContext = i < context.length;
                    const messageTextContent = getMessageTextContent(message);
                    const showActions =
                      i > 0 &&
                      !(message.preview || messageTextContent.length === 0) &&
                      !isContext;
                    const showTyping = message.preview || message.streaming;
                    const messageUsageText = formatMessageUsage(message.usage);

                    const shouldShowClearContextDivider =
                      i === clearContextIndex - 1;

                    return (
                      <Fragment key={message.id}>
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
                                {isUser && (
                                  <div className={styles["chat-message-edit"]}>
                                    <IconButton
                                      icon={<EditIcon />}
                                      aria={Locale.Chat.Actions.Edit}
                                      onClick={async () => {
                                        const newMessage = await showPrompt(
                                          Locale.Chat.Actions.Edit,
                                          getMessageTextContent(message),
                                          10,
                                        );
                                        let newContent:
                                          | string
                                          | MultimodalContent[] = newMessage;
                                        const images =
                                          getMessageImages(message);
                                        if (images.length > 0) {
                                          newContent = [
                                            { type: "text", text: newMessage },
                                          ];
                                          for (
                                            let i = 0;
                                            i < images.length;
                                            i++
                                          ) {
                                            newContent.push({
                                              type: "image_url",
                                              image_url: {
                                                url: images[i],
                                              },
                                            });
                                          }
                                        }
                                        chatStore.updateTargetSession(
                                          session,
                                          (session) => {
                                            const m = session.mask.context
                                              .concat(sessionMessages)
                                              .find((m) => m.id === message.id);
                                            if (m) {
                                              m.content = newContent;
                                            }
                                          },
                                        );
                                      }}
                                    ></IconButton>
                                  </div>
                                )}
                                {isUser ? (
                                  <Avatar avatar={config.avatar} />
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
                                  {normalizeReservedDisplayModelName(
                                    message.modelDisplay || message.model,
                                  )}
                                </div>
                              )}

                              {showActions && (
                                <div className={styles["chat-message-actions"]}>
                                  <div className={styles["chat-input-actions"]}>
                                    {message.streaming ? (
                                      <ChatAction
                                        text={Locale.Chat.Actions.Stop}
                                        icon={<StopIcon />}
                                        onClick={() =>
                                          onUserStop(message.id ?? i)
                                        }
                                      />
                                    ) : (
                                      <>
                                        <ChatAction
                                          text={Locale.Chat.Actions.Retry}
                                          icon={<ResetIcon />}
                                          onClick={() => onResend(message)}
                                        />

                                        <ChatAction
                                          text={Locale.Chat.Actions.Delete}
                                          icon={<DeleteIcon />}
                                          onClick={() =>
                                            onDelete(message.id ?? i)
                                          }
                                        />

                                        <ChatAction
                                          text={Locale.Chat.Actions.Pin}
                                          icon={<PinIcon />}
                                          onClick={() => onPinMessage(message)}
                                        />
                                        <ChatAction
                                          text={Locale.Chat.Actions.Copy}
                                          icon={<CopyIcon />}
                                          onClick={() =>
                                            copyToClipboard(
                                              getMessageTextContent(message),
                                            )
                                          }
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
                            <div className={styles["chat-message-item"]}>
                              <Markdown
                                key={message.streaming ? "loading" : "done"}
                                content={messageTextContent}
                                loading={
                                  (message.preview || message.streaming) &&
                                  messageTextContent.length === 0 &&
                                  !isUser
                                }
                                //   onContextMenu={(e) => onRightClick(e, message)} // hard to use
                                onDoubleClickCapture={() => {
                                  if (!isMobileScreen) return;
                                  setUserInput(getMessageTextContent(message));
                                }}
                                fontSize={fontSize}
                                fontFamily={fontFamily}
                                parentRef={scrollRef}
                                defaultShow={i >= messages.length - 6}
                              />
                              {getMessageImages(message).length == 1 &&
                                renderGeneratedMedia(
                                  getMessageImages(message)[0],
                                  styles["chat-message-item-image"],
                                )}
                              {getMessageImages(message).length > 1 && (
                                <div
                                  className={styles["chat-message-item-images"]}
                                  style={
                                    {
                                      "--image-count":
                                        getMessageImages(message).length,
                                    } as React.CSSProperties
                                  }
                                >
                                  {getMessageImages(message).map(
                                    (image, index) => {
                                      return renderGeneratedMedia(
                                        image,
                                        styles["chat-message-item-image-multi"],
                                        index,
                                      );
                                    },
                                  )}
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
            <div className={styles["chat-input-panel"]}>
              <PromptHints
                prompts={promptHints}
                onPromptSelect={onPromptSelect}
              />

              <ChatActions
                currentModelButtonText={`${currentProviderDisplayName} ${currentModelName}`}
                uploadImage={uploadImage}
                setAttachImages={setAttachImages}
                setUploading={setUploading}
                showPromptModal={() => setShowPromptModal(true)}
                scrollToBottom={scrollToBottom}
                hitBottom={hitBottom}
                uploading={uploading}
                showPromptHints={() => {
                  // Click again to close
                  if (promptHints.length > 0) {
                    setPromptHints([]);
                    return;
                  }

                  inputRef.current?.focus();
                  onSearch("");
                }}
                setShowShortcutKeyModal={setShowShortcutKeyModal}
                setUserInput={setUserInput}
                setShowChatSidePanel={setShowChatSidePanel}
                showModelSelector={showModelSelector}
                setShowModelSelector={setShowModelSelector}
                modelSelectorDefaultValue={modelSelectorDefaultValue}
                setModelSelectorDefaultValue={setModelSelectorDefaultValue}
                modelSelectorDefaultGroup={modelSelectorDefaultGroup}
                setModelSelectorDefaultGroup={setModelSelectorDefaultGroup}
                openModelSelector={openModelSelector}
                modelSelectorDisabled={providerSwitchDisabled}
              />
              <label
                className={clsx(styles["chat-input-panel-inner"], {
                  [styles["chat-input-panel-inner-attach"]]:
                    attachImages.length !== 0,
                })}
                htmlFor="chat-input"
              >
                <textarea
                  id="chat-input"
                  ref={inputRef}
                  className={styles["chat-input"]}
                  placeholder={
                    readOnly
                      ? "管理员查看模式下不可发送消息"
                      : syncProvider === ProviderType.Database &&
                        (!criticalSyncReady || criticalSyncInProgress)
                      ? "正在后台恢复聊天记录和 API 配置，可直接对话"
                      : Locale.Chat.Input(submitKey)
                  }
                  onInput={(e) => onInput(e.currentTarget.value)}
                  value={userInput}
                  onKeyDown={onInputKeyDown}
                  onFocus={scrollToBottom}
                  onClick={scrollToBottom}
                  onPaste={handlePaste}
                  rows={inputRows}
                  autoFocus={autoFocus}
                  disabled={readOnly}
                  style={{
                    fontSize: config.fontSize,
                    fontFamily: config.fontFamily,
                  }}
                />
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
                <IconButton
                  icon={<SendWhiteIcon />}
                  text={Locale.Chat.Send}
                  className={styles["chat-input-send"]}
                  type="primary"
                  disabled={readOnly}
                  onClick={() => doSubmit(userInput)}
                />
              </label>
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
        <ExportMessageModal onClose={() => setShowExport(false)} />
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
                    setShowAutoModelSelector(false);
                    setModelSelectorProviderId(currentProviderId);
                    setIsProviderSelectorOpen(!isProviderSelectorOpen);
                  }}
                >
                  <span>{activeModelSelectorProviderDisplayName}</span>
                  <DownIcon />
                </button>
                <span className={styles["model-selector-hint-count"]}>
                  共 {models.length} 个模型可用
                </span>
                <button
                  type="button"
                  data-auto-model-selector-toggle="true"
                  className={clsx(styles["model-selector-auto-button"], {
                    [styles["model-selector-auto-button-active"]]:
                      autoModeEnabled,
                  })}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setIsProviderSelectorOpen(false);
                    setShowAutoModelSelector((visible) => !visible);
                  }}
                >
                  <AutoModeStateIcon enabled={autoModeEnabled} />
                  <span>自动模式</span>
                </button>
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
              {showAutoModelSelector && (
                <div
                  data-auto-model-selector-menu="true"
                  className={styles["model-selector-provider-menu"]}
                >
                  {autoModelSeriesItems.map((item) => {
                    const active = selectedAutoModelSeries === item.value;
                    const iconSrc = getProviderIcon(item.value);
                    return (
                      <button
                        type="button"
                        key={item.value}
                        className={clsx(
                          styles["model-selector-provider-option"],
                          {
                            [styles["model-selector-provider-option-active"]]:
                              active,
                          },
                        )}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          const normalized = active
                            ? []
                            : normalizeAutoModelSeries([item.value]);
                          config.update((config) => {
                            config.autoModelSeries = normalized;
                          });
                        }}
                      >
                        <span
                          className={
                            styles["model-selector-provider-option-leading"]
                          }
                        >
                          <span
                            className={clsx(
                              styles["model-selector-option-icon-frame"],
                              item.value === "doubao" &&
                                styles["model-selector-option-icon-frame-dark"],
                            )}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              alt={`${item.title} icon`}
                              className={clsx(
                                styles["model-selector-option-icon-image"],
                                item.value === "doubao" &&
                                  styles[
                                    "model-selector-option-icon-image-inset"
                                  ],
                              )}
                              src={iconSrc}
                            />
                          </span>
                        </span>
                        <span>{item.title}</span>
                        {active ? <ConfirmIcon /> : null}
                      </button>
                    );
                  })}
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
          quickFilters={modelSelectorQuickFilters}
          showSearch={true}
          extraGroups={["自定义模型"]}
          onGroupChange={(group) => {
            setModelSelectorDefaultGroup(group);
            localStorage.setItem(MODEL_SELECTOR_GROUP_STORAGE_KEY, group);
          }}
          onClose={() => {
            setShowAutoModelSelector(false);
            setShowModelSelector(false);
          }}
          onSelection={async (s) => {
            if (manualModelSelectionDisabled || s.length === 0) return;

            // 选择模型后关闭自动模型选择器（但保持主模型选择器打开）
            setShowAutoModelSelector(false);
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

            // 手动切换模型必须立即写回当前会话。
            // Effect B 仅会在空白会话时把全局配置同步到会话，
            // 已有消息的会话如果不在这里更新，会继续沿用旧模型发起请求。
            chatStore.updateTargetSession(session, (session) => {
              session.mask.modelConfig = nextModelConfig;
              session.mask.syncGlobalConfig = false;
            });

            console.info("[Model Selector] model changed", {
              sessionId: session.id,
              model: nextModelConfig.model,
              providerName: nextModelConfig.providerName,
              providerId: selectedProviderId,
              profileName: selectedProfile?.name,
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

            // 只有在非供应商切换后的1秒内才显示提示
            const timeSinceProviderSwitch =
              Date.now() - lastProviderSwitchTimeRef.current;
            if (timeSinceProviderSwitch > 1000) {
              showToast(`已选择 ${model}`);
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
  }, [sessionIdListKey, urlSessionId]);

  // 对话变化时同步 URL
  useEffect(() => {
    if (isNavigatingFromUrl.current) {
      isNavigatingFromUrl.current = false;
      return;
    }
    if (session?.id && session.messages.length > 0) {
      navigate(`/chat/${session.id}`, { replace: true });
    }
  }, [session?.id, navigate]);

  if (!session?.id) {
    return null;
  }

  return <_Chat key={session.id}></_Chat>;
}
