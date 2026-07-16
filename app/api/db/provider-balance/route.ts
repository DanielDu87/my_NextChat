import { NextRequest, NextResponse } from "next/server";
import {
  getProviderBalanceErrorMessage,
  resolveProviderBalanceQueryTarget,
} from "@/app/utils/provider-balance";
import { AuthError } from "@/app/utils/server/auth";
import {
  ProviderBalanceQueryError,
  queryProviderBalanceWithRetry,
  sanitizeBalancePath,
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

function getUrlOrigin(value?: string) {
  try {
    return value ? new URL(value).origin : "";
  } catch {
    return "";
  }
}

export async function GET(req: NextRequest) {
  try {
    const { sharedUserId } = await getContext(req);
    const profileId = String(
      req.nextUrl.searchParams.get("profileId") || "",
    ).trim();
    const balanceProfiles = await listProviderBalanceConfigs(sharedUserId);
    if (profileId) {
      const profile = balanceProfiles.find(
        (item) => item.profileId === profileId,
      );
      if (!profile) {
        return NextResponse.json(
          { ok: false, error: "provider_not_found" },
          { status: 404 },
        );
      }
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
      useUuidQueryFormat?: boolean;
      uuidQueryValue?: string;
    };
    const profileId = String(payload.profileId || "").trim();
    if (!profileId)
      return NextResponse.json(
        { ok: false, error: "missing_profile_id" },
        { status: 400 },
      );
    await getContext(req);

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

    const useUuidQueryFormat =
      payload.useUuidQueryFormat ?? current.useUuidQueryFormat;
    const uuidQueryValue = String(
      payload.uuidQueryValue ?? current.uuidQueryValue,
    ).trim();
    if (useUuidQueryFormat && !uuidQueryValue) {
      return NextResponse.json(
        { ok: false, error: "missing_uuid_query_value" },
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
      useUuidQueryFormat,
      uuidQueryValue,
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
    const balanceProfiles = await listProviderBalanceConfigs(sharedUserId);
    const balanceConfig = balanceProfiles.find(
      (item) => item.profileId === profileId,
    );
    if (!balanceConfig) {
      return NextResponse.json(
        { ok: false, error: "provider_not_found" },
        { status: 404 },
      );
    }

    // 余额配置是全局数据库数据；访问态中没有同 ID Profile 时，仍使用
    // provider_configs 的名称和 Base URL 构造查询配置，避免 GET/POST 数据源分裂。
    const profile = profiles.find((item) => item.id === profileId) || {
      id: balanceConfig.profileId,
      name: balanceConfig.profileName,
      provider: "Custom",
      baseUrl: balanceConfig.baseUrl,
      apiKey: "",
      enabled: true,
    };
    const managementKey = balanceConfig?.managementKey || "";
    const customBalanceUrl = balanceConfig?.customBalanceUrl || "";
    const effectiveManagementKey =
      balanceConfig?.useNewApiUserFormat && balanceConfig.newApiUserId
        ? `${managementKey}|${balanceConfig.newApiUserId}`
        : managementKey;

    try {
      // 合并 profile 和缓存路径，优先使用余额查询页面配置的管理密钥
      const customTarget = resolveProviderBalanceQueryTarget(
        customBalanceUrl,
        profile.baseUrl,
      );
      const customBaseUrl = customBalanceUrl ? customTarget.baseUrl : undefined;
      const customPath = customBalanceUrl ? customTarget.path : undefined;
      const hasFixedCustomPath = customTarget.hasExplicitPath;
      const useUuidQueryFormat = balanceConfig?.useUuidQueryFormat ?? false;
      const uuidQueryValue = balanceConfig?.uuidQueryValue ?? "";
      // 旧配置未保存完整 URL 时，继续优先使用此前成功的缓存路径，避免回归为全量探测。
      const canReuseCachedPath =
        Boolean(balanceConfig?.cachedPath) &&
        (!customBaseUrl ||
          !balanceConfig?.cachedBaseUrl ||
          getUrlOrigin(customBaseUrl) ===
            getUrlOrigin(balanceConfig.cachedBaseUrl));
      const queryProfile = {
        ...profile,
        baseUrl: customBaseUrl || profile.baseUrl,
        apiKey: effectiveManagementKey || profile.apiKey,
        apiKeyGroups: {},
        signal: req.signal,
        useUuidQueryFormat,
        uuidQueryValue,
        // UUID 格式有固定 POST body，必须优先走服务端 UUID 分支；
        // 其他已保存完整 URL 才按原样直查，旧配置继续保留兼容路径。
        ...(useUuidQueryFormat
          ? {}
          : customBalanceUrl
          ? {
              cachedPath: customPath,
              cachedBaseUrl: customBaseUrl || profile.baseUrl,
              cachedAuthType: balanceConfig.cachedAuthType,
              customUrlOnly: true,
            }
          : canReuseCachedPath
          ? {
              cachedPath: balanceConfig.cachedPath,
              cachedBaseUrl: balanceConfig.cachedBaseUrl,
              cachedAuthType: balanceConfig.cachedAuthType,
            }
          : {}),
      };

      console.log(
        `[Provider Balance] 查询配置：指定 URL=${!!customBalanceUrl}，固定路径=${hasFixedCustomPath}，有缓存路径=${!!balanceConfig?.cachedPath}`,
      );

      const balance = await queryProviderBalanceWithRetry(queryProfile);
      const {
        attempts,
        cachedPath,
        cachedBaseUrl,
        cachedAuthType,
        ...balanceSnapshot
      } = balance;

      // 所有成功模式都保存真实路径、Base URL 与认证方式，下次优先直查。
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

      return NextResponse.json({
        ok: true,
        balance: balanceSnapshot,
        attempts: (attempts || []).map((attempt) => ({
          ...attempt,
          path: sanitizeBalancePath(attempt.path),
        })),
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
            error instanceof ProviderBalanceQueryError
              ? error.attempts.map((attempt) => ({
                  ...attempt,
                  path: sanitizeBalancePath(attempt.path),
                }))
              : [],
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
