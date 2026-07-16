import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  createChatBackup,
  createChatBackupBatch,
  deleteChatBackup,
  deleteChatBackupConversationSnapshot,
  getChatBackupDetail,
  getChatBackupSettings,
  listChatBackups,
  listChatBackupSummaries,
  restoreChatBackupConversation,
  saveChatBackupSettings,
  saveChatBackupBatchMember,
} from "@/app/utils/server/chat-backup-repository";
import {
  AuthError,
  isAuthBypassEnabled,
  listManagedUsers,
  requireAuthContext,
  requireWritableAuthContext,
} from "@/app/utils/server/auth";
import { isPostgresTemporarilyUnavailableError } from "@/app/utils/server/postgres";

const DEFAULT_CHAT_BACKUP_SETTINGS = {
  enabled: true,
  intervalMinutes: 1440,
  maxBackups: 30,
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  console.error(
    "[Chat Backup] 接口执行失败",
    error instanceof Error ? error.stack || error.message : String(error),
  );
  return NextResponse.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : "unknown_error",
    },
    { status: error instanceof AuthError ? error.status : 500 },
  );
}

async function resolveRequestedBackupUserId(
  req: NextRequest,
  requestedUserId: string,
  writable: boolean,
) {
  const context = writable
    ? await requireWritableAuthContext(req)
    : await requireAuthContext(req);
  const targetUserId = requestedUserId.trim();

  if (!targetUserId || targetUserId === context.effective.id) {
    return context.effective.externalId;
  }

  if (!isAuthBypassEnabled() && context.actor.role !== "admin") {
    throw new AuthError("forbidden", 403);
  }

  const users = await listManagedUsers();
  const target = users.find((user) => user.id === targetUserId);
  if (!target?.isActive) {
    throw new AuthError("target_user_not_found", 404);
  }

  return target.externalId;
}

async function resolveVisibleBackupUserId(
  req: NextRequest,
  requestedUserId: string,
) {
  const context = await requireAuthContext(req);
  const targetUserId = requestedUserId.trim();

  // 不传 userId 时只能看自己的备份；管理员或 bypass 模式下显式传 userId 才能看他人备份
  if (!targetUserId) {
    return context.effective.externalId;
  }

  if (targetUserId === context.effective.id) {
    return context.effective.externalId;
  }

  // 看他人备份需要管理员角色（生产）或 bypass 模式
  if (!isAuthBypassEnabled() && context.actor.role !== "admin") {
    throw new AuthError("forbidden", 403);
  }

  const users = await listManagedUsers();
  const target = users.find((user) => user.id === targetUserId);
  if (!target?.isActive) {
    throw new AuthError("target_user_not_found", 404);
  }

  return target.externalId;
}

