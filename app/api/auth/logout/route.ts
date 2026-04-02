import { NextRequest, NextResponse } from "next/server";
import {
  getAuthSessionCookieName,
  getEffectiveUserCookieName,
  revokeAuthSession,
} from "@/app/utils/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const sessionToken = req.cookies.get(getAuthSessionCookieName())?.value;
    await revokeAuthSession(sessionToken);

    const response = NextResponse.json({ ok: true });
    response.cookies.delete(getAuthSessionCookieName());
    response.cookies.delete(getEffectiveUserCookieName());
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}
