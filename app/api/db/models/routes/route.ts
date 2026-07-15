import { NextRequest, NextResponse } from "next/server";
import { AuthError } from "@/app/utils/server/auth";
import {
  getProviderModelKeyCachedPath,
  listProviderModelKnownCachedPaths,
} from "@/app/utils/server/provider-model-repository";
import { resolveSharedSyncUserId } from "@/app/utils/server/sync-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    await resolveSharedSyncUserId(req);
    const payload = (await req.json().catch(() => ({}))) as {
      profileId?: string;
      apiKeys?: string[];
    };
    const profileId = String(payload.profileId || "").trim();
    const apiKeys = Array.isArray(payload.apiKeys)
      ? payload.apiKeys.map((key) => String(key || "").trim()).filter(Boolean)
      : [];
    if (!profileId || apiKeys.length === 0 || apiKeys.length > 100) {
      return NextResponse.json(
        { ok: false, error: "invalid_model_route_query" },
        { status: 400 },
      );
    }

    const [routes, knownRoutes] = await Promise.all([
      Promise.all(
        apiKeys.map(async (apiKey, index) => ({
          index,
          route: await getProviderModelKeyCachedPath(profileId, apiKey),
        })),
      ),
      listProviderModelKnownCachedPaths(profileId),
    ]);
    return NextResponse.json(
      { ok: true, routes, knownRoutes },
      { headers: { "Cache-Control": "no-store" } },
    );
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