async function createAllUsersChatBackups(req: NextRequest) {
  await requireWritableAuthContext(req);

  const users = (await listManagedUsers()).filter(
    (user) => user.isActive && user.externalId,
  );
  const results: Array<Record<string, unknown>> = [];
  const batchId = randomUUID();
  await createChatBackupBatch(batchId, "manual");
  for (const user of users) {
    try {
      const result = await createChatBackup(user.externalId, "manual", {
        batchId,
      });
      const status = result.created ? "created" : "skipped";
      await saveChatBackupBatchMember(batchId, {
        userId: user.id,
        externalUserId: user.externalId,
        status,
        reason: result.reason,
        sessionCount: result.sessionCount,
        messageCount: result.messageCount,
      });
      results.push({
        userId: user.id,
        externalId: user.externalId,
        username: user.username,
        displayName: user.displayName,
        status,
        ...result,
      });
    } catch (error) {
      await saveChatBackupBatchMember(batchId, {
        userId: user.id,
        externalUserId: user.externalId,
        status: "failed",
        reason: "backup_failed",
      });
      results.push({
        userId: user.id,
        externalId: user.externalId,
        username: user.username,
        displayName: user.displayName,
        status: "failed",
        created: false,
        reason: "backup_failed",
      });
      console.error(
        "[Chat Backup] 单个用户手动备份失败",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return { batchId, results };
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = new URL(req.url).searchParams;
    const requestedUserId = searchParams.get("userId") || "";
    const context = await requireAuthContext(req);
    const id = searchParams.get("id") || "";
    if (id) {
      const backup = await getChatBackupDetail(
        undefined,
        id,
        searchParams.get("search") || "",
      );
      if (!backup) {
        return NextResponse.json(
          { ok: false, error: "backup_not_found" },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, backup });
    }

    const effectiveUserId = requestedUserId
      ? await resolveRequestedBackupUserId(req, requestedUserId, false)
      : context.effective.externalId;
    const [settings, backups, summary] = await Promise.all([
      getChatBackupSettings(effectiveUserId),
      // 备份历史是全局审计视图，进入页面的任何用户都看到所有备份批次。
      listChatBackups(undefined, searchParams.get("search") || ""),
      listChatBackupSummaries(),
    ]);
    return NextResponse.json({ ok: true, settings, backups, summary });
  } catch (error) {
    if (isPostgresTemporarilyUnavailableError(error)) {
      console.warn(
        "[Chat Backup] ⚠️ 对话备份读取暂时不可用，返回默认设置",
        error instanceof Error ? error.message : String(error),
      );
      const searchParams = new URL(req.url).searchParams;
      const backups = await listChatBackups(
        undefined,
        searchParams.get("search") || "",
      );
      const summary = await listChatBackupSummaries();
      return NextResponse.json(
        {
          ok: true,
          degraded: true,
          settings: DEFAULT_CHAT_BACKUP_SETTINGS,
          backups,
          summary,
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body?.action || "backup");
    const requestedUserId = String(body?.userId || "");

    if (action === "settings") {
      const userId = requestedUserId
        ? await resolveRequestedBackupUserId(req, requestedUserId, true)
        : await resolveRequestedBackupUserId(req, "", true);
      const settings = {
        enabled: Boolean(body.enabled),
        intervalMinutes: Math.max(
          1,
          Math.min(525600, Number(body.intervalMinutes) || 1),
        ),
        maxBackups: Math.max(1, Math.min(100, Number(body.maxBackups) || 1)),
      };
      return NextResponse.json({
        ok: true,
        settings: await saveChatBackupSettings(userId, settings),
      });
    }

    if (action === "backup-all") {
      const result = await createAllUsersChatBackups(req);
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "restore-conversation") {
      await requireAuthContext(req);
      const userId = requestedUserId
        ? await resolveVisibleBackupUserId(req, requestedUserId)
        : undefined;
      const result = await restoreChatBackupConversation({
        externalUserId: userId,
        backupId: String(body?.backupId || ""),
        externalSessionId: String(body?.externalSessionId || ""),
      });
      if (!result) {
        return NextResponse.json(
          { ok: false, error: "conversation_snapshot_not_found" },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, result });
    }

    // 兼容旧调用：未声明 action 的手动备份同样固定覆盖所有活动用户。
    const result = await createAllUsersChatBackups(req);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const context = await requireWritableAuthContext(req);
    const searchParams = new URL(req.url).searchParams;
    const requestedUserId = searchParams.get("userId") || "";
    const backupId = searchParams.get("id") || "";
    const externalSessionId = searchParams.get("externalSessionId") || "";
    const userId = requestedUserId
      ? await resolveRequestedBackupUserId(req, requestedUserId, true)
      : isAuthBypassEnabled() || context.actor.role === "admin"
      ? undefined
      : context.effective.externalId;

    const deleted = externalSessionId
      ? await deleteChatBackupConversationSnapshot({
          externalUserId: userId,
          backupId,
          externalSessionId,
        })
      : await deleteChatBackup(userId, backupId);

    return NextResponse.json({ ok: deleted });
  } catch (error) {
    return errorResponse(error);
  }
}
