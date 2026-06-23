import { getMessageTextContent, isDalle3, trimTopic } from "../utils";
import { safeLocalStorage } from "../utils/safe-local-storage";

import { clearPersistedStateStorage } from "@/app/utils/indexeddb-state-storage";
import {
  chatPersistStorage,
  getPersistedChatSession,
  removePersistedChatSession,
  setPersistedChatSession,
} from "@/app/utils/chat-persist-storage";
import { nanoid } from "nanoid";
import { createJSONStorage } from "zustand/middleware";
import type {
  ClientApi,
  MultimodalContent,
  RequestMessage,
} from "../client/api";
import { getClientApi } from "../client/api";
import { ChatControllerPool } from "../client/controller";
import { showToast } from "../components/ui-lib";
import {
  ALWAYS_USE_CHINESE_SYSTEM_PROMPT,
  DEFAULT_INPUT_TEMPLATE,
  DEFAULT_MODELS,
  DEFAULT_SYSTEM_TEMPLATE,
  KnowledgeCutOffDate,
  MCP_SYSTEM_TEMPLATE,
  MCP_TOOLS_TEMPLATE,
  ServiceProvider,
  StoreKey,
  SUMMARIZE_MODEL,
} from "../constant";
import Locale, { getLang } from "../locales";
import { prettyObject } from "../utils/format";
import { createPersistStore } from "../utils/store";
import {
  countCompletionTokens,
  countPromptTokens,
  countSystemTokens,
  estimateTokenLength,
} from "../utils/token";
import { logPerfSummary, nowMs } from "../utils/perf";
import { logger } from "../utils/logger";
import { readManualSessionModelSelection } from "../utils/manual-model-selection";
import {
  DEFAULT_TOPIC,
  getBotHelloContent,
  getDefaultTopic,
} from "./chat-defaults";
import {
  AutoModelSeriesKey,
  ModelConfig,
  ModelType,
  useAppConfig,
} from "./config";
import { useAccessStore } from "./access";
import { useModelCacheStore } from "./model-cache";
import {
  collectModelsWithDefaultModel,
  getPreferredDisplayModelConfig,
  getPreferredRuntimeModelConfig,
  resolveModelProviderId,
} from "../utils/model";
import { buildCachedExtraModels } from "../utils/model-pool";
import { createEmptyMask, Mask } from "./mask";
import { BUILTIN_PLUGIN_IDS } from "./plugin";
import { executeMcpAction, getAllTools, isMcpEnabled } from "../mcp/actions";
import { extractMcpJson, isMcpJson } from "../mcp/utils";
import { sanitizeModelConfigForCapability } from "../client/model-parameter-rules";
import {
  AutoModelCandidate,
  buildAutoModelCandidates,
  getAutoModelSeriesLabel,
} from "../utils/auto-model";

export {
  DEFAULT_TOPIC,
  getBotHelloContent,
  getDefaultTopic,
} from "./chat-defaults";
import { createSyncClient, ProviderType } from "../utils/cloud";

const localStorage = safeLocalStorage();
const STREAM_REFRESH_DELAY = 48;
const AUTO_TITLE_REFRESH_USER_TEXT_THRESHOLD = 50;
const TAB_INITIALIZED_KEY = "nextchat_tab_initialized";
const TAB_CURRENT_SESSION_ID_KEY = "nextchat_tab_current_session_id";
export const CHAT_DELETE_UI_GUARD_UNTIL_KEY =
  "nextchat_chat_delete_ui_guard_until";
const CHAT_DELETE_UI_GUARD_MS = 8000;
const pendingSessionRefreshTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

function readSessionStorageItem(key: string) {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeSessionStorageItem(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(key, value);
  } catch {}
}

function markChatDeleteUiGuard() {
  writeSessionStorageItem(
    CHAT_DELETE_UI_GUARD_UNTIL_KEY,
    String(Date.now() + CHAT_DELETE_UI_GUARD_MS),
  );
}

function isChatDebugLoggingEnabled() {
  if (process.env.NODE_ENV === "test") {
    return false;
  }

  try {
    return (
      localStorage.getItem("debug-chat-logs") === "1" ||
      process.env.NEXT_PUBLIC_DEBUG_CHAT_LOGS === "1"
    );
  } catch {
    return process.env.NEXT_PUBLIC_DEBUG_CHAT_LOGS === "1";
  }
}

function isStandaloneDisplayMode() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return (
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
        true
    );
  } catch {
    return false;
  }
}

function isMobileUserAgent() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function isAndroidUserAgent() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /Android/i.test(navigator.userAgent);
}

function isDesktopPwaStartEntry() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    if (!isAndroidUserAgent()) {
      return isStandaloneDisplayMode() && isMobileUserAgent();
    }

    const source = new URLSearchParams(window.location.search)
      .get("source")
      ?.toLowerCase();
    const hasDesktopLaunchMarker = [
      "pwa",
      "shortcut",
      "homescreen",
      "a2hs",
    ].includes(source || "");
    const isDirectExternalEntry = document.referrer.trim().length === 0;

    return (
      isStandaloneDisplayMode() ||
      hasDesktopLaunchMarker ||
      isDirectExternalEntry
    );
  } catch {
    return false;
  }
}

function logChatDebug(...args: unknown[]) {
  if (!isChatDebugLoggingEnabled()) {
    return;
  }

  if (args.length === 0) {
    return;
  }

  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate(),
  )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  console.log(`[Debug][Chat] ${timestamp}`, ...args);
}

export type ChatMessageTool = {
  id: string;
  index?: number;
  type?: string;
  function?: {
    name: string;
    arguments?: string;
  };
  content?: string;
  isError?: boolean;
  errorMsg?: string;
};

export type ChatMessageUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  systemTokens?: number;
};

export type ChatMessage = RequestMessage & {
  date: string;
  streaming?: boolean;
  isError?: boolean;
  id: string;
  model?: ModelType;
  modelDisplay?: string;
  modelIcon?: ModelType;
  providerName?: ServiceProvider;
  providerId?: string;
  profileId?: string;
  profileName?: string;
  reasoning_details?: any;
  tools?: ChatMessageTool[];
  audio_url?: string;
  isMcpResponse?: boolean;
  usage?: ChatMessageUsage;
  manualStopped?: boolean;
};

export function createMessage(override: Partial<ChatMessage>): ChatMessage {
  return {
    id: nanoid(),
    date: new Date().toISOString(),
    role: "user",
    content: "",
    ...override,
  };
}

export interface ChatStat {
  tokenCount: number;
  wordCount: number;
  charCount: number;
}

export interface ChatSession {
  id: string;
  topic: string;

  memoryPrompt: string;
  messages: ChatMessage[];
  stat: ChatStat;
  createdAt: number;
  lastUpdate: number;
  lastSummarizeIndex: number;
  clearContextIndex?: number;

  mask: Mask;
}

export interface ChatSessionSummary {
  id: string;
  topic: string;
  messageCount: number;
  createdAt: number;
  displayTime: number;
  avatar: string;
  model: ModelType;
  searchText: string;
}

const SESSION_SEARCH_TEXT_LIMIT = 4000;

function getLocaleStoreStrings() {
  try {
    return Locale.Store;
  } catch {
    return {
      DefaultTopic: "New Chat",
      BotHello: "Hello",
    };
  }
}
export const BOT_HELLO: ChatMessage = createMessage({
  role: "assistant",
  content: getBotHelloContent(),
});

function isDefaultTopic(topic: string | undefined) {
  const normalizedTopic = String(topic || "").trim();

  return (
    !normalizedTopic ||
    normalizedTopic === getDefaultTopic() ||
    normalizedTopic === DEFAULT_TOPIC ||
    normalizedTopic === "新的聊天" ||
    normalizedTopic === "New Chat"
  );
}

function getSessionFallbackTopic(session: ChatSession) {
  const firstUserMessage = session.messages.find(
    (message) =>
      message.role === "user" &&
      Boolean(getMessageTextContent(message).trim()) &&
      !message.isError,
  );
  const firstValidMessage =
    firstUserMessage ??
    session.messages.find(
      (message) =>
        Boolean(getMessageTextContent(message).trim()) && !message.isError,
    );
  const rawTopic = firstValidMessage
    ? getMessageTextContent(firstValidMessage).trim()
    : "";

  return trimTopic(rawTopic);
}

function isFreshDefaultSession(session: ChatSession | undefined) {
  if (!session) {
    return false;
  }

  return (
    isDefaultTopic(session.topic) &&
    session.messages.length === 0 &&
    !session.memoryPrompt
  );
}

function isMeaningfulSession(session: ChatSession | undefined) {
  if (!session) {
    return false;
  }

  return (
    session.messages.length > 0 ||
    !isDefaultTopic(session.topic) ||
    !!session.memoryPrompt
  );
}

function shouldRemoveEmptyDefaultSession(session: ChatSession | undefined) {
  if (!session) {
    return false;
  }

  return (
    isDefaultTopic(session.topic) &&
    session.messages.length === 0 &&
    !session.memoryPrompt
  );
}

function ensureFreshDefaultSession(
  sessions: ChatSession[],
  options?: {
    preserveSessionId?: string;
  },
) {
  const preserveSessionId = String(options?.preserveSessionId || "");
  const normalizedSessions = sessions.filter(
    (session) =>
      !shouldRemoveEmptyDefaultSession(session) ||
      session.id === preserveSessionId,
  );

  if (normalizedSessions.some((session) => isFreshDefaultSession(session))) {
    return normalizedSessions;
  }

  return [createEmptySession(), ...normalizedSessions];
}

function areSessionArraysEqual(
  left: ChatSession[] | undefined,
  right: ChatSession[] | undefined,
) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  return left.every((session, index) => session.id === right[index]?.id);
}

function getSessionCreatedAt(session: Partial<ChatSession>) {
  const createdAt = Number(session.createdAt);
  if (Number.isFinite(createdAt) && createdAt > 0) {
    return createdAt;
  }

  const lastUpdate = Number(session.lastUpdate);
  if (Number.isFinite(lastUpdate) && lastUpdate > 0) {
    return lastUpdate;
  }

  return 0;
}

function sortSessionsByCreatedAt(sessions: ChatSession[]) {
  return sessions.sort((a, b) => {
    const createdAtDiff = getSessionCreatedAt(b) - getSessionCreatedAt(a);
    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }

    return Number(b.lastUpdate || 0) - Number(a.lastUpdate || 0);
  });
}

export function createEmptySession(): ChatSession {
  const now = Date.now();
  return {
    id: nanoid(),
    topic: getDefaultTopic(),
    memoryPrompt: "",
    messages: [],
    stat: {
      tokenCount: 0,
      wordCount: 0,
      charCount: 0,
    },
    createdAt: now,
    lastUpdate: now,
    lastSummarizeIndex: 0,

    mask: createEmptyMask(),
  };
}

function formatChatSessionLogLabel(session: Pick<ChatSession, "id" | "topic">) {
  const topic = String(session.topic || "").trim() || "未命名对话";
  return `${topic}（ID: ${session.id}）`;
}

function formatLimitedChatSessionLogLabels(sessions: ChatSession[]) {
  const labels = sessions.slice(0, 5).map(formatChatSessionLogLabel);
  return `${labels.join("、")}${
    sessions.length > 5 ? ` 等${sessions.length}个` : ""
  }`;
}

export function normalizeSession(
  session?: ChatSession,
): ChatSession | undefined {
  if (!session) {
    return session;
  }

  const fallbackSession = createEmptySession();
  const fallbackMask = fallbackSession.mask;
  const currentMask =
    session.mask && typeof session.mask === "object" ? session.mask : undefined;

  return {
    ...fallbackSession,
    ...session,
    createdAt: getSessionCreatedAt(session) || fallbackSession.createdAt,
    messages: Array.isArray(session.messages) ? session.messages : [],
    stat:
      session.stat && typeof session.stat === "object"
        ? {
            ...fallbackSession.stat,
            ...session.stat,
          }
        : fallbackSession.stat,
    mask: {
      ...fallbackMask,
      ...currentMask,
      syncGlobalConfig: true,
      context:
        currentMask && Array.isArray(currentMask.context)
          ? currentMask.context
          : [],
      plugin:
        currentMask &&
        Array.isArray(currentMask.plugin) &&
        currentMask.plugin.length > 0
          ? currentMask.plugin
          : [...BUILTIN_PLUGIN_IDS],
      modelConfig: {
        ...fallbackMask.modelConfig,
        ...(currentMask?.modelConfig || {}),
      },
    },
  };
}

export function buildSessionSummary(session: ChatSession): ChatSessionSummary {
  const normalizedSession = normalizeSession(session) ?? createEmptySession();
  const fallbackMask = createEmptyMask();

  return {
    id: normalizedSession.id,
    topic: normalizedSession.topic,
    messageCount: Array.isArray(normalizedSession.messages)
      ? normalizedSession.messages.length
      : 0,
    createdAt: normalizedSession.createdAt,
    displayTime:
      normalizedSession.createdAt || normalizedSession.lastUpdate || Date.now(),
    avatar: normalizedSession.mask?.avatar || fallbackMask.avatar,
    model:
      normalizedSession.mask?.modelConfig?.model ||
      fallbackMask.modelConfig.model,
    searchText: buildSessionSearchText(normalizedSession),
  };
}

function buildSessionSearchText(session: ChatSession) {
  const parts: string[] = [];
  let totalLength = 0;
  const messages = Array.isArray(session.messages) ? session.messages : [];

  for (const message of messages) {
    const content =
      typeof message.content === "string" ? message.content.trim() : "";
    if (!content) {
      continue;
    }

    const remaining = SESSION_SEARCH_TEXT_LIMIT - totalLength;
    if (remaining <= 0) {
      break;
    }

    const nextContent = content.slice(0, remaining);
    if (nextContent) {
      parts.push(nextContent.toLowerCase());
      totalLength += nextContent.length + 1;
    }
  }

  return parts.join("\n");
}

