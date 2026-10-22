import {
  getMessageTextContent,
  isDalle3,
  isImageGenerationModel,
  trimTopic,
} from "../utils";
import { safeLocalStorage } from "../utils/safe-local-storage";

import { clearPersistedStateStorage } from "@/app/utils/indexeddb-state-storage";
import {
  chatPersistStorage,
  getPersistedChatSession,
  removePersistedChatSession,
  setPersistedChatSession,
  getActiveChatStoreScopeUserId,
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
  CACHE_URL_PREFIX,
  DEFAULT_INPUT_TEMPLATE,
  DEFAULT_MODELS,
  DEFAULT_SYSTEM_TEMPLATE,
  KnowledgeCutOffDate,
  MCP_SYSTEM_TEMPLATE,
  MCP_TOOLS_TEMPLATE,
  ServiceProvider,
  StoreKey,
} from "../constant";
import Locale, { getLang } from "../locales";
import { prettyObject } from "../utils/format";
import {
  createPersistStore,
  runWithImmediateStoreSyncPausedSync,
} from "../utils/store";
import {
  countCompletionTokens,
  countPromptTokens,
  countSystemTokens,
  estimateTokenLength,
} from "../utils/token";
import { logPerfSummary, nowMs } from "../utils/perf";
import { logger } from "../utils/logger";
import {
  readManualSessionModelSelection,
  saveManualSessionModelSelection,
} from "../utils/manual-model-selection";
import {
  DEFAULT_TOPIC,
  getBotHelloContent,
  getDefaultTopic,
} from "./chat-defaults";
import { ModelConfig, ModelType, useAppConfig } from "./config";
import { normalizeAccessStateDerivedFields, useAccessStore } from "./access";
import { useModelCacheStore } from "./model-cache";
import {
  collectModelsWithDefaultModel,
  getPreferredDisplayModelConfig,
  getPreferredRuntimeModelConfig,
  getModelProvider,
  resolveModelProviderId,
} from "../utils/model";
import { buildCachedExtraModels } from "../utils/model-pool";
import { createEmptyMask, Mask } from "./mask";
import { BUILTIN_PLUGIN_IDS } from "./plugin";
import { rewriteGeneratedFileLinksFromTools } from "../utils/generated-file-links";
import { executeMcpAction, getAllTools, isMcpEnabled } from "../mcp/actions";
import { extractMcpJson, isMcpJson } from "../mcp/utils";
import { sanitizeModelConfigForCapability } from "../client/model-parameter-rules";
import {
  getExtractableAttachmentKind,
  isSafeImageAttachment,
} from "../utils/attachment-file";
import {
  buildChatFailoverCandidates,
  isProviderBalanceFailure,
  type ChatFailoverCandidate,
} from "../utils/chat-failover";
import { writeStoredGlobalModelConfig } from "../utils/global-model-config";
import { withSyncUserHeaders } from "../utils/sync-user-client";
import { isAbortLikeError } from "../utils/stale-revalidate";

export {
  DEFAULT_TOPIC,
  getBotHelloContent,
  getDefaultTopic,
} from "./chat-defaults";
import { createSyncClient, ProviderType } from "../utils/cloud";

const localStorage = safeLocalStorage();
const STREAM_REFRESH_DELAY = 48;
const AUTO_TITLE_REFINEMENT_MAX_USER_MESSAGES = 3;
const SESSION_TITLE_MAX_CHARACTERS = 15;
const MEMORY_SUMMARY_MAX_TOKENS = 1000;
const TAB_INITIALIZED_KEY = "nextchat_tab_initialized";
const TAB_CURRENT_SESSION_ID_KEY = "nextchat_tab_current_session_id";
const CHAT_PAGE_INIT_WINDOW_KEY = "__nextchatChatPageInitialized";
let hasInitializedChatForCurrentPageFallback = false;

function readChatPageInitialized() {
  if (typeof window === "undefined") {
    return hasInitializedChatForCurrentPageFallback;
  }
  return (window as any)[CHAT_PAGE_INIT_WINDOW_KEY] === true;
}

function writeChatPageInitialized() {
  hasInitializedChatForCurrentPageFallback = true;
  if (typeof window === "undefined") {
    return;
  }
  (window as any)[CHAT_PAGE_INIT_WINDOW_KEY] = true;
}

function clearChatPageInitialized() {
  hasInitializedChatForCurrentPageFallback = false;
  if (typeof window === "undefined") {
    return;
  }
  delete (window as any)[CHAT_PAGE_INIT_WINDOW_KEY];
}
export const CHAT_DELETE_UI_GUARD_UNTIL_KEY =
  "nextchat_chat_delete_ui_guard_until";
const CHAT_DELETE_UI_GUARD_MS = 8000;
const pendingSessionRefreshTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();
// 流式输出每个动画帧都会更新会话；逐帧 JSON 序列化整段会话并写 IndexedDB 会阻塞主线程，
// 因此流式期间节流持久化，流式结束（无 streaming 消息）后立即落盘。
const STREAMING_SESSION_PERSIST_INTERVAL_MS = 1000;
const pendingSessionPersistTimers = new Map<
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

export type ChatRetryAttempt = {
  attempt: number;
  provider: string;
  providerId: string;
  model: string;
  status: "trying" | "failed" | "success";
};

type SelectedModelConfig = ModelConfig & {
  providerId?: string;
  profileId?: string;
  modelSelectionUpdatedAt?: number;
};

export type ChatMessageAttachedFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  contentMd5?: string;
  typeLabel: string;
  typeKind: "document" | "spreadsheet" | "pdf" | "archive" | "file";
  extractedText?: string;
  extractionStatus?: "pending" | "ready" | "partial" | "metadata" | "failed";
  extractionTruncated?: boolean;
  extractionMode?: "document" | "text" | "binary" | "metadata";
  extractionSummary?: string;
  requiresVisualInput?: boolean;
  previewText?: string;
  previewUrl?: string;
  localPreviewUrl?: string;
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
  refreshInterrupted?: boolean;
  attachedFiles?: ChatMessageAttachedFile[];
  attachedFilesPromptText?: string;
  aiSelectionText?: string;
  aiSelectionPromptText?: string;
  retryAttempts?: ChatRetryAttempt[];
  retrying?: boolean;
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

export function countCompletedSessionMessages(
  messages: readonly ChatMessage[] | undefined,
) {
  return Array.isArray(messages)
    ? messages.filter(
        (message) => message.role !== "assistant" || message.streaming !== true,
      ).length
    : 0;
}

function appendHiddenPromptText(
  message: ChatMessage,
  extraPrompt: string,
): ChatMessage {
  if (!extraPrompt.trim() || message.role !== "user") {
    return message;
  }

  if (typeof message.content === "string") {
    return {
      ...message,
      content: [message.content, extraPrompt].filter(Boolean).join("\n\n"),
    };
  }

  const content = Array.isArray(message.content) ? message.content : [];
  const nextContent = content.slice();
  const firstTextIndex = nextContent.findIndex((item) => item.type === "text");
  if (firstTextIndex >= 0) {
    const firstTextItem = nextContent[firstTextIndex];
    if (firstTextItem?.type === "text") {
      nextContent[firstTextIndex] = {
        ...firstTextItem,
        text: [firstTextItem.text, extraPrompt].filter(Boolean).join("\n\n"),
      };
    }
  } else {
    nextContent.unshift({ type: "text", text: extraPrompt });
  }

  return {
    ...message,
    content: nextContent,
  };
}

function withAttachedFilesPromptText(message: ChatMessage): ChatMessage {
  return appendHiddenPromptText(
    message,
    String(message.attachedFilesPromptText || ""),
  );
}

function withAiSelectionPromptText(message: ChatMessage): ChatMessage {
  return appendHiddenPromptText(
    message,
    String(message.aiSelectionPromptText || ""),
  );
}

function needsAttachmentVisionInput(files: ChatMessageAttachedFile[] = []) {
  return files.some((file) => {
    const kind = getExtractableAttachmentKind(file.name || "");
    if (isSafeImageAttachment(file.name || "")) return true;
    // Short-text PDFs retain their text fallback but also need visual pages.
    // The selected non-native model receives those pages without capability
    // list-based model switching.
    return (
      kind === "pdf" &&
      (file.requiresVisualInput || !String(file.extractedText || "").trim())
    );
  });
}

