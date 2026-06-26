import { useEffect, useState } from "react";

import {
  AUTO_SYNC_CHANNEL_NAME,
  STARTUP_CHAT_SYNC_STATUS_KEY,
  STARTUP_CHAT_SYNC_STATUS_MESSAGE_TYPE,
  StartupChatSyncStatus,
} from "./sync-tab-coordination";

export const STARTUP_CHAT_SYNC_WAIT_MS = 30_000;

export function useStartupChatSyncStatus() {
  const [startupChatSyncStatus, setStartupChatSyncStatus] =
    useState<StartupChatSyncStatus | null>(null);

  useEffect(() => {
    const readStatus = () => {
      try {
        const raw = window.localStorage.getItem(STARTUP_CHAT_SYNC_STATUS_KEY);
        if (!raw) {
          return;
        }

        const parsed = JSON.parse(raw) as StartupChatSyncStatus;
        if (
          parsed &&
          ["syncing", "done", "error"].includes(parsed.status) &&
          Number.isFinite(parsed.updatedAt)
        ) {
          setStartupChatSyncStatus(parsed);
        }
      } catch {}
    };

    readStatus();

    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(AUTO_SYNC_CHANNEL_NAME)
        : null;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== STARTUP_CHAT_SYNC_STATUS_MESSAGE_TYPE) {
        return;
      }

      setStartupChatSyncStatus({
        status: event.data.status,
        updatedAt: event.data.updatedAt,
      });
    };
    channel?.addEventListener("message", onMessage);

    return () => {
      channel?.removeEventListener("message", onMessage);
      channel?.close();
    };
  }, []);

  return startupChatSyncStatus;
}

export function isChatListStartupLoading(params: {
  initialized: boolean;
  chatStoreHydrated: boolean;
  totalChatCount: number;
  allSessionCount: number;
  initialEmptyListGuard?: boolean;
  startupChatSyncStatus: StartupChatSyncStatus | null;
  now?: number;
  fallbackStartAt?: number;
}) {
  const now = params.now ?? Date.now();
  const fallbackStartAt =
    params.fallbackStartAt ??
    (typeof performance !== "undefined" ? performance.timeOrigin : now);

  return (
    !params.initialized ||
    (!params.chatStoreHydrated &&
      params.totalChatCount === 0 &&
      params.allSessionCount === 0) ||
    (!!params.initialEmptyListGuard && params.totalChatCount === 0) ||
    (params.totalChatCount === 0 &&
      (!params.startupChatSyncStatus ||
        params.startupChatSyncStatus.status === "syncing") &&
      now - (params.startupChatSyncStatus?.updatedAt ?? fallbackStartAt) <
        STARTUP_CHAT_SYNC_WAIT_MS)
  );
}
