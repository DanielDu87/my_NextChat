import { NextRequest, NextResponse } from "next/server";
import { pgHealthcheck } from "../../../utils/server/postgres";
import {
  getAuthContext,
  isAuthBypassEnabled,
} from "../../../utils/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// 数据库版本、库名、账号、主机属于内网信息，只返回给管理员（或本地免登录模式）。
async function canViewHealthDetails(req: NextRequest) {
  if (isAuthBypassEnabled()) return true;
  const context = await getAuthContext(req).catch(() => null);
  return context?.actor.role === "admin";
}

// 连接被拒等场景 pg 抛出 AggregateError，message 为空，需要回退到 code。
function describeError(error: unknown) {
  if (error instanceof Error) {
    return error.message || (error as any).code || error.name;
  }
  return "unknown_error";
}

export async function GET(req: NextRequest) {
  try {
    const health = await pgHealthcheck();

    if (!(await canViewHealthDetails(req))) {
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({
      ok: true,
      postgres: health,
    });
  } catch (error) {
    const showDetails = await canViewHealthDetails(req).catch(() => false);
    return NextResponse.json(
      {
        ok: false,
        error: showDetails ? describeError(error) : "postgres_unavailable",
      },
      { status: 500 },
    );
  }
}
