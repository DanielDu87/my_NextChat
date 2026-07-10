import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent,
  useState,
} from "react";

import { useMobileScreen } from "../utils";
import { useNavigate } from "react-router-dom";
import CloseIcon from "../icons/close.svg";
import ConfirmIcon from "../icons/confirm.svg";
import LoadingIcon from "../icons/three-dots.svg";
import TrashIcon from "../icons/trash.svg";
import UploadIcon from "../icons/upload.svg";
import DownIcon from "../icons/down.svg";
import { Path } from "../constant";
import { useAuthStore } from "../store/auth";
import {
  buildSessionSummary,
  createEmptySession,
  type ChatSession,
  useChatStore,
} from "../store/chat";
import { useChatIndexStore } from "../store/chat-index";
import { getMessageTextContent } from "../utils";
import { IconButton } from "./button";
import { List, ListItem, showConfirm, showToast } from "./ui-lib";
import styles from "./chat-backups.module.scss";

type ChatBackupRun = {
  id: string;
  userId?: string;
  externalId?: string | null;
  username?: string | null;
  displayName?: string | null;
  source: "manual" | "auto";
  mode: "full" | "incremental" | string;
  fromWatermark: string | null;
  toWatermark: string;
  sessionCount: number;
  messageCount: number;
  createdAt: string;
};

type ChatBackupSession = {
  id: string;
  externalSessionId: string;
  title: string;
  messageCount: number;
  createdAt: string;
  payload: {
    id?: string;
    topic?: string;
    messages?: Array<Record<string, any>>;
  };
};

type ChatBackupDetail = ChatBackupRun & {
  sessions: ChatBackupSession[];
};

type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  isActive: boolean;
};

type ChatBackupUserSummary = {
  userId: string;
  externalId: string | null;
  username: string | null;
  displayName: string | null;
  backupCount: number;
  conversationCount: number;
  lastBackupAt: string | null;
};

type ChatBackupSummary = {
  backupMode: "incremental" | string;
  totalBackupCount: number;
  totalConversationCount: number;
  users: ChatBackupUserSummary[];
};

const SOURCE_LABEL = {
  manual: "手动备份",
  auto: "自动备份",
};

function formatTime(value?: string | null) {
  if (!value) return "无";
  return new Date(value).toLocaleString();
}

function formatBackupRange(backup: ChatBackupRun) {
  if (!backup.fromWatermark) {
    return `首次备份 · 截止 ${formatTime(backup.toWatermark)}`;
  }
  return `增量范围：${formatTime(backup.fromWatermark)} 至 ${formatTime(
    backup.toWatermark,
  )}`;
}

function getMessagePreview(message: Record<string, any>) {
  const text = getMessageTextContent(message as any).trim();
  if (text) return text;
  if (Array.isArray(message.tools) && message.tools.length > 0) {
    return JSON.stringify(message.tools, null, 2);
  }
  return JSON.stringify(message.content ?? message, null, 2);
}

function updateHoverPosition(event: PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty(
    "--hover-x",
    `${event.clientX - rect.left}px`,
  );
  event.currentTarget.style.setProperty(
    "--hover-y",
    `${event.clientY - rect.top}px`,
  );
}

// 兼容性校验和规范化恢复的会话数据
function normalizeRestoredSession(
  rawSession: any,
  restoredAt: number,
): ChatSession {
  // 创建一个符合 ChatSession 类型的完整会话
  const emptySession = createEmptySession();

  // 确保必要字段存在
  const normalized = {
    ...emptySession,
    id: String(rawSession.id || ""),
    topic: String(rawSession.topic || rawSession.title || "未命名对话"),
    createdAt: Number(rawSession.createdAt || restoredAt),
    lastUpdate: restoredAt,
    memoryPrompt: String(rawSession.memoryPrompt || ""),
    messages: Array.isArray(rawSession.messages) ? rawSession.messages : [],
    stat: {
      tokenCount: Number(rawSession.stat?.tokenCount || 0),
      wordCount: Number(rawSession.stat?.wordCount || 0),
      charCount: Number(rawSession.stat?.charCount || 0),
    },
    mask: {
      ...emptySession.mask,
      ...(rawSession.mask && typeof rawSession.mask === "object"
        ? rawSession.mask
        : {}),
    },
  };

  // 确保 messages 数组中的每个消息都有必要字段
  normalized.messages = normalized.messages.map((msg: any, index: number) => ({
    id: String(msg.id || `msg-${index}-${Date.now()}`),
    date:
      msg.date ||
      new Date(
        restoredAt - (normalized.messages.length - index) * 1000,
      ).toISOString(),
    role: msg.role || "user",
    content: msg.content || "",
    ...(typeof msg === "object" ? msg : {}),
  }));

  return normalized;
}

