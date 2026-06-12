import { useChatStore } from "../store/chat";

export async function createNewChatWithSyncedModel() {
  return useChatStore.getState().newSession();
}
