import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import { AuthError } from "@/app/utils/server/auth";
import {
  createApiConfigBackup,
  deleteApiConfigBackup,
  getApiConfigBackupPayload,
  getApiConfigBackupSettings,
  listApiConfigBackups,
  saveApiConfigBackupSettings,
} from "@/app/utils/server/api-config-backup-repository";
import {
  getStoreSnapshot,
  setStoreSnapshot,
} from "@/app/utils/server/sync-store-repository";
import { isPostgresTemporarilyUnavailableError } from "@/app/utils/server/postgres";
import {
  requireWritableSharedSyncUserId,
  resolveSharedSyncUserId,
} from "@/app/utils/server/sync-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_API_CONFIG_BACKUP_SETTINGS = {
  enabled: true,
  intervalMinutes: 1440,
  maxBackups: 10,
};

function errorResponse(error: unknown) {
  console.error(
    "[API Config] ❌ 配置备份接口执行失败",
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

export async function GET(req: NextRequest) {
  try {
    const userId = await resolveSharedSyncUserId(req);
    const [settings, backups] = await Promise.all([
      getApiConfigBackupSettings(userId),
      listApiConfigBackups(userId),
    ]);
    return NextResponse.json({ ok: true, settings, backups });
  } catch (error) {
    if (isPostgresTemporarilyUnavailableError(error)) {
      console.warn(
        "[API Config] ⚠️ 配置备份读取暂时不可用，返回空列表",
        error instanceof Error ? error.message : String(error),
      );
      return NextResponse.json(
        {
          ok: true,
          degraded: true,
          settings: DEFAULT_API_CONFIG_BACKUP_SETTINGS,
          backups: [],
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
    const userId = await requireWritableSharedSyncUserId(req);
    const body = await req.json();
    const action = String(body?.action || "backup");
    if (action === "settings") {
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
        settings: await saveApiConfigBackupSettings(userId, settings),
      });
    }
    if (action === "restore") {
      console.log("[API Config] ♻️ 服务端开始恢复配置备份", {
        备份ID: String(body.id || ""),
      });
      const payload = await getApiConfigBackupPayload(
        userId,
        String(body.id || ""),
      );
      if (!payload)
        return NextResponse.json(
          { ok: false, error: "backup_not_found" },
          { status: 404 },
        );
      const current = await getStoreSnapshot(StoreKey.Access, userId);
      if (current) {
        console.log("[API Config] 💾 恢复前正在创建保护备份...");
        await createApiConfigBackup(userId, current, "pre_restore");
      }
      await setStoreSnapshot(StoreKey.Access, payload, userId);
      console.log("[API Config] ✅ 服务端配置备份恢复完成", {
        备份ID: String(body.id || ""),
      });
      return NextResponse.json({ ok: true, payload });
    }
    const payload =
      body.payload ?? (await getStoreSnapshot(StoreKey.Access, userId));
    if (!payload)
      return NextResponse.json(
        { ok: false, error: "api_config_empty" },
        { status: 400 },
      );
    const source = action === "auto" ? "auto" : "manual";
    return NextResponse.json({
      ok: true,
      result: await createApiConfigBackup(userId, payload, source),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireWritableSharedSyncUserId(req);
    const id = new URL(req.url).searchParams.get("id") || "";
    const deleted = await deleteApiConfigBackup(userId, id);
    return NextResponse.json({ ok: deleted });
  } catch (error) {
    return errorResponse(error);
  }
}
