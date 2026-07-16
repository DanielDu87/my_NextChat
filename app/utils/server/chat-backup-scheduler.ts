import { listManagedUsers } from "./auth";
import {
  createChatBackup,
  createChatBackupBatch,
  saveChatBackupBatchMember,
} from "./chat-backup-repository";
import { cleanupLegacyMainDbBackupTables } from "./postgres";
import { randomUUID } from "crypto";

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
    const userResults: Array<{
      name: string;
      status:
        | "created"
        | "interval"
        | "no_changes"
        | "disabled"
        | "other"
        | "failed";
      sessions?: number;
      messages?: number;
      error?: string;
    }> = [];
    // 一次扫描代表一个全员自动备份轮次，即使部分用户因间隔或无变更跳过也可追溯。
    const batchId = randomUUID();
    await createChatBackupBatch(batchId, "auto");
    for (const user of users) {
      const userName =
        user.displayName || user.username || user.externalId || "未知用户";
      try {
        const result = await createChatBackup(user.externalId, "auto", {
          batchId,
        });
        if (result.created) {
          userResults.push({
            name: userName,
            status: "created",
            sessions: result.sessionCount,
            messages: result.messageCount,
          });
          await saveChatBackupBatchMember(batchId, {
            userId: user.id,
            externalUserId: user.externalId,
            status: "created",
            sessionCount: result.sessionCount,
            messageCount: result.messageCount,
          });
        } else if (result.reason === "interval") {
          userResults.push({ name: userName, status: "interval" });
        } else if (result.reason === "no_changes") {
          userResults.push({ name: userName, status: "no_changes" });
        } else if (result.reason === "disabled") {
          userResults.push({ name: userName, status: "disabled" });
        } else {
          userResults.push({ name: userName, status: "other" });
        }
        if (!result.created) {
          await saveChatBackupBatchMember(batchId, {
            userId: user.id,
            externalUserId: user.externalId,
            status: "skipped",
            reason: result.reason || "other",
          });
        }
      } catch (userError) {
        userResults.push({
          name: userName,
          status: "failed",
          error:
            userError instanceof Error ? userError.message : String(userError),
        });
        await saveChatBackupBatchMember(batchId, {
          userId: user.id,
          externalUserId: user.externalId,
          status: "failed",
          reason: "backup_failed",
        });
      }
    }
    if (users.length > 0) {
      const created = userResults.filter((r) => r.status === "created").length;
      const skipped = userResults.filter((r) =>
        ["interval", "no_changes", "disabled", "other"].includes(r.status),
      ).length;
      const failed = userResults.filter((r) => r.status === "failed").length;
      console.log(
        `[Chat Backup Scheduler] 本轮扫描完成（${created} 已创建 / ${skipped} 跳过 / ${failed} 失败 / 共 ${users.length} 用户）：`,
      );
      userResults.forEach((r) => {
        if (r.status === "created") {
          console.log(
            `  - ${r.name}：已创建（${r.sessions} 会话 / ${r.messages} 消息）`,
          );
        } else if (r.status === "failed") {
          console.error(`  - ${r.name}：失败 - ${r.error}`);
        } else {
          const reasons: Record<string, string> = {
            interval: "未到间隔",
            no_changes: "无变更",
            disabled: "已关闭",
            other: "其他跳过",
          };
          console.log(
            `  - ${r.name}：跳过（${reasons[r.status] || r.status}）`,
          );
        }
      });
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