function applyRestoredSessionToStores(
  restoredSession: ChatSession,
  restoredAt: number,
) {
  const sessionId = restoredSession.id;
  if (!sessionId) {
    console.error("[Chat Backup] 会话 ID 为空，无法应用");
    return;
  }

  // 先规范化数据
  const normalizedSession = normalizeRestoredSession(
    restoredSession,
    restoredAt,
  );

  const nextSession = {
    ...normalizedSession,
    lastUpdate: restoredAt,
  };
  const nextSummary = {
    ...buildSessionSummary(nextSession),
    displayTime: restoredAt,
  };

  useChatStore.setState((state) => {
    const remainingSessions = state.sessions.filter(
      (item) => item.id !== sessionId,
    );
    const nextSessions = [nextSession, ...remainingSessions];
    const remainingSummaries = (state.sessionSummaries || []).filter(
      (item) => item.id !== sessionId,
    );

    // 从 deletedSessionTimestamps 中清除该会话，防止被过滤
    const { [sessionId]: _, ...remainingDeletedTimestamps } =
      state.deletedSessionTimestamps || {};

    return {
      ...state,
      sessions: nextSessions,
      sessionSummaries: [nextSummary, ...remainingSummaries],
      currentSessionIndex: 0,
      selectedSessionId: sessionId,
      hydratedSessionIds: Array.from(
        new Set([sessionId, ...((state as any).hydratedSessionIds || [])]),
      ),
      deletedSessionTimestamps: remainingDeletedTimestamps,
    };
  });

  // 确保 chatIndexStore 同步
  useChatIndexStore.getState().syncFromChatStore();

  // 直接更新 chatIndexStore 确保会话出现在列表中
  useChatIndexStore.setState((state) => {
    const allOrderedSessionIds = [
      sessionId,
      ...state.allOrderedSessionIds.filter((id) => id !== sessionId),
    ];
    const visibleCount = Math.max(state.visibleCount, 20);

    // 同样从 chatIndexStore 的 deletedSessionTimestamps 中清除
    const { [sessionId]: __, ...remainingDeletedTimestamps } =
      state.deletedSessionTimestamps || {};

    return {
      ...state,
      allOrderedSessionIds,
      orderedSessionIds: allOrderedSessionIds.slice(0, visibleCount),
      sessionSummaries: {
        ...state.sessionSummaries,
        [sessionId]: nextSummary,
      },
      currentSessionId: sessionId,
      visibleCount,
      initialized: true,
      deletedSessionTimestamps: remainingDeletedTimestamps,
    };
  });
}

async function showRestoredSessionNow(
  restoredSession: ChatSession,
  restoredAt: number,
) {
  const sessionId = restoredSession.id;
  if (!sessionId) return;

  // 先规范化数据
  const normalizedSession = normalizeRestoredSession(
    restoredSession,
    restoredAt,
  );
  const nextSession = {
    ...normalizedSession,
    lastUpdate: restoredAt,
  };

  await useChatStore
    .getState()
    .saveSessionToPersistedStorage(nextSession)
    .catch((error) => {
      console.error(
        "[Chat Backup] ❌ 写入本地恢复会话失败",
        error instanceof Error ? error.message : error,
      );
    });

  // 立即应用一次，然后轮询直到 store 中存在该会话。
  // 取代旧实现里 300ms / 1200ms 两次硬编码 setTimeout，避免在快机器上空转、
  // 在慢机器上又覆盖不到的竞态。指数退避 + 显式上限，不会无限延后。
  applyRestoredSessionToStores(nextSession, restoredAt);
  await waitForSessionInStore(sessionId);
}

// 轮询 store 直到指定 sessionId 出现在 chat store 中。最多 6 次，间隔
// 50/100/200/400/800/1200ms（指数退避），总耗时约 2.75s，已能覆盖正常
// Zustand persist + chatIndexStore 同步链路。命中后立即 resolve。
async function waitForSessionInStore(sessionId: string) {
  const delays = [50, 100, 200, 400, 800, 1200];
  for (let i = 0; i < delays.length; i++) {
    const delay = delays[i];
    await new Promise((resolve) => setTimeout(resolve, delay));
    const present = useChatStore
      .getState()
      .sessions.some((item) => item.id === sessionId);
    if (present) {
      // 命中后再 apply 一次，把 index store 的 orderedIds 同步进来
      // （index store 的同步逻辑在 applyRestoredSessionToStores 内部完成）
      const target = useChatStore
        .getState()
        .sessions.find((item) => item.id === sessionId);
      if (target) {
        applyRestoredSessionToStores(target, Date.now());
      }
      return;
    }
  }
  console.warn(
    `[Chat Backup] ⚠️ 轮询结束仍未在 store 中看到会话：${sessionId}（当前 store 共 ${
      useChatStore.getState().sessions.length
    } 个会话）`,
  );
}

