import { NextRequest, NextResponse } from "next/server";
import {
  createChatBackup,
  deleteChatBackup,
  deleteChatBackupConversationSnapshot,
  getChatBackupDetail,
  getChatBackupSettings,
  listChatBackups,
  listChatBackupSummaries,
  restoreChatBackupConversation,
  saveChatBackupSettings,
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

  if (!targetUserId || targetUserId === context.effective.id) {
    return targetUserId ? context.effective.externalId : undefined;
  }

  const users = await listManagedUsers();
  const target = users.find((user) => user.id === targetUserId);
  if (!target?.isActive) {
    throw new AuthError("target_user_not_found", 404);
  }

  return target.externalId;
}

async function getVisibleBackupSummary(req: NextRequest) {
  await requireAuthContext(req);
  return listChatBackupSummaries();
}

async function createAllUsersChatBackups(req: NextRequest) {
  const context = await requireWritableAuthContext(req);
  if (!isAuthBypassEnabled() && context.actor.role !== "admin") {
    throw new AuthError("forbidden", 403);
  }

  const users = (await listManagedUsers()).filter(
    (user) => user.isActive && user.externalId,
  );
  const results = [];
  for (const user of users) {
    const result = await createChatBackup(user.externalId, "manual");
    results.push({
      userId: user.id,
      externalId: user.externalId,
      username: user.username,
      displayName: user.displayName,
      ...result,
    });
  }

  return results;
}

export async function GET(req: NextRequest) {
  try {
    const searchParams = new URL(req.url).searchParams;
    const requestedUserId = searchParams.get("userId") || "";
    const userId = await resolveVisibleBackupUserId(req, requestedUserId);
    const id = searchParams.get("id") || "";
    if (id) {
      const backup = await getChatBackupDetail(
        userId,
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

    const effectiveUserId =
      requestedUserId && userId
        ? userId
        : (await requireAuthContext(req)).effective.externalId;
    const [settings, backups, summary] = await Promise.all([
      getChatBackupSettings(effectiveUserId),
      listChatBackups(userId, searchParams.get("search") || ""),
      getVisibleBackupSummary(req),
    ]);
    return NextResponse.json({ ok: true, settings, backups, summary });
  } catch (error) {
    if (isPostgresTemporarilyUnavailableError(error)) {
      console.warn(
        "[Chat Backup] ⚠️ 对话备份读取暂时不可用，返回默认设置",
        error instanceof Error ? error.message : String(error),
      );
      const searchParams = new URL(req.url).searchParams;
      const requestedUserId = searchParams.get("userId") || "";
      const userId = requestedUserId
        ? await resolveVisibleBackupUserId(req, requestedUserId)
        : undefined;
      const backups = await listChatBackups(
        userId,
        searchParams.get("search") || "",
      );
      const summary = await getVisibleBackupSummary(req);
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
      const results = await createAllUsersChatBackups(req);
      return NextResponse.json({ ok: true, results });
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

    const userId = requestedUserId
      ? await resolveRequestedBackupUserId(req, requestedUserId, true)
      : await resolveRequestedBackupUserId(req, "", true);

    const result = await createChatBackup(userId, "manual");
    return NextResponse.json({ ok: true, result });
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