export function buildSessionSummaries(
  sessions: ChatSession[],
  existingSummaries?: ChatSessionSummary[],
) {
  if (!existingSummaries || existingSummaries.length === 0) {
    return sessions.map(buildSessionSummary);
  }

  // 创建 existingSummaries 的映射，以便快速查找
  const existingSummaryMap = new Map(existingSummaries.map((s) => [s.id, s]));

  return sessions.map((session) => {
    const existingSummary = existingSummaryMap.get(session.id);
    const newSummary = buildSessionSummary(session);

    // 如果 session 的 messages 为空（被修剪），但原有的 messageCount > 0，
    // 则保留原有的 messageCount
    if (
      existingSummary &&
      session.messages.length === 0 &&
      existingSummary.messageCount > 0
    ) {
      return {
        ...newSummary,
        messageCount: existingSummary.messageCount,
      };
    }

    return newSummary;
  });
}

function shouldRefreshSessionSummary(
  previousSession: ChatSession,
  nextSession: ChatSession,
) {
  const previousMessageCount = Array.isArray(previousSession.messages)
    ? previousSession.messages.length
    : 0;
  const nextMessageCount = Array.isArray(nextSession.messages)
    ? nextSession.messages.length
    : 0;
  const previousAvatar = previousSession.mask?.avatar || "";
  const nextAvatar = nextSession.mask?.avatar || "";
  const previousModel = previousSession.mask?.modelConfig?.model || "";
  const nextModel = nextSession.mask?.modelConfig?.model || "";

  return (
    previousSession.topic !== nextSession.topic ||
    previousSession.createdAt !== nextSession.createdAt ||
    previousMessageCount !== nextMessageCount ||
    previousAvatar !== nextAvatar ||
    previousModel !== nextModel
  );
}

function createSeedTestSession(
  index: number,
  options?: {
    empty?: boolean;
    messagePairs?: number;
    daysAgo?: number;
  },
) {
  const now = Date.now();
  const daysAgo = options?.daysAgo ?? index;
  const createdAt = now - daysAgo * 24 * 60 * 60 * 1000;
  const session = createEmptySession();
  session.id = nanoid();
  session.topic = options?.empty
    ? `空白测试会话 ${index + 1}`
    : `测试会话 ${index + 1}`;
  session.createdAt = createdAt;
  session.lastUpdate = createdAt;

  if (options?.empty) {
    return session;
  }

  const messagePairs = options?.messagePairs ?? (index % 4) + 2;
  const messages: ChatMessage[] = [];

  for (let i = 0; i < messagePairs; i += 1) {
    const userMessageTime = createdAt + i * 2 * 60 * 1000;
    const assistantMessageTime = userMessageTime + 45 * 1000;
    const userMessage = createMessage({
      id: nanoid(),
      role: "user",
      date: new Date(userMessageTime).toISOString(),
      content: `这是第 ${index + 1} 个测试会话的第 ${
        i + 1
      } 轮提问，用于验证侧边栏摘要、搜索、懒加载和滚动行为。`,
    });
    const assistantMessage = createMessage({
      id: nanoid(),
      role: "assistant",
      date: new Date(assistantMessageTime).toISOString(),
      model: session.mask.modelConfig.model,
      content:
        i === 0
          ? `测试会话 ${
              index + 1
            } 已生成。这个会话包含多轮消息，方便验证启动仅恢复索引和最近若干正文。`
          : `第 ${i + 1} 轮回复：当前会话编号 ${
              index + 1
            }，可用于测试切换老会话时的局部 loading 与正文补载。`,
    });
    messages.push(userMessage, assistantMessage);
  }

  session.messages = messages;
  session.lastSummarizeIndex = messages.length;
  session.lastUpdate = createdAt + messagePairs * 2 * 60 * 1000;
  session.mask.name = session.topic;
  return session;
}

async function fetchRemoteSessionById(sessionId: string) {
  if (!sessionId) {
    return undefined;
  }

  const { useSyncStore } = await import("./sync");
  const syncState = useSyncStore.getState();
  const provider = syncState.provider as ProviderType;
  const client = createSyncClient(provider, syncState[provider] as any);
  const remoteSessions = await client.getChatSessions?.([sessionId]);
  const remoteSession = remoteSessions?.[sessionId];

  if (!remoteSession || typeof remoteSession !== "object") {
    return undefined;
  }

  return remoteSession as ChatSession;
}

function createPrunedSession(session: ChatSession, preserveMessages: boolean) {
  if (preserveMessages || session.messages.length === 0) {
    return session;
  }

  return {
    ...session,
    messages: [],
  };
}

function isSessionPayloadPlaceholder(
  session: ChatSession | undefined,
  summary: ChatSessionSummary | undefined,
) {
  if (!session) {
    return false;
  }

  return (
    Number(summary?.messageCount || 0) > 0 &&
    (!Array.isArray(session.messages) || session.messages.length === 0)
  );
}

function clearPendingSessionRefresh(sessionId: string | undefined) {
  if (!sessionId) {
    return;
  }

  const timer = pendingSessionRefreshTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    pendingSessionRefreshTimers.delete(sessionId);
  }
}