function getCacheFileId(url: unknown) {
  const value = String(url || "").trim();
  if (!value.startsWith(`${CACHE_URL_PREFIX}/`)) return "";
  const fileName = value.split(/[?#]/, 1)[0].split("/").pop() || "";
  const id = fileName.split(".")[0];
  return /^[0-9a-f-]{36}$/i.test(id) ? id : "";
}

async function appendAttachmentVisionPages(
  messages: ChatMessage[],
  userMessageId: string,
) {
  const targetMessage = messages.find(
    (message) => message.id === userMessageId && message.role === "user",
  );
  const files = (targetMessage?.attachedFiles || []).filter(
    (file) =>
      needsAttachmentVisionInput([file]) &&
      Boolean(getCacheFileId(file.previewUrl)),
  );
  if (files.length === 0) return messages;

  try {
    const response = await fetch(`${CACHE_URL_PREFIX}/visualize`, {
      method: "POST",
      credentials: "include",
      headers: withSyncUserHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        ids: files.map((file) => getCacheFileId(file.previewUrl)),
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.code !== 0) return messages;

    const visualizedFiles: Array<{
      id?: unknown;
      pages?: unknown;
      totalPages?: unknown;
      renderedPages?: unknown;
      truncated?: unknown;
      reason?: unknown;
    }> = Array.isArray(payload?.data?.files) ? payload.data.files : [];
    const images: string[] = visualizedFiles.flatMap((file) =>
      Array.isArray(file?.pages)
        ? (file.pages as unknown[]).filter(
            (page): page is string => typeof page === "string",
          )
        : [],
    );
    const selectedFilesById = new Map(
      files.map((file) => [getCacheFileId(file.previewUrl), file]),
    );
    const statusLines = visualizedFiles.flatMap((file) => {
      const selectedFile = selectedFilesById.get(String(file.id || ""));
      if (!selectedFile) return [];
      const totalPages = Math.max(0, Number(file.totalPages) || 0);
      const renderedPages = Math.max(0, Number(file.renderedPages) || 0);
      if (!file.truncated && renderedPages > 0) return [];

      if (file.truncated) {
        return [
          `“${selectedFile.name || "未命名 PDF"}”仅提供了 ${renderedPages}/${totalPages || "未知"} 页视觉内容；不要将其视为完整文件。`,
        ];
      }
      return [
        `“${selectedFile.name || "未命名 PDF"}”未能生成视觉页面；仅可依据已提供的文本或文件元信息回答。`,
      ];
    });
    if (statusLines.length > 0) {
      showToast("部分 PDF 未能完整转换，模型已收到具体限制", undefined, 6000);
    }
    if (images.length === 0 && statusLines.length === 0) return messages;

    return messages.map((message) => {
      if (message.id !== userMessageId || message.role !== "user") {
        return message;
      }
      const content =
        typeof message.content === "string"
          ? [{ type: "text" as const, text: message.content }]
          : Array.isArray(message.content)
            ? message.content.slice()
            : [];
      return {
        ...message,
        content: [
          ...content,
          ...(statusLines.length > 0
            ? [
                {
                  type: "text" as const,
                  text: ["【附件视觉读取状态】", ...statusLines].join("\n"),
                },
              ]
            : []),
          ...images.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        ],
      };
    });
  } catch {
    return messages;
  }
}

export interface ChatStat {
  tokenCount: number;
  wordCount: number;
  charCount: number;
}

export interface ChatSession {
  id: string;
  topic: string;
  explicitEmptySession?: boolean;
  titleGeneratedByAI?: boolean;
  titleFallbackText?: string;
  titleGeneratedMessageCount?: number;
  titleGeneratedUserMessageCount?: number;

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

function hasLegacySessionFallbackTitle(session: ChatSession) {
  const legacyFallbackTitle = String(session.titleFallbackText || "").trim();
  return (
    !session.titleGeneratedByAI &&
    Boolean(legacyFallbackTitle) &&
    trimTopic(String(session.topic || "")) === trimTopic(legacyFallbackTitle)
  );
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

  return [
    createEmptySession({ explicitEmptySession: true }),
    ...normalizedSessions,
  ];
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

export function createEmptySession(options?: {
  explicitEmptySession?: boolean;
}): ChatSession {
  const now = Date.now();
  return {
    id: nanoid(),
    topic: getDefaultTopic(),
    explicitEmptySession: options?.explicitEmptySession,
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
  const resetLegacyFallbackTitle = hasLegacySessionFallbackTitle(session);
  const normalizedTopic = resetLegacyFallbackTitle
    ? getDefaultTopic()
    : String(session.topic || fallbackSession.topic);

  return {
    ...fallbackSession,
    ...session,
    topic: normalizedTopic,
    titleGeneratedByAI: resetLegacyFallbackTitle
      ? false
      : session.titleGeneratedByAI,
    titleFallbackText: resetLegacyFallbackTitle
      ? ""
      : session.titleFallbackText,
    titleGeneratedMessageCount: resetLegacyFallbackTitle
      ? 0
      : session.titleGeneratedMessageCount,
    titleGeneratedUserMessageCount: resetLegacyFallbackTitle
      ? 0
      : session.titleGeneratedUserMessageCount,
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
      name: resetLegacyFallbackTitle
        ? normalizedTopic
        : currentMask?.name || fallbackMask.name,
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
    messageCount: countCompletedSessionMessages(normalizedSession.messages),
    createdAt: normalizedSession.createdAt,
    displayTime:
      normalizedSession.lastUpdate || normalizedSession.createdAt || Date.now(),
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
  const previousMessageCount = countCompletedSessionMessages(
    previousSession.messages,
  );
  const nextMessageCount = countCompletedSessionMessages(nextSession.messages);
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

function mergeHydratedSessionWithLiveChanges(
  hydratedSession: ChatSession,
  liveSession: ChatSession,
  hydrateBaseLastUpdate: number,
) {
  if (Number(liveSession.lastUpdate || 0) <= hydrateBaseLastUpdate) {
    return hydratedSession;
  }

  const liveMessagesById = new Map(
    liveSession.messages
      .filter((message) => Boolean(message.id))
      .map((message) => [message.id, message]),
  );
  const hydratedMessageIds = new Set(
    hydratedSession.messages
      .map((message) => message.id)
      .filter((messageId): messageId is string => Boolean(messageId)),
  );
  const mergedMessages = hydratedSession.messages.map(
    (message) => liveMessagesById.get(message.id) ?? message,
  );

  for (const message of liveSession.messages) {
    if (!message.id || !hydratedMessageIds.has(message.id)) {
      mergedMessages.push(message);
    }
  }

  return {
    ...hydratedSession,
    ...liveSession,
    createdAt: Math.min(
      getSessionCreatedAt(hydratedSession),
      getSessionCreatedAt(liveSession),
    ),
    messages: mergedMessages,
    mask: liveSession.mask,
  };
}

function normalizeCacheAttachmentUrl(url: unknown) {
  const value = String(url || "").trim();
  if (!value.startsWith(CACHE_URL_PREFIX)) {
    return "";
  }
  return value.split("?")[0].split("#")[0];
}

function collectSessionCacheAttachmentUrls(session: ChatSession | undefined) {
  const urls = new Set<string>();
  for (const message of session?.messages || []) {
    for (const file of message.attachedFiles || []) {
      const url = normalizeCacheAttachmentUrl(file.previewUrl);
      if (url) {
        urls.add(url);
      }
    }

    const content = (message as any)?.content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      const imageUrl =
        part?.type === "image_url" ? part?.image_url?.url : undefined;
      const url = normalizeCacheAttachmentUrl(imageUrl);
      if (url) {
        urls.add(url);
      }
    }
  }
  return urls;
}

function cleanupUnusedDeletedSessionAttachments(
  deletedSessions: ChatSession[],
  remainingSessions: ChatSession[],
) {
  const deletedUrls = new Set<string>();
  deletedSessions.forEach((session) => {
    collectSessionCacheAttachmentUrls(session).forEach((url) =>
      deletedUrls.add(url),
    );
  });

  if (deletedUrls.size === 0) {
    return;
  }

  const remainingUrls = new Set<string>();
  remainingSessions.forEach((session) => {
    collectSessionCacheAttachmentUrls(session).forEach((url) =>
      remainingUrls.add(url),
    );
  });

  deletedUrls.forEach((url) => {
    if (remainingUrls.has(url)) {
      return;
    }
    const params = new URLSearchParams();
    params.set("force", "1");
    deletedSessions.forEach((session) => {
      if (session.id) {
        params.append("excludeSessionId", session.id);
      }
    });
    void fetch(`${url}?${params.toString()}`, {
      method: "DELETE",
      credentials: "include",
    }).catch((error) => {
      logger.chat.error("❌ 删除未引用附件缓存失败:", error);
    });
  });
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

function getSummarizeTarget(targetSession?: ChatSession) {
  const targetModelConfig = targetSession?.mask.modelConfig;
  const targetProfile = targetModelConfig
    ? getProfileForModelConfig(targetModelConfig)
    : undefined;
  const sessionProviderName =
    targetModelConfig?.providerName ?? targetProfile?.provider;

  return {
    model: targetModelConfig?.model || "",
    providerName: normalizeTitleCandidateProviderName(
      sessionProviderName,
      targetProfile,
    ),
    profile: targetProfile,
  };
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

function applySharedGlobalConversationSettings(
  selectedModelConfig: SelectedModelConfig,
): SelectedModelConfig {
  const sharedModelConfig = useAppConfig.getState().modelConfig;
  return sanitizeModelConfigForCapability({
    ...sharedModelConfig,
    model: selectedModelConfig.model,
    providerName: selectedModelConfig.providerName,
    providerId: selectedModelConfig.providerId,
    profileId: selectedModelConfig.profileId,
    modelSelectionUpdatedAt: selectedModelConfig.modelSelectionUpdatedAt,
  });
}

function normalizeTitleCandidateProviderName(
  providerName: ServiceProvider | string | undefined,
  profile?: {
    provider?: ServiceProvider;
  },
) {
  if (profile?.provider) {
    return profile.provider;
  }

  if (
    providerName &&
    Object.values(ServiceProvider).includes(providerName as ServiceProvider)
  ) {
    return providerName as ServiceProvider;
  }

  return ServiceProvider.Custom;
}

function triggerTitleSync() {
  import("./sync").then(({ useSyncStore }) => {
    useSyncStore
      .getState()
      .triggerDebounceSync([StoreKey.Chat], { delayMs: 0 });
  });
}

function normalizeGeneratedSessionTitle(value: string) {
  const firstLine =
    value
      .replace(/^```(?:\w+)?\s*/i, "")
      .replace(/\s*```$/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || "";
  const normalized = trimTopic(
    firstLine
      .replace(/^#{1,6}\s*/, "")
      .replace(/^(?:标题|主题|title|topic)\s*[:：-]\s*/i, ""),
  );

  // Reject non-compliant output instead of truncating a full answer into a
  // misleading title.
  return Array.from(normalized).length <= SESSION_TITLE_MAX_CHARACTERS
    ? normalized
    : "";
}

function getGeneratedSessionTitleCandidate(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const jsonText = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try {
    const payload = JSON.parse(jsonText);
    if (typeof payload === "string") {
      return normalizeGeneratedSessionTitle(payload);
    }

    if (payload && typeof payload === "object") {
      const title =
        (payload as { title?: unknown; topic?: unknown }).title ??
        (payload as { topic?: unknown }).topic;
      if (typeof title === "string") {
        return normalizeGeneratedSessionTitle(title);
      }

      // Provider protocol envelopes and error objects are diagnostic payloads,
      // not titles. Only explicit title/topic fields are accepted from JSON.
      return "";
    }
  } catch {
    // Plain model output is expected, so an unparsable string remains valid.
  }

  return normalizeGeneratedSessionTitle(raw);
}

function applyGeneratedSessionTitle(
  targetSession: ChatSession,
  title: string,
  requestVersion?: string,
) {
  const nextTitle = getGeneratedSessionTitleCandidate(title);
  if (!nextTitle) {
    return false;
  }

  const latestSession = useChatStore
    .getState()
    .getSessionById(targetSession.id);
  if (
    !latestSession ||
    (requestVersion &&
      getSessionTitleRequestVersion(latestSession) !== requestVersion)
  ) {
    logger.chat.log("⏭️ 标题结果已过期，跳过写回:", {
      对话ID: targetSession.id,
    });
    return false;
  }

  useChatStore.getState().updateTargetSession(latestSession, (session) => {
    session.topic = nextTitle;
    session.mask.name = nextTitle;
    session.titleGeneratedByAI = true;
    session.titleFallbackText = "";
    session.titleGeneratedMessageCount = session.messages.length;
    session.titleGeneratedUserMessageCount = session.messages.filter(
      (message) =>
        !message.isError &&
        message.role === "user" &&
        Boolean(getMessageTextContent(message).trim()),
    ).length;
  });
  triggerTitleSync();
  return true;
}

const pendingTitleBackfillSessionIds = new Set<string>();
const pendingTitleGenerationSessionIds = new Set<string>();
const pendingMemorySummarySessionIds = new Set<string>();

function getSessionTitleRequestVersion(session: ChatSession) {
  const modelConfig = session.mask.modelConfig;
  const profile = getProfileForModelConfig(modelConfig);
  const lastMessage = session.messages.at(-1);
  return [
    session.messages.length,
    lastMessage?.id || "",
    lastMessage?.date || "",
    modelConfig.model || "",
    modelConfig.providerName || "",
    profile
      ? getAccessProviderId(profile)
      : String((modelConfig as any).providerId || ""),
    profile?.id || String((modelConfig as any).profileId || ""),
  ].join("\u0000");
}

function shouldBackfillSessionTitle(session: ChatSession) {
  return (
    canAutoGenerateSessionTitle(session.messages) &&
    !session.titleGeneratedByAI &&
    isDefaultTopic(session.topic)
  );
}

function scheduleSessionTitleBackfill(sessionId: string, delayMs = 1200) {
  if (!sessionId || pendingTitleBackfillSessionIds.has(sessionId)) {
    return;
  }

  pendingTitleBackfillSessionIds.add(sessionId);
  setTimeout(() => {
    pendingTitleBackfillSessionIds.delete(sessionId);

    const config = useAppConfig.getState();
    if (!config.enableAutoGenerateTitle) {
      return;
    }

    const store = useChatStore.getState();
    if (store.currentSessionId() !== sessionId) {
      return;
    }
    const session = store.getSessionById(sessionId);
    if (
      !session ||
      ChatControllerPool.hasSession(sessionId) ||
      pendingTitleGenerationSessionIds.has(sessionId) ||
      !shouldBackfillSessionTitle(session)
    ) {
      return;
    }

    void store.summarizeSession(false, session);
  }, delayMs);
}

function getRefreshTitleCandidates(targetSession: ChatSession) {
  const modelConfig = targetSession.mask.modelConfig;
  const currentProviderName =
    modelConfig.providerName ?? ServiceProvider.Custom;
  const currentProfile = getProfileForModelConfig(modelConfig);
  const currentProviderId = currentProfile
    ? getAccessProviderId(currentProfile)
    : String((modelConfig as any).providerId || currentProviderName || "")
        .trim()
        .toLowerCase();
  if (!modelConfig.model || !currentProviderId) {
    logger.chat.log("⚠️ 标题候选模型为空，model 或 providerId 缺失:", {
      对话ID: targetSession.id,
      model: modelConfig.model,
      currentProviderName,
      currentProviderId,
    });
    return [];
  }

  const candidates = [
    {
      model: modelConfig.model,
      providerName: normalizeTitleCandidateProviderName(
        currentProviderName,
        currentProfile,
      ),
      profile: currentProfile,
      providerId: currentProviderId,
    },
  ];

  logger.chat.log("[标题候选] 获取候选模型:", {
    对话ID: targetSession.id,
    候选数量: candidates.length,
    模型: candidates[0].model,
    供应商: candidates[0].providerName,
    profileName: candidates[0].profile?.name,
  });

  return candidates;
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

  const normalizedFailureText = failureText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(normalizedFailureText);
    return (
      Boolean(parsed?.error) ||
      /empty response/i.test(String(parsed?.message || ""))
    );
  } catch {
    const lowerMessage = normalizedFailureText.toLowerCase();
    return (
      lowerMessage.includes("model_not_found") ||
      lowerMessage.includes("service unavailable") ||
      lowerMessage.includes("empty response") ||
      /"error"\s*:\s*(?:true|\{)/i.test(normalizedFailureText)
    );
  }
}

function getChatFailureLogReason(reason: unknown) {
  const text = String(
    reason instanceof Error ? reason.message : reason || "请求失败",
  ).trim();
  const structuredCode =
    text.match(/"(?:code|type)"\s*:\s*"([^"]+)"/i)?.[1] || "";
  if (structuredCode) {
    return structuredCode;
  }
  return (
    text
      .replace(/\s*\(request id:[^)]+\)/gi, "")
      .replace(/\s+/g, " ")
      .slice(0, 160) || "请求失败"
  );
}

function isTransientTitleRequestFailure(reason: unknown) {
  const message = String(
    reason instanceof Error ? reason.message : reason || "",
  ).toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("network error") ||
    message.includes("empty response") ||
    message.includes("err_empty_response")
  );
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
  logger.chat.log(
    kind === "chat"
      ? `🔄 对话请求尝试 ${payload.attempt || ""}:`
      : `🏷️ 标题请求开始 ${payload.attempt || ""}:`,
    {
      尝试: payload.attempt,
      供应商: payload.profileName || payload.provider,
      模型: payload.model,
      基础地址: payload.baseUrl,
      请求路径: payload.chatPath,
      流式请求: payload.stream,
    },
  );
}

function buildSessionTitleMessages(
  messages: ChatMessage[],
  historyMessageCount: number,
) {
  const titleSourceMessages = messages
    .filter(
      (message) =>
        !message.isError &&
        (message.role === "user" || message.role === "assistant") &&
        Boolean(getMessageTextContent(message).trim()),
    )
    .map((message) =>
      createMessage({
        role: message.role,
        // Title generation only needs text. Do not resend image URLs, tool
        // payloads, attachment metadata, or other message-only state.
        content: getMessageTextContent(message).trim(),
      }),
    );
  const contextMessageCount = Math.max(1, historyMessageCount || 1);

  return titleSourceMessages.slice(-contextMessageCount).concat(
    createMessage({
      role: "user",
      content: `${Locale.Store.Prompt.Topic}\n\n标题最终长度不得超过 ${SESSION_TITLE_MAX_CHARACTERS} 个字符（包括空格和标点），只返回标题。The final title must not exceed ${SESSION_TITLE_MAX_CHARACTERS} characters, including spaces and punctuation. Return only the title.`,
    }),
  );
}

async function requestSessionTitleCandidate(
  session: ChatSession,
  modelConfig: SelectedModelConfig,
  candidate: ReturnType<typeof getRefreshTitleCandidates>[number],
  requestVersion: string,
  mode: "auto" | "manual",
) {
  const requestProviderName = getProfileChatRequestProvider(
    candidate.providerName as ServiceProvider,
    candidate.profile,
  );
  const api: ClientApi = getClientApi(requestProviderName);
  const titleRequestConfig = {
    ...modelConfig,
    model: candidate.model as ModelType,
    stream: false,
    providerName: requestProviderName,
  };
  (titleRequestConfig as any).providerId = candidate.providerId;
  (titleRequestConfig as any).profileId = candidate.profile?.id || "";
  const topicMessages = buildSessionTitleMessages(
    session.messages,
    modelConfig.historyMessageCount,
  );

  return withTemporaryCustomProfile(candidate.profile, async () => {
    let success = false;
    let providerBalanceExhausted = false;
    let finalError: unknown;

    for (let requestAttempt = 1; requestAttempt <= 2; requestAttempt++) {
      let requestError: unknown;
      try {
        await api.llm.chat({
          messages: topicMessages,
          config: titleRequestConfig,
          requestBaseUrl: candidate.profile?.baseUrl,
          requestApiKey: candidate.profile?.apiKey,
          onRequest(request) {
            logRequestBanner("title", {
              model: request.model,
              provider: request.provider,
              baseUrl: request.baseUrl,
              chatPath: request.chatPath,
              stream: request.stream,
              profileName: candidate.profile?.name || null,
              attempt: `${requestAttempt}/2（${
                mode === "auto" ? "自动" : "手动"
              }）`,
            });
          },
          onFinish(message, responseRes) {
            const title = getGeneratedSessionTitleCandidate(message);
            success = responseRes?.status === 200 && Boolean(title);
            if (!success) {
              providerBalanceExhausted = isProviderBalanceFailure(
                message,
                responseRes?.status,
              );
              if (!String(message || "").trim()) {
                requestError = new Error("empty response");
              }
            }

            if (success) {
              success = applyGeneratedSessionTitle(
                session,
                title,
                requestVersion,
              );
            }
          },
          onError(err) {
            requestError = err;
            providerBalanceExhausted = isProviderBalanceFailure(err);
          },
        });
      } catch (error) {
        requestError = error;
      }

      if (isAbortLikeError(requestError)) {
        logger.chat.log("⏹️ 标题请求已取消:", {
          类型: mode === "auto" ? "自动" : "手动",
          供应商: candidate.profile?.name || candidate.providerName,
          模型: candidate.model,
        });
        return {
          success: false,
          providerBalanceExhausted: false,
          aborted: true,
        };
      }

      if (success || providerBalanceExhausted) {
        break;
      }
      finalError = requestError;
      if (
        requestAttempt >= 2 ||
        !isTransientTitleRequestFailure(requestError)
      ) {
        break;
      }
      logger.chat.log(
        `🔄 ${mode === "auto" ? "自动" : "手动"}标题网络请求失败，准备重试:`,
        {
          供应商: candidate.profile?.name || candidate.providerName,
          模型: candidate.model,
          原因: getChatFailureLogReason(requestError),
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    if (!success && finalError) {
      logger.chat.error(
        `${mode === "auto" ? "自动生成" : "手动刷新"}标题出错:`,
        finalError,
      );
    }

    return { success, providerBalanceExhausted, aborted: false };
  });
}

function getProfileChatRequestProvider(
  providerName: ServiceProvider,
  profile?: {
    baseUrl?: string;
    openAICompatible?: boolean;
  },
) {
  // 配置页测试对话统一使用 OpenAI 兼容客户端。已明确标记兼容的 Profile
  // 在正常聊天、标题和摘要中也沿用同一请求与代理链路。
  return profile?.baseUrl?.trim() && profile.openAICompatible === true
    ? ServiceProvider.Custom
    : providerName;
}

async function refreshSessionTitle(targetSession: ChatSession) {
  const session =
    useChatStore.getState().getSessionById(targetSession.id) ?? targetSession;
  if (pendingTitleGenerationSessionIds.has(session.id)) {
    showToast("标题正在生成，请稍后再试");
    return false;
  }
  pendingTitleGenerationSessionIds.add(session.id);
  try {
    const modelConfig = applySharedGlobalConversationSettings(
      session.mask.modelConfig,
    );
    const candidates = getRefreshTitleCandidates(session);
    const requestVersion = getSessionTitleRequestVersion(session);

    if (!canAutoGenerateSessionTitle(session.messages)) {
      showToast("没有可用于刷新标题的对话内容");
      return false;
    }

    for (const candidate of candidates) {
      try {
        const result = await requestSessionTitleCandidate(
          session,
          modelConfig,
          candidate,
          requestVersion,
          "manual",
        );

        if (result.success) {
          const latestTitle =
            useChatStore.getState().getSessionById(session.id)?.topic ||
            session.topic;
          logger.chat.log("✅ 手动标题更新成功:", {
            供应商: candidate.profile?.name || candidate.providerName,
            模型: candidate.model,
            标题: latestTitle,
          });
          return true;
        }
        if (result.providerBalanceExhausted) {
          logger.chat.log("💳 当前对话模型余额或额度不足，标题生成停止:", {
            当前供应商: candidate.profile?.name || candidate.providerName,
          });
          return false;
        }
        if (result.aborted) {
          return false;
        }
      } catch (error) {
        logger.chat.error("刷新标题失败", error);
      }
    }

    showToast("标题刷新失败：当前对话模型不可用，请检查模型或 API 配置");
    return false;
  } finally {
    pendingTitleGenerationSessionIds.delete(session.id);
  }
}

function withTemporaryCustomProfile<T>(
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
      }) as T;
    }
    return result;
  } catch (error) {
    useAccessStore.setState(prevState as any);
    throw error;
  }
}

function applySuccessfulChatFailoverGlobally(
  targetSession: ChatSession,
  candidate: ChatFailoverCandidate,
) {
  const selectedAt = Date.now();
  const nextModelConfig = sanitizeModelConfigForCapability({
    ...applySharedGlobalConversationSettings(targetSession.mask.modelConfig),
    model: candidate.model as ModelType,
    providerName: candidate.providerName,
  });
  (nextModelConfig as any).providerId = candidate.providerId;
  (nextModelConfig as any).profileId = candidate.profile?.id || "";
  (nextModelConfig as any).modelSelectionUpdatedAt = selectedAt;

  saveManualSessionModelSelection(
    targetSession.id,
    nextModelConfig as Record<string, unknown>,
  );
  writeStoredGlobalModelConfig(nextModelConfig as Record<string, unknown>);
  localStorage.setItem(
    "nextchat:last-model-selection",
    `${candidate.model}@${candidate.providerId}`,
  );
  if (candidate.profile?.name) {
    localStorage.setItem(
      "nextchat:model-selector-provider",
      candidate.profile.name,
    );
  }

  runWithImmediateStoreSyncPausedSync(() => {
    if (candidate.profile) {
      useAccessStore.getState().update((access) => {
        access.apiProfiles = access.apiProfiles.map((profile) => ({
          ...profile,
          enabled:
            candidate.profile?.id && profile.id
              ? profile.id === candidate.profile.id
              : getAccessProviderId(profile) === candidate.providerId,
        }));
        access.provider = candidate.providerName;
        access.profileSelectionUpdatedAt = selectedAt;
        normalizeAccessStateDerivedFields(access as Record<string, any>);
      });
    }

    useAppConfig.getState().update((config) => {
      config.modelConfig = nextModelConfig;
      config.modelSelectionUpdatedAt = selectedAt;
    });

    useChatStore.getState().updateTargetSession(targetSession, (session) => {
      session.mask.modelConfig = nextModelConfig;
      (session.mask as any).modelSelectionUpdatedAt = selectedAt;
      session.mask.syncGlobalConfig = true;
    });
  });

  void import("../utils/sync").then(({ markPendingModelSelection }) => {
    markPendingModelSelection({
      ...nextModelConfig,
      modelSelectionUpdatedAt: selectedAt,
    });
  });
  void import("./sync").then(({ useSyncStore }) => {
    useSyncStore
      .getState()
      .triggerDebounceSync([StoreKey.Config, StoreKey.Access, StoreKey.Chat], {
        delayMs: 0,
      });
  });

  logger.chat.log("✅ 自动重试成功，已切换全局模型:", {
    供应商: candidate.providerDisplayName,
    模型: candidate.model,
  });
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

  if (!session.titleGeneratedByAI) {
    return true;
  }

  const generatedUserMessageCount =
    session.titleGeneratedUserMessageCount ?? userMessages.length;

  return (
    generatedUserMessageCount <= 1 &&
    userMessages.length > generatedUserMessageCount &&
    userMessages.length <= AUTO_TITLE_REFINEMENT_MAX_USER_MESSAGES
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
        // Store hydration may toggle more than once while a page stays open. Only a
        // real document load (or an explicit user switch reset) may run page init
        // again; otherwise a completed reply can be mistaken for a browser refresh
        // and create an extra empty session.
        if (readChatPageInitialized()) {
          return;
        }
        writeChatPageInitialized();

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
          if (hasLegacySessionFallbackTitle(session)) {
            session.topic = getDefaultTopic();
            session.mask.name = session.topic;
            session.titleGeneratedByAI = false;
            session.titleFallbackText = "";
            session.titleGeneratedMessageCount = 0;
            session.titleGeneratedUserMessageCount = 0;
            changed = true;
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
          const startupSession = createEmptySession({
            explicitEmptySession: true,
          });
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
            const emptySession = createEmptySession({
              explicitEmptySession: true,
            });
            sessions = [emptySession, ...sessions];
            changed = true;
            newIndex += 1;
          }
        } else {
          const startupSession = createEmptySession({
            explicitEmptySession: true,
          });
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
        const selectedSession = sessions[newIndex];
        if (selectedSession && shouldBackfillSessionTitle(selectedSession)) {
          scheduleSessionTitleBackfill(selectedSession.id);
        }

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
          cleanupUnusedDeletedSessionAttachments(deletedSessions, newSessions);
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
        clearChatPageInitialized();

        // 重置所有内存缓存，确保旧用户的数据不会残留
        chatPersistStorage.resetAll();

        // 在触发任何 Zustand 状态变更（即 set）之前，先对齐 lastHydratedUserId 允许写入
        chatPersistStorage.setLastHydratedUserId(
          getActiveChatStoreScopeUserId(),
        );

        // 重置 _hasHydrated，强制后续 initialize 从 IndexedDB 重新加载，而不是读内存
        (useChatStore.getState() as any).setHasHydrated?.(false);

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

        const session = createEmptySession({ explicitEmptySession: true });

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
        cleanupUnusedDeletedSessionAttachments([deletedSession], sessions);

        if (!silent) {
          showToast(Locale.Home.DeleteToast);
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
        cleanupUnusedDeletedSessionAttachments(deletedSessions, sessions);

        showToast(Locale.Home.DeleteToast);

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
        const expectedUserId = getActiveChatStoreScopeUserId();
        const hydrateBaseLastUpdate = Number(
          get().getSessionById(sessionId)?.lastUpdate || 0,
        );

        const summary = get().sessionSummaries.find(
          (session) => session.id === sessionId,
        );
        set(() => ({ hydratingSessionId: sessionId }));

        try {
          const persistedSession = normalizeSession(
            await get().loadSessionById(sessionId),
          );
          if (
            !persistedSession ||
            getActiveChatStoreScopeUserId() !== expectedUserId
          ) {
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
            const liveSession = state.sessions[targetIndex];
            nextSessions[targetIndex] = mergeHydratedSessionWithLiveChanges(
              persistedSession,
              liveSession,
              hydrateBaseLastUpdate,
            );
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

          if (shouldBackfillSessionTitle(persistedSession)) {
            scheduleSessionTitleBackfill(persistedSession.id, 800);
          }

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

        const latestSession = get().getSessionById(targetSession.id);
        get().summarizeSession(false, latestSession ?? targetSession);

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
        options?: {
          reuseUserMessageId?: string;
          attachedFiles?: ChatMessageAttachedFile[];
          attachedFilesPromptText?: string;
          aiSelectionText?: string;
          aiSelectionPromptText?: string;
          onUserMessageCreated?: (
            messageId: string,
            signal?: AbortSignal,
          ) => Promise<void> | void;
        },
      ): Promise<{ userMessageId: string }> {
        logChatDebug("[Chat] 💬 用户输入:", {
          contentLength: content.length,
          hasImages: attachImages && attachImages.length > 0,
          isMcpResponse,
        });

        const session = get().currentSession();
        const manualModelSelection = readManualSessionModelSelection(
          session.id,
        );
        const selectedModelConfig = manualModelSelection
          ? ({
              ...session.mask.modelConfig,
              ...manualModelSelection,
            } as ModelConfig)
          : session.mask.modelConfig;
        const modelConfig =
          applySharedGlobalConversationSettings(selectedModelConfig);
        const appConfig = useAppConfig.getState();
        const accessStore = useAccessStore.getState();
        const modelCacheStore = useModelCacheStore.getState();
        const cachedExtraModels = buildCachedExtraModels(
          accessStore.apiProfiles,
          modelCacheStore.profiles || {},
        );
        const allModels = collectModelsWithDefaultModel(
          [...appConfig.models, ...cachedExtraModels],
          appConfig.customModels,
          accessStore.defaultModel,
        );
        const initialModelConfig = sanitizeModelConfigForCapability({
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
        const profileCachedModels = String(
          modelCacheStore.profiles?.[resolvedProfile?.id || ""]?.cachedModels ||
            resolvedProfile?.cachedModels ||
            "",
        );
        const allowedFallbackModelNames = new Set(
          profileCachedModels
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean),
        );
        String(appConfig.customModels || "")
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.startsWith("+"))
          .forEach((entry) => {
            const [modelName, providerId] = getModelProvider(
              entry.slice(1).split("=")[0],
            );
            if (
              modelName &&
              String(providerId || "")
                .trim()
                .toLowerCase() === resolvedProviderId
            ) {
              allowedFallbackModelNames.add(modelName.trim());
            }
          });
        if (manualModelSelection) {
          logger.chat.log("[Chat Failover] 手动选择已锁定供应商:", {
            供应商: resolvedDisplayProviderName,
            模型: initialModelConfig.model,
          });
        }
        const retryCandidates = buildChatFailoverCandidates(
          allModels,
          accessStore.apiProfiles,
          {
            model: initialModelConfig.model,
            // 使用用户选择的模型名作为 displayName，保持与模型选择器一致
            displayName: initialModelConfig.model,
            providerName: initialModelConfig.providerName,
            providerId: resolvedProviderId,
            profileId: resolvedProfile?.id,
            providerDisplayName: resolvedDisplayProviderName,
            allowedFallbackModelNames,
          },
        );

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
              attachedFiles: options?.attachedFiles || [],
              attachedFilesPromptText: options?.attachedFilesPromptText || "",
              aiSelectionText: options?.aiSelectionText || "",
              aiSelectionPromptText: options?.aiSelectionPromptText || "",
            }
          : createMessage({
              role: "user",
              content: mContent,
              isMcpResponse,
              attachedFiles: options?.attachedFiles || [],
              attachedFilesPromptText: options?.attachedFilesPromptText || "",
              aiSelectionText: options?.aiSelectionText || "",
              aiSelectionPromptText: options?.aiSelectionPromptText || "",
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
          modelIcon: (retryCandidates[0]?.vendorGroup ||
            getMessageIconModel(
              initialModelConfig.model,
              initialModelConfig.providerName,
            )) as ModelType,
        });

        const submittedMessageMeta = {
          userMessageId: reusedUserMessage?.id ?? userMessage.id,
        };
        const savedUserMessage = {
          ...userMessage,
          content: mContent,
          date: new Date().toISOString(),
        };
        const botMessageIndex =
          session.messages.length + (reusedUserMessage ? 0 : 1);

        // Show both the submitted message and the assistant loading bubble before
        // any async context preparation. The placeholder is filtered from the
        // outbound context below, so it is visual state only.
        get().updateTargetSession(session, (session) => {
          session.mask.modelConfig = {
            ...session.mask.modelConfig,
            ...initialModelConfig,
          };
          if (isDefaultTopic(session.topic)) {
            session.titleGeneratedByAI = false;
            session.titleFallbackText = "";
            session.titleGeneratedMessageCount = 0;
            session.titleGeneratedUserMessageCount = 0;
          }
          if (reusedUserMessage) {
            const userIndex = session.messages.findIndex(
              (message) => message.id === reusedUserMessage.id,
            );
            if (userIndex >= 0) {
              const nextMessages = session.messages.slice();
              nextMessages[userIndex] = savedUserMessage;
              if (nextMessages[userIndex + 1]?.id !== botMessage.id) {
                nextMessages.splice(userIndex + 1, 0, botMessage);
              }
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

        // Keep the message and loading placeholder responsive, but never let a
        // provider receive an attachment while its extraction state is pending.
        // Register a real preparation controller before attachment extraction.
        // Without this marker the UI mistakes that intentional wait for a
        // refresh interruption.
        const attachmentPreparationController = options?.attachedFiles?.length
          ? new AbortController()
          : null;
        if (attachmentPreparationController) {
          ChatControllerPool.addController(
            session.id,
            botMessage.id ?? botMessageIndex,
            attachmentPreparationController,
          );
        }
        await options?.onUserMessageCreated?.(
          submittedMessageMeta.userMessageId,
          attachmentPreparationController?.signal,
        );

        const stoppedDuringAttachmentPreparation = Boolean(
          attachmentPreparationController?.signal.aborted ||
          get()
            .getSessionById(session.id)
            ?.messages.find((message) => message.id === botMessage.id)
            ?.manualStopped,
        );
        if (stoppedDuringAttachmentPreparation) {
          ChatControllerPool.remove(
            session.id,
            botMessage.id ?? botMessageIndex,
          );
          return submittedMessageMeta;
        }

        const submittedAttachmentFiles =
          get()
            .getSessionById(session.id)
            ?.messages.find(
              (message) =>
                message.id === submittedMessageMeta.userMessageId &&
                message.role === "user",
            )?.attachedFiles || [];
        const shouldUseAttachmentVision =
          initialModelConfig.providerName !== ServiceProvider.OpenAI &&
          needsAttachmentVisionInput(submittedAttachmentFiles);
        if (shouldUseAttachmentVision) {
          logger.chat.log("[Attachment Vision] 按当前所选模型直接发送附件", {
            模型: initialModelConfig.model,
            供应商: resolvedDisplayProviderName,
          });
        }

        // get recent messages
        const recentMessages = (
          await get().getMessagesWithMemory(initialModelConfig, session)
        )
          .filter((message) => message.id !== botMessage.id)
          .map(withAttachedFilesPromptText)
          .map(withAiSelectionPromptText);
        const sendMessages = shouldUseAttachmentVision
          ? await appendAttachmentVisionPages(
              recentMessages,
              submittedMessageMeta.userMessageId,
            )
          : recentMessages;
        const messageIndex = botMessageIndex;

        const extractCacheUuid = (value: string) => {
          const base = String(value || "")
            .split("?")[0]
            .split("#")[0];
          const idPart = base.split("/").pop() || "";
          return idPart.split(".")[0];
        };
        const cacheIds = new Set<string>();
        const tryAddCacheUrl = (url?: string) => {
          if (!url) return;
          const normalized = String(url);
          if (!normalized.startsWith(CACHE_URL_PREFIX)) return;
          const uuid = extractCacheUuid(normalized);
          if (uuid) cacheIds.add(uuid);
        };
        for (const message of sendMessages) {
          const messageContent = (message as any)?.content;
          if (Array.isArray(messageContent)) {
            for (const part of messageContent) {
              if (part?.type === "image_url" && part?.image_url?.url) {
                tryAddCacheUrl(part.image_url.url);
              }
            }
          }
        }
        for (const file of options?.attachedFiles || []) {
          tryAddCacheUrl((file as any)?.previewUrl || (file as any)?.url);
        }
        if (cacheIds.size > 0) {
          void fetch(`${CACHE_URL_PREFIX}/commit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: Array.from(cacheIds) }),
            credentials: "include",
          }).catch(() => {});
        }

        logChatDebug("[Chat] 📨 发送消息:", {
          contextMessages: recentMessages.length,
          totalMessages: sendMessages.length,
        });

        const syncBotMessageToCurrentSession = () => {
          get().updateTargetSession(session, (currentSession) => {
            const currentMessageIndex = currentSession.messages.findIndex(
              (message) => message.id === botMessage.id,
            );
            if (currentMessageIndex < 0) {
              return;
            }
            const nextMessages = currentSession.messages.slice();
            nextMessages[currentMessageIndex] = {
              ...botMessage,
              retryAttempts: botMessage.retryAttempts?.map((attempt) => ({
                ...attempt,
              })),
              tools: botMessage.tools?.map((tool) => ({ ...tool })),
            };
            currentSession.messages = nextMessages;
          });
        };
        const isBotMessageManuallyStopped = () => {
          if (botMessage.manualStopped) return true;
          return Boolean(
            get()
              .getSessionById(session.id)
              ?.messages.find((message) => message.id === botMessage.id)
              ?.manualStopped,
          );
        };

        const attemptChatWithCandidate = async (
          candidate: ChatFailoverCandidate,
          attemptIndex: number,
        ) => {
          // The stop action updates the current Store session, while this async
          // chain retains its initial session snapshot. Always re-check the
          // live message before entering another candidate.
          if (isBotMessageManuallyStopped()) {
            return "aborted" as const;
          }

          // 动态检查模型可用性：非首个候选时重新确认模型当前可用
          if (attemptIndex > 0) {
            const currentModel = allModels.find(
              (model) =>
                model.name === candidate.model &&
                String(model.provider?.id || "").toLowerCase() ===
                  candidate.providerId,
            );
            if (currentModel && currentModel.available === false) {
              logger.chat.log(
                `[Chat Failover] 跳过不可用模型: ${
                  candidate.displayName || candidate.model
                }`,
              );
              // 内联 recordFailedAttempt 和 finalize("failed") 逻辑
              const attempts = [...(botMessage.retryAttempts || [])];
              attempts.push({
                attempt: attemptIndex + 1,
                provider: candidate.providerDisplayName,
                providerId: candidate.providerId,
                model: candidate.model,
                status: "failed" as const,
              });
              botMessage.retryAttempts = attempts;
              botMessage.retrying = true;
              botMessage.content = "";
              botMessage.reasoning_details = undefined;
              botMessage.usage = undefined;
              syncBotMessageToCurrentSession();
              return "failed";
            }
          }

          const candidateProfile =
            candidate.profile ||
            getProfileForModel(candidate.providerId, candidate.providerName);
          const requestProviderName = getProfileChatRequestProvider(
            candidate.providerName,
            candidateProfile,
          );
          const candidateConfig = sanitizeModelConfigForCapability({
            ...initialModelConfig,
            model: candidate.model as ModelType,
            providerName: requestProviderName,
          });
          (candidateConfig as any).providerId = candidate.providerId;
          (candidateConfig as any).profileId = String(
            candidateProfile?.id || "",
          );

          if (attemptIndex > 0) {
            botMessage.retrying = true;
            botMessage.retryAttempts = [
              ...(botMessage.retryAttempts || []),
              {
                attempt: attemptIndex + 1,
                provider: candidate.providerDisplayName,
                providerId: candidate.providerId,
                model: candidate.model,
                status: "trying",
              },
            ];
          }

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
          botMessage.modelIcon = candidate.vendorGroup as ModelType;
          botMessage.content = "";
          botMessage.tools = [];
          botMessage.reasoning_details = undefined;
          botMessage.usage = undefined;
          botMessage.streaming = true;
          botMessage.isError = false;
          userMessage.isError = false;

          syncBotMessageToCurrentSession();

          const api: ClientApi = getClientApi(requestProviderName);
          const attemptLabel = `${attemptIndex + 1}/${retryCandidates.length}`;

          return new Promise<
            | "success"
            | "failed"
            | "provider-balance-exhausted"
            | "aborted"
            | "blocked"
          >((resolve) => {
            let settled = false;
            let finishing = false;

            const finalize = (
              status:
                | "success"
                | "failed"
                | "provider-balance-exhausted"
                | "aborted"
                | "blocked",
            ) => {
              if (settled) return;
              settled = true;
              resolve(status);
            };

            const recordFailedAttempt = () => {
              const attempts = [...(botMessage.retryAttempts || [])];
              const currentAttemptIndex = attempts.findIndex(
                (attempt) => attempt.attempt === attemptIndex + 1,
              );
              const failedAttempt = {
                attempt: attemptIndex + 1,
                provider: candidate.providerDisplayName,
                providerId: candidate.providerId,
                model: candidate.model,
                status: "failed" as const,
              };
              if (currentAttemptIndex >= 0) {
                attempts[currentAttemptIndex] = failedAttempt;
              } else {
                attempts.push(failedAttempt);
              }
              botMessage.retryAttempts = attempts;
              botMessage.retrying = true;
            };

            withTemporaryCustomProfile(candidateProfile as any, () =>
              api.llm.chat({
                messages: sendMessages,
                config: {
                  ...candidateConfig,
                  stream: candidateConfig.stream !== false,
                },
                // 对 Profile 供应商显式传递本次候选的连接信息，避免专用客户端
                // 回退到其他会话或旧全局配置中的 Base URL / Key。
                requestBaseUrl: candidateProfile?.baseUrl,
                requestApiKey: candidateProfile?.apiKey,
                onRequest(request: { chatPath: string; baseUrl: string }) {
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
                  if (isBotMessageManuallyStopped()) return;
                  botMessage.streaming = true;
                  if (message && !isApiFailurePayload(message)) {
                    botMessage.content = rewriteGeneratedFileLinksFromTools(
                      message,
                      botMessage.tools,
                    );
                  }
                  syncBotMessageToCurrentSession();
                  get().scheduleTargetSessionRefresh(session);
                },
                async onFinish(message, responseRes) {
                  if (settled || finishing) return;
                  get().flushTargetSessionRefresh(session);
                  if (isBotMessageManuallyStopped()) {
                    botMessage.manualStopped = true;
                    botMessage.streaming = false;
                    botMessage.content = "";
                    botMessage.retrying = false;
                    syncBotMessageToCurrentSession();
                    finalize("aborted");
                    return;
                  }
                  botMessage.streaming = false;
                  const finalMessage =
                    message || getMessageTextContent(botMessage);

                  if (!finalMessage) {
                    recordFailedAttempt();
                    logger.chat.log("❌ 对话请求尝试失败:", {
                      尝试: attemptLabel,
                      供应商: candidate.providerDisplayName,
                      模型: candidate.model,
                      原因: "空响应",
                    });
                    botMessage.content = "";
                    botMessage.usage = undefined;
                    syncBotMessageToCurrentSession();
                    ChatControllerPool.remove(
                      session.id,
                      botMessage.id ?? messageIndex,
                    );
                    finalize(botMessage.tools?.length ? "blocked" : "failed");
                    return;
                  }

                  if (
                    (responseRes && !responseRes.ok) ||
                    isApiFailurePayload(finalMessage)
                  ) {
                    const providerBalanceExhausted = isProviderBalanceFailure(
                      finalMessage,
                      responseRes?.status,
                    );
                    recordFailedAttempt();
                    logger.chat.log("❌ 对话请求尝试失败:", {
                      尝试: attemptLabel,
                      供应商: candidate.providerDisplayName,
                      模型: candidate.model,
                      原因: responseRes?.status
                        ? `HTTP ${responseRes.status}`
                        : "API 返回错误",
                    });
                    botMessage.content = "";
                    botMessage.reasoning_details = undefined;
                    botMessage.usage = undefined;
                    syncBotMessageToCurrentSession();
                    get().flushTargetSessionRefresh(session);
                    ChatControllerPool.remove(
                      session.id,
                      botMessage.id ?? messageIndex,
                    );
                    finalize(
                      botMessage.tools?.length
                        ? "blocked"
                        : providerBalanceExhausted
                          ? "provider-balance-exhausted"
                          : "failed",
                    );
                    return;
                  }

                  finishing = true;
                  botMessage.content = rewriteGeneratedFileLinksFromTools(
                    finalMessage,
                    botMessage.tools,
                  );
                  botMessage.date = new Date().toISOString();
                  botMessage.reasoning_details = (
                    responseRes as any
                  )?.__reasoning_details;
                  const [promptTokens, completionTokens, systemTokens] =
                    await Promise.all([
                      countPromptTokens(sendMessages, candidate.model),
                      countCompletionTokens(finalMessage, candidate.model),
                      countSystemTokens(sendMessages, candidate.model),
                    ]);
                  botMessage.usage = {
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens,
                    systemTokens,
                  };
                  botMessage.isError = false;
                  botMessage.retrying = false;
                  if (attemptIndex > 0 && botMessage.retryAttempts) {
                    botMessage.retryAttempts = botMessage.retryAttempts.map(
                      (attempt) =>
                        attempt.attempt === attemptIndex + 1
                          ? { ...attempt, status: "success" }
                          : attempt,
                    );
                  }
                  userMessage.isError = false;
                  syncBotMessageToCurrentSession();
                  logger.chat.log("✅ 对话请求尝试成功:", {
                    尝试: attemptLabel,
                    供应商: candidate.providerDisplayName,
                    模型: candidate.model,
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
                  syncBotMessageToCurrentSession();
                  get().flushTargetSessionRefresh(session);
                },
                onAfterTool(tool: ChatMessageTool) {
                  botMessage?.tools?.forEach((t, i, tools) => {
                    if (tool.id == t.id) {
                      tools[i] = { ...tool };
                    }
                  });
                  syncBotMessageToCurrentSession();
                  get().flushTargetSessionRefresh(session);
                },
                onError(error) {
                  if (settled || finishing) return;
                  get().flushTargetSessionRefresh(session);
                  // Only a user stop ends failover. Provider timeout aborts are
                  // ordinary request failures and must retain automatic retry.
                  const isAborted = isBotMessageManuallyStopped();
                  logger.chat.log(
                    isAborted ? "⏹️ 对话请求已停止:" : "❌ 对话请求尝试失败:",
                    {
                      尝试: attemptLabel,
                      供应商: candidate.providerDisplayName,
                      模型: candidate.model,
                      原因: isAborted
                        ? "用户停止"
                        : getChatFailureLogReason(error),
                    },
                  );
                  botMessage.streaming = false;
                  botMessage.content = "";
                  botMessage.reasoning_details = undefined;
                  botMessage.usage = undefined;
                  if (!isAborted) {
                    recordFailedAttempt();
                  } else {
                    botMessage.retrying = false;
                  }
                  syncBotMessageToCurrentSession();
                  get().flushTargetSessionRefresh(session);
                  ChatControllerPool.remove(
                    session.id,
                    botMessage.id ?? messageIndex,
                  );

                  if (isAborted) {
                    finalize("aborted");
                    return;
                  }

                  finalize(
                    botMessage.tools?.length
                      ? "blocked"
                      : isProviderBalanceFailure(error)
                        ? "provider-balance-exhausted"
                        : "failed",
                  );
                },
                onController(controller) {
                  ChatControllerPool.addController(
                    session.id,
                    botMessage.id ?? messageIndex,
                    controller,
                  );
                  // A stop can race with controller creation between retries.
                  // Abort this late controller instead of leaving a request live.
                  if (isBotMessageManuallyStopped()) {
                    controller.abort();
                  }
                },
              }),
            ).catch((error) => {
              if (settled) return;
              const message =
                error instanceof Error ? error.message : String(error);
              const isAborted = isBotMessageManuallyStopped();
              if (isAborted) {
                logger.chat.log("⏹️ 对话请求已停止（catch）:", {
                  尝试: attemptLabel,
                  供应商: candidate.providerDisplayName,
                  模型: candidate.model,
                });
                botMessage.streaming = false;
                botMessage.content = "";
                botMessage.usage = undefined;
                botMessage.retrying = false;
                syncBotMessageToCurrentSession();
                get().flushTargetSessionRefresh(session);
                ChatControllerPool.remove(
                  session.id,
                  botMessage.id ?? messageIndex,
                );
                finalize("aborted");
                return;
              }
              logger.chat.log("❌ 对话请求尝试失败:", {
                尝试: attemptLabel,
                供应商: candidate.providerDisplayName,
                模型: candidate.model,
                原因: getChatFailureLogReason(message),
              });
              recordFailedAttempt();
              botMessage.streaming = false;
              botMessage.content = "";
              botMessage.usage = undefined;
              syncBotMessageToCurrentSession();
              get().flushTargetSessionRefresh(session);
              ChatControllerPool.remove(
                session.id,
                botMessage.id ?? messageIndex,
              );
              finalize(
                botMessage.tools?.length
                  ? "blocked"
                  : isProviderBalanceFailure(error)
                    ? "provider-balance-exhausted"
                    : "failed",
              );
            });
          });
        };

        let blockedResult: "blocked" | null = null;
        const exhaustedProviderIds = new Set<string>();
        for (const [attemptIndex, candidate] of retryCandidates.entries()) {
          if (isBotMessageManuallyStopped()) {
            botMessage.manualStopped = true;
            logger.chat.log("⏹️ 检测到用户停止，终止所有重试");
            botMessage.retrying = false;
            syncBotMessageToCurrentSession();
            return submittedMessageMeta;
          }
          if (exhaustedProviderIds.has(candidate.providerId)) {
            continue;
          }
          const result = await attemptChatWithCandidate(
            candidate,
            attemptIndex,
          );
          if (result === "success") {
            if (attemptIndex > 0) {
              applySuccessfulChatFailoverGlobally(session, candidate);
            }
            get().onNewMessage(botMessage, session);
            return submittedMessageMeta;
          }
          if (result === "aborted") {
            return submittedMessageMeta;
          }
          if (result === "provider-balance-exhausted") {
            exhaustedProviderIds.add(candidate.providerId);
            const nextProvider = retryCandidates
              .slice(attemptIndex + 1)
              .find(
                (nextCandidate) =>
                  nextCandidate.providerId !== candidate.providerId &&
                  !exhaustedProviderIds.has(nextCandidate.providerId),
              );
            logger.chat.log("💳 API 余额或额度不足，跳过当前供应商剩余模型:", {
              当前供应商: candidate.providerDisplayName,
              下一供应商: nextProvider?.providerDisplayName || "无",
            });
            continue;
          }
          if (result === "blocked") {
            // 工具已经执行后禁止重放原始请求，避免具有副作用的工具被重复调用。
            blockedResult = "blocked";
            break;
          }
        }

        // 所有候选都失败后，如果曾有 blocked 结果，使用它
        if (blockedResult === "blocked") {
          botMessage.streaming = false;
          botMessage.retrying = false;
          botMessage.isError = false;
          // blocked 状态下保留 botMessage 的现有内容（工具调用列表等）
          get().updateTargetSession(session, (session) => {
            session.messages = session.messages.concat();
          });
          get().onNewMessage(botMessage, session);
          return submittedMessageMeta;
        }

        botMessage.streaming = false;
        botMessage.retrying = false;
        botMessage.content = "所有可用聊天模型均重试失败";
        botMessage.isError = true;
        botMessage.reasoning_details = undefined;
        botMessage.usage = undefined;
        userMessage.isError = true;
        get().updateTargetSession(session, (session) => {
          session.messages = session.messages.concat();
        });
        get().onNewMessage(botMessage, session);
        return submittedMessageMeta;
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

      async getMessagesWithMemory(
        modelConfigOverride?: ModelConfig,
        targetSession?: ChatSession,
      ) {
        const session = targetSession
          ? (get().getSessionById(targetSession.id) ?? targetSession)
          : get().currentSession();
        const modelConfig = sanitizeModelConfigForCapability(
          modelConfigOverride ??
            applySharedGlobalConversationSettings(session.mask.modelConfig),
        );
        const clearContextIndex = session.clearContextIndex ?? 0;
        const messages = session.messages.slice();
        const totalMessageCount = session.messages.length;

        // in-context prompts
        const contextPrompts = (
          useAppConfig.getState().conversationContext as ChatMessage[]
        ).slice();

        // system prompts, to get close to OpenAI Web ChatGPT
        const shouldInjectSystemPrompts = modelConfig.enableInjectSystemPrompts;

        const mcpEnabled = await isMcpEnabled();
        const mcpSystemPrompt = mcpEnabled ? await getMcpSystemPrompt() : "";
        const globalSystemPrompt = String(
          useAppConfig.getState().modelConfig.customSystemPrompt || "",
        );
        const systemPromptTemplate =
          globalSystemPrompt || DEFAULT_SYSTEM_TEMPLATE;

        const systemPromptContent = [
          shouldInjectSystemPrompts
            ? fillTemplateWith("", {
                ...modelConfig,
                template: systemPromptTemplate,
              })
            : "",
          mcpSystemPrompt,
        ]
          .filter(Boolean)
          .join("\n");
        const systemPrompts: ChatMessage[] = systemPromptContent
          ? [
              createMessage({
                role: "system",
                content: systemPromptContent,
              }),
            ]
          : [];

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

        // short term memory：同时受全局历史消息数和 Token 上限约束。
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
        const historyMessageLimit = Math.max(
          0,
          modelConfig.historyMessageCount,
        );
        let hasNewestMessage = false;
        let includedHistoryMessages = 0;
        for (
          let i = totalMessageCount - 1, tokenCount = 0;
          i >= contextStartIndex && tokenCount < maxTokenThreshold;
          i -= 1
        ) {
          const msg = messages[i];
          if (
            !msg ||
            msg.isError ||
            (msg.streaming && !getMessageTextContent(msg).trim())
          ) {
            continue;
          }
          if (
            hasNewestMessage &&
            includedHistoryMessages >= historyMessageLimit
          ) {
            break;
          }
          tokenCount += estimateTokenLength(getMessageTextContent(msg));
          reversedRecentMessages.push(msg);
          if (hasNewestMessage) {
            includedHistoryMessages += 1;
          } else {
            hasNewestMessage = true;
          }
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
          session.lastSummarizeIndex = 0;
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
        const session = get().getSessionById(targetSession.id) ?? targetSession;
        const modelConfig = applySharedGlobalConversationSettings(
          session.mask.modelConfig,
        );
        // skip summarize when using dalle3?
        if (isDalle3(modelConfig.model)) {
          return;
        }

        if (refreshTitle) {
          return refreshSessionTitle(session);
        }

        const messages = session.messages;

        if (
          config.enableAutoGenerateTitle &&
          shouldAutoRefreshSessionTitle(session) &&
          !pendingTitleGenerationSessionIds.has(session.id)
        ) {
          pendingTitleGenerationSessionIds.add(session.id);
          try {
            const requestVersion = getSessionTitleRequestVersion(session);
            // 标题只使用当前对话最终模型，不额外切换模型或供应商。
            const candidates = getRefreshTitleCandidates(session);

            for (const candidate of candidates) {
              try {
                const result = await requestSessionTitleCandidate(
                  session,
                  modelConfig,
                  candidate,
                  requestVersion,
                  "auto",
                );

                if (result.success) {
                  const latestTitle =
                    get().getSessionById(session.id)?.topic || session.topic;
                  logger.chat.log("✅ 自动标题更新成功:", {
                    供应商: candidate.profile?.name || candidate.providerName,
                    模型: candidate.model,
                    标题: latestTitle,
                  });
                  break;
                }
                if (result.providerBalanceExhausted) {
                  logger.chat.log(
                    "💳 当前对话模型余额或额度不足，自动标题生成停止:",
                    {
                      当前供应商:
                        candidate.profile?.name || candidate.providerName,
                    },
                  );
                  break;
                }
                if (result.aborted) {
                  break;
                }
              } catch (error) {
                logger.chat.error("自动生成标题候选模型失败", error);
              }
            }
          } finally {
            pendingTitleGenerationSessionIds.delete(session.id);
          }
        }
        const summarizeIndex = Math.max(
          session.lastSummarizeIndex,
          session.clearContextIndex ?? 0,
        );
        const summarySource = messages
          .slice(summarizeIndex)
          .map((message, offset) => ({
            message,
            messageIndex: summarizeIndex + offset,
          }))
          .filter(
            ({ message }) =>
              !message.isError &&
              Boolean(getMessageTextContent(message).trim()),
          );
        const historyMsgLength = countMessages(
          summarySource.map(({ message }) => message),
        );

        if (
          historyMsgLength > modelConfig.compressMessageLengthThreshold &&
          modelConfig.sendMemory &&
          summarySource.length > 0 &&
          !pendingMemorySummarySessionIds.has(session.id)
        ) {
          const maxInputTokens = Math.max(
            1,
            modelConfig.compressMessageLengthThreshold,
          );
          const maxMessageCount = Math.max(1, modelConfig.historyMessageCount);
          const selectedSource: typeof summarySource = [];
          let selectedTokenCount = 0;

          for (const source of summarySource) {
            if (selectedSource.length >= maxMessageCount) {
              break;
            }
            const messageTokenCount = countMessages([source.message]);
            if (
              selectedSource.length > 0 &&
              selectedTokenCount + messageTokenCount > maxInputTokens
            ) {
              break;
            }
            selectedSource.push(source);
            selectedTokenCount += messageTokenCount;
          }

          const lastSummarizeIndex =
            selectedSource[selectedSource.length - 1].messageIndex + 1;
          const lastSelectedMessageId =
            selectedSource[selectedSource.length - 1].message.id;
          const toBeSummarizedMsgs = selectedSource.map(
            ({ message }) => message,
          );
          if (session.memoryPrompt.trim()) {
            toBeSummarizedMsgs.unshift(
              createMessage({
                role: "system",
                content: Locale.Store.Prompt.History(session.memoryPrompt),
                date: "",
              }),
            );
          }

          const summarizeTarget = getSummarizeTarget(session);
          const { model, providerName } = summarizeTarget;
          if (!model) {
            logger.chat.error("[Summarize] 当前对话没有可用模型");
            return;
          }
          const requestProviderName = getProfileChatRequestProvider(
            providerName,
            summarizeTarget.profile,
          );
          const api: ClientApi = getClientApi(requestProviderName);
          let pendingMemoryPrompt = "";

          pendingMemorySummarySessionIds.add(session.id);
          try {
            await withTemporaryCustomProfile(summarizeTarget.profile, () =>
              api.llm.chat({
                messages: toBeSummarizedMsgs.concat(
                  createMessage({
                    role: "system",
                    content: Locale.Store.Prompt.Summarize,
                    date: "",
                  }),
                ),
                config: {
                  ...modelConfig,
                  stream: false,
                  outputTokenLimit: MEMORY_SUMMARY_MAX_TOKENS,
                  reasoningEffort: "none",
                  reasoningMaxTokens: 0,
                  model,
                  providerName: requestProviderName,
                },
                requestBaseUrl: summarizeTarget.profile?.baseUrl,
                requestApiKey: summarizeTarget.profile?.apiKey,
                onUpdate(message) {
                  pendingMemoryPrompt = message;
                },
                onFinish(message, responseRes) {
                  const completedMemoryPrompt = String(
                    message || pendingMemoryPrompt,
                  ).trim();
                  if (
                    responseRes?.status !== 200 ||
                    !completedMemoryPrompt ||
                    isApiFailurePayload(completedMemoryPrompt)
                  ) {
                    logger.chat.error("[Summarize] 摘要响应无效", {
                      status: responseRes?.status,
                    });
                    return;
                  }

                  logger.chat.log("[Memory] ", completedMemoryPrompt);
                  get().updateTargetSession(session, (targetSession) => {
                    const currentLastSelectedMessage =
                      targetSession.messages[lastSummarizeIndex - 1];
                    if (
                      targetSession.lastSummarizeIndex > summarizeIndex ||
                      !currentLastSelectedMessage ||
                      (lastSelectedMessageId &&
                        currentLastSelectedMessage.id !== lastSelectedMessageId)
                    ) {
                      return;
                    }
                    targetSession.lastSummarizeIndex = lastSummarizeIndex;
                    targetSession.memoryPrompt = completedMemoryPrompt;
                  });
                },
                onError(err) {
                  logger.chat.error("[Summarize] ", err);
                },
              }),
            );
          } catch (error) {
            logger.chat.error("[Summarize] 摘要请求失败", error);
          } finally {
            pendingMemorySummarySessionIds.delete(session.id);
          }
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
        const sessionId = updatedSession.id;
        const hasStreamingMessage = updatedSession.messages.some(
          (message) => message.streaming,
        );
        if (hasStreamingMessage) {
          if (!pendingSessionPersistTimers.has(sessionId)) {
            pendingSessionPersistTimers.set(
              sessionId,
              setTimeout(() => {
                pendingSessionPersistTimers.delete(sessionId);
                // 落盘时按 id 读取最新会话；用户切换后旧会话已不在内存中，直接跳过。
                const latestSession = get().sessions.find(
                  (session) => session.id === sessionId,
                );
                if (latestSession) {
                  void get().saveSessionToPersistedStorage(latestSession);
                }
              }, STREAMING_SESSION_PERSIST_INTERVAL_MS),
            );
          }
          return;
        }
        const pendingPersistTimer = pendingSessionPersistTimers.get(sessionId);
        if (pendingPersistTimer) {
          clearTimeout(pendingPersistTimer);
          pendingSessionPersistTimers.delete(sessionId);
        }
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
