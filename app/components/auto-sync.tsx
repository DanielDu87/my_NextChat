"use client";

import { useEffect, useRef } from "react";
import { useSyncStore } from "../store/sync";

let autoSyncStarted = false;
let autoSyncPromise: Promise<void> | null = null;

export default function AutoSync() {
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) {
      return;
    }
    hasRunRef.current = true;

    const startAutoSync = async () => {
      if (autoSyncPromise) {
        return autoSyncPromise;
      }

      autoSyncPromise = new Promise<void>((resolve) => {
        const tick = async () => {
          const syncStore = useSyncStore.getState();
          if (!syncStore._hasHydrated || !syncStore.provider) {
            return;
          }

          if (autoSyncStarted) {
            resolve();
            return;
          }

          autoSyncStarted = true;

          try {
            await syncStore.sync();
          } catch (error) {
            console.error("[AutoSync] 同步失败:", error);
          } finally {
            syncStore.markSyncTime();
            resolve();
          }
        };

        const intervalId = setInterval(() => {
          void tick();
          if (autoSyncStarted) {
            clearInterval(intervalId);
          }
        }, 200);

        void tick().finally(() => {
          if (autoSyncStarted) {
            clearInterval(intervalId);
          }
        });
      }).finally(() => {
        autoSyncPromise = null;
      });

      return autoSyncPromise;
    };

    void startAutoSync();

    return () => undefined;
  }, []);

  return null;
}
