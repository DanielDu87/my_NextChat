import { Path } from "../constant";
import { type ChatSession, useChatStore } from "../store/chat";
import { DEFAULT_TOPIC, getDefaultTopic } from "../store/chat-defaults";

type NewChatNavigate = (path: string, options?: { replace?: boolean }) => void;

let newChatTransitionPendingUntil = 0;

export function isNewChatTransitionPending() {
  return Date.now() <= newChatTransitionPendingUntil;
}

/**
 * 在同一个事件回调里「建会话 + 跳 /chat」，不再经过 /new-chat 中转路由。
 *
 * 走 /new-chat 会先卸载 Chat、挂载 dynamic 的 NewChat（带全屏 splash），
 * 建完会话再跳回 /chat 让 Chat 重新挂载，视觉上等同于整页刷新。
 * 这里用一个短时事务标记包住 store 与路由更新，避免两种中间态：
 * 新 session 先落地时不能被误判为历史恢复，旧 URL 先离开时也不能
 * 被旧会话的 URL 同步 effect 立刻写回。
 */
export function startNewChat(
  navigate: NewChatNavigate,
  options?: { replace?: boolean },
) {
  newChatTransitionPendingUntil = Date.now() + 1500;

  // 已经是空白新会话时只对齐路由，避免重复建号。
  if (!isCurrentFreshDefaultChat()) {
    useChatStore.getState().newSession();
  }

  navigate(Path.Chat, { replace: options?.replace });
}

export function isFreshDefaultChatSession(
  session: Pick<ChatSession, "topic" | "messages" | "memoryPrompt"> | undefined,
) {
  const normalizedTopic = String(session?.topic || "").trim();
  const defaultTopics = new Set([
    "",
    DEFAULT_TOPIC,
    getDefaultTopic(),
    "新的聊天",
    "New Chat",
  ]);

  return (
    !!session &&
    session.messages.length === 0 &&
    !session.memoryPrompt &&
    defaultTopics.has(normalizedTopic)
  );
}

export function isCurrentFreshDefaultChat() {
  return isFreshDefaultChatSession(useChatStore.getState().currentSession());
}
