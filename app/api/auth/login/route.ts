import { NextRequest, NextResponse } from "next/server";
import {
  authenticateUser,
  createAuthSession,
  getAuthSessionCookieName,
  getAuthSessionMaxAgeSeconds,
} from "@/app/utils/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as {
      username?: string;
      password?: string;
    };
    const user = await authenticateUser(
      String(payload?.username || ""),
      String(payload?.password || ""),
    );

    if (!user) {
      return NextResponse.json(
        { ok: false, error: "用户名或密码错误" },
        { status: 401 },
      );
    }

    const sessionToken = await createAuthSession(user.id);
    const response = NextResponse.json({
      ok: true,
      user,
    });
    const isHttps =
      req.headers.get("x-forwarded-proto") === "https" ||
      req.nextUrl.protocol === "https:";

    response.cookies.set({
      name: getAuthSessionCookieName(),
      value: sessionToken,
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
      maxAge: getAuthSessionMaxAgeSeconds(),
      path: "/",
    });

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
