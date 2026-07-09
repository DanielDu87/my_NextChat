import { getDefaultSyncUserId } from "./sync-user";
import { createChatBackup } from "./chat-backup-repository";
import { cleanupLegacyMainDbBackupTables } from "./postgres";

const SCHEDULER_TICK_MS = 60_000;

declare global {
  var __nextchatChatBackupSchedulerStarted: boolean | undefined;
  var __nextchatChatBackupSchedulerRunning: boolean | undefined;
}

async function runChatBackupScheduler() {
  if (globalThis.__nextchatChatBackupSchedulerRunning) return;
  globalThis.__nextchatChatBackupSchedulerRunning = true;

  try {
    const sharedUserId = getDefaultSyncUserId();
    await createChatBackup(sharedUserId, "auto");
    // 备份完成后顺带清理主业务库遗留的旧备份表（进程内只执行一次）
    await cleanupLegacyMainDbBackupTables();
  } catch (error) {
    console.error(
      "[Chat Backup Scheduler] 后台扫描失败",
      error instanceof Error ? error.stack || error.message : String(error),
    );
  } finally {
    globalThis.__nextchatChatBackupSchedulerRunning = false;
  }
}

export function startChatBackupScheduler() {
  if (globalThis.__nextchatChatBackupSchedulerStarted) return;
  globalThis.__nextchatChatBackupSchedulerStarted = true;

  console.log("[Chat Backup Scheduler] 容器服务启动，定时备份任务已启动");
  void runChatBackupScheduler();
  const timer = setInterval(
    () => void runChatBackupScheduler(),
    SCHEDULER_TICK_MS,
  );
  timer.unref();
}
