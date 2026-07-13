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
  getProviderBalanceConfig,
  listProviderBalanceConfigs,
  saveProviderBalanceConfig,
  saveProviderBalanceResult,
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
    const { sharedUserId, profiles } = await getContext(req);
    const profileId = String(
      req.nextUrl.searchParams.get("profileId") || "",
    ).trim();
    const balanceProfiles = await listProviderBalanceConfigs(sharedUserId);
    if (profileId) {
      if (!profiles.some((item) => item.id === profileId)) {
        return NextResponse.json(
          { ok: false, error: "provider_not_found" },
          { status: 404 },
        );
      }
      const profile = balanceProfiles.find(
        (item) => item.profileId === profileId,
      );
      return NextResponse.json({
        ok: true,
        balance: profile?.balance || null,
        lastError: profile?.lastError || "",
      });
    }
    return NextResponse.json({
      ok: true,
      profiles: balanceProfiles,
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
      customBalanceUrl?: string;
      useNewApiUserFormat?: boolean;
      newApiUserId?: string;
    };
    const profileId = String(payload.profileId || "").trim();
    if (!profileId)
      return NextResponse.json(
        { ok: false, error: "missing_profile_id" },
        { status: 400 },
      );
    const { profiles } = await getContext(req);
    if (!profiles.some((item) => item.id === profileId))
      return NextResponse.json(
        { ok: false, error: "provider_not_found" },
        { status: 404 },
      );

    const current = await getProviderBalanceConfig(profileId);
    if (!current) {
      return NextResponse.json(
        { ok: false, error: "provider_not_found" },
        { status: 404 },
      );
    }

    const useNewApiUserFormat =
      payload.useNewApiUserFormat ?? current.useNewApiUserFormat;
    const newApiUserId = String(
      payload.newApiUserId ?? current.newApiUserId,
    ).trim();
    if (useNewApiUserFormat && !newApiUserId) {
      return NextResponse.json(
        { ok: false, error: "missing_new_api_user_id" },
        { status: 400 },
      );
    }

    await saveProviderBalanceConfig(profileId, {
      managementKey: String(payload.managementKey ?? current.managementKey),
      customBalanceUrl: String(
        payload.customBalanceUrl ?? current.customBalanceUrl,
      ),
      useNewApiUserFormat,
      newApiUserId,
    });

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
  const queryStartedAt = Date.now();
  try {
    const payload = (await req.json()) as {
      profileId?: string;
    };
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

    const balanceConfig = await getProviderBalanceConfig(profileId);
    const managementKey = balanceConfig?.managementKey || "";
    const customBalanceUrl = balanceConfig?.customBalanceUrl || "";
    const effectiveManagementKey =
      balanceConfig?.useNewApiUserFormat && balanceConfig.newApiUserId
        ? `${managementKey}|${balanceConfig.newApiUserId}`
        : managementKey;

    try {
      // 合并 profile 和缓存路径，优先使用余额查询页面配置的管理密钥
      let customBaseUrl: string | undefined;
      let customPath: string | undefined;

      // 如果有自定义 URL，解析是完整 URL 还是路径
      if (customBalanceUrl) {
        if (
          customBalanceUrl.startsWith("http://") ||
          customBalanceUrl.startsWith("https://")
        ) {
          // 完整 URL，提取 baseUrl 和 path
          try {
            const url = new URL(customBalanceUrl);
            customBaseUrl = `${url.protocol}//${url.host}`;
            customPath = url.pathname.replace(/^\//, ""); // 移除前导斜杠
          } catch {
            // URL 解析失败，当作路径处理
            customPath = customBalanceUrl.replace(/^\//, "");
          }
        } else {
          // 只是路径，使用 profile 的 baseUrl
          customPath = customBalanceUrl.replace(/^\//, "");
        }
      }

      const queryProfile = {
        ...profile,
        apiKey: effectiveManagementKey || profile.apiKey,
        apiKeyGroups: {},
        signal: req.signal,
        // 如果有自定义 URL，优先使用；否则使用缓存路径
        ...(customBalanceUrl
          ? {
              // 自定义 URL：直接使用，只查询此路径
              cachedPath: customPath,
              cachedBaseUrl: customBaseUrl || profile.baseUrl,
              cachedAuthType: undefined,
              customUrlOnly: true,
            }
          : balanceConfig?.cachedPath
          ? {
              cachedPath: balanceConfig.cachedPath,
              cachedBaseUrl: balanceConfig.cachedBaseUrl,
              cachedAuthType: balanceConfig.cachedAuthType,
            }
          : {}),
      };

      console.log(
        `[Provider Balance] 查询配置: baseUrl=${
          profile.baseUrl
        }, 自定义URL=${!!customBalanceUrl}, 仅自定义=${!!customBalanceUrl}, 有缓存路径=${!!balanceConfig?.cachedPath}`,
      );

      const balance = await queryProviderBalanceWithRetry(queryProfile);
      const {
        attempts,
        cachedPath,
        cachedBaseUrl,
        cachedAuthType,
        ...balanceSnapshot
      } = balance;

      // 保存余额结果和缓存路径（只有非自定义URL时才更新缓存）
      if (!customBalanceUrl) {
        await saveProviderBalanceResult(
          sharedUserId,
          profileId,
          balanceSnapshot,
          "",
          {
            cachedPath,
            cachedBaseUrl,
            cachedAuthType,
            queryStartedAt,
          },
        );
      } else {
        await saveProviderBalanceResult(
          sharedUserId,
          profileId,
          balanceSnapshot,
          "",
          { queryStartedAt },
        );
      }

      return NextResponse.json({
        ok: true,
        balance: balanceSnapshot,
        attempts: attempts || [],
        cachedPath,
        cachedBaseUrl,
      });
    } catch (error) {
      const errorMessage = getProviderBalanceErrorMessage(error);
      await saveProviderBalanceResult(
        sharedUserId,
        profileId,
        null,
        errorMessage,
        { keepExistingBalance: true, queryStartedAt },
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
