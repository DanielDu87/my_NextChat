// 页面启动时的数据汇总日志。
// 首页只保留四类数据：分用户对话数、每个 API 配置的模型数、插件数、绘画数。

import { getISOLang } from "../locales";
import { ServiceProvider } from "../constant";
import { useAccessStore } from "../store/access";
import { useAppConfig } from "../store/config";
import { useModelCacheStore } from "../store/model-cache";
import { useAuthStore } from "../store/auth";
import { useChatStore } from "../store/chat";
import { usePluginStore, BUILTIN_PLUGIN_ID_SET } from "../store/plugin";

type ManagedUserSummary = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  isActive: boolean;
  conversationCount: number;
  drawingCount: number;
};

type ApiConfigSummary = {
  name: string;
  modelCount: number;
};

const LOG_PREFIX = "[Sync]";

function shouldLogUsageSummary() {
  // 不再做角色门禁：普通用户 / 本地免登录用户都允许打印汇总。
  // 实际能拉到哪些数据完全由后端 /api/admin/* 端点按角色控制；
  // 没有权限的请求会被服务端 403，前端 fetch 会拿到 null，本函数对应分支会输出
  // 「拉取失败，跳过」。这样既保留可观察性，又不绕过服务端鉴权。
  if (typeof window === "undefined") return false;
  // 至少需要登录态已初始化，否则在切换用户中途触发会拿到陈旧 user
  const authState = useAuthStore.getState();
  return Boolean(authState.user) || Boolean(authState.effectiveUser);
}

function isVisibleProfile(profile: { id?: string }) {
  return Boolean(profile?.id);
}

function normalizeModelOwner(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/^custom_/, "")
    .toLowerCase();
}

function countCachedModels(value: unknown) {
  return String(value || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean).length;
}

function buildApiConfigSummaries(): ApiConfigSummary[] {
  const accessState = useAccessStore.getState() as any;
  const allProfiles = Array.isArray(accessState?.apiProfiles)
    ? accessState.apiProfiles
    : [];
  // 与 api-config 页保持一致：只过滤有 id 的 profile，不过滤 enabled。
  const visibleProfiles = allProfiles.filter(isVisibleProfile);

  const cachedProfiles = useModelCacheStore.getState().profiles || {};
  const appModels = (useAppConfig.getState() as any).models || [];
  const customModels = String(
    (useAppConfig.getState() as any).customModels || "",
  );
  return visibleProfiles
    .map((profile: any): ApiConfigSummary => {
      const profileId = String(profile.id || "");
      const cachedProfile = cachedProfiles[profileId];
      const cachedCount =
        Number(cachedProfile?.modelCount || 0) ||
        countCachedModels(cachedProfile?.cachedModels) ||
        countCachedModels(profile.cachedModels);
      const providerId =
        profile.provider === ServiceProvider.Custom
          ? `custom_${String(profile.name || "")}`.toLowerCase()
          : profile.provider === ServiceProvider.Local
          ? `${String(profile.provider).toLowerCase()}_${String(
              profile.name || "",
            )}`.toLowerCase()
          : String(profile.provider || "").toLowerCase();
      const ownerNames = new Set(
        [profile.name, profile.provider, providerId].map(normalizeModelOwner),
      );
      const liveCount = Array.isArray(appModels)
        ? appModels.filter((model: any) => {
            const modelProviderId = normalizeModelOwner(model?.provider?.id);
            const modelProviderName = normalizeModelOwner(
              model?.provider?.providerName,
            );
            return (
              ownerNames.has(modelProviderId) ||
              ownerNames.has(modelProviderName)
            );
          }).length
        : 0;
      const customModelCount = customModels
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean)
        .filter((model) => {
          const separator = model.lastIndexOf("@");
          if (separator <= 0) return false;
          return ownerNames.has(
            normalizeModelOwner(model.slice(separator + 1)),
          );
        }).length;
      return {
        name: String(profile.name || profile.id || "未命名"),
        modelCount:
          cachedCount ||
          Number(profile.modelCount || 0) ||
          liveCount ||
          customModelCount,
      };
    })
    .sort((a: ApiConfigSummary, b: ApiConfigSummary) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
}

