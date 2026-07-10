import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  isAuthBypassEnabled,
  requireAdminContext,
  requireAuthContext,
} from "@/app/utils/server/auth";
import { pgQuery } from "@/app/utils/server/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// 仅供 admin 调试 / 启动汇总使用：返回当前主库内「未删除」文件的总数（不分用户）。
// 之所以放在 /api/admin/usage-summary 而不是通用端点，是为了和 listManagedUsers
// 一样受 requireAdminContext 保护，避免泄露全库文件量给普通用户。
export async function GET(req: NextRequest) {
  try {
    if (isAuthBypassEnabled()) {
      await requireAuthContext(req);
    } else {
      await requireAdminContext(req);
    }
    const result = await pgQuery<{ file_count: string }>(
      `select count(*)::text as file_count from user_cache_files`,
    );
    const fileCount = parseInt(result.rows[0]?.file_count || "0", 10) || 0;
    return NextResponse.json({ ok: true, fileCount });
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
