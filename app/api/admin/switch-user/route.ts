import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getEffectiveUserCookieName,
  getEffectiveUserCookieMaxAgeSeconds,
  isAuthBypassEnabled,
  listManagedUsers,
  requireAdminContext,
  requireAuthContext,
} from "@/app/utils/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    // 切换用户（impersonate）属于高危操作，必须由管理员发起并记录审计日志。
    // 本地免登录（NEXTCHAT_DISABLE_AUTH=true）模式视为开发环境，与 chat-backups 等
    // 端点保持一致：bypass 模式下任何已登录用户都能切换，避免本地 ccc 被 403 阻断。
    const context = isAuthBypassEnabled()
      ? await requireAuthContext(req)
      : await requireAdminContext(req);

    const payload = (await req.json()) as {
      userId?: string;
      password?: string;
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

    // 审计日志：记录谁切换到哪个用户，便于事后追责
    console.info(
      `[SwitchUser] admin=${context.actor.username}(${
        context.actor.id
      }) switched to target=${target.username}(${target.id}) from ip=${
        req.headers.get("x-forwarded-for") ||
        req.headers.get("x-real-ip") ||
        "unknown"
      }`,
    );

    const response = NextResponse.json({
      ok: true,
      effectiveUser: target,
      readOnly: false,
      isImpersonating: true,
    });

    const isHttps =
      req.headers.get("x-forwarded-proto") === "https" ||
      req.nextUrl.protocol === "https:";

    response.cookies.set({
      name: getEffectiveUserCookieName(),
      value: target.id,
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
      maxAge: getEffectiveUserCookieMaxAgeSeconds(),
      path: "/",
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
    const context = await requireAuthContext(req);
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
