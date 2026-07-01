import { useEffect, useState } from "react";

import {
  AUTO_SYNC_CHANNEL_NAME,
  STARTUP_CHAT_SYNC_STATUS_KEY,
  STARTUP_CHAT_SYNC_STATUS_MESSAGE_TYPE,
  StartupChatSyncStatus,
} from "./sync-tab-coordination";

export const STARTUP_CHAT_SYNC_WAIT_MS = 30_000;
export const STARTUP_CHAT_SYNC_STATUS_EVENT =
  "nextchat:startup-chat-sync-status";

export function publishStartupChatSyncStatus(
  status: StartupChatSyncStatus["status"],
  channel?: BroadcastChannel | null,
) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: StartupChatSyncStatus = {
    status,
    updatedAt: Date.now(),
  };

  try {
    window.localStorage.setItem(
      STARTUP_CHAT_SYNC_STATUS_KEY,
      JSON.stringify(payload),
    );
  } catch {}

  try {
    channel?.postMessage({
      type: STARTUP_CHAT_SYNC_STATUS_MESSAGE_TYPE,
      ...payload,
    });
  } catch {}

  // storage 事件不会在当前标签页触发，补一个同页事件让侧边栏即时刷新。
  try {
    window.dispatchEvent(
      new CustomEvent(STARTUP_CHAT_SYNC_STATUS_EVENT, { detail: payload }),
    );
  } catch {}
}

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
    const onStorage = (event: StorageEvent) => {
      if (event.key === STARTUP_CHAT_SYNC_STATUS_KEY) {
        readStatus();
      }
    };
    window.addEventListener("storage", onStorage);
    const onCurrentTabStatus = (event: Event) => {
      const detail = (event as CustomEvent<StartupChatSyncStatus>).detail;
      if (
        detail &&
        ["syncing", "done", "error"].includes(detail.status) &&
        Number.isFinite(detail.updatedAt)
      ) {
        setStartupChatSyncStatus(detail);
      }
    };
    window.addEventListener(STARTUP_CHAT_SYNC_STATUS_EVENT, onCurrentTabStatus);

    return () => {
      channel?.removeEventListener("message", onMessage);
      channel?.close();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(
        STARTUP_CHAT_SYNC_STATUS_EVENT,
        onCurrentTabStatus,
      );
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