function countActivePlugins() {
  const pluginState = usePluginStore.getState() as any;
  const plugins = (pluginState?.plugins || {}) as Record<string, any>;
  const deletedIds = new Set(
    Array.isArray(pluginState?.deletedPluginIds)
      ? pluginState.deletedPluginIds
      : [],
  );
  const activeEntries = Object.entries(plugins).filter(
    ([id, plugin]) =>
      !deletedIds.has(id) &&
      (BUILTIN_PLUGIN_ID_SET.has(id) ||
        (plugin && (plugin.title?.trim() || plugin.content?.trim()))),
  );

  return activeEntries.length;
}

async function fetchManagedUsers(): Promise<ManagedUserSummary[] | null> {
  try {
    const response = await fetch("/api/admin/users", {
      method: "GET",
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.ok || !Array.isArray(data.users)) return null;
    return data.users as ManagedUserSummary[];
  } catch {
    return null;
  }
}

function labelForUser(user: ManagedUserSummary) {
  if (user.displayName && user.displayName !== user.username) {
    return `${user.displayName}（${user.username}）`;
  }
  return user.username || user.displayName || user.id;
}

export async function logPageOpenUsageSummary() {
  if (!shouldLogUsageSummary()) {
    return;
  }

  // 1. 每个 API 配置单独输出模型数量。
  const apiConfigs = buildApiConfigSummaries();
  console.log(`${LOG_PREFIX} ✅ API配置模型数量: ${apiConfigs.length} 个配置`);
  apiConfigs.forEach((config) => {
    console.log(`${LOG_PREFIX}   ${config.name}: ${config.modelCount} 个模型`);
  });

  // 2. 各用户对话数量 + 总绘画数量
  const users = await fetchManagedUsers();
  const authState = useAuthStore.getState();
  const currentUser = authState.effectiveUser || authState.user;
  const currentUserLabel = currentUser
    ? currentUser.displayName &&
      currentUser.displayName !== currentUser.username
      ? `${currentUser.displayName}（${currentUser.username}）`
      : currentUser.username || currentUser.displayName || currentUser.id
    : "未知用户";

  if (users && users.length > 0) {
    const sortedUsers = [...users].sort((a, b) =>
      labelForUser(a).localeCompare(labelForUser(b), getISOLang()),
    );
    const totalConversations = sortedUsers.reduce(
      (sum, u) => sum + Number(u.conversationCount || 0),
      0,
    );
    const totalDrawings = sortedUsers.reduce(
      (sum, u) => sum + Number(u.drawingCount || 0),
      0,
    );

    console.log(`${LOG_PREFIX} ✅ 对话数量: ${totalConversations} 个`);
    sortedUsers.forEach((u) => {
      const count = Number(u.conversationCount || 0);
      if (count > 0) {
        console.log(`${LOG_PREFIX}   ${labelForUser(u)}: ${count} 个`);
      }
    });
    console.log(`${LOG_PREFIX} ✅ 绘画数量:`);
    console.log(`${LOG_PREFIX}   ${totalDrawings} 个`);
  } else {
    try {
      const localSessions = useChatStore.getState().sessions || [];
      console.log(
        `${LOG_PREFIX} ✅ 对话数量: ${currentUserLabel} 共 ${localSessions.length} 个`,
      );
    } catch {
      console.log(`${LOG_PREFIX} ℹ️ 对话数量: 用户列表拉取失败，跳过`);
    }
  }

  // 4. 插件数量
  console.log(`${LOG_PREFIX} ✅ 插件数量:`);
  console.log(`${LOG_PREFIX}   ${countActivePlugins()} 个`);
}
