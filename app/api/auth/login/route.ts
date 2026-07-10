import { NextRequest, NextResponse } from "next/server";
import {
  authenticateUser,
  createAuthSession,
  getAuthSessionCookieName,
  getAuthSessionMaxAgeSeconds,
  getEffectiveUserCookieMaxAgeSeconds,
  getEffectiveUserCookieName,
} from "@/app/utils/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// 进程内登录限流：同一用户名/IP 在 WINDOW_MS 内最多允许 ATTEMPT_LIMIT 次失败登录。
// 失败次数超限后锁定 LOCKOUT_MS，期间所有登录请求直接拒绝。
// 注意：多实例部署时应替换为 Redis 等共享存储；当前为进程内兜底，避免最暴力爆破。
const ATTEMPT_LIMIT = 5;
const WINDOW_MS = 5 * 60_000;
const LOCKOUT_MS = 15 * 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __nextchatLoginAttempts: Map<string, number[]> | undefined;
  // eslint-disable-next-line no-var
  var __nextchatLoginLockedUntil: Map<string, number> | undefined;
}

function getLoginAttemptsMap() {
  if (!globalThis.__nextchatLoginAttempts) {
    globalThis.__nextchatLoginAttempts = new Map();
  }
  return globalThis.__nextchatLoginAttempts;
}

function getLoginLockedUntilMap() {
  if (!globalThis.__nextchatLoginLockedUntil) {
    globalThis.__nextchatLoginLockedUntil = new Map();
  }
  return globalThis.__nextchatLoginLockedUntil;
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

function recordFailedAttempt(key: string): { locked: boolean } {
  const now = Date.now();
  const lockedUntilMap = getLoginLockedUntilMap();
  const lockedUntil = lockedUntilMap.get(key) || 0;
  if (lockedUntil > now) {
    return { locked: true };
  }
  const attemptsMap = getLoginAttemptsMap();
  const recent = (attemptsMap.get(key) || []).filter(
    (ts) => now - ts < WINDOW_MS,
  );
  recent.push(now);
  attemptsMap.set(key, recent);
  if (recent.length >= ATTEMPT_LIMIT) {
    lockedUntilMap.set(key, now + LOCKOUT_MS);
    attemptsMap.delete(key);
    return { locked: true };
  }
  return { locked: false };
}

function recordSuccess(key: string) {
  getLoginAttemptsMap().delete(key);
  getLoginLockedUntilMap().delete(key);
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const lockedUntil = getLoginLockedUntilMap().get(ip) || 0;
    if (lockedUntil > Date.now()) {
      const retryAfter = Math.ceil((lockedUntil - Date.now()) / 1000);
      return NextResponse.json(
        { ok: false, error: "too_many_attempts" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    const payload = (await req.json()) as {
      username?: string;
      password?: string;
    };
    const username = String(payload?.username || "")
      .trim()
      .toLowerCase();
    const throttleKey = `${ip}|${username}`;

    const user = await authenticateUser(
      username,
      String(payload?.password || ""),
    );

    if (!user) {
      const result = recordFailedAttempt(throttleKey);
      if (result.locked) {
        return NextResponse.json(
          { ok: false, error: "too_many_attempts" },
          {
            status: 429,
            headers: { "Retry-After": String(LOCKOUT_MS / 1000) },
          },
        );
      }
      return NextResponse.json(
        { ok: false, error: "用户名或密码错误" },
        { status: 401 },
      );
    }

    recordSuccess(throttleKey);

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

    response.cookies.set({
      name: getEffectiveUserCookieName(),
      value: user.id,
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
      maxAge: getEffectiveUserCookieMaxAgeSeconds(),
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
