import { NextRequest, NextResponse } from "next/server";
import { StoreKey } from "@/app/constant";
import { AuthError } from "@/app/utils/server/auth";
import {
  buildApiConfigBackupPayload,
  createApiConfigBackup,
  deleteApiConfigBackup,
  getApiConfigBackupPayload,
  getApiConfigBackupSettings,
  listApiConfigBackups,
  readBalanceEntriesFromPayload,
  saveApiConfigBackupSettings,
  writeApiConfigBalanceEntries,
  normalizeApiConfigBackupState,
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
        const currentPayload = await buildApiConfigBackupPayload(
          userId,
          current,
        );
        await createApiConfigBackup(userId, currentPayload, "pre_restore");
      }
      // 兼容 V1（双层 {state:{state:{apiProfiles:...}}}）和 V2（单层 {state:{apiProfiles:...}}）
      // 的备份格式：使用 normalizeApiConfigBackupState 统一剥壳，去除 V1 的双层 state。
      const state = normalizeApiConfigBackupState(payload);
      await setStoreSnapshot(StoreKey.Access, state, userId);
      const balanceEntries = readBalanceEntriesFromPayload(payload);
      if (balanceEntries.length > 0) {
        console.log("[API Config] ♻️ 同步恢复供应商余额条目", {
          条目数量: balanceEntries.length,
        });
        await writeApiConfigBalanceEntries(userId, balanceEntries);
      } else {
        console.log(
          "[API Config] ♻️ 备份未携带余额条目，仅恢复 access-control",
        );
      }
      console.log("[API Config] ✅ 服务端配置备份恢复完成", {
        备份ID: String(body.id || ""),
        恢复余额条目: balanceEntries.length,
      });
      return NextResponse.json({ ok: true, payload });
    }
    const payload = await (async () => {
      if (body.payload) return body.payload;
      const currentState = await getStoreSnapshot(StoreKey.Access, userId);
      if (!currentState) return undefined;
      return buildApiConfigBackupPayload(userId, currentState);
    })();
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
