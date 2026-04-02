import { NextRequest, NextResponse } from "next/server";
import {
  AuthError,
  getAuthContext,
  getAuthSessionCookieName,
  getEffectiveUserCookieName,
} from "@/app/utils/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const context = await getAuthContext(req);
    if (!context) {
      const response = NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
      response.cookies.delete(getAuthSessionCookieName());
      response.cookies.delete(getEffectiveUserCookieName());
      return response;
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: context.actor.id,
        username: context.actor.username,
        displayName: context.actor.displayName,
        role: context.actor.role,
      },
      effectiveUser: {
        id: context.effective.id,
        username: context.effective.username,
        displayName: context.effective.displayName,
        role: context.effective.role,
      },
      isImpersonating: context.isImpersonating,
      readOnly: context.readOnly,
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
