import { NextRequest, NextResponse } from "next/server";
import { resolveStoreSyncUserId } from "@/app/utils/server/sync-user";
import { AuthError } from "@/app/utils/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * 轻量级端点：只返回聊天数据的最新更新时间，不构建完整快照。
 * 用于跨浏览器轮询检测对话变更。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveStoreSyncUserId("chat-next-web-store", req);

    const { getPostgresPool } = await import("@/app/utils/server/postgres");
    const pool = getPostgresPool();
    const result = await pool.query<{ max_updated_at: string | null }>(
      `select max(updated_at)::text as max_updated_at
       from (
         select updated_at
         from app_settings
         where user_id = (select id from app_users where external_id = $1 limit 1)
           and chat_settings ? '__chat-index-state__'
         union all
         select updated_at
         from conversations
         where user_id = (select id from app_users where external_id = $1 limit 1)
       ) chat_updates`,
      [userId],
    );

    const updatedAt = result.rows[0]?.max_updated_at || null;

    return NextResponse.json({
      ok: true,
      updatedAt,
    });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status },
    );
  }
}
