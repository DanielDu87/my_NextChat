import { StoreKey } from "../constant";
import { useChatStore } from "../store/chat";
import { useSyncStore } from "../store/sync";

export async function createNewChatWithSyncedModel() {
  const syncStore = useSyncStore.getState();

  if (syncStore.cloudSync?.()) {
    useSyncStore.setState({
      criticalSyncReady: false,
      criticalSyncInProgress: true,
    } as any);

    try {
      // 新对话依赖全局模型配置，先拉取最新 Config 再创建会话。
      await syncStore.sync([StoreKey.Config], {
        force: true,
        isolateQueue: true,
        broadcastChatHint: false,
      });
    } catch (error) {
      console.error("[Sync] 新建对话前同步模型选择失败:", error);
    } finally {
      useSyncStore.setState({
        criticalSyncReady: true,
        criticalSyncInProgress: false,
      } as any);
    }
  }

  return useChatStore.getState().newSession();
}
