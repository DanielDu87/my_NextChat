import { NextRequest, NextResponse } from "next/server";
import { getProviderBalanceErrorMessage } from "@/app/utils/provider-balance";
import { AuthError } from "@/app/utils/server/auth";
import {
  ProviderBalanceQueryError,
  queryProviderBalanceWithRetry,
} from "@/app/utils/server/provider-balance";
import { getProviderProfilesForAccessState } from "@/app/utils/server/provider-config-repository";
import { resolveSyncUserId } from "@/app/utils/server/sync-user";
import { resolveSharedSyncUserId } from "@/app/utils/server/sync-user";
import { getOrCreateSyncAppUserId } from "@/app/utils/server/sync-app-user";
import {
  getProviderManagementKey,
  listProviderBalanceConfigs,
  saveProviderBalanceResult,
  saveProviderManagementKey,
} from "@/app/utils/server/provider-balance-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getContext(req: NextRequest) {
  const externalUserId = await resolveSyncUserId(req);
  const sharedUserId = await getOrCreateSyncAppUserId(
    await resolveSharedSyncUserId(req),
  );
  return {
    sharedUserId,
    profiles: await getProviderProfilesForAccessState(externalUserId),
  };
}

export async function GET(req: NextRequest) {
  try {
    const { sharedUserId } = await getContext(req);
    return NextResponse.json({
      ok: true,
      profiles: await listProviderBalanceConfigs(sharedUserId),
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

export async function PUT(req: NextRequest) {
  try {
    const payload = (await req.json()) as {
      profileId?: string;
      managementKey?: string;
    };
    const profileId = String(payload.profileId || "").trim();
    if (!profileId)
      return NextResponse.json(
        { ok: false, error: "missing_profile_id" },
        { status: 400 },
      );
    const { sharedUserId, profiles } = await getContext(req);
    if (!profiles.some((item) => item.id === profileId))
      return NextResponse.json(
        { ok: false, error: "provider_not_found" },
        { status: 404 },
      );
    await saveProviderManagementKey(
      sharedUserId,
      profileId,
      String(payload.managementKey || ""),
    );
    return NextResponse.json({ ok: true });
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

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as { profileId?: string };
    const profileId = String(payload.profileId || "").trim();
    if (!profileId) {
      return NextResponse.json(
        { ok: false, error: "missing_profile_id" },
        { status: 400 },
      );
    }

    const { sharedUserId, profiles } = await getContext(req);
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      return NextResponse.json(
        { ok: false, error: "provider_not_found" },
        { status: 404 },
      );
    }

    const managementKey = await getProviderManagementKey(
      sharedUserId,
      profileId,
    );
    try {
      // 对于 Yuto，必须使用页面配置的管理密钥
      const isYuto =
        profile.baseUrl &&
        (profile.baseUrl.includes("gptapi.asia") ||
          profile.baseUrl.includes("yutoai.net"));

      if (isYuto && !managementKey) {
        throw new Error(
          "Yuto 尚未配置管理 API Key，请使用 API_Key|User_ID 格式保存",
        );
      }

      // 优先使用余额查询页面配置的管理密钥，如果没有才使用对话密钥
      const queryProfile = managementKey
        ? { ...profile, apiKey: managementKey, apiKeyGroups: {} }
        : profile;
      const balance = await queryProviderBalanceWithRetry(queryProfile);
      const { attempts, ...balanceSnapshot } = balance;
      await saveProviderBalanceResult(sharedUserId, profileId, balanceSnapshot);
      return NextResponse.json({
        ok: true,
        balance: balanceSnapshot,
        attempts: attempts || [],
      });
    } catch (error) {
      const errorMessage = getProviderBalanceErrorMessage(error);
      await saveProviderBalanceResult(
        sharedUserId,
        profileId,
        null,
        errorMessage,
        { keepExistingBalance: true },
      );
      // 读取当前的余额配置来返回给前端
      const currentConfigs = await listProviderBalanceConfigs(sharedUserId);
      const currentConfig = currentConfigs.find(
        (c) => c.profileId === profileId,
      );
      return NextResponse.json(
        {
          ok: false,
          error: errorMessage,
          balance: currentConfig?.balance,
          attempts:
            error instanceof ProviderBalanceQueryError ? error.attempts : [],
        },
        { status: 502 },
      );
    }
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 502;
    return NextResponse.json(
      {
        ok: false,
        error: getProviderBalanceErrorMessage(error),
        attempts:
          error instanceof ProviderBalanceQueryError ? error.attempts : [],
      },
      { status },
    );
  }
}
