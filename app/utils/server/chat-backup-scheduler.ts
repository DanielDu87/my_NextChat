import { listManagedUsers } from "./auth";
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
    // 必须遍历所有启用用户而非只备份默认用户，否则其他用户的对话永远不会被自动备份
    const users = (await listManagedUsers()).filter(
      (user) => user.isActive && user.externalId,
    );
    let succeeded = 0;
    let failed = 0;
    for (const user of users) {
      try {
        await createChatBackup(user.externalId, "auto");
        succeeded += 1;
      } catch (userError) {
        failed += 1;
        console.error(
          `[Chat Backup Scheduler] 用户 ${user.username}(${user.id}) 备份失败`,
          userError instanceof Error
            ? userError.stack || userError.message
            : String(userError),
        );
      }
    }
    if (users.length > 0) {
      console.log(
        `[Chat Backup Scheduler] 本轮备份完成：${succeeded} 成功 / ${failed} 失败 / 共 ${users.length} 用户`,
      );
    }
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
