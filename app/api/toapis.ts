import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_BROWSER_USER_AGENT } from "./user-agent";

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
    const response = await fetch("https://toapis.com/api/pricing", {
      method: "GET",
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
        Accept: "application/json",
        "User-Agent": DEFAULT_BROWSER_USER_AGENT,
      },
      redirect: "manual",
    });

    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.delete("www-authenticate");
    headers.set("X-Accel-Buffering", "no");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
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
