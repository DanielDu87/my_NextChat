import { useChatStore } from "../store/chat";
import { DEFAULT_TOPIC, getDefaultTopic } from "../store/chat-defaults";

export async function createNewChatWithSyncedModel() {
  return useChatStore.getState().newSession();
}

export function isCurrentFreshDefaultChat() {
  const chatStore = useChatStore.getState();
  const currentSession = chatStore.currentSession();
  const normalizedTopic = String(currentSession?.topic || "").trim();
  const defaultTopics = new Set([
    "",
    DEFAULT_TOPIC,
    getDefaultTopic(),
    "新的聊天",
    "New Chat",
  ]);

  return (
    !!currentSession &&
    currentSession.messages.length === 0 &&
    !currentSession.memoryPrompt &&
    defaultTopics.has(normalizedTopic)
  );
}
