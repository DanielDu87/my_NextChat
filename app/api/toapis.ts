import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_BROWSER_USER_AGENT } from "./user-agent";
import { requestUpstream } from "./upstream";

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const subpath = params.path.join("/");
  const authHeader = req.headers.get("authorization");

  if (subpath !== "pricing") {
    return NextResponse.json(
      { error: "unsupported_toapis_path", path: subpath },
      { status: 404 },
    );
  }

  try {
    return await requestUpstream("https://toapis.com/api/pricing", {
      method: "GET",
      dnsServers: ["1.1.1.1", "8.8.8.8"],
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
        Accept: "application/json",
        "User-Agent": DEFAULT_BROWSER_USER_AGENT,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "toapis_fetch_failed",
        message: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 502 },
    );
  }
}