function getAccessProviderId(profile: {
  provider: ServiceProvider;
  name: string;
}) {
  return profile.provider === ServiceProvider.Custom
    ? `custom_${profile.name}`.toLowerCase()
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

function getActiveAccessProfile(
  accessState: ReturnType<typeof useAccessStore.getState>,
  providerName: ServiceProvider | undefined,
) {
  if (!providerName) {
    return undefined;
  }

  if (providerName === ServiceProvider.Custom) {
    const activeProfile = accessState.apiProfiles.find((profile) => {
      if (
        profile.provider !== ServiceProvider.Custom ||
        !profile.baseUrl ||
        profile.baseUrl !== accessState.customUrl
      ) {
        return false;
      }

      if (!accessState.customApiKey) {
        return true;
      }

      return profile.apiKey === accessState.customApiKey;
    });

    return (
      activeProfile ??
      accessState.apiProfiles.find(
        (profile) =>
          profile.enabled && profile.provider === ServiceProvider.Custom,
      )
    );
  }

  if (providerName === ServiceProvider.Local) {
    const activeProfile = accessState.apiProfiles.find((profile) => {
      if (
        profile.provider !== ServiceProvider.Local ||
        !profile.baseUrl ||
        profile.baseUrl !== accessState.localUrl
      ) {
        return false;
      }

      if (!accessState.localApiKey) {
        return true;
      }

      return profile.apiKey === accessState.localApiKey;
    });

    return (
      activeProfile ??
      accessState.apiProfiles.find(
        (profile) =>
          profile.enabled && profile.provider === ServiceProvider.Local,
      )
    );
  }

  return (
    accessState.apiProfiles.find(
      (profile) => profile.enabled && profile.provider === providerName,
    ) ??
    accessState.apiProfiles.find((profile) => profile.provider === providerName)
  );
}

function getPreferredRefreshTitleModelForProvider(
  allModels: ReturnType<typeof collectModelsWithDefaultModel>,
  providerId: string,
) {
  const scopedModels = allModels.filter(
    (model) =>
      model.available &&
      String(model.provider?.id || "").toLowerCase() === providerId,
  );

  const candidates = scopedModels
    .filter((model) => isLooseRefreshTitleModel(model.name))
    .slice()
    .sort((left, right) => {
      const leftExact = normalizeModelKeyword(left.name) === "gpt4omini";
      const rightExact = normalizeModelKeyword(right.name) === "gpt4omini";
      if (leftExact !== rightExact) {
        return leftExact ? -1 : 1;
      }
      return String(left.name || "").localeCompare(String(right.name || ""));
    });

  return candidates[0];
}

function getSummarizeTarget(targetSession?: ChatSession) {
  const configStore = useAppConfig.getState();
  const accessStore = useAccessStore.getState();
  const allModel = collectModelsWithDefaultModel(
    configStore.models,
    configStore.customModels,
    accessStore.defaultModel,
  );
  const targetModelConfig = targetSession?.mask.modelConfig;
  const sessionProviderName =
    targetModelConfig?.providerName ?? ServiceProvider.Custom;
  const activeProfile =
    (targetModelConfig ? getProfileForModelConfig(targetModelConfig) : null) ??
    getActiveAccessProfile(accessStore, sessionProviderName) ??
    accessStore.apiProfiles.find((profile) => profile.enabled);
  const targetProfile =
    sessionProviderName === ServiceProvider.Custom
      ? activeProfile
      : accessStore.apiProfiles.find(
          (profile) => profile.provider === sessionProviderName,
        ) ?? activeProfile;
  const targetProviderId =
    targetProfile?.provider === ServiceProvider.Custom
      ? `custom_${targetProfile.name}`
      : String(
          targetProfile?.provider || sessionProviderName || "",
        ).toLowerCase();
  const currentSupplierModel = allModel.find(
    (m) =>
      m.name === SUMMARIZE_MODEL &&
      m.available &&
      String(m.provider?.id || "").toLowerCase() ===
        targetProviderId.toLowerCase(),
  );
  if (currentSupplierModel) {
    return {
      model: currentSupplierModel.name,
      providerName: currentSupplierModel.provider
        ?.providerName as ServiceProvider,
      profile: targetProfile,
    };
  }

  const aihubMixProfile = accessStore.apiProfiles.find(
    (profile) => profile.name === "AihubMix",
  );
  const aihubMixModel = allModel.find(
    (m) =>
      m.name === SUMMARIZE_MODEL &&
      m.available &&
      String(m.provider?.id || "").toLowerCase() === "custom_aihubmix",
  );
  if (aihubMixProfile && aihubMixModel) {
    return {
      model: aihubMixModel.name,
      providerName: ServiceProvider.Custom,
      profile: aihubMixProfile,
    };
  }

  return {
    model: targetModelConfig?.model || SUMMARIZE_MODEL,
    providerName: activeProfile?.provider ?? ServiceProvider.Custom,
    profile: activeProfile,
  };
}

function normalizeModelKeyword(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isLooseRefreshTitleModel(name: string) {
  const normalized = normalizeModelKeyword(name);
  // 只匹配 gpt-4o-mini，不包括其他变体（如 transcribe、tts、search 等）
  return (
    normalized === "gpt4omini" ||
    normalized === "gpt40mini" || // 4o 可能被识别为 40
    (normalized.includes("gpt") &&
      normalized.includes("4o") &&
      normalized.includes("mini") &&
      !normalized.includes("transcribe") &&
      !normalized.includes("tts") &&
      !normalized.includes("audio") &&
      !normalized.includes("search") &&
      !normalized.includes("realtime"))
  );
}

function getProfileForModel(
  modelProviderId: string | undefined,
  providerName: ServiceProvider | undefined,
) {
  const accessStore = useAccessStore.getState();
  const providerId = String(modelProviderId || "").toLowerCase();
  const lookupKeys = [modelProviderId, providerName]
    .map(normalizeProviderLookup)
    .filter(Boolean);

  if (lookupKeys.length > 0) {
    const matchProfileByProviderIdentity = (profile: {
      provider: ServiceProvider;
      name: string;
    }) => {
      const profileProviderId = getAccessProviderId(profile);
      const profileKeys = [
        profile.name,
        profile.provider,
        profileProviderId,
        profileProviderId.replace(/^(custom|local)_/i, ""),
      ]
        .map(normalizeProviderLookup)
        .filter(Boolean);

      return lookupKeys.some((key) => profileKeys.includes(key));
    };

    const matchedProfile =
      accessStore.apiProfiles.find(
        (profile) => profile.enabled && matchProfileByProviderIdentity(profile),
      ) ?? accessStore.apiProfiles.find(matchProfileByProviderIdentity);

    if (matchedProfile) {
      return matchedProfile;
    }
  }

  if (providerName === ServiceProvider.Custom) {
    return accessStore.apiProfiles.find((profile) => {
      const profileId =
        profile.provider === ServiceProvider.Custom
          ? `custom_${profile.name}`
          : String(profile.provider || "");
      return profileId.toLowerCase() === providerId;
    });
  }

  return (
    accessStore.apiProfiles.find(
      (profile) => profile.enabled && profile.provider === providerName,
    ) ??
    accessStore.apiProfiles.find((profile) => profile.provider === providerName)
  );
}

function getProfileForModelConfig(modelConfig: ModelConfig) {
  const accessStore = useAccessStore.getState();
  const configProviderId = String((modelConfig as any)?.providerId || "")
    .trim()
    .toLowerCase();
  const configProfileId = String((modelConfig as any)?.profileId || "").trim();

  const matchedProfile = accessStore.apiProfiles.find((profile) => {
    if (configProfileId && profile.id === configProfileId) {
      return true;
    }

    return (
      configProviderId &&
      getAccessProviderId(profile).toLowerCase() === configProviderId
    );
  });

  if (matchedProfile) {
    return matchedProfile;
  }

  return getActiveAccessProfile(accessStore, modelConfig.providerName);
}

function getRefreshTitleCandidates(targetSession: ChatSession) {
  const configStore = useAppConfig.getState();
  const accessStore = useAccessStore.getState();
  const allModels = collectModelsWithDefaultModel(
    configStore.models,
    configStore.customModels,
    accessStore.defaultModel,
  );
  const modelConfig = targetSession.mask.modelConfig;
  const currentProviderName =
    modelConfig.providerName ?? ServiceProvider.Custom;
  const currentProfile = getProfileForModelConfig(modelConfig);
  const currentProviderId = currentProfile
    ? getAccessProviderId(currentProfile)
    : String((modelConfig as any).providerId || currentProviderName || "")
        .trim()
        .toLowerCase();
  const currentRefreshModel = getPreferredRefreshTitleModelForProvider(
    allModels,
    currentProviderId,
  );

  const candidates: Array<{
    model: string;
    providerName: ServiceProvider;
    profile: any;
    providerId: string;
    score: number;
  }> = [];

  if (currentProfile && currentProviderId && modelConfig.model) {
    candidates.push({
      model: modelConfig.model,
      providerName: currentProviderName,
      profile: currentProfile,
      providerId: currentProviderId,
      score: 1000,
    });
  }

  if (
    currentProfile &&
    currentRefreshModel &&
    normalizeModelKeyword(currentRefreshModel.name) !==
      normalizeModelKeyword(modelConfig.model || "")
  ) {
    candidates.push({
      model: currentRefreshModel.name,
      providerName: (currentRefreshModel.provider?.providerName ||
        currentProviderName) as ServiceProvider,
      profile: currentProfile,
      providerId: currentProviderId,
      score: 900,
    });
  }

  if (!currentRefreshModel && currentProfile && currentProviderId) {
    candidates.push({
      model: SUMMARIZE_MODEL,
      providerName: currentProviderName,
      profile: currentProfile,
      providerId: currentProviderId,
      score: 800,
    });
  }

  const aihubMixProfile = accessStore.apiProfiles.find(
    (profile) =>
      profile.provider === ServiceProvider.Custom &&
      profile.name === "AihubMix",
  );
  const aihubMixProviderId = aihubMixProfile
    ? getAccessProviderId(aihubMixProfile)
    : "custom_aihubmix";
  const aihubMixRefreshModel = getPreferredRefreshTitleModelForProvider(
    allModels,
    aihubMixProviderId,
  );

  if (
    aihubMixProfile &&
    aihubMixRefreshModel &&
    aihubMixProviderId !== currentProviderId
  ) {
    candidates.push({
      model: aihubMixRefreshModel.name,
      providerName:
        (aihubMixRefreshModel.provider?.providerName as ServiceProvider) ||
        ServiceProvider.Custom,
      profile: aihubMixProfile,
      providerId: aihubMixProviderId,
      score: 100,
    });
  }

  const appendedProviderIds = new Set(
    candidates.map((candidate) => candidate.providerId),
  );
  const fallbackProviderMap = new Map<
    string,
    {
      model: string;
      providerName: ServiceProvider;
      profile: any;
      providerId: string;
      score: number;
    }
  >();

  allModels.forEach((model) => {
    if (!model.available || !isLooseRefreshTitleModel(model.name)) {
      return;
    }

    const providerId = String(model.provider?.id || "").toLowerCase();
    if (!providerId || appendedProviderIds.has(providerId)) {
      return;
    }

    const providerName = model.provider?.providerName as
      | ServiceProvider
      | undefined;
    const profile = getProfileForModel(model.provider?.id, providerName);
    if (!profile) {
      return;
    }

    const isExact = normalizeModelKeyword(model.name) === "gpt4omini";
    const existing = fallbackProviderMap.get(providerId);
    if (
      !existing ||
      (isExact && normalizeModelKeyword(existing.model) !== "gpt4omini")
    ) {
      fallbackProviderMap.set(providerId, {
        model: model.name,
        providerName: (providerName as ServiceProvider) || profile.provider,
        profile,
        providerId,
        score: isExact ? 10 : 1,
      });
    }
  });

  candidates.push(
    ...Array.from(fallbackProviderMap.values()).sort(
      (left, right) => right.score - left.score,
    ),
  );

  logger.chat.log(
    "可用 API 配置:",
    accessStore.apiProfiles.map((p) => ({
      配置名称: p.name,
      供应商类型: p.provider,
      已启用: p.enabled,
    })),
  );
  logger.chat.log("模型总数:", allModels.length);
  logger.chat.log("当前供应商:", currentProviderId);

  logger.chat.log(
    "最终候选模型:",
    candidates.map((c) => ({
      模型: c.model,
      供应商ID: c.providerId,
      配置名称: c.profile?.name,
      配置地址: c.profile?.baseUrl,
      APIKey状态: c.profile?.apiKey ? "已配置" : "缺失",
      评分: c.score,
    })),
  );

  if (candidates.length > 0) {
    return candidates;
  }

  const fallback = getSummarizeTarget(targetSession);
  return [
    {
      model: fallback.model,
      providerName: fallback.providerName,
      profile: fallback.profile,
      providerId: fallback.profile
        ? getAccessProviderId(fallback.profile)
        : String(fallback.providerName).toLowerCase(),
      score: -1,
    },
  ];
}

function resolveDisplayProviderName(
  modelConfig: ModelConfig,
  allModels = collectModelsWithDefaultModel(
    useAppConfig.getState().models,
    useAppConfig.getState().customModels,
    useAccessStore.getState().defaultModel,
  ),
  accessProfiles = useAccessStore.getState().apiProfiles,
) {
  const displayModelConfig =
    getPreferredDisplayModelConfig(allModels, modelConfig, accessProfiles) ||
    modelConfig;

  if (displayModelConfig.providerName !== ServiceProvider.Custom) {
    return displayModelConfig.providerName;
  }

  const configProviderId = String((modelConfig as any)?.providerId || "")
    .trim()
    .toLowerCase();
  const configProfileId = String((modelConfig as any)?.profileId || "").trim();
  const configProfile = accessProfiles.find((profile) => {
    if (configProfileId && profile.id === configProfileId) {
      return true;
    }
    return (
      configProviderId &&
      profile.provider === ServiceProvider.Custom &&
      `custom_${profile.name}`.toLowerCase() === configProviderId
    );
  });
  if (configProfile?.name) {
    return configProfile.name;
  }

  const accessState = useAccessStore.getState();
  const activeProfile = accessState.apiProfiles.find((profile) => {
    if (
      profile.provider !== ServiceProvider.Custom ||
      !profile.baseUrl ||
      profile.baseUrl !== accessState.customUrl
    ) {
      return false;
    }

    if (!accessState.customApiKey) {
      return true;
    }

    return profile.apiKey === accessState.customApiKey;
  });
  const enabledProfile = accessState.apiProfiles.find(
    (p) => p.enabled && p.provider === ServiceProvider.Custom,
  );

  return (
    activeProfile?.name || enabledProfile?.name || modelConfig.providerName
  );
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

function getApiFailurePayloadText(message: unknown) {
  if (typeof message === "string") {
    return message;
  }

  if (Array.isArray(message)) {
    return message
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item?.type === "text" && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (message && typeof message === "object" && "error" in message) {
    try {
      return JSON.stringify(message);
    } catch {
      return String((message as { error?: unknown }).error || "");
    }
  }

  return "";
}

function isApiFailurePayload(message: unknown) {
  const failureText = getApiFailurePayloadText(message);
  if (!failureText) {
    return false;
  }

  try {
    const parsed = JSON.parse(failureText);
    return Boolean(parsed?.error);
  } catch {
    const lowerMessage = failureText.toLowerCase();
    return (
      lowerMessage.includes("model_not_found") ||
      lowerMessage.includes("service unavailable") ||
      lowerMessage.includes('"error"')
    );
  }
}

function getMessageContentLength(message: unknown) {
  if (typeof message === "string") {
    return message.length;
  }
  if (Array.isArray(message)) {
    return message.length;
  }
  return getApiFailurePayloadText(message).length;
}

function buildAutoModeFailureSummary(
  errors: Array<{
    candidate: AutoModelCandidate;
    reason: string;
  }>,
) {
  return [
    "自动模式尝试的模型全部失败。",
    "",
    ...errors.map(({ candidate, reason }, index) => {
      const providerLabel =
        candidate.providerName === ServiceProvider.Custom
          ? candidate.providerId.replace(/^custom_/i, "")
          : candidate.providerName;
      return `${index + 1}. ${getAutoModelSeriesLabel(candidate.series)} / ${
        candidate.displayName
      } / ${providerLabel}: ${reason}`;
    }),
  ].join("\n");
}

function logRequestBanner(
  kind: "chat" | "title",
  payload: {
    model: string;
    provider: string;
    baseUrl?: string;
    chatPath?: string;
    stream?: boolean;
    profileName?: string | null;
    attempt?: string;
  },
) {
  const title = kind === "chat" ? "💬💬💬 对话请求开始" : "🏷️🏷️🏷️ 标题请求开始";
  const line = "=".repeat(5);
  logger.chat.log(
    `${line} ${title} | ${kind === "chat" ? "对话请求" : "标题请求"} ${line}`,
    {
      模型: payload.model,
      供应商: payload.provider,
      基础地址: payload.baseUrl,
      请求路径: payload.chatPath,
      流式请求: payload.stream,
      配置名称: payload.profileName,
      尝试说明: payload.attempt,
    },
  );
}

async function refreshSessionTitle(targetSession: ChatSession) {
  const session = targetSession;
  const modelConfig = session.mask.modelConfig;
  const messages = session.messages;
  const candidates = getRefreshTitleCandidates(session);

  if (messages.length === 0) {
    showToast("没有可用于刷新标题的对话内容");
    return false;
  }

  const startIndex = Math.max(
    0,
    messages.length - modelConfig.historyMessageCount,
  );
  const topicMessages = messages
    .slice(
      startIndex < messages.length ? startIndex : messages.length - 1,
      messages.length,
    )
    .concat(
      createMessage({
        role: "user",
        content: Locale.Store.Prompt.Topic,
      }),
    );

  for (const candidate of candidates) {
    logger.chat.log("正在尝试标题候选模型:", {
      模型: candidate.model,
      供应商ID: candidate.providerId,
      配置名称: candidate.profile?.name,
      配置地址: candidate.profile?.baseUrl,
      是否有配置: !!candidate.profile,
    });

    const api: ClientApi = getClientApi(
      candidate.providerName as ServiceProvider,
    );

    try {
      const result = await withSummarizeProfile(candidate.profile, async () => {
        let success = false;

        await api.llm.chat({
          messages: topicMessages,
          config: {
            model: candidate.model,
            stream: false,
            providerName: candidate.providerName,
          },
          onFinish(message, responseRes) {
            success =
              responseRes?.status === 200 && Boolean(trimTopic(message || ""));

            if (success) {
              useChatStore
                .getState()
                .updateTargetSession(session, (session) => {
                  session.topic = trimTopic(message);
                });
            }
          },
          onError(err) {
            logger.chat.error("刷新标题出错:", err);
          },
        });

        return success;
      });

      if (result) {
        return true;
      }
    } catch (error) {
      logger.chat.error("刷新标题候选模型失败", candidate, error);
    }
  }

  showToast(
    "标题刷新失败：当前供应商和其他供应商都尝试过了，请检查模型或 API 配置",
  );
  return false;
}

function withSummarizeProfile<T>(
  profile:
    | {
        provider: ServiceProvider;
        baseUrl: string;
        apiKey: string;
        openAICompatible?: boolean;
      }
    | undefined,
  fn: () => T,
): T {
  if (!profile || profile.provider !== ServiceProvider.Custom) {
    return fn();
  }

  const accessStore = useAccessStore.getState();
  const prevState = {
    provider: accessStore.provider,
    customUrl: accessStore.customUrl,
    customApiKey: accessStore.customApiKey,
    customOpenAICompatible: accessStore.customOpenAICompatible,
  };

  logger.chat.log("[标题生成] 使用当前对话 API 配置:", {
    基础地址: profile.baseUrl,
    APIKey状态: profile.apiKey ? "已配置" : "缺失",
    OpenAI兼容: profile.openAICompatible,
  });

  useAccessStore.setState({
    provider: ServiceProvider.Custom,
    customUrl: profile.baseUrl,
    customApiKey: profile.apiKey,
    customOpenAICompatible: profile.openAICompatible ?? true,
  } as any);

  try {
    const result = fn();
    // 如果 fn() 返回 Promise，在 Promise 完成后再恢复状态
    if (result instanceof Promise) {
      return (result as Promise<T>).finally(() => {
        useAccessStore.setState(prevState as any);
        logger.chat.log("[标题生成] 请求结束，已清理标题生成请求上下文");
      }) as T;
    }
    return result;
  } catch (error) {
    useAccessStore.setState(prevState as any);
    logger.chat.log("[标题生成] 请求出错，已清理标题生成请求上下文");
    throw error;
  }
}

function countMessages(msgs: ChatMessage[]) {
  return msgs.reduce(
    (pre, cur) => pre + estimateTokenLength(getMessageTextContent(cur)),
    0,
  );
}

function canAutoGenerateSessionTitle(messages: ChatMessage[]) {
  let hasUserMessage = false;
  let lastCompletedAssistantMessage = false;

  for (const message of messages) {
    if (message.isError) {
      continue;
    }

    if (message.role === "user" && getMessageTextContent(message).trim()) {
      hasUserMessage = true;
      lastCompletedAssistantMessage = false;
    }

    if (
      message.role === "assistant" &&
      getMessageTextContent(message).trim() &&
      !message.streaming
    ) {
      lastCompletedAssistantMessage = true;
    }
  }

  return hasUserMessage && lastCompletedAssistantMessage;
}

function shouldAutoRefreshSessionTitle(session: ChatSession) {
  const messages = session.messages;
  if (!canAutoGenerateSessionTitle(messages)) {
    return false;
  }

  const userMessages = messages.filter(
    (message) =>
      !message.isError &&
      message.role === "user" &&
      Boolean(getMessageTextContent(message).trim()),
  );
  const latestUserMessage = userMessages.at(-1);

  if (!latestUserMessage) {
    return false;
  }

  if (userMessages.length <= 1) {
    return true;
  }

  return (
    getMessageTextContent(latestUserMessage).trim().length >
    AUTO_TITLE_REFRESH_USER_TEXT_THRESHOLD
  );
}

function getMessageIconModel(
  model: string,
  providerName?: ServiceProvider,
): ModelType {
  const normalizedModel = String(model || "").toLowerCase();
  if (
    normalizedModel.startsWith("gpt") ||
    normalizedModel.startsWith("chatgpt") ||
    normalizedModel.startsWith("o1") ||
    normalizedModel.startsWith("o3") ||
    normalizedModel.startsWith("o4") ||
    normalizedModel.startsWith("o5") ||
    normalizedModel.includes("deepseek") ||
    normalizedModel.startsWith("doubao") ||
    normalizedModel.startsWith("ep-") ||
    normalizedModel.startsWith("claude") ||
    normalizedModel.startsWith("gemini") ||
    normalizedModel.startsWith("grok") ||
    normalizedModel.startsWith("qwen") ||
    normalizedModel.startsWith("ernie") ||
    normalizedModel.includes("wenxin") ||
    normalizedModel.includes("glm") ||
    normalizedModel.startsWith("hunyuan") ||
    normalizedModel.startsWith("moonshot") ||
    normalizedModel.startsWith("kimi") ||
    normalizedModel.includes("llama") ||
    normalizedModel.startsWith("mixtral") ||
    normalizedModel.startsWith("codestral")
  ) {
    return model as ModelType;
  }

  const configStore = useAppConfig.getState();
  const accessStore = useAccessStore.getState();
  const allModels = collectModelsWithDefaultModel(
    configStore.models,
    configStore.customModels,
    accessStore.defaultModel,
  );
  const matchedModel = allModels.find(
    (item) =>
      item.name === model && item.provider?.providerName === providerName,
  );

  if (matchedModel?.vendor?.name) {
    return matchedModel.vendor.name as ModelType;
  }

  return (providerName || model) as ModelType;
}

function fillTemplateWith(input: string, modelConfig: ModelConfig) {
  const cutoff =
    KnowledgeCutOffDate[modelConfig.model] ?? KnowledgeCutOffDate.default;
  // Find the model in the DEFAULT_MODELS array that matches the modelConfig.model
  const modelInfo = DEFAULT_MODELS.find((m) => m.name === modelConfig.model);

  var serviceProvider = "OpenAI";
  if (modelInfo) {
    // TODO: auto detect the providerName from the modelConfig.model

    // Directly use the providerName from the modelInfo
    serviceProvider = modelInfo.provider.providerName;
  }

  const vars = {
    ServiceProvider: serviceProvider,
    cutoff,
    model: modelConfig.model,
    time: new Date().toString(),
    lang: getLang(),
    input: input,
  };

  let output = modelConfig.template ?? DEFAULT_INPUT_TEMPLATE;

  // remove duplicate
  if (input.startsWith(output)) {
    output = "";
  }

  // must contains {{input}}
  const inputVar = "{{input}}";
  if (!output.includes(inputVar)) {
    output += "\n" + inputVar;
  }

  Object.entries(vars).forEach(([name, value]) => {
    const regex = new RegExp(`{{${name}}}`, "g");
    output = output.replace(regex, value.toString()); // Ensure value is a string
  });

  return output;
}

async function getMcpSystemPrompt(): Promise<string> {
  const tools = await getAllTools();

  let toolsStr = "";

  tools.forEach((i) => {
    // error client has no tools
    if (!i.tools) return;

    toolsStr += MCP_TOOLS_TEMPLATE.replace(
      "{{ clientId }}",
      i.clientId,
    ).replace(
      "{{ tools }}",
      i.tools.tools.map((p: object) => JSON.stringify(p, null, 2)).join("\n"),
    );
  });

  return MCP_SYSTEM_TEMPLATE.replace("{{ MCP_TOOLS }}", toolsStr);
}

const DEFAULT_SESSION = createEmptySession();

const DEFAULT_CHAT_STATE = {
  sessions: [DEFAULT_SESSION],
  sessionSummaries: [buildSessionSummary(DEFAULT_SESSION)],
  currentSessionIndex: 0,
  selectedSessionId: DEFAULT_SESSION.id,
  hydratingSessionId: "",
  hydratedSessionIds: [] as string[],
  lastInput: "",
  globalClearAt: 0,
  deletedSessionTimestamps: {} as Record<string, number>,
};

export const useChatStore = createPersistStore(
  DEFAULT_CHAT_STATE,
  (set, _get) => {
    function get() {
      return {
        ..._get(),
        ...methods,
      };
    }

    const methods = {
      initializeForNewPage() {
        const currentState = get();
        const currentSessions = Array.isArray(currentState.sessions)
          ? currentState.sessions.slice()
          : [];
        const currentSessionId =
          currentState.selectedSessionId ||
          currentSessions[currentState.currentSessionIndex]?.id ||
          "";

        let sessions = ensureFreshDefaultSession(currentSessions, {
          preserveSessionId: currentSessionId,
        });
        let changed = sessions.length !== currentSessions.length;

        logChatDebug("[initializeForNewPage] 开始", {
          currentSessionsCount: currentSessions.length,
          removedEmptySessionsCount: currentSessions.length - sessions.length,
          currentSessionId,
        });

        sessions.forEach((session) => {
          if (session.messages.length > 0 && isDefaultTopic(session.topic)) {
            const fallbackTopic = getSessionFallbackTopic(session);
            if (fallbackTopic) {
              session.topic = fallbackTopic;
              changed = true;
            }
          }
        });

        let newIndex = 0;
        const routePath =
          typeof window !== "undefined"
            ? String(window.location.hash || "").replace(/^#/, "") ||
              window.location.pathname
            : "";
        const chatMatch = routePath.match(/^\/chat\/([^/]+)/);
        const urlId = chatMatch ? chatMatch[1] : "";
        const hasTabInitialized =
          readSessionStorageItem(TAB_INITIALIZED_KEY) === "1";
        const tabCurrentSessionId = readSessionStorageItem(
          TAB_CURRENT_SESSION_ID_KEY,
        );
        const resolveSessionById = (sessionId: string) =>
          sessions.find((session) => session.id === sessionId);

        const isPwaStartEntry = isDesktopPwaStartEntry();
        const isNewTab = !hasTabInitialized || isPwaStartEntry;
        const isRefreshWithChatUrl =
          !isPwaStartEntry &&
          hasTabInitialized &&
          !!urlId &&
          !!resolveSessionById(urlId);

        if (isNewTab) {
          const startupSession = createEmptySession();
          sessions = [
            startupSession,
            ...sessions.filter((session) => !isFreshDefaultSession(session)),
          ];
          changed = true;
          newIndex = 0;
          writeSessionStorageItem(TAB_INITIALIZED_KEY, "1");
          writeSessionStorageItem(
            TAB_CURRENT_SESSION_ID_KEY,
            startupSession.id,
          );
        } else if (isRefreshWithChatUrl) {
          const idx = sessions.findIndex((s) => s.id === urlId);
          if (idx >= 0) newIndex = idx;

          if (!sessions.some((s) => isFreshDefaultSession(s))) {
            const emptySession = createEmptySession();
            sessions = [emptySession, ...sessions];
            changed = true;
            newIndex += 1;
          }
        } else {
          const startupSession = createEmptySession();
          sessions = [
            startupSession,
            ...sessions.filter((session) => !isFreshDefaultSession(session)),
          ];
          changed = true;
          newIndex = 0;
          writeSessionStorageItem(
            TAB_CURRENT_SESSION_ID_KEY,
            startupSession.id,
          );
        }

        logChatDebug("[initializeForNewPage] 完成", {
          sessionsCount: sessions.length,
          currentSessionIndex: newIndex,
        });

        const nextState = {
          sessions,
          sessionSummaries: buildSessionSummaries(
            sessions,
            currentState.sessionSummaries,
          ),
          currentSessionIndex: newIndex,
          selectedSessionId: sessions[newIndex]?.id || "",
          hydratedSessionIds: sessions
            .filter(
              (session) =>
                Array.isArray(session.messages) && session.messages.length > 0,
            )
            .map((session) => session.id),
        };

        if (
          changed ||
          currentState.currentSessionIndex !== newIndex ||
          currentState.sessions[0]?.id !== sessions[0]?.id
        ) {
          logChatDebug("[initializeForNewPage] 应用新状态");
          set(() => nextState);
        }

        writeSessionStorageItem(TAB_INITIALIZED_KEY, "1");
        writeSessionStorageItem(
          TAB_CURRENT_SESSION_ID_KEY,
          sessions[newIndex]?.id || "",
        );

        get().pruneInactiveSessionsInMemory();

        // 首开页面对“新空对话”的本地整理不再触发远端聊天同步，
        // 避免首次进入就因为空会话变更打远端接口。
      },

      refreshFreshDefaultSessionModel() {
        const configStore = useAppConfig.getState();
        const nextModelConfig = sanitizeModelConfigForCapability({
          ...configStore.modelConfig,
        });

        set((state) => {
          let changed = false;
          const sessions = state.sessions.map((session) => {
            if (!isFreshDefaultSession(session)) {
              return session;
            }

            changed = true;
            return {
              ...session,
              mask: {
                ...session.mask,
                syncGlobalConfig: true,
                modelConfig: nextModelConfig,
              },
            };
          });

          if (!changed) {
            return {};
          }

          return {
            sessions,
            sessionSummaries: buildSessionSummaries(
              sessions,
              state.sessionSummaries,
            ),
          };
        });
      },

      forkSession() {
        // 获取当前会话
        const currentSession = get().currentSession();
        if (!currentSession) return;

        const newSession = createEmptySession();

        newSession.topic = currentSession.topic;
        // 深拷贝消息
        newSession.messages = currentSession.messages.map((msg) => ({
          ...msg,
          id: nanoid(), // 生成新的消息 ID
        }));
        newSession.mask = {
          ...currentSession.mask,
          modelConfig: {
            ...currentSession.mask.modelConfig,
          },
        };

        set((state) => ({
          currentSessionIndex: 0,
          selectedSessionId: newSession.id,
          sessionSummaries: [
            buildSessionSummary(newSession),
            ...state.sessionSummaries,
          ],
          sessions: [newSession, ...state.sessions],
        }));

        import("./sync").then(({ useSyncStore }) => {
          useSyncStore.getState().triggerDebounceSync([StoreKey.Chat], {
            delayMs: 0,
          });
        });
      },

      async clearSessions() {
        const newSessions = [createEmptySession()];
        const deletedSessions = get().sessions.filter((session) => session?.id);
        const globalClearAt = Date.now();
        const deletedSessionTimestamps = Object.fromEntries(
          deletedSessions.map((session) => [session.id, globalClearAt]),
        );
        set(() => ({
          sessions: newSessions,
          sessionSummaries: buildSessionSummaries(newSessions),
          currentSessionIndex: 0,
          selectedSessionId: newSessions[0]?.id || "",
          globalClearAt,
          deletedSessionTimestamps,
        }));

        if (deletedSessions.length > 0) {
          console.log(
            `[Chat] 🧹 清空对话：已删除 ${formatLimitedChatSessionLogLabels(
              deletedSessions,
            )}；已新建 ${formatChatSessionLogLabel(newSessions[0])}`,
          );
        }

        // 使用统一聊天同步链路传播删除，避免远端残留旧会话。
        try {
          const { useSyncStore } = await import("./sync");
          const syncStore = useSyncStore.getState();
          if (syncStore.cloudSync()) {
            await syncStore.sync([StoreKey.Chat], { force: true });
            logger.chat.log("✅ 清空对话已同步到服务器");
          }
        } catch (error) {
          logger.chat.error("❌ 同步清空对话失败:", error);
        }
      },

      async resetForUserSwitch(options?: { sync?: boolean }) {
        const newSessions = [createEmptySession()];
        set(() => ({
          sessions: newSessions,
          sessionSummaries: buildSessionSummaries(newSessions),
          currentSessionIndex: 0,
          selectedSessionId: newSessions[0]?.id || "",
          globalClearAt: 0,
          deletedSessionTimestamps: {},
          hydratedSessionIds: [],
          hydratingSessionId: "",
        }));

        if (options?.sync === false) {
          return;
        }

        try {
          const { useSyncStore } = await import("./sync");
          await useSyncStore.getState().sync([StoreKey.Chat], {
            isolateQueue: true,
            force: true,
            downloadOnlyChat: true,
          });
        } catch (error) {
          logger.chat.error("❌ 切换用户后同步失败:", error);
        }
      },

      selectSession(index: number) {
        const sessionId = get().sessions[index]?.id || "";
        if (sessionId) {
          writeSessionStorageItem(TAB_INITIALIZED_KEY, "1");
          writeSessionStorageItem(TAB_CURRENT_SESSION_ID_KEY, sessionId);
        }
        set({
          currentSessionIndex: index,
          selectedSessionId: sessionId,
        });
      },

      selectSessionById(sessionId: string) {
        const targetIndex = get().sessions.findIndex(
          (session) => session.id === sessionId,
        );
        if (targetIndex < 0) {
          return;
        }

        get().selectSession(targetIndex);
      },

      moveSession(from: number, to: number) {
        set((state) => {
          const {
            sessions,
            sessionSummaries,
            currentSessionIndex: oldIndex,
          } = state;

          // move the session
          const newSessions = [...sessions];
          const session = newSessions[from];
          newSessions.splice(from, 1);
          newSessions.splice(to, 0, session);

          const newSessionSummaries = [...sessionSummaries];
          const summary = newSessionSummaries[from];
          newSessionSummaries.splice(from, 1);
          newSessionSummaries.splice(to, 0, summary);

          // modify current session id
          let newIndex = oldIndex === from ? to : oldIndex;
          if (oldIndex > from && oldIndex <= to) {
            newIndex -= 1;
          } else if (oldIndex < from && oldIndex >= to) {
            newIndex += 1;
          }

          return {
            currentSessionIndex: newIndex,
            selectedSessionId: newSessions[newIndex]?.id || "",
            sessionSummaries: newSessionSummaries,
            sessions: newSessions,
          };
        });

        import("./sync").then(({ useSyncStore }) => {
          useSyncStore.getState().triggerDebounceSync([StoreKey.Chat]);
        });
      },

      newSession(mask?: Mask) {
        if (!mask) {
          const existingEmptyIndex = get().sessions.findIndex((session) =>
            isFreshDefaultSession(session),
          );

          if (existingEmptyIndex >= 0) {
            const configStore = useAppConfig.getState();
            const nextModelConfig = sanitizeModelConfigForCapability({
              ...configStore.modelConfig,
            });
            set((state) => {
              const sessions = state.sessions.slice();
              const existingSession = sessions[existingEmptyIndex];
              if (existingSession?.mask) {
                sessions[existingEmptyIndex] = {
                  ...existingSession,
                  mask: {
                    ...existingSession.mask,
                    syncGlobalConfig: true,
                    modelConfig: nextModelConfig,
                  },
                };
              }

              return {
                sessions,
                sessionSummaries: buildSessionSummaries(
                  sessions,
                  state.sessionSummaries,
                ),
              };
            });
            get().selectSession(existingEmptyIndex);
            return false;
          }
        }

        const session = createEmptySession();

        if (mask) {
          const config = useAppConfig.getState();
          const globalModelConfig = config.modelConfig;

          session.mask = {
            ...mask,
            syncGlobalConfig: true,
            modelConfig: { ...globalModelConfig },
          };
          session.topic = mask.name;
        } else {
          const currentSession = get().currentSession();
          if (currentSession) {
            const configStore = useAppConfig.getState();
            const globalModelConfig = configStore.modelConfig;
            const accessStore = useAccessStore.getState();
            const modelCacheStore = useModelCacheStore.getState();
            const globalProviderId = String(
              (globalModelConfig as any)?.providerId || "",
            )
              .trim()
              .toLowerCase();
            const enabledProfile =
              (accessStore.apiProfiles || []).find(
                (profile) =>
                  globalProviderId &&
                  getAccessProviderId(profile).toLowerCase() ===
                    globalProviderId,
              ) ||
              (accessStore.apiProfiles || []).find(
                (profile) => profile.enabled,
              ) ||
              (accessStore.apiProfiles || []).find(
                (profile) => profile.provider === accessStore.provider,
              );
            const activeProviderId = enabledProfile
              ? getAccessProviderId(enabledProfile).toLowerCase()
              : (
                  resolveModelProviderId(
                    collectModelsWithDefaultModel(
                      configStore.models,
                      configStore.customModels,
                      accessStore.defaultModel,
                    ),
                    globalModelConfig,
                    accessStore.apiProfiles,
                  ) || globalProviderId
                ).toLowerCase();
            const cachedExtras = buildCachedExtraModels(
              accessStore.apiProfiles || [],
              (modelCacheStore as any).profiles || {},
            );
            const allModels = collectModelsWithDefaultModel(
              [...configStore.models, ...cachedExtras],
              configStore.customModels,
              accessStore.defaultModel,
            );
            const nextModelConfig = sanitizeModelConfigForCapability({
              ...globalModelConfig,
            });
            if (activeProviderId) {
              (nextModelConfig as any).providerId = activeProviderId;
            }
            if (enabledProfile?.id) {
              (nextModelConfig as any).profileId = enabledProfile.id;
            }

            session.mask = {
              ...currentSession.mask,
              id: session.mask.id,
              name: session.mask.name,
              syncGlobalConfig: true,
              modelConfig: nextModelConfig,
            };
          }
        }

        set((state) => {
          const sessions = mask
            ? [session].concat(state.sessions)
            : ensureFreshDefaultSession([session].concat(state.sessions), {
                preserveSessionId: session.id,
              });

          const newSummary = buildSessionSummary(session);
          const oldSummaryMap = new Map(
            (state.sessionSummaries || []).map((s) => [s.id, s]),
          );
          const sessionSummaries: ChatSessionSummary[] = sessions.map((s) => {
            if (s.id === session.id) return newSummary;
            return oldSummaryMap.get(s.id) ?? buildSessionSummary(s);
          });

          return {
            currentSessionIndex: 0,
            selectedSessionId: session.id,
            sessionSummaries,
            sessions,
          };
        });

        console.log(
          `[Chat] ➕ 新增对话：${formatChatSessionLogLabel(session)}`,
        );

        // 新建空白会话只更新本地 UI，不立即上传；等真正产生消息后再同步。
        return true;
      },

      nextSession(delta: number) {
        const n = get().sessions.length;
        const limit = (x: number) => (x + n) % n;
        const i = get().currentSessionIndex;
        get().selectSession(limit(i + delta));
      },

      deleteSession(index: number, silent?: boolean) {
        const deletingLastSession = get().sessions.length === 1;
        const deletedSession = get().sessions.at(index);

        if (!deletedSession) return;

        const sessions = get().sessions.slice();
        sessions.splice(index, 1);

        const currentIndex = get().currentSessionIndex;
        let nextIndex = Math.min(
          currentIndex - Number(index < currentIndex),
          sessions.length - 1,
        );

        if (deletingLastSession) {
          nextIndex = 0;
          sessions.push(createEmptySession());
        }

        const deletedAt = Date.now();
        const deletedSessionTimestamps = {
          ...get().deletedSessionTimestamps,
          [deletedSession.id]: deletedAt,
        };

        // for undo delete action
        const restoreState = silent
          ? null
          : {
              currentSessionIndex: get().currentSessionIndex,
              selectedSessionId: get().currentSessionId(),
              sessions: get().sessions.slice(),
              sessionSummaries: get().sessionSummaries.slice(),
              deletedSessionTimestamps: {
                ...get().deletedSessionTimestamps,
              },
            };

        set(() => ({
          currentSessionIndex: nextIndex,
          selectedSessionId: sessions[nextIndex]?.id || "",
          sessionSummaries: buildSessionSummaries(
            sessions,
            get().sessionSummaries,
          ),
          sessions,
          hydratedSessionIds: get().hydratedSessionIds.filter(
            (sessionId) => sessionId !== deletedSession.id,
          ),
          deletedSessionTimestamps,
        }));
        markChatDeleteUiGuard();

        console.log(
          `[Chat] ➖ 删除对话：${formatChatSessionLogLabel(deletedSession)}`,
        );

        if (!silent) {
          showToast(
            Locale.Home.DeleteToast,
            {
              text: Locale.Home.Revert,
              onClick() {
                set(() => restoreState!);
                import("./sync").then(({ useSyncStore }) => {
                  useSyncStore
                    .getState()
                    .sync([StoreKey.Chat], { force: true })
                    .catch((error) => {
                      logger.chat.error("❌ 撤销删除后立即同步失败:", error);
                    });
                });
              },
            },
            5000,
          );
        }

        // 删除会话后立即同步，避免远端旧会话被自动同步拉回
        import("./sync").then(({ useSyncStore }) => {
          useSyncStore
            .getState()
            .sync([StoreKey.Chat], {
              force: true,
              isolateQueue: true,
              skipChatWriteBack: true,
            })
            .catch((error) => {
              logger.chat.error("❌ 删除会话后立即同步失败:", error);
            });
        });
        void removePersistedChatSession(deletedSession.id);
      },

      deleteSessionById(sessionId: string) {
        if (!sessionId) return;

        const index = get().sessions.findIndex(
          (session) => session.id === sessionId,
        );

        if (index < 0) return;

        get().deleteSession(index);
      },

      deleteSessionsByIds(sessionIds: string[]) {
        const idsToDelete = new Set(sessionIds.filter(Boolean));
        if (idsToDelete.size === 0) return;

        const currentState = get();
        const deletedSessions = currentState.sessions.filter((session) =>
          idsToDelete.has(session.id),
        );

        if (deletedSessions.length === 0) return;

        const restoreState = {
          currentSessionIndex: currentState.currentSessionIndex,
          selectedSessionId: currentState.currentSessionId(),
          sessions: currentState.sessions.slice(),
          sessionSummaries: currentState.sessionSummaries.slice(),
          deletedSessionTimestamps: {
            ...currentState.deletedSessionTimestamps,
          },
        };
        const deletedAt = Date.now();
        const deletedSessionTimestamps = {
          ...currentState.deletedSessionTimestamps,
          ...Object.fromEntries(
            deletedSessions.map((session) => [session.id, deletedAt]),
          ),
        };
        let sessions = currentState.sessions.filter(
          (session) => !idsToDelete.has(session.id),
        );

        if (sessions.length === 0) {
          sessions = [createEmptySession()];
        }

        const currentSessionId =
          currentState.sessions[currentState.currentSessionIndex]?.id || "";
        const nextIndex = idsToDelete.has(currentSessionId)
          ? 0
          : Math.max(
              0,
              sessions.findIndex((session) => session.id === currentSessionId),
            );

        set(() => ({
          currentSessionIndex: nextIndex,
          selectedSessionId: sessions[nextIndex]?.id || "",
          sessionSummaries: buildSessionSummaries(
            sessions,
            currentState.sessionSummaries,
          ),
          sessions,
          hydratedSessionIds: currentState.hydratedSessionIds.filter(
            (sessionId) => !idsToDelete.has(sessionId),
          ),
          deletedSessionTimestamps,
        }));
        markChatDeleteUiGuard();

        console.log(
          `[Chat] ➖ 批量删除对话：${deletedSessions
            .map(formatChatSessionLogLabel)
            .join("、")}`,
        );

        showToast(
          Locale.Home.DeleteToast,
          {
            text: Locale.Home.Revert,
            onClick() {
              set(() => restoreState);
              import("./sync").then(({ useSyncStore }) => {
                useSyncStore
                  .getState()
                  .sync([StoreKey.Chat], { force: true })
                  .catch((error) => {
                    logger.chat.error("❌ 撤销批量删除后立即同步失败:", error);
                  });
              });
            },
          },
          5000,
        );

        import("./sync").then(({ useSyncStore }) => {
          useSyncStore
            .getState()
            .sync([StoreKey.Chat], {
              force: true,
              isolateQueue: true,
              skipChatWriteBack: true,
            })
            .catch((error) => {
              logger.chat.error("❌ 批量删除会话后立即同步失败:", error);
            });
        });
        deletedSessions.forEach((session) => {
          void removePersistedChatSession(session.id);
        });
      },

      deleteCurrentSession() {
        get().deleteSession(get().currentSessionIndex);
      },

      getSessionById(sessionId: string) {
        if (!sessionId) {
          return undefined;
        }

        return get().sessions.find((session) => session.id === sessionId);
      },

      async loadSessionById(sessionId: string) {
        if (!sessionId) {
          return undefined;
        }

        const inMemorySession = get().getSessionById(sessionId);
        const summary = get().sessionSummaries.find(
          (session) => session.id === sessionId,
        );
        const isPrunedInMemory = isSessionPayloadPlaceholder(
          inMemorySession,
          summary,
        );

        if (inMemorySession && !isPrunedInMemory) {
          return inMemorySession;
        }

        const persistedSession =
          await getPersistedChatSession<ChatSession>(sessionId);
        const isPersistedPlaceholder = isSessionPayloadPlaceholder(
          persistedSession ?? undefined,
          summary,
        );
        if (persistedSession && !isPersistedPlaceholder) {
          return normalizeSession(persistedSession);
        }

        const remoteSession = await fetchRemoteSessionById(sessionId);
        if (remoteSession) {
          const normalizedRemoteSession = normalizeSession(remoteSession);
          if (normalizedRemoteSession) {
            await get().saveSessionToPersistedStorage(normalizedRemoteSession);
          }
          return normalizedRemoteSession;
        }

        // 三个来源都找不到内容，删除孤儿会话
        const orphanIndex = get().sessions.findIndex((s) => s.id === sessionId);
        if (orphanIndex >= 0) {
          const orphanSession = get().sessions[orphanIndex];
          console.warn(
            `[Chat] ⚠️ 会话内容在本地和远端均不存在，自动删除孤儿会话：${formatChatSessionLogLabel(
              orphanSession,
            )}`,
          );
          get().deleteSession(orphanIndex);
        }

        return undefined;
      },

      async saveSessionToPersistedStorage(session: ChatSession) {
        if (!session?.id) {
          return;
        }

        await setPersistedChatSession(
          session.id,
          session as unknown as Record<string, unknown>,
        );
      },

      async hydrateSessionIntoMemory(sessionId: string) {
        if (!sessionId) {
          return undefined;
        }

        const hydrateStartedAt = nowMs();

        const summary = get().sessionSummaries.find(
          (session) => session.id === sessionId,
        );
        set(() => ({ hydratingSessionId: sessionId }));

        try {
          const persistedSession = normalizeSession(
            await get().loadSessionById(sessionId),
          );
          if (!persistedSession) {
            return undefined;
          }

          set((state) => {
            const targetIndex = state.sessions.findIndex(
              (session) => session.id === sessionId,
            );
            if (targetIndex < 0) {
              return state;
            }

            const nextSessions = state.sessions.slice();
            nextSessions[targetIndex] = persistedSession;
            const keepSessionIds = new Set(
              state.hydratedSessionIds.filter(Boolean),
            );
            // 使用 targetIndex 来确定当前会话，而不是 state.currentSessionIndex
            const currentSessionId =
              targetIndex === state.currentSessionIndex
                ? sessionId
                : nextSessions[state.currentSessionIndex]?.id;
            if (currentSessionId) {
              keepSessionIds.add(currentSessionId);
            }
            // 确保正在加载的会话被保留
            keepSessionIds.add(sessionId);
            const prunedSessions = nextSessions.map((session) =>
              createPrunedSession(session, keepSessionIds.has(session.id)),
            );

            return {
              sessions: prunedSessions,
              hydratedSessionIds: Array.from(
                new Set([...state.hydratedSessionIds, sessionId]),
              ),
            };
          });

          return persistedSession;
        } finally {
          logPerfSummary("ChatHydrate", {
            currentSessionHydrateDurationMs: Number(
              (nowMs() - hydrateStartedAt).toFixed(2),
            ),
            sessionId,
            messageCount: Number(summary?.messageCount || 0),
          });
          set(() => ({ hydratingSessionId: "" }));
        }
      },

      pruneInactiveSessionsInMemory() {
        set((state) => {
          const keepSessionIds = new Set(
            state.hydratedSessionIds.filter(Boolean),
          );
          const currentSessionId =
            state.sessions[state.currentSessionIndex]?.id ?? "";
          if (currentSessionId) {
            keepSessionIds.add(currentSessionId);
          }
          const nextSessions = state.sessions.map((session) =>
            createPrunedSession(session, keepSessionIds.has(session.id)),
          );

          return {
            sessions: nextSessions,
          };
        });
      },

      currentSessionId() {
        return (
          get().selectedSessionId ||
          get().sessions[get().currentSessionIndex]?.id ||
          ""
        );
      },

      currentSession() {
        const currentSessionId = get().currentSessionId();
        const sessions = get().sessions;
        const sessionById = currentSessionId
          ? get().getSessionById(currentSessionId)
          : undefined;
        if (sessionById) {
          return sessionById;
        }

        let index = get().currentSessionIndex;
        if (currentSessionId) {
          const targetIndex = sessions.findIndex(
            (session) => session.id === currentSessionId,
          );
          if (targetIndex >= 0) {
            index = targetIndex;
          }
        }

        if (index < 0 || index >= sessions.length) {
          index = Math.min(sessions.length - 1, Math.max(0, index));
          set(() => ({
            currentSessionIndex: index,
            selectedSessionId: sessions[index]?.id || "",
          }));
        }

        const session = sessions[index];
        return session;
      },

      onNewMessage(message: ChatMessage, targetSession: ChatSession) {
        get().flushTargetSessionRefresh(targetSession);
        get().updateTargetSession(targetSession, (session) => {
          session.messages = session.messages.concat();
          session.lastUpdate = Date.now();
        });

        get().updateStat(message, targetSession);

        get().checkMcpJson(message);

        get().summarizeSession(false, targetSession);

        // 触发防抖同步（动态导入避免循环依赖）
        import("./sync").then(({ useSyncStore }) => {
          useSyncStore.getState().triggerDebounceSync([StoreKey.Chat]);
        });
      },

      scheduleTargetSessionRefresh(
        targetSession: ChatSession,
        delay: number = STREAM_REFRESH_DELAY,
      ) {
        const sessionId = targetSession?.id;
        if (!sessionId) {
          return;
        }

        if (pendingSessionRefreshTimers.has(sessionId)) {
          return;
        }

        const timer = setTimeout(
          () => {
            pendingSessionRefreshTimers.delete(sessionId);
            const sessions = get().sessions;
            const index = sessions.findIndex(
              (session) => session.id === sessionId,
            );
            if (index < 0) {
              return;
            }

            set(() => ({ sessions }));
          },
          Math.max(0, delay),
        );

        pendingSessionRefreshTimers.set(sessionId, timer);
      },

      flushTargetSessionRefresh(targetSession: ChatSession) {
        const sessionId = targetSession?.id;
        if (!sessionId) {
          return;
        }

        clearPendingSessionRefresh(sessionId);
        const sessions = get().sessions;
        const index = sessions.findIndex((session) => session.id === sessionId);
        if (index < 0) {
          return;
        }

        set(() => ({ sessions }));
      },

      async onUserInput(
        content: string,
        attachImages?: string[],
        isMcpResponse?: boolean,
        options?: { reuseUserMessageId?: string },
      ) {
        logChatDebug("[Chat] 💬 用户输入:", {
          contentLength: content.length,
          hasImages: attachImages && attachImages.length > 0,
          isMcpResponse,
        });

        const session = get().currentSession();
        const manualModelSelection = readManualSessionModelSelection(
          session.id,
        );
        const modelConfig = manualModelSelection
          ? ({
              ...session.mask.modelConfig,
              ...manualModelSelection,
            } as ModelConfig)
          : session.mask.modelConfig;
        const appConfig = useAppConfig.getState();
        const accessStore = useAccessStore.getState();
        const autoModelSeries = (appConfig.autoModelSeries ||
          []) as AutoModelSeriesKey[];
        const autoModeEnabled =
          autoModelSeries.length > 0 &&
          session.mask.syncGlobalConfig &&
          !manualModelSelection;
        const allModels = collectModelsWithDefaultModel(
          appConfig.models,
          appConfig.customModels,
          accessStore.defaultModel,
        );
        const autoCandidates = autoModeEnabled
          ? buildAutoModelCandidates(
              allModels,
              accessStore.apiProfiles,
              autoModelSeries,
            )
          : [];
        const selectedAutoSeries = autoModelSeries[0];
        const initialModelConfig =
          autoModeEnabled && autoCandidates.length > 0
            ? sanitizeModelConfigForCapability({
                ...modelConfig,
                model: autoCandidates[0].model as ModelType,
                providerName: autoCandidates[0].providerName,
              })
            : sanitizeModelConfigForCapability({
                ...modelConfig,
                ...(session.mask.syncGlobalConfig && !manualModelSelection
                  ? getPreferredRuntimeModelConfig(
                      allModels,
                      modelConfig,
                      accessStore.apiProfiles,
                    ) || {}
                  : {}),
              });

        // 获取实际提供商名称（对于 Custom provider，显示 profile 名称）
        const displayModelConfig =
          getPreferredDisplayModelConfig(
            allModels,
            initialModelConfig,
            accessStore.apiProfiles,
          ) || initialModelConfig;
        const displayProviderName = resolveDisplayProviderName(
          initialModelConfig,
          allModels,
          accessStore.apiProfiles,
        );
        const resolvedProviderId = (
          resolveModelProviderId(
            allModels,
            initialModelConfig,
            accessStore.apiProfiles,
          ) || String((initialModelConfig as any).providerId || "")
        ).toLowerCase();
        const resolvedProfile = getProfileForModel(
          resolvedProviderId,
          initialModelConfig.providerName,
        );
        if (resolvedProviderId) {
          (initialModelConfig as any).providerId = resolvedProviderId;
        }
        if (resolvedProfile?.id) {
          (initialModelConfig as any).profileId = resolvedProfile.id;
        }
        const resolvedDisplayProviderName =
          resolvedProfile?.name || displayProviderName;

        if (autoModeEnabled) {
          logChatDebug("[Chat] 🔄 自动模式已启用:", {
            selectedSeries: selectedAutoSeries || null,
            candidateCount: autoCandidates.length,
            candidates: autoCandidates.map((candidate, index) => ({
              index: index + 1,
              series: candidate.series,
              provider: candidate.providerDisplayName,
              providerName: candidate.providerName,
              model: candidate.model,
            })),
          });
        }

        // MCP Response no need to fill template
        let mContent: string | MultimodalContent[] = isMcpResponse
          ? content
          : fillTemplateWith(content, initialModelConfig);

        if (!isMcpResponse && attachImages && attachImages.length > 0) {
          mContent = [
            ...(content ? [{ type: "text" as const, text: content }] : []),
            ...attachImages.map((url) => ({
              type: "image_url" as const,
              image_url: { url },
            })),
          ];
        }

        const reusedUserMessage = options?.reuseUserMessageId
          ? session.messages.find(
              (message) =>
                message.id === options.reuseUserMessageId &&
                message.role === "user",
            )
          : undefined;
        const userMessage: ChatMessage = reusedUserMessage
          ? {
              ...reusedUserMessage,
              content: mContent,
              isMcpResponse,
            }
          : createMessage({
              role: "user",
              content: mContent,
              isMcpResponse,
            });

        const botMessage: ChatMessage = createMessage({
          role: "assistant",
          streaming: true,
          model: initialModelConfig.model,
          modelDisplay: formatModelProviderLabel(
            displayModelConfig.model,
            resolvedDisplayProviderName,
          ),
          providerName: initialModelConfig.providerName as ServiceProvider,
          providerId: String((initialModelConfig as any).providerId || ""),
          profileId: String((initialModelConfig as any).profileId || ""),
          profileName: resolvedDisplayProviderName,
          modelIcon: getMessageIconModel(
            initialModelConfig.model,
            initialModelConfig.providerName,
          ),
        });

        // get recent messages
        const recentMessages =
          await get().getMessagesWithMemory(initialModelConfig);
        const sendMessages = reusedUserMessage
          ? recentMessages
          : recentMessages.concat(userMessage);
        const messageIndex =
          session.messages.length + (reusedUserMessage ? 0 : 1);

        logChatDebug("[Chat] 📨 发送消息:", {
          contextMessages: recentMessages.length,
          totalMessages: sendMessages.length,
        });

        // save user's and bot's message
        get().updateTargetSession(session, (session) => {
          const savedUserMessage = {
            ...userMessage,
            content: mContent,
            date: new Date().toISOString(),
          };
          session.mask.modelConfig = {
            ...session.mask.modelConfig,
            ...initialModelConfig,
          };
          if (isDefaultTopic(session.topic)) {
            const fallbackTopic = trimTopic(content.trim());
            if (fallbackTopic) {
              session.topic = fallbackTopic;
            }
          }
          if (reusedUserMessage) {
            const userIndex = session.messages.findIndex(
              (message) => message.id === reusedUserMessage.id,
            );
            if (userIndex >= 0) {
              const nextMessages = session.messages.slice();
              nextMessages[userIndex] = savedUserMessage;
              nextMessages.splice(userIndex + 1, 0, botMessage);
              session.messages = nextMessages;
            } else {
              session.messages = session.messages.concat([botMessage]);
            }
          } else {
            session.messages = session.messages.concat([
              savedUserMessage,
              botMessage,
            ]);
          }
        });

        if (!autoModeEnabled) {
          const api: ClientApi = getClientApi(initialModelConfig.providerName);
          api.llm.chat({
            messages: sendMessages,
            config: {
              ...initialModelConfig,
              stream: initialModelConfig.stream !== false,
            },
            onRequest(request) {
              logRequestBanner("chat", {
                model: request.model,
                provider: request.provider,
                baseUrl: request.baseUrl,
                chatPath: request.chatPath,
                stream: request.stream,
                profileName: resolvedDisplayProviderName,
              });
            },
            onUpdate(message) {
              botMessage.streaming = true;
              if (message) {
                botMessage.content = message;
              }
              get().scheduleTargetSessionRefresh(session);
            },
            async onFinish(message, responseRes) {
              get().flushTargetSessionRefresh(session);
              botMessage.streaming = false;
              const finalMessage = message || getMessageTextContent(botMessage);
              if (finalMessage) {
                const hasFailure = isApiFailurePayload(finalMessage);

                botMessage.content = finalMessage;
                botMessage.date = new Date().toISOString();
                botMessage.reasoning_details = (responseRes as any)
                  ?.__reasoning_details;
                const apiUsage = (responseRes as any)?.__usage;
                if (apiUsage && Number.isFinite(apiUsage.total_tokens)) {
                  botMessage.usage = {
                    promptTokens: Number(apiUsage.prompt_tokens),
                    completionTokens: Number(apiUsage.completion_tokens),
                    totalTokens: Number(apiUsage.total_tokens),
                    systemTokens: countSystemTokens(
                      sendMessages,
                      initialModelConfig.model,
                    ),
                  };
                  if (
                    Number.isFinite(
                      apiUsage.prompt_tokens_details?.cached_tokens,
                    )
                  ) {
                    botMessage.usage.cachedTokens = Number(
                      apiUsage.prompt_tokens_details.cached_tokens,
                    );
                  }
                  if (
                    Number.isFinite(
                      apiUsage.completion_tokens_details?.reasoning_tokens,
                    )
                  ) {
                    botMessage.usage.reasoningTokens = Number(
                      apiUsage.completion_tokens_details.reasoning_tokens,
                    );
                  }
                } else {
                  const promptTokens = countPromptTokens(
                    sendMessages,
                    initialModelConfig.model,
                  );
                  const completionTokens = countCompletionTokens(
                    finalMessage,
                    initialModelConfig.model,
                  );
                  botMessage.usage = {
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens,
                    systemTokens: countSystemTokens(
                      sendMessages,
                      initialModelConfig.model,
                    ),
                  };
                }
                botMessage.isError = hasFailure;
                userMessage.isError = hasFailure;

                if (hasFailure) {
                  logger.chat.error(
                    "❌ API 调用失败(响应错误体), 响应长度:",
                    getMessageContentLength(finalMessage),
                  );
                } else {
                  logger.chat.log(
                    "✅ API 调用完成, 响应长度:",
                    getMessageContentLength(finalMessage),
                  );
                }
                get().onNewMessage(botMessage, session);
              } else {
                get().flushTargetSessionRefresh(session);
              }
              import("./sync").then(({ useSyncStore }) => {
                useSyncStore
                  .getState()
                  .triggerDebounceSync([StoreKey.Chat], { delayMs: 0 });
              });
              ChatControllerPool.remove(session.id, botMessage.id);
            },
            onBeforeTool(tool: ChatMessageTool) {
              logger.chat.log("🔧 工具调用:", tool.function?.name);
              (botMessage.tools = botMessage?.tools || []).push(tool);
              get().flushTargetSessionRefresh(session);
            },
            onAfterTool(tool: ChatMessageTool) {
              botMessage?.tools?.forEach((t, i, tools) => {
                if (tool.id == t.id) {
                  tools[i] = { ...tool };
                }
              });
              get().flushTargetSessionRefresh(session);
            },
            onError(error) {
              get().flushTargetSessionRefresh(session);
              const isAborted = error.message?.includes?.("aborted");
              logger.chat.error(
                "❌ API 调用失败:",
                error.message,
                isAborted ? "(已中止)" : "",
              );
              botMessage.content +=
                "\n\n" +
                prettyObject({
                  error: true,
                  message: error.message,
                });
              botMessage.streaming = false;
              userMessage.isError = !isAborted;
              botMessage.isError = !isAborted;
              get().flushTargetSessionRefresh(session);
              ChatControllerPool.remove(
                session.id,
                botMessage.id ?? messageIndex,
              );

              logger.chat.error("API failed:", error);
              import("./sync").then(({ useSyncStore }) => {
                useSyncStore
                  .getState()
                  .triggerDebounceSync([StoreKey.Chat], { delayMs: 0 });
              });
            },
            onController(controller) {
              ChatControllerPool.addController(
                session.id,
                botMessage.id ?? messageIndex,
                controller,
              );
            },
          });
          return;
        }

        if (autoCandidates.length === 0) {
          const errorMessage =
            "自动模式未找到可用模型，请检查所选系列和 API 配置。";
          botMessage.streaming = false;
          botMessage.content = errorMessage;
          botMessage.isError = true;
          userMessage.isError = true;
          get().updateTargetSession(session, (session) => {
            session.messages = session.messages.concat();
          });
          get().onNewMessage(botMessage, session);
          showToast(errorMessage);
          return;
        }

        const attemptErrors: Array<{
          candidate: AutoModelCandidate;
          reason: string;
        }> = [];

        const attemptChatWithCandidate = async (
          candidate: AutoModelCandidate,
          attemptIndex: number,
        ) => {
          const candidateProfile = getProfileForModel(
            candidate.providerId,
            candidate.providerName,
          );
          const candidateConfig = sanitizeModelConfigForCapability({
            ...modelConfig,
            model: candidate.model as ModelType,
            providerName: candidate.providerName,
          });

          botMessage.model = candidate.model as ModelType;
          botMessage.modelDisplay = formatModelProviderLabel(
            candidate.displayName || candidate.model,
            candidate.providerDisplayName,
          );
          botMessage.providerName = candidate.providerName as ServiceProvider;
          botMessage.providerId = candidate.providerId;
          botMessage.profileId = String(candidateProfile?.id || "");
          botMessage.profileName =
            candidateProfile?.name || candidate.providerDisplayName;
          botMessage.modelIcon = getMessageIconModel(
            candidate.model,
            candidate.providerName,
          );
          botMessage.content = "";
          botMessage.tools = [];
          botMessage.reasoning_details = undefined;
          botMessage.usage = undefined;
          botMessage.streaming = true;
          botMessage.isError = false;
          userMessage.isError = false;

          get().updateTargetSession(session, (session) => {
            session.messages = session.messages.concat();
          });

          const api: ClientApi = getClientApi(candidate.providerName);
          const attemptLabel = `${attemptIndex + 1}/${autoCandidates.length}`;
          let requestUrl = "";

          return new Promise<"success" | "failed" | "aborted">((resolve) => {
            let settled = false;

            const finalize = (status: "success" | "failed" | "aborted") => {
              if (settled) return;
              settled = true;
              resolve(status);
            };

            withSummarizeProfile(candidateProfile as any, () =>
              api.llm.chat({
                messages: sendMessages,
                config: {
                  ...candidateConfig,
                  stream: candidateConfig.stream !== false,
                },
                onRequest(request: { chatPath: string; baseUrl: string }) {
                  requestUrl = request?.chatPath || request?.baseUrl || "";
                  logger.chat.log("🚀 自动模式尝试:", {
                    attempt: attemptLabel,
                    selectedSeries: selectedAutoSeries || candidate.series,
                    series: candidate.series,
                    provider: candidate.providerDisplayName,
                    providerName: candidate.providerName,
                    providerId: candidate.providerId,
                    profileName: candidateProfile?.name || null,
                    model: candidate.model,
                    url: requestUrl,
                  });
                  logRequestBanner("chat", {
                    model: candidate.model,
                    provider: String(candidate.providerName),
                    baseUrl: request?.baseUrl,
                    chatPath: request?.chatPath,
                    stream: candidateConfig.stream !== false,
                    profileName: candidateProfile?.name || null,
                    attempt: attemptLabel,
                  });
                },
                onUpdate(message) {
                  botMessage.streaming = true;
                  if (message) {
                    botMessage.content = message;
                  }
                  get().scheduleTargetSessionRefresh(session);
                },
                onFinish(message, responseRes) {
                  get().flushTargetSessionRefresh(session);
                  botMessage.streaming = false;
                  const finalMessage =
                    message || getMessageTextContent(botMessage);
                  const responseUrl = responseRes?.url || requestUrl || "";

                  if (!finalMessage) {
                    attemptErrors.push({
                      candidate,
                      reason: "空响应",
                    });
                    logger.chat.warn("自动模式尝试失败:", {
                      attempt: attemptLabel,
                      provider: candidate.providerDisplayName,
                      providerId: candidate.providerId,
                      model: candidate.model,
                      url: responseUrl,
                      reason: "空响应",
                    });
                    botMessage.content = "";
                    botMessage.usage = undefined;
                    ChatControllerPool.remove(
                      session.id,
                      botMessage.id ?? messageIndex,
                    );
                    finalize("failed");
                    return;
                  }

                  if (isApiFailurePayload(finalMessage)) {
                    attemptErrors.push({
                      candidate,
                      reason: finalMessage,
                    });
                    logger.chat.warn("自动模式尝试失败:", {
                      attempt: attemptLabel,
                      provider: candidate.providerDisplayName,
                      providerId: candidate.providerId,
                      model: candidate.model,
                      url: responseUrl,
                      reason: finalMessage,
                    });
                    botMessage.content = "";
                    botMessage.reasoning_details = undefined;
                    botMessage.usage = undefined;
                    get().flushTargetSessionRefresh(session);
                    ChatControllerPool.remove(
                      session.id,
                      botMessage.id ?? messageIndex,
                    );
                    finalize("failed");
                    return;
                  }

                  botMessage.content = finalMessage;
                  botMessage.date = new Date().toISOString();
                  botMessage.reasoning_details = (responseRes as any)
                    ?.__reasoning_details;
                  const promptTokens = countPromptTokens(
                    sendMessages,
                    candidate.model,
                  );
                  const completionTokens = countCompletionTokens(
                    finalMessage,
                    candidate.model,
                  );
                  botMessage.usage = {
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens,
                    systemTokens: countSystemTokens(
                      sendMessages,
                      candidate.model,
                    ),
                  };
                  botMessage.isError = false;
                  userMessage.isError = false;
                  get().onNewMessage(botMessage, session);
                  logger.chat.log("✅ 自动模式尝试成功:", {
                    attempt: attemptLabel,
                    provider: candidate.providerDisplayName,
                    providerId: candidate.providerId,
                    model: candidate.model,
                    url: responseUrl,
                  });
                  ChatControllerPool.remove(
                    session.id,
                    botMessage.id ?? messageIndex,
                  );
                  finalize("success");
                },
                onBeforeTool(tool: ChatMessageTool) {
                  logger.chat.log("🔧 工具调用:", tool.function?.name);
                  (botMessage.tools = botMessage?.tools || []).push(tool);
                  get().flushTargetSessionRefresh(session);
                },
                onAfterTool(tool: ChatMessageTool) {
                  botMessage?.tools?.forEach((t, i, tools) => {
                    if (tool.id == t.id) {
                      tools[i] = { ...tool };
                    }
                  });
                  get().flushTargetSessionRefresh(session);
                },
                onError(error) {
                  get().flushTargetSessionRefresh(session);
                  const isAborted = error.message?.includes?.("aborted");
                  const logMethod = isAborted
                    ? logger.chat.log.bind(logger.chat)
                    : logger.chat.warn.bind(logger.chat);
                  logMethod("自动模式尝试失败:", {
                    attempt: attemptLabel,
                    provider: candidate.providerDisplayName,
                    providerId: candidate.providerId,
                    model: candidate.model,
                    url: requestUrl,
                    reason: error.message,
                    aborted: isAborted,
                  });
                  botMessage.streaming = false;
                  botMessage.content = "";
                  botMessage.reasoning_details = undefined;
                  botMessage.usage = undefined;
                  get().flushTargetSessionRefresh(session);
                  ChatControllerPool.remove(
                    session.id,
                    botMessage.id ?? messageIndex,
                  );

                  if (isAborted) {
                    finalize("aborted");
                    return;
                  }

                  attemptErrors.push({
                    candidate,
                    reason: error.message,
                  });
                  finalize("failed");
                },
                onController(controller) {
                  ChatControllerPool.addController(
                    session.id,
                    botMessage.id ?? messageIndex,
                    controller,
                  );
                },
              }),
            ).catch((error) => {
              const message =
                error instanceof Error ? error.message : String(error);
              logger.chat.warn("自动模式尝试失败:", {
                attempt: attemptLabel,
                provider: candidate.providerDisplayName,
                providerId: candidate.providerId,
                model: candidate.model,
                url: requestUrl,
                reason: message,
                rejected: true,
              });
              attemptErrors.push({
                candidate,
                reason: message,
              });
              botMessage.streaming = false;
              botMessage.content = "";
              botMessage.usage = undefined;
              get().flushTargetSessionRefresh(session);
              ChatControllerPool.remove(
                session.id,
                botMessage.id ?? messageIndex,
              );
              finalize("failed");
            });
          });
        };

        for (const [attemptIndex, candidate] of autoCandidates.entries()) {
          const result = await attemptChatWithCandidate(
            candidate,
            attemptIndex,
          );
          if (result === "success") {
            return;
          }
          if (result === "aborted") {
            return;
          }
        }

        const summary = buildAutoModeFailureSummary(attemptErrors);
        botMessage.streaming = false;
        botMessage.content = summary;
        botMessage.isError = true;
        botMessage.reasoning_details = undefined;
        botMessage.usage = undefined;
        userMessage.isError = true;
        get().updateTargetSession(session, (session) => {
          session.messages = session.messages.concat();
        });
        get().onNewMessage(botMessage, session);
        showToast("自动模式尝试失败，请检查模型与 API 配置。");
      },

      getMemoryPrompt() {
        const session = get().currentSession();

        if (session.memoryPrompt.length) {
          return {
            role: "system",
            content: Locale.Store.Prompt.History(session.memoryPrompt),
            date: "",
          } as ChatMessage;
        }
      },

      async getMessagesWithMemory(modelConfigOverride?: ModelConfig) {
        const session = get().currentSession();
        const modelConfig = modelConfigOverride ?? session.mask.modelConfig;
        const clearContextIndex = session.clearContextIndex ?? 0;
        const messages = session.messages.slice();
        const totalMessageCount = session.messages.length;

        // in-context prompts
        const contextPrompts = session.mask.context.slice();

        // system prompts, to get close to OpenAI Web ChatGPT
        const shouldInjectSystemPrompts =
          modelConfig.enableInjectSystemPrompts &&
          (session.mask.modelConfig.model.startsWith("gpt-") ||
            session.mask.modelConfig.model.startsWith("chatgpt-"));

        const mcpEnabled = await isMcpEnabled();
        const mcpSystemPrompt = mcpEnabled ? await getMcpSystemPrompt() : "";
        const globalSystemPrompt = ALWAYS_USE_CHINESE_SYSTEM_PROMPT;

        var systemPrompts: ChatMessage[] = [];

        if (shouldInjectSystemPrompts) {
          systemPrompts = [
            createMessage({
              role: "system",
              content:
                fillTemplateWith("", {
                  ...modelConfig,
                  template: DEFAULT_SYSTEM_TEMPLATE,
                }) +
                "\n" +
                globalSystemPrompt +
                mcpSystemPrompt,
            }),
          ];
        } else if (mcpEnabled) {
          systemPrompts = [
            createMessage({
              role: "system",
              content: `${globalSystemPrompt}${mcpSystemPrompt}`,
            }),
          ];
        } else {
          systemPrompts = [
            createMessage({
              role: "system",
              content: globalSystemPrompt,
            }),
          ];
        }

        // if (shouldInjectSystemPrompts || mcpEnabled) {
        //   console.log(
        //     "[Global System Prompt] ",
        //     systemPrompts.at(0)?.content ?? "empty",
        //   );
        // }
        const memoryPrompt = get().getMemoryPrompt();
        // long term memory
        const shouldSendLongTermMemory =
          modelConfig.sendMemory &&
          session.memoryPrompt &&
          session.memoryPrompt.length > 0 &&
          session.lastSummarizeIndex > clearContextIndex;
        const longTermMemoryPrompts =
          shouldSendLongTermMemory && memoryPrompt ? [memoryPrompt] : [];
        const longTermMemoryStartIndex = session.lastSummarizeIndex;

        // short term memory
        // 不再机械截断最近固定条数，而是优先从当前会话的清空边界后尽可能多地携带上下文，
        // 具体由后面的 token 上限控制。这样切换模型或供应商后继续追问时，上下文更连贯。
        const shortTermMemoryStartIndex = clearContextIndex;

        // lets concat send messages, including 4 parts:
        // 0. system prompt: to get close to OpenAI Web ChatGPT
        // 1. long term memory: summarized memory messages
        // 2. pre-defined in-context prompts
        // 3. short term memory: latest n messages
        // 4. newest input message
        const memoryStartIndex = shouldSendLongTermMemory
          ? Math.min(longTermMemoryStartIndex, shortTermMemoryStartIndex)
          : shortTermMemoryStartIndex;
        // and if user has cleared history messages, we should exclude the memory too.
        const contextStartIndex = Math.max(clearContextIndex, memoryStartIndex);
        const maxTokenThreshold = modelConfig.max_tokens;

        // get recent messages as much as possible
        const reversedRecentMessages = [];
        for (
          let i = totalMessageCount - 1, tokenCount = 0;
          i >= contextStartIndex && tokenCount < maxTokenThreshold;
          i -= 1
        ) {
          const msg = messages[i];
          if (!msg || msg.isError) continue;
          tokenCount += estimateTokenLength(getMessageTextContent(msg));
          reversedRecentMessages.push(msg);
        }
        // concat all messages
        const recentMessages = [
          ...systemPrompts,
          ...longTermMemoryPrompts,
          ...contextPrompts,
          ...reversedRecentMessages.reverse(),
        ];

        return recentMessages;
      },

      updateMessage(
        sessionIndex: number,
        messageIndex: number,
        updater: (message?: ChatMessage) => void,
      ) {
        const sessions = get().sessions;
        const session = sessions.at(sessionIndex);
        const messages = session?.messages;
        updater(messages?.at(messageIndex));
        if (session) {
          session.lastUpdate = Date.now();
        }
        set(() => ({ sessions }));

        import("./sync").then(({ useSyncStore }) => {
          useSyncStore.getState().triggerDebounceSync([StoreKey.Chat]);
        });
      },

      deleteMessage(sessionIndex: number, messageIndex: number) {
        const sessions = get().sessions;
        const session = sessions.at(sessionIndex);
        if (!session) return;

        const messages = session.messages;
        messages.splice(messageIndex, 1);
        session.lastUpdate = Date.now();
        set(() => ({
          sessions,
          sessionSummaries: buildSessionSummaries(sessions),
        }));

        import("./sync").then(({ useSyncStore }) => {
          useSyncStore.getState().triggerDebounceSync([StoreKey.Chat]);
        });
      },

      resetSession(session: ChatSession) {
        get().updateTargetSession(session, (session) => {
          session.messages = [];
          session.memoryPrompt = "";
        });

        import("./sync").then(({ useSyncStore }) => {
          useSyncStore.getState().triggerDebounceSync([StoreKey.Chat]);
        });
      },

      async summarizeSession(
        refreshTitle: boolean = false,
        targetSession: ChatSession,
      ) {
        const config = useAppConfig.getState();
        const session = targetSession;
        const modelConfig = session.mask.modelConfig;
        // skip summarize when using dalle3?
        if (isDalle3(modelConfig.model)) {
          return;
        }

        if (refreshTitle) {
          void refreshSessionTitle(session);
          return;
        }

        const summarizeTarget = getSummarizeTarget(session);
        const { model, providerName } = summarizeTarget;
        const api: ClientApi = getClientApi(providerName as ServiceProvider);

        // remove error messages if any
        const messages = session.messages;

        if (
          config.enableAutoGenerateTitle &&
          shouldAutoRefreshSessionTitle(session)
        ) {
          const startIndex = Math.max(
            0,
            messages.length - modelConfig.historyMessageCount,
          );
          const topicMessages = messages
            .slice(
              startIndex < messages.length ? startIndex : messages.length - 1,
              messages.length,
            )
            .concat(
              createMessage({
                role: "user",
                content: Locale.Store.Prompt.Topic,
              }),
            );

          // 使用多供应商切换逻辑生成标题
          const candidates = getRefreshTitleCandidates(session);
          logChatDebug(
            "[自动生成标题] 正在尝试",
            candidates.length,
            "个候选模型",
          );

          for (const candidate of candidates) {
            logChatDebug("[自动生成标题] 正在尝试候选模型:", {
              模型: candidate.model,
              供应商ID: candidate.providerId,
              配置名称: candidate.profile?.name,
              配置地址: candidate.profile?.baseUrl,
              是否有配置: !!candidate.profile,
            });

            const candidateApi: ClientApi = getClientApi(
              candidate.providerName as ServiceProvider,
            );

            try {
              const success = await withSummarizeProfile(
                candidate.profile,
                async () => {
                  let success = false;

                  await candidateApi.llm.chat({
                    messages: topicMessages,
                    config: {
                      model: candidate.model,
                      stream: false,
                      providerName: candidate.providerName,
                    },
                    onRequest(request) {
                      logRequestBanner("title", {
                        model: request.model,
                        provider: request.provider,
                        baseUrl: request.baseUrl,
                        chatPath: request.chatPath,
                        stream: request.stream,
                        profileName: candidate.profile?.name || null,
                      });
                    },
                    onFinish(message, responseRes) {
                      success =
                        responseRes?.status === 200 &&
                        Boolean(trimTopic(message || ""));

                      if (success) {
                        useChatStore
                          .getState()
                          .updateTargetSession(session, (session) => {
                            session.topic = trimTopic(message);
                          });
                      }
                    },
                    onError(err) {
                      logger.chat.error("自动生成标题出错:", err);
                    },
                  });

                  return success;
                },
              );

              if (success) {
                logChatDebug("[自动生成标题] 标题生成成功");
                break;
              }
            } catch (error) {
              logger.chat.error("自动生成标题候选模型失败", error);
            }
          }
        }
        const summarizeIndex = Math.max(
          session.lastSummarizeIndex,
          session.clearContextIndex ?? 0,
        );
        let toBeSummarizedMsgs = messages
          .filter((msg) => !msg.isError)
          .slice(summarizeIndex);

        const historyMsgLength = countMessages(toBeSummarizedMsgs);

        if (historyMsgLength > (modelConfig?.max_tokens || 4000)) {
          const n = toBeSummarizedMsgs.length;
          toBeSummarizedMsgs = toBeSummarizedMsgs.slice(
            Math.max(0, n - modelConfig.historyMessageCount),
          );
        }
        const memoryPrompt = get().getMemoryPrompt();
        if (memoryPrompt) {
          // add memory prompt
          toBeSummarizedMsgs.unshift(memoryPrompt);
        }

        const lastSummarizeIndex = session.messages.length;

        // console.log(
        //   "[Chat History] ",
        //   toBeSummarizedMsgs,
        //   historyMsgLength,
        //   modelConfig.compressMessageLengthThreshold,
        // );

        if (
          historyMsgLength > modelConfig.compressMessageLengthThreshold &&
          modelConfig.sendMemory
        ) {
          /** Destruct max_tokens while summarizing
           * this param is just shit
           **/
          const { max_tokens, ...modelcfg } = modelConfig;
          withSummarizeProfile(summarizeTarget.profile, () =>
            api.llm.chat({
              messages: toBeSummarizedMsgs.concat(
                createMessage({
                  role: "system",
                  content: Locale.Store.Prompt.Summarize,
                  date: "",
                }),
              ),
              config: {
                ...modelcfg,
                stream: modelConfig.stream !== false,
                model,
                providerName,
              },
              onUpdate(message) {
                session.memoryPrompt = message;
              },
              onFinish(message, responseRes) {
                if (responseRes?.status === 200) {
                  logger.chat.log("[Memory] ", message);
                  get().updateTargetSession(session, (session) => {
                    session.lastSummarizeIndex = lastSummarizeIndex;
                    session.memoryPrompt = message;
                  });
                }
              },
              onError(err) {
                logger.chat.error("[Summarize] ", err);
              },
            }),
          );
        }
      },

      updateStat(message: ChatMessage, session: ChatSession) {
        get().updateTargetSession(session, (session) => {
          session.stat.charCount += message.content.length;
          // TODO: should update chat count and word count
        });
      },
      updateTargetSession(
        targetSession: ChatSession,
        updater: (session: ChatSession) => void,
      ) {
        const sessions = get().sessions;
        const index = sessions.findIndex((s) => s.id === targetSession.id);
        if (index < 0) return;
        const stableCreatedAt =
          getSessionCreatedAt(sessions[index]) || Date.now();
        const previousSession = {
          ...sessions[index],
          createdAt: stableCreatedAt,
          messages: sessions[index].messages.slice(),
          mask: {
            ...sessions[index].mask,
            modelConfig: {
              ...sessions[index].mask.modelConfig,
            },
          },
        };
        // 创建新 session 对象，避免 mutation 导致选择器无法检测变化
        const updatedSession = {
          ...sessions[index],
          createdAt: stableCreatedAt,
          messages: sessions[index].messages.slice(),
          mask: {
            ...sessions[index].mask,
            modelConfig: {
              ...sessions[index].mask.modelConfig,
            },
          },
        };
        updater(updatedSession);
        updatedSession.lastUpdate = Date.now();
        const newSessions = sessions.slice();
        newSessions[index] = updatedSession;
        set((state) => {
          if (!shouldRefreshSessionSummary(previousSession, updatedSession)) {
            return { sessions: newSessions };
          }

          const sessionSummaries = state.sessionSummaries.slice();
          sessionSummaries[index] = buildSessionSummary(updatedSession);

          return {
            sessions: newSessions,
            sessionSummaries,
          };
        });
        void get().saveSessionToPersistedStorage(updatedSession);
      },
      async clearAllData() {
        await clearPersistedStateStorage();
        location.reload();
      },
      async resetAndSeedTestData() {
        await clearPersistedStateStorage();

        const seededSessions = [
          createEmptySession(),
          ...Array.from({ length: 14 }, (_, index) =>
            createSeedTestSession(index, {
              daysAgo: index,
              messagePairs: index < 3 ? 8 : (index % 4) + 2,
            }),
          ),
          createSeedTestSession(14, { empty: true, daysAgo: 30 }),
          createSeedTestSession(15, { empty: true, daysAgo: 45 }),
        ];

        const leadingSession = seededSessions[0];
        leadingSession.topic = getDefaultTopic();
        leadingSession.mask.name = leadingSession.topic;

        set(() => ({
          sessions: seededSessions,
          sessionSummaries: buildSessionSummaries(seededSessions),
          currentSessionIndex: 0,
          hydratingSessionId: "",
          hydratedSessionIds: seededSessions
            .filter(
              (session) =>
                Array.isArray(session.messages) && session.messages.length > 0,
            )
            .map((session) => session.id),
          lastInput: "",
          globalClearAt: 0,
          deletedSessionTimestamps: {},
        }));

        showToast("已重置本地对话，并生成测试数据");
        setTimeout(() => location.reload(), 120);
      },
      setLastInput(lastInput: string) {
        set({
          lastInput,
        });
      },

      /** check if the message contains MCP JSON and execute the MCP action */
      checkMcpJson(message: ChatMessage) {
        const mcpEnabled = isMcpEnabled();
        if (!mcpEnabled) return;
        const content = getMessageTextContent(message);
        if (isMcpJson(content)) {
          try {
            const mcpRequest = extractMcpJson(content);
            if (mcpRequest) {
              logger.chat.log("[MCP Request]", mcpRequest);

              executeMcpAction(mcpRequest.clientId, mcpRequest.mcp)
                .then((result) => {
                  logger.chat.log("[MCP Response]", result);
                  const mcpResponse =
                    typeof result === "object"
                      ? JSON.stringify(result)
                      : String(result);
                  get().onUserInput(
                    `\`\`\`json:mcp-response:${mcpRequest.clientId}\n${mcpResponse}\n\`\`\``,
                    [],
                    true,
                  );
                })
                .catch((error) => showToast("MCP execution failed", error));
            }
          } catch (error) {
            logger.chat.error("[Check MCP JSON]", error);
          }
        }
      },
    };

    return methods;
  },
  {
    name: StoreKey.Chat,
    version: 3.7,
    storage: createJSONStorage(() => chatPersistStorage as any) as any,
    migrate(persistedState, version) {
      const state = persistedState as any;
      const newState = JSON.parse(
        JSON.stringify(state),
      ) as typeof DEFAULT_CHAT_STATE;

      if (version < 2) {
        newState.sessions = [];

        const oldSessions = state.sessions;
        for (const oldSession of oldSessions) {
          const newSession = createEmptySession();
          newSession.topic = oldSession.topic;
          newSession.messages = [...oldSession.messages];
          newSession.mask.modelConfig.sendMemory = false;
          newSession.mask.modelConfig.historyMessageCount = 6;
          newSession.mask.modelConfig.compressMessageLengthThreshold = 12000;
          newState.sessions.push(newSession);
        }
      }

      if (version < 3) {
        // migrate id to nanoid
        newState.sessions.forEach((s) => {
          s.id = nanoid();
          s.messages.forEach((m) => (m.id = nanoid()));
        });
      }

      // Enable `enableInjectSystemPrompts` attribute for old sessions.
      // Resolve issue of old sessions not automatically enabling.
      if (version < 3.1) {
        newState.sessions.forEach((s) => {
          if (
            // Exclude those already set by user
            !s.mask.modelConfig.hasOwnProperty("enableInjectSystemPrompts")
          ) {
            // Because users may have changed this configuration,
            // the user's current configuration is used instead of the default
            const config = useAppConfig.getState();
            s.mask.modelConfig.enableInjectSystemPrompts =
              config.modelConfig.enableInjectSystemPrompts;
          }
        });
      }

      // add default summarize model for every session
      if (version < 3.2) {
        newState.sessions.forEach((s) => {
          const config = useAppConfig.getState();
          s.mask.modelConfig.compressModel = config.modelConfig.compressModel;
          s.mask.modelConfig.compressProviderName =
            config.modelConfig.compressProviderName;
        });
      }
      // revert default summarize model for every session
      if (version < 3.3) {
        newState.sessions.forEach((s) => {
          const config = useAppConfig.getState();
          s.mask.modelConfig.compressModel = "";
          s.mask.modelConfig.compressProviderName = "";
        });
      }

      if (version < 3.4) {
        const selectedSessionId =
          newState.sessions?.[newState.currentSessionIndex]?.id ?? "";
        newState.sessions.forEach((s) => {
          if (!s.createdAt) {
            const firstMessageTime = s.messages
              ?.map((message) => new Date(message.date).getTime())
              .find((time) => Number.isFinite(time) && time > 0);
            s.createdAt = firstMessageTime || s.lastUpdate || Date.now();
          }
        });
        newState.sessions = sortSessionsByCreatedAt(newState.sessions);
        if (selectedSessionId) {
          const nextIndex = newState.sessions.findIndex(
            (session) => session.id === selectedSessionId,
          );
          if (nextIndex >= 0) {
            newState.currentSessionIndex = nextIndex;
          }
        }
      }

      if (version < 3.5) {
        newState.deletedSessionTimestamps = {};
      }

      if (!Array.isArray((newState as any).hydratedSessionIds)) {
        (newState as any).hydratedSessionIds = Array.isArray(newState.sessions)
          ? newState.sessions
              .filter(
                (session: ChatSession) =>
                  Array.isArray(session?.messages) &&
                  session.messages.length > 0,
              )
              .map((session: ChatSession) => session.id)
          : [];
      }

      if (!(newState as any).selectedSessionId) {
        (newState as any).selectedSessionId =
          newState.sessions?.[newState.currentSessionIndex]?.id || "";
      }

      if (
        version < 3.7 ||
        !Array.isArray((newState as any).sessionSummaries) ||
        (newState as any).sessionSummaries.some(
          (summary: ChatSessionSummary) =>
            typeof summary?.searchText !== "string",
        )
      ) {
        // 使用 buildSessionSummaries，它会保留原有的 messageCount（对于占位符 sessions）
        (newState as any).sessionSummaries = buildSessionSummaries(
          newState.sessions,
          (newState as any).sessionSummaries,
        );
      }

      return newState as any;
    },
  },
);
