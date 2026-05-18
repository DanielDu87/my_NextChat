import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getEffectiveUserCookieName,
  getAuthContext,
  listManagedUsers,
  requireAdminContext,
} from "@/app/utils/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const context = await requireAdminContext(req);
    const payload = (await req.json()) as {
      userId?: string;
    };
    const userId = String(payload?.userId || "").trim();

    if (!userId) {
      throw new AuthError("missing_user_id", 400);
    }

    const users = await listManagedUsers();
    const target = users.find((user) => user.id === userId);
    if (!target?.isActive) {
      throw new AuthError("target_user_not_found", 404);
    }

    const response = NextResponse.json({
      ok: true,
      effectiveUser: target,
      readOnly: true,
      isImpersonating: true,
    });

    const isHttps =
      req.headers.get("x-forwarded-proto") === "https" ||
      req.nextUrl.protocol === "https:";

    // 不设置 cookie，只在内存中切换
    // 这样刷新页面后就会恢复到管理员账户
    response.cookies.set({
      name: getEffectiveUserCookieName(),
      value: target.id,
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
      path: "/",
      // 不设置 maxAge，使其成为会话 cookie
      // 但即使是会话 cookie，刷新时也不会消失
      // 所以我们需要在前端处理
    });

    return response;
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

export async function DELETE(req: NextRequest) {
  try {
    const context = await requireAdminContext(req);
    const response = NextResponse.json({
      ok: true,
      effectiveUser: context.actor,
      readOnly: false,
    });
    response.cookies.delete(getEffectiveUserCookieName());
    return response;
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
