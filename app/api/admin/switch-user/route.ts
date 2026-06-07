import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getEffectiveUserCookieName,
  getEffectiveUserCookieMaxAgeSeconds,
  listManagedUsers,
  requireAuthContext,
} from "@/app/utils/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
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

    // 任意已登录用户均可切换到其他用户
    await requireAuthContext(req);

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