// 轮询 chat index store 的初始化标志，最多 maxAttempts 次（每次 100ms）。
// 用于切换用户后等待目标用户的会话列表加载完成，取代硬编码 1.5s 等待。
async function waitForChatIndexInitialized(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    if (useChatIndexStore.getState().initialized) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.warn(
    `[Chat Backup] ⚠️ chat index store 初始化超时（${maxAttempts} 次）`,
  );
}

export function ChatBackupsPage() {
  const navigate = useNavigate();
  const isMobileScreen = useMobileScreen();
  const effectiveUser = useAuthStore((state) => state.effectiveUser);
  const switchUser = useAuthStore((state) => state.switchUser);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [settings, setSettings] = useState({
    enabled: true,
    intervalMinutes: 1440,
    maxBackups: 30,
  });
  const [backups, setBackups] = useState<ChatBackupRun[]>([]);
  const [summary, setSummary] = useState<ChatBackupSummary | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ChatBackupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [working, setWorking] = useState("");
  const [expandedSessionId, setExpandedSessionId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [settingsSyncStatus, setSettingsSyncStatus] =
    useState("正在读取服务器设置...");
  const [userSelectOpen, setUserSelectOpen] = useState(false);
  const userSelectRef = useRef<HTMLDivElement | null>(null);
  const settingsReadyRef = useRef(false);
  const syncedSettingsRef = useRef("");
  const backupLogSignatureRef = useRef("");

  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/users", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "load_users_failed");
      }
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (error) {
      console.error(
        "[Chat Backup] ❌ 读取用户列表失败",
        error instanceof Error ? error.message : error,
      );
    }
  }, []);

  const load = useCallback(async (targetUserId: string, keyword = "") => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (targetUserId) {
        query.set("userId", targetUserId);
      }
      if (keyword.trim()) {
        query.set("search", keyword.trim());
      }
      const queryString = query.toString() ? `?${query}` : "";
      const response = await fetch(`/api/db/chat-backups${queryString}`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "load_failed");
      }
      const nextBackups = Array.isArray(data.backups) ? data.backups : [];
      if (data.settings) {
        setSettings(data.settings);
        syncedSettingsRef.current = JSON.stringify(data.settings);
        settingsReadyRef.current = true;
        setSettingsSyncStatus(
          data.degraded ? "服务器暂不可用，显示默认设置" : "已与服务器同步",
        );
      }
      setBackups(nextBackups);
      setSummary(
        data.summary && typeof data.summary === "object" ? data.summary : null,
      );
      const summaryText =
        data.summary && typeof data.summary === "object" ? data.summary : null;
      const backupLogSignature = JSON.stringify({
        targetUserId,
        keyword,
        degraded: Boolean(data.degraded),
        backups: nextBackups,
        summary: summaryText,
      });
      if (backupLogSignatureRef.current !== backupLogSignature) {
        backupLogSignatureRef.current = backupLogSignature;
        console.log(
          `[Chat Backup] 📋 已读取对话备份（${nextBackups.length} 次${
            data.degraded ? "，降级返回" : ""
          }）：`,
        );
        if (nextBackups.length) {
          nextBackups.forEach((backup) => {
            console.log(
              `  - ${new Date(backup.createdAt).toLocaleString()}（${
                backup.source
              }/${backup.mode}，${backup.sessionCount} 个会话 / ${
                backup.messageCount
              } 条消息，归属 ${backup.username || backup.externalId || "?"}）`,
            );
          });
        } else {
          console.log("  - 暂无备份");
        }
      }
      setSelectedId((current) => {
        if (keyword.trim()) {
          return nextBackups[0]?.id || "";
        }
        return current &&
          nextBackups.some((backup: ChatBackupRun) => backup.id === current)
          ? current
          : "";
      });
      setExpandedSessionId("");
    } catch (error) {
      console.error(
        "[Chat Backup] ❌ 读取备份列表失败",
        error instanceof Error ? error.message : error,
      );
      showToast("读取对话备份失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(
    async (id: string, targetUserId: string, keyword = "") => {
      if (!id) {
        setDetail(null);
        return;
      }
      setDetailLoading(true);
      try {
        const query = new URLSearchParams({ id });
        if (targetUserId) {
          query.set("userId", targetUserId);
        }
        if (keyword.trim()) {
          query.set("search", keyword.trim());
        }
        const response = await fetch(`/api/db/chat-backups?${query}`, {
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "detail_failed");
        }
        const nextDetail = data.backup;
        setDetail(nextDetail);
        const sessions = Array.isArray(nextDetail?.sessions)
          ? nextDetail.sessions
          : [];
        setExpandedSessionId(
          keyword.trim() ? sessions[0]?.externalSessionId || "" : "",
        );
      } catch (error) {
        console.error(
          "[Chat Backup] ❌ 读取备份内容失败",
          error instanceof Error ? error.message : error,
        );
        showToast("读取对话备份内容失败");
      } finally {
        setDetailLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    setSelectedId("");
    setDetail(null);
    setExpandedSessionId("");
    void load(selectedUserId, searchText);
  }, [load, searchText, selectedUserId]);

  useEffect(() => {
    void loadDetail(selectedId, selectedUserId, searchText);
  }, [loadDetail, searchText, selectedId, selectedUserId]);

  useEffect(() => {
    if (isMobileScreen || !settingsReadyRef.current) return;
    const settingsSnapshot = JSON.stringify(settings);
    if (settingsSnapshot === syncedSettingsRef.current) return;
    setSettingsSyncStatus("等待同步...");
    const timer = window.setTimeout(async () => {
      setWorking("settings");
      setSettingsSyncStatus("正在同步到服务器...");
      try {
        const response = await fetch("/api/db/chat-backups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "settings",
            userId: selectedUserId,
            ...settings,
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok)
          throw new Error(data.error || "save_failed");
        syncedSettingsRef.current = JSON.stringify(data.settings);
        setSettingsSyncStatus("已与服务器同步");
        console.log(
          `[Chat Backup] ✅ 自动备份设置已同步（启用=${data.settings.enabled}，间隔=${data.settings.intervalMinutes} 分钟，保留=${data.settings.maxBackups}）`,
        );
      } catch (error) {
        console.error(
          "[Chat Backup] ❌ 备份设置同步失败",
          error instanceof Error ? error.message : error,
        );
        setSettingsSyncStatus("同步失败，请修改后重试");
        showToast("自动备份设置同步失败");
      } finally {
        setWorking("");
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [isMobileScreen, settings, selectedUserId]);

  const handleUserChange = (nextUserId: string) => {
    setSelectedUserId(nextUserId);
    setBackups([]);
    setSelectedId("");
    setDetail(null);
    setExpandedSessionId("");
    setLoading(true);
    setUserSelectOpen(false);
  };

  const createBackup = async () => {
    console.log("[Chat Backup] 🔄 开始为所有用户创建增量备份");
    setWorking("backup");
    try {
      const response = await fetch("/api/db/chat-backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backup-all" }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "backup_failed");
      }
      const results = Array.isArray(data.results) ? data.results : [];
      const successCount = results.filter((r: any) => r.created).length;
      const sessionTotal = results.reduce(
        (sum: number, r: any) => sum + (r.sessionCount || 0),
        0,
      );
      console.log(
        `[Chat Backup] ✅ 增量备份已创建（${successCount}/${results.length} 个用户，共 ${sessionTotal} 个会话）`,
      );
      showToast(`已为 ${results.length} 个用户创建增量备份`);
      setSearchText("");
      await load(selectedUserId, "");
      setSelectedId("");
    } catch (error) {
      console.error(
        "[Chat Backup] ❌ 创建备份失败",
        error instanceof Error ? error.message : error,
      );
      showToast("创建对话备份失败");
    } finally {
      setWorking("");
    }
  };

  const restoreConversation = async (session: ChatBackupSession) => {
    if (
      !(await showConfirm(
        selectedUserId
          ? `确定恢复「${
              session.title || "未命名对话"
            }」？同 ID 的现有对话会被此备份覆盖。`
          : `确定恢复「${
              session.title || "未命名对话"
            }」到备份所属用户？同 ID 的现有对话会被此备份覆盖。`,
      ))
    ) {
      return;
    }
    const sessionTitle = session.title || "未命名对话";
    console.log(`[Chat Backup] 🔄 开始恢复会话：${sessionTitle}`);
    setWorking(session.externalSessionId);
    try {
      const response = await fetch("/api/db/chat-backups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "restore-conversation",
          backupId: selectedId,
          externalSessionId: session.externalSessionId,
          userId: selectedUserId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `服务器错误 (${response.status}): ${errorText || "未知错误"}`,
        );
      }

      const data = await response.json();
      if (!data.ok) {
        throw new Error(data.error || "restore_failed");
      }

      const restoredSession = data.result?.session as ChatSession | undefined;
      const restoredAt = Number(data.result?.restoredAt || Date.now());
      const restoredUserId = String(data.result?.userId || "");
      const sessionAlreadyExistsAndSame = Boolean(
        data.result?.sessionAlreadyExistsAndSame,
      );

      if (restoredSession?.id) {
        // 检查会话是否已存在且内容相同
        if (sessionAlreadyExistsAndSame) {
          const shouldContinue = await showConfirm(
            `该对话「${sessionTitle}」已存在且内容相同，是否仍要恢复？`,
          );
          if (!shouldContinue) {
            // 如果用户选择不继续，则直接跳转到该会话
            const isCurrentUserSame =
              !restoredUserId ||
              !effectiveUser?.id ||
              restoredUserId === effectiveUser.id;
            if (isCurrentUserSame) {
              // 如果是当前用户，直接跳转
              navigate(
                `${Path.Chat}/${encodeURIComponent(restoredSession.id)}`,
              );
            } else {
              // 如果是其他用户，切换用户后跳转
              await switchUser(restoredUserId, {
                username: String(data.result?.username || ""),
                displayName: String(data.result?.displayName || ""),
              });
              // 等目标用户的 index store 初始化好再跳转，取代硬编码 1s 等待
              await waitForChatIndexInitialized(20);
              navigate(
                `${Path.Chat}/${encodeURIComponent(restoredSession.id)}`,
              );
            }
            showToast("已跳转到该对话");
            return;
          }
        }

        let needsSwitchUser =
          restoredUserId &&
          effectiveUser?.id &&
          restoredUserId !== effectiveUser.id;

        if (needsSwitchUser) {
          // 如果需要切换用户，先切换用户
          await switchUser(restoredUserId, {
            username: String(data.result?.username || ""),
            displayName: String(data.result?.displayName || ""),
          });
          // 等待目标用户的 chat index store 初始化完成（取代硬编码 1.5s）。
          // 轮询最多 30 次（每次 100ms，约 3s），命中 initialized=true 即继续。
          await waitForChatIndexInitialized(30);
        }

        // 写入 store 并通过轮询确认会话可见（取代 7 个硬编码 setTimeout）
        await showRestoredSessionNow(restoredSession, restoredAt);

        showToast("对话已恢复");

        console.log(
          `[Chat Backup] ✅ 恢复流程完成：${sessionTitle}${
            needsSwitchUser ? `（已切换到 ${restoredUserId}）` : ""
          }`,
        );
        navigate(`${Path.Chat}/${encodeURIComponent(restoredSession.id)}`);
      } else {
        console.warn("[Chat Backup] 没有返回会话数据，刷新页面");
        showToast("对话已恢复，正在刷新对话列表...");
        window.location.reload();
      }
    } catch (error) {
      console.error(
        `[Chat Backup] ❌ ${sessionTitle} 恢复失败`,
        error instanceof Error ? error.message : error,
      );

      // 显示更友好的错误信息
      let errorMessage = "恢复对话失败";
      if (error instanceof Error) {
        if (error.message.includes("server")) {
          errorMessage = "服务器连接失败，请稍后重试";
        } else if (error.message.includes("network")) {
          errorMessage = "网络连接失败，请检查网络";
        } else if (error.message !== "restore_failed") {
          errorMessage = error.message;
        }
      }

      showToast(errorMessage);
    } finally {
      setWorking("");
    }
  };

  const removeBackup = async (backup: ChatBackupRun) => {
    if (!(await showConfirm("确定删除这次对话备份？删除后无法恢复。"))) {
      return;
    }
    console.log(`[Chat Backup] 🔄 开始删除备份（${backup.id}）`);
    setWorking(`delete:${backup.id}`);
    try {
      const query = new URLSearchParams({ id: backup.id });
      if (selectedUserId) {
        query.set("userId", selectedUserId);
      }
      const response = await fetch(`/api/db/chat-backups?${query}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "delete_failed");
      }
      console.log("[Chat Backup] ✅ 备份已删除");
      showToast("对话备份已删除");
      setSelectedId("");
      setDetail(null);
      await load(selectedUserId, searchText);
    } catch (error) {
      console.error(
        "[Chat Backup] ❌ 删除备份失败",
        error instanceof Error ? error.message : error,
      );
      showToast("删除对话备份失败");
    } finally {
      setWorking("");
    }
  };

  const removeBackupSession = async (session: ChatBackupSession) => {
    if (
      !(await showConfirm(
        `确定删除「${
          session.title || "未命名对话"
        }」这份备份内容？删除后无法从这次备份恢复它。`,
      ))
    ) {
      return;
    }
    console.log(
      `[Chat Backup] 🔄 开始删除备份内的会话快照：${
        session.title || "未命名对话"
      }`,
    );
    setWorking(`delete-session:${session.externalSessionId}`);
    try {
      const query = new URLSearchParams({
        id: selectedId,
        externalSessionId: session.externalSessionId,
      });
      if (selectedUserId) {
        query.set("userId", selectedUserId);
      }
      const response = await fetch(`/api/db/chat-backups?${query}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "delete_snapshot_failed");
      }
      console.log("[Chat Backup] ✅ 备份会话快照已删除");
      showToast("备份内容已删除");
      setExpandedSessionId("");
      await Promise.all([
        load(selectedUserId, searchText),
        loadDetail(selectedId, selectedUserId, searchText),
      ]);
    } catch (error) {
      console.error(
        "[Chat Backup] ❌ 删除备份内容失败",
        error instanceof Error ? error.message : error,
      );
      showToast("删除备份内容失败");
    } finally {
      setWorking("");
    }
  };

  const toggleBackup = (backupId: string) => {
    setSelectedId((current) => (current === backupId ? "" : backupId));
    setExpandedSessionId("");
  };

  const selectableUsers = (() => {
    const resolved =
      users.length > 0
        ? users
        : (summary?.users || []).map((user) => ({
            id: user.userId,
            username: user.username || user.externalId || "",
            displayName:
              user.displayName || user.username || user.externalId || "",
            role: "user" as const,
            isActive: true,
          }));

    return [
      {
        id: "",
        username: "所有用户",
        displayName: "所有用户",
        role: "user" as const,
        isActive: true,
      },
      ...resolved,
    ];
  })();

  const selectedUserOption =
    selectableUsers.find((user) => user.id === selectedUserId) ||
    selectableUsers[0];
  const selectedUserLabel =
    selectedUserOption.displayName &&
    selectedUserOption.displayName !== selectedUserOption.username
      ? `${selectedUserOption.displayName}（${selectedUserOption.username}）`
      : selectedUserOption.username || selectedUserOption.displayName;

  useEffect(() => {
    if (!userSelectOpen) return;

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!userSelectRef.current?.contains(event.target as Node)) {
        setUserSelectOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [userSelectOpen]);

  return (
    <div className={styles.page} data-top-notice-anchor="true">
      <div className="window-header" data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">对话备份</div>
          <div className="window-header-sub-title">
            一键为所有用户创建增量备份、查看内容并恢复单个对话
          </div>
        </div>
        <div className="window-actions">
          <IconButton
            aria="关闭"
            icon={<CloseIcon />}
            close
            onClick={() => navigate(Path.Chat)}
          />
        </div>
      </div>

      <div className={styles.content}>
        <List>
          <ListItem
            className={styles.hoverCard}
            onPointerMove={updateHoverPosition}
            title="备份说明"
            subTitle="备份方式为增量；切换用户后读取对应用户的备份，汇总展示所有用户的数据库对话总量。"
            vertical
          >
            <div className={styles.summaryContent}>
              {summary?.users && summary.users.length > 0 ? (
                <div
                  className={`${styles.userSummaryBox} ${styles.hoverCard}`}
                  onPointerMove={updateHoverPosition}
                >
                  <div className={styles.userSummaryBoxTitle}>
                    <span>所有用户对话总数</span>
                    <span className={styles.userSummaryTitleCount}>
                      {summary.totalConversationCount}
                    </span>
                  </div>
                  <div className={styles.userSummaryList}>
                    {summary.users.map((user) => {
                      const userName =
                        user.displayName ||
                        user.username ||
                        user.externalId ||
                        "未命名用户";
                      return (
                        <div
                          className={`${styles.userSummaryItem} ${styles.hoverCard}`}
                          key={user.userId}
                          onPointerMove={updateHoverPosition}
                        >
                          <div>
                            <div className={styles.userSummaryName}>
                              {userName}
                            </div>
                          </div>
                          <div className={styles.userSummaryCount}>
                            {user.conversationCount}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div
                  className={`${styles.userSummaryBox} ${styles.hoverCard}`}
                  onPointerMove={updateHoverPosition}
                >
                  <div className={styles.userSummaryBoxTitle}>
                    <span>所有用户对话总数</span>
                  </div>
                  <div className={styles.empty}>暂无用户备份统计</div>
                </div>
              )}

              <div
                className={`${styles.userSelector} ${styles.summaryCard} ${styles.hoverCard}`}
                onPointerMove={updateHoverPosition}
              >
                <div className={styles.summaryLabel}>查看用户</div>
                <div
                  className={`nextchat-select ${
                    userSelectOpen ? "nextchat-select-open" : ""
                  }`}
                  ref={userSelectRef}
                >
                  <button
                    aria-controls={
                      userSelectOpen ? "chat-backup-user-select" : undefined
                    }
                    aria-expanded={userSelectOpen}
                    aria-haspopup="listbox"
                    aria-label="查看用户"
                    className="nextchat-select-trigger nextchat-control-surface"
                    onClick={() => setUserSelectOpen((open) => !open)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setUserSelectOpen(false);
                      }
                      if (event.key === "ArrowDown" || event.key === "Enter") {
                        event.preventDefault();
                        setUserSelectOpen(true);
                      }
                    }}
                    type="button"
                  >
                    <span className="nextchat-select-text">
                      {selectedUserLabel}
                    </span>
                    <DownIcon className="nextchat-select-icon" />
                  </button>
                  {userSelectOpen && (
                    <div
                      className="nextchat-select-menu"
                      id="chat-backup-user-select"
                      role="listbox"
                    >
                      {selectableUsers.map((user) => {
                        const label =
                          user.displayName && user.displayName !== user.username
                            ? `${user.displayName}（${user.username}）`
                            : user.username || user.displayName;
                        const selected = user.id === selectedUserId;

                        return (
                          <button
                            aria-selected={selected}
                            className={`nextchat-select-option ${
                              selected ? "nextchat-select-option-active" : ""
                            }`}
                            key={user.id || "all"}
                            onClick={() => handleUserChange(user.id)}
                            role="option"
                            type="button"
                          >
                            <span className="nextchat-select-check" />
                            <span className="nextchat-select-option-text">
                              {label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div
                className={`${styles.summaryCard} ${styles.hoverCard}`}
                onPointerMove={updateHoverPosition}
              >
                <div className={styles.summaryLabel}>备份方式</div>
                <div className={styles.summaryValue}>增量</div>
              </div>
              <div
                className={`${styles.summaryCard} ${styles.hoverCard}`}
                onPointerMove={updateHoverPosition}
              >
                <div className={styles.summaryLabel}>备份次数</div>
                <div className={styles.summaryValue}>
                  {summary?.totalBackupCount ?? backups.length}
                </div>
              </div>
              <div
                className={`${styles.summaryCard} ${styles.hoverCard}`}
                onPointerMove={updateHoverPosition}
              >
                <div className={styles.summaryLabel}>
                  所有用户数据库对话总量
                </div>
                <div className={styles.summaryValue}>
                  {summary?.totalConversationCount ?? "-"}
                </div>
              </div>
            </div>
          </ListItem>

          <ListItem
            className={styles.hoverCard}
            onPointerMove={updateHoverPosition}
            title="自动备份设置"
            subTitle="备份间隔按分钟计算，可自定义保留数量。"
            vertical
          >
            <div className={styles.settings}>
              <label>
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      enabled: e.currentTarget.checked,
                    })
                  }
                />
                启用自动备份
              </label>
              <label>
                备份间隔（分钟）
                <input
                  className="nextchat-input-control"
                  type="number"
                  min={1}
                  max={525600}
                  value={settings.intervalMinutes}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      intervalMinutes: Math.max(
                        1,
                        Number(e.currentTarget.value) || 1,
                      ),
                    })
                  }
                />
              </label>
              <label>
                最大保留数量
                <input
                  className="nextchat-input-control"
                  type="number"
                  min={1}
                  max={100}
                  value={settings.maxBackups}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      maxBackups: Math.max(
                        1,
                        Number(e.currentTarget.value) || 1,
                      ),
                    })
                  }
                />
              </label>
              <div className={styles.syncStatus}>
                {working === "settings" && <LoadingIcon />}
                <span>{settingsSyncStatus}</span>
              </div>
            </div>
          </ListItem>

          <ListItem
            className={styles.hoverCard}
            onPointerMove={updateHoverPosition}
            title={
              <div className={styles.historyHeader}>
                <div className={styles.historyHeaderText}>
                  <div className={styles.historyTitle}>对话备份历史</div>
                  <div className={styles.historySubTitle}>
                    立即备份会为所有用户创建增量备份；下方历史随查看用户切换。
                  </div>
                </div>
                <IconButton
                  icon={working === "backup" ? <LoadingIcon /> : <UploadIcon />}
                  text={working === "backup" ? "备份中..." : "立即备份"}
                  type="green"
                  className={styles.createBackupButton}
                  disabled={!!working}
                  onClick={() => void createBackup()}
                />
              </div>
            }
            vertical
          >
            <div className={styles.searchBar}>
              <input
                className="nextchat-input-control"
                value={searchText}
                onChange={(event) => setSearchText(event.currentTarget.value)}
                placeholder="搜索全部备份：用户、来源、时间、数量或备份 ID"
              />
            </div>
            {loading ? (
              <div className={`${styles.empty} ${styles.loadingEmpty}`}>
                <LoadingIcon />
                正在读取备份...
              </div>
            ) : backups.length === 0 && !searchText.trim() ? (
              <div className={styles.empty}>暂无对话备份</div>
            ) : backups.length === 0 ? (
              <div className={styles.empty}>没有匹配的备份</div>
            ) : (
              <div className={styles.backups}>
                {backups.map((backup) => {
                  const active = backup.id === selectedId;
                  return (
                    <article
                      className={`${styles.backup} ${styles.hoverCard} ${
                        active ? styles.backupActive : ""
                      }`}
                      key={backup.id}
                      onPointerMove={updateHoverPosition}
                    >
                      <div className={styles.backupTop}>
                        <button
                          type="button"
                          className={styles.backupInfoButton}
                          onClick={() => toggleBackup(backup.id)}
                        >
                          <div className={styles.backupTitle}>
                            {backup.displayName ||
                              backup.username ||
                              backup.externalId ||
                              "未知用户"}{" "}
                            · {SOURCE_LABEL[backup.source] || backup.source}
                            <span className={styles.modeBadge}>
                              {backup.mode === "full" ? "首次全量" : "增量"}
                            </span>
                          </div>
                          <div className={styles.backupMeta}>
                            {formatTime(backup.createdAt)} ·{" "}
                            {backup.sessionCount} 个会话 · {backup.messageCount}{" "}
                            条消息
                          </div>
                          <div className={styles.backupMeta}>
                            {formatBackupRange(backup)}
                          </div>
                        </button>
                        <IconButton
                          icon={<ConfirmIcon />}
                          text={active ? "已展开" : "查看"}
                          type="primary"
                          disabled={!!working}
                          onClick={() => toggleBackup(backup.id)}
                        />
                        <IconButton
                          icon={<TrashIcon />}
                          text="删除"
                          type="danger"
                          className="nextchat-danger-button-filled nextchat-api-config-danger-action"
                          disabled={!!working}
                          onClick={() => void removeBackup(backup)}
                        />
                      </div>

                      {active && (
                        <div className={styles.backupDetail}>
                          {detailLoading ? (
                            <div className={styles.empty}>
                              正在读取备份内容...
                            </div>
                          ) : !detail ? (
                            <div className={styles.empty}>暂无内容</div>
                          ) : detail.sessions.length === 0 ? (
                            <div className={styles.empty}>
                              {searchText.trim()
                                ? "没有匹配的对话"
                                : "这次增量没有变更的会话"}
                            </div>
                          ) : (
                            <div className={styles.sessionList}>
                              {detail.sessions.map((session) => (
                                <article
                                  className={`${styles.session} ${styles.hoverCard}`}
                                  key={session.id}
                                  onPointerMove={updateHoverPosition}
                                >
                                  <div className={styles.sessionHeader}>
                                    <button
                                      type="button"
                                      className={styles.sessionInfoButton}
                                      onClick={() =>
                                        setExpandedSessionId((current) =>
                                          current === session.externalSessionId
                                            ? ""
                                            : session.externalSessionId,
                                        )
                                      }
                                    >
                                      <div className={styles.sessionTitle}>
                                        {session.title || "未命名对话"}
                                      </div>
                                      <div className={styles.backupMeta}>
                                        {session.messageCount} 条消息 · 会话 ID:{" "}
                                        {session.externalSessionId}
                                      </div>
                                    </button>
                                    <IconButton
                                      icon={
                                        working ===
                                        session.externalSessionId ? (
                                          <LoadingIcon />
                                        ) : (
                                          <ConfirmIcon />
                                        )
                                      }
                                      text="恢复此对话"
                                      type="primary"
                                      disabled={!!working}
                                      onClick={() =>
                                        void restoreConversation(session)
                                      }
                                    />
                                    <IconButton
                                      icon={
                                        working ===
                                        `delete-session:${session.externalSessionId}` ? (
                                          <LoadingIcon />
                                        ) : (
                                          <TrashIcon />
                                        )
                                      }
                                      text="删除"
                                      type="danger"
                                      className="nextchat-danger-button-filled nextchat-api-config-danger-action"
                                      disabled={!!working}
                                      onClick={() =>
                                        void removeBackupSession(session)
                                      }
                                    />
                                  </div>

                                  {expandedSessionId ===
                                    session.externalSessionId && (
                                    <div className={styles.messageList}>
                                      {(session.payload.messages || []).map(
                                        (message, index) => (
                                          <div
                                            className={`${styles.message} ${styles.hoverCard}`}
                                            key={index}
                                            onPointerMove={updateHoverPosition}
                                          >
                                            <div className={styles.messageRole}>
                                              {String(
                                                message.role || "unknown",
                                              )}
                                            </div>
                                            <div
                                              className={styles.messageContent}
                                            >
                                              {getMessagePreview(message)}
                                            </div>
                                          </div>
                                        ),
                                      )}
                                    </div>
                                  )}
                                </article>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </ListItem>
        </List>
      </div>
    </div>
  );
}
