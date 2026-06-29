import { StoreKey } from "@/app/constant";
import { createApiConfigBackup } from "./api-config-backup-repository";
import { getStoreSnapshot } from "./sync-store-repository";
import { getDefaultSyncUserId } from "./sync-user";

const SCHEDULER_TICK_MS = 60_000;

declare global {
  var __nextchatApiConfigBackupSchedulerStarted: boolean | undefined;
  var __nextchatApiConfigBackupSchedulerRunning: boolean | undefined;
}

async function runApiConfigBackupScheduler() {
  if (globalThis.__nextchatApiConfigBackupSchedulerRunning) return;
  globalThis.__nextchatApiConfigBackupSchedulerRunning = true;

  try {
    const sharedUserId = getDefaultSyncUserId();
    const payload = await getStoreSnapshot(StoreKey.Access, sharedUserId);
    if (payload !== undefined) {
      await createApiConfigBackup(sharedUserId, payload, "auto");
    }
  } catch (error) {
    console.error(
      "[API Config Backup Scheduler] 后台扫描失败",
      error instanceof Error ? error.stack || error.message : String(error),
    );
  } finally {
    globalThis.__nextchatApiConfigBackupSchedulerRunning = false;
  }
}

export function startApiConfigBackupScheduler() {
  if (globalThis.__nextchatApiConfigBackupSchedulerStarted) return;
  globalThis.__nextchatApiConfigBackupSchedulerStarted = true;

  console.log("[API Config Backup Scheduler] 容器服务启动，定时备份任务已启动");
  void runApiConfigBackupScheduler();
  const timer = setInterval(
    () => void runApiConfigBackupScheduler(),
    SCHEDULER_TICK_MS,
  );
  timer.unref();
}
