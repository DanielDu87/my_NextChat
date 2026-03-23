import { NextRequest } from "next/server";
import { handle as proxyHandler } from "../../proxy";

async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  return proxyHandler(req, {
    params: {
      path: params.path,
    },
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
