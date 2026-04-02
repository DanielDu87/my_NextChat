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
      readOnly: false,
    });
    response.cookies.set({
      name: getEffectiveUserCookieName(),
      value: target.id,
      httpOnly: true,
      sameSite: "lax",
      secure:
        req.headers.get("x-forwarded-proto") === "https" ||
        req.nextUrl.protocol === "https:",
      maxAge: 30 * 24 * 60 * 60,
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
