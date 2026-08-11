import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import CloseIcon from "../icons/close.svg";
import ConfirmIcon from "../icons/confirm.svg";
import ReloadIcon from "../icons/reload.svg";
import AddIcon from "../icons/add.svg";
import TrashIcon from "../icons/trash.svg";
import { Path, ServiceProvider, StoreKey } from "../constant";
import { useAccessStore, useAppConfig } from "../store";
import { useModelCacheStore } from "../store/model-cache";
import { useSyncStore } from "../store/sync";
import { getClientApi } from "../client/api";
import {
  cacheProviderBalanceProfiles,
  getProviderBalanceErrorMessage,
  hasExplicitProviderBalancePath,
  loadProviderBalanceProfiles,
  queryProviderBalanceProfile,
  readCachedProviderBalance,
  readCachedProviderBalanceProfiles,
  saveProviderBalanceConfig,
  type ProviderBalanceProfile,
  type ProviderBalanceAttempt,
} from "../utils/provider-balance";
import { prepareRouteEntryForSync } from "../utils/route-sync-entry";
import { syncProfileModels } from "../utils/provider-sync";
import { isAbortLikeError } from "../utils/stale-revalidate";
import { logger } from "../utils/logger";
import { IconButton } from "./button";
import { showConfirm, showToast } from "./ui-lib";
import styles from "./provider-balances.module.scss";

type QueryStatus =
  | {
      type: "querying";
      text: string;
      attempts?: never;
      mode?: "custom" | "auto";
    }
  | {
      type: "querying-with-log";
      text: string;
      attempts: ProviderBalanceAttempt[];
      mode?: "custom" | "auto";
    }
  | { type: "success"; text: string; mode?: "custom" | "auto" }
  | {
      type: "error";
      text: string;
      attempts: ProviderBalanceAttempt[];
    mode?: "custom" | "auto";
  };

type FetchStatus = {
  type: "querying" | "success" | "error";
  text: string;
};

function toFullBalanceUrl(baseUrl: string, path: string) {
  const trimmedPath = path.trim();
  if (!trimmedPath) return "";
  if (/^https?:\/\//i.test(trimmedPath)) return trimmedPath;
  if (!baseUrl.trim()) return trimmedPath;
  try {
    return new URL(trimmedPath, `${baseUrl.replace(/\/+$/, "")}/`)
      .toString()
      .replace(/\/$/, "");
  } catch {
    return `${baseUrl.replace(/\/+$/, "")}/${trimmedPath.replace(/^\/+/, "")}`;
  }
}

function updateHoverPosition(event: PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty(
    "--hover-x",
    `${event.clientX - rect.left}px`,
  );
  event.currentTarget.style.setProperty(
    "--hover-y",
    `${event.clientY - rect.top}px`,
  );
}

function mergeProfiles(
  localProfiles: ProviderBalanceProfile[],
  remoteProfiles: ProviderBalanceProfile[],
) {
  const localMap = new Map(
    localProfiles.map((profile) => [profile.profileId, profile]),
  );
  return remoteProfiles.map((remote) => {
    const profile = localMap.get(remote.profileId);

    const rawKey = remote.managementKey || profile?.managementKey || "";
    const useNewApiUser =
      remote.useNewApiUserFormat ?? profile?.useNewApiUserFormat ?? false;
    const newApiUserId = remote.newApiUserId ?? profile?.newApiUserId ?? "";
    const cleanKey =
      useNewApiUser && newApiUserId && rawKey.endsWith(`|${newApiUserId}`)
        ? rawKey.slice(0, -(newApiUserId.length + 1))
        : rawKey;

    return {
      ...(profile || {}),
      ...remote,
      managementKey: cleanKey,
      baseUrl: remote.baseUrl || profile?.baseUrl || "",
      balance: remote.balance,
      customBalanceUrl: remote.customBalanceUrl || "",
      cachedPath: remote.cachedPath || "",
      cachedBaseUrl: remote.cachedBaseUrl || "",
      useNewApiUserFormat: useNewApiUser,
      newApiUserId: newApiUserId,
      useUuidQueryFormat:
        remote.useUuidQueryFormat ?? profile?.useUuidQueryFormat ?? false,
      uuidQueryValue: remote.uuidQueryValue ?? profile?.uuidQueryValue ?? "",
    };
  });
}

export function ProviderBalancesPage() {
  const navigate = useNavigate();
  const apiProfiles = useAccessStore((state) => state.apiProfiles || []);
  const modelCacheProfiles = useModelCacheStore((state) => state.profiles);
  const cachedProfiles = useMemo(() => {
    const profiles = readCachedProviderBalanceProfiles();
    const cachedIds = new Set(profiles.map((profile) => profile.profileId));
    for (const apiProfile of apiProfiles) {
      if (!apiProfile?.id || cachedIds.has(apiProfile.id)) continue;
      profiles.push({
        profileId: apiProfile.id,
        profileName: apiProfile.name || apiProfile.provider || apiProfile.id,
        baseUrl: apiProfile.baseUrl || "",
        hasManagementKey: false,
        maskedManagementKey: "",
        managementKey: "",
        balance: readCachedProviderBalance(
          apiProfile.id,
          apiProfile.name || apiProfile.provider,
        ),
        lastError: "",
        customBalanceUrl: "",
        cachedPath: "",
        cachedBaseUrl: "",
        useNewApiUserFormat: false,
        newApiUserId: "",
        useUuidQueryFormat: false,
        uuidQueryValue: "",
      });
    }
    return profiles.sort((a, b) =>
      a.profileName.localeCompare(b.profileName, "en", {
        sensitivity: "base",
      }),
    );
  }, [apiProfiles]);
  const [profiles, setProfiles] =
    useState<ProviderBalanceProfile[]>(cachedProfiles);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [customUrls, setCustomUrls] = useState<Record<string, string>>({});
  const [newApiUserIds, setNewApiUserIds] = useState<Record<string, string>>(
    {},
  );
  const [newApiUserFormats, setNewApiUserFormats] = useState<
    Record<string, boolean>
  >({});
  const [uuidQueryFormats, setUuidQueryFormats] = useState<
    Record<string, boolean>
  >({});
  const [uuidQueryValues, setUuidQueryValues] = useState<
    Record<string, string>
  >({});
  const [queryStatusMap, setQueryStatusMap] = useState<
    Record<string, QueryStatus>
  >({});
  const [working, setWorking] = useState("");
  const [savingProfileIds, setSavingProfileIds] = useState<string[]>([]);
  const [queryingProfileIds, setQueryingProfileIds] = useState<string[]>([]);
  const [recentlyUpdatedIds, setRecentlyUpdatedIds] = useState<Set<string>>(
    new Set(),
  );
  const [recentlyUpdatedModelIds, setRecentlyUpdatedModelIds] = useState<
    Set<string>
  >(new Set());
  const [fetchingModelIds, setFetchingModelIds] = useState<string[]>([]);
  const [isFetchingAllModels, setIsFetchingAllModels] = useState(false);
  const [modelStatusMap, setModelStatusMap] = useState<
    Record<string, FetchStatus>
  >({});
  const [testModels, setTestModels] = useState<Record<string, string>>({});
  const [testingProfileIds, setTestingProfileIds] = useState<string[]>([]);
  const [testStatusMap, setTestStatusMap] = useState<
    Record<string, FetchStatus>
  >({});
  const [hasUnsavedConfigEdits, setHasUnsavedConfigEdits] = useState(false);
  const [syncingConfig, setSyncingConfig] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const balanceLogSignatureRef = useRef("");
  const unsavedConfigPromptShownRef = useRef(false);
  const hasUnsavedDrafts = useMemo(() => {
    const keyChanged = Object.entries(drafts).some(([profileId, value]) => {
      const savedValue =
        profiles.find((profile) => profile.profileId === profileId)
          ?.managementKey || "";
      return value !== savedValue;
    });
    const urlChanged = Object.entries(customUrls).some(
      ([profileId, value]) =>
        value !==
        (profiles.find((profile) => profile.profileId === profileId)
          ?.customBalanceUrl || ""),
    );
    const userIdChanged = Object.entries(newApiUserIds).some(
      ([profileId, value]) =>
        value !==
        (profiles.find((profile) => profile.profileId === profileId)
          ?.newApiUserId || ""),
    );
    const formatChanged = Object.entries(newApiUserFormats).some(
      ([profileId, value]) =>
        value !==
        Boolean(
          profiles.find((profile) => profile.profileId === profileId)
            ?.useNewApiUserFormat,
        ),
    );
    return keyChanged || urlChanged || userIdChanged || formatChanged;
  }, [customUrls, drafts, newApiUserFormats, newApiUserIds, profiles]);
  const isSaving = working.startsWith("save:");
  const isBatchOperationRunning = isFetchingAllModels || working === "all";

  const markConfigEdited = () => {
    setHasUnsavedConfigEdits(true);
    if (!unsavedConfigPromptShownRef.current) {
      unsavedConfigPromptShownRef.current = true;
      showToast("配置已修改，请点击“保存并同步”");
    }
  };

  const clearUnsavedConfigEdits = () => {
    setHasUnsavedConfigEdits(false);
    unsavedConfigPromptShownRef.current = false;
  };

  useEffect(() => {
    prepareRouteEntryForSync(Path.ApiConfig, {
      source: "provider-management-page",
    });
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const remoteProfiles = await loadProviderBalanceProfiles();
      const mergedProfiles = mergeProfiles(cachedProfiles, remoteProfiles).sort(
        (a, b) =>
          a.profileName.localeCompare(b.profileName, "en", {
            sensitivity: "base",
          }),
      );
      cacheProviderBalanceProfiles(mergedProfiles);
      setProfiles(mergedProfiles);
      const named = mergedProfiles
        .map((p) => p?.profileName || p?.profileId || "(未命名)")
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
      const withKey = mergedProfiles.filter((p) => p?.hasManagementKey).length;
      const withBalance = mergedProfiles.filter(
        (p) => p?.balance?.value != null,
      ).length;
      const withCustomUrl = mergedProfiles.filter(
        (p) => p?.customBalanceUrl?.trim(),
      ).length;
      const balanceLogSignature = JSON.stringify({
        profiles: mergedProfiles,
        withKey,
        withBalance,
        withCustomUrl,
      });
      if (balanceLogSignatureRef.current === balanceLogSignature) return;
      balanceLogSignatureRef.current = balanceLogSignature;
      console.log(
        `[Provider Balance] 📋 已读取余额配置（${mergedProfiles.length} 个；已存管理 Key ${withKey} 个，已查过余额 ${withBalance} 个，已配自定义 URL ${withCustomUrl} 个）：`,
      );
      if (named.length) {
        named.forEach((n) => {
          console.log(`  - ${n}`);
        });
      } else {
        console.log("  - 无");
      }
    } finally {
      setIsLoading(false);
    }
  }, [cachedProfiles]);

  useEffect(() => {
    void load().catch(() => showToast("读取余额配置失败"));
  }, [load]);

  useEffect(() => {
    const shouldWarn = hasUnsavedDrafts || isSaving;
    if (!shouldWarn) return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [hasUnsavedDrafts, isSaving]);

  const getNewApiUserIdInputValue = (profileId: string) => {
    if (Object.prototype.hasOwnProperty.call(newApiUserIds, profileId)) {
      return newApiUserIds[profileId] || "";
    }
    return (
      profiles.find((profile) => profile.profileId === profileId)
        ?.newApiUserId || ""
    );
  };

  const getNewApiUserFormatValue = (profileId: string) => {
    if (Object.prototype.hasOwnProperty.call(newApiUserFormats, profileId)) {
      return Boolean(newApiUserFormats[profileId]);
    }
    return Boolean(
      profiles.find((profile) => profile.profileId === profileId)
        ?.useNewApiUserFormat,
    );
  };

  const getUuidQueryFormatValue = (profileId: string) => {
    if (Object.prototype.hasOwnProperty.call(uuidQueryFormats, profileId)) {
      return Boolean(uuidQueryFormats[profileId]);
    }
    return Boolean(
      profiles.find((profile) => profile.profileId === profileId)
        ?.useUuidQueryFormat,
    );
  };

  const getUuidQueryValue = (profileId: string) => {
    if (Object.prototype.hasOwnProperty.call(uuidQueryValues, profileId)) {
      return uuidQueryValues[profileId] || "";
    }
    return (
      profiles.find((profile) => profile.profileId === profileId)
        ?.uuidQueryValue || ""
    );
  };

  const profileHasUnsavedChanges = (profileId: string) => {
    const profile = profiles.find((item) => item.profileId === profileId);
    if (!profile) return false;
    return (
      (Object.prototype.hasOwnProperty.call(drafts, profileId) &&
        getManagementInputValue(profileId) !== (profile.managementKey || "")) ||
      (Object.prototype.hasOwnProperty.call(customUrls, profileId) &&
        getCustomUrlInputValue(profileId) !==
          (profile.customBalanceUrl || "")) ||
      (Object.prototype.hasOwnProperty.call(newApiUserIds, profileId) &&
        getNewApiUserIdInputValue(profileId) !==
          (profile.newApiUserId || "")) ||
      (Object.prototype.hasOwnProperty.call(newApiUserFormats, profileId) &&
        getNewApiUserFormatValue(profileId) !==
          Boolean(profile.useNewApiUserFormat)) ||
      (Object.prototype.hasOwnProperty.call(uuidQueryFormats, profileId) &&
        getUuidQueryFormatValue(profileId) !==
          Boolean(profile.useUuidQueryFormat)) ||
      (Object.prototype.hasOwnProperty.call(uuidQueryValues, profileId) &&
        getUuidQueryValue(profileId) !== (profile.uuidQueryValue || ""))
    );
  };

  const getApiProfile = (profileId: string) =>
    apiProfiles.find((profile) => profile.id === profileId);

  const updateApiProfile = (profileId: string, changes: Record<string, any>) => {
    useAccessStore.getState().update((access: any) => {
      access.lastUpdateTime = Date.now();
      access.apiProfiles = (access.apiProfiles || []).map((profile: any) =>
        profile.id === profileId ? { ...profile, ...changes } : profile,
      );
    });
    markConfigEdited();
  };

  const syncApiConfig = async (options?: { silent?: boolean }) => {
    setSyncingConfig(true);
    try {
      await useSyncStore.getState().sync([StoreKey.Access], {
        force: true,
        isolateQueue: true,
        manual: true,
      });
      if (!options?.silent) showToast("API 配置已保存并同步");
      return true;
    } catch (error) {
      console.error("[Provider Management] API 配置同步失败", error);
      showToast("API 配置同步失败，请检查数据库连接");
      return false;
    } finally {
      setSyncingConfig(false);
    }
  };

  const addApiProfile = () => {
    const timestamp = Date.now();
    useAccessStore.getState().update((access: any) => {
      access.lastUpdateTime = timestamp;
      access.apiProfiles = [
        ...(access.apiProfiles || []),
        {
          id: `profile_${timestamp}`,
          name: "默认新增配置",
          provider: ServiceProvider.Custom,
          baseUrl: "",
          apiKey: "",
          modelFetchApiKey: "",
          modelFetchUrl: "",
          enabled: false,
          openAICompatible: true,
        },
      ];
    });
    markConfigEdited();
    setProfiles((current) => [
      ...current,
      {
        profileId: `profile_${timestamp}`,
        profileName: "默认新增配置",
        baseUrl: "",
        hasManagementKey: false,
        maskedManagementKey: "",
        managementKey: "",
        balance: null,
        lastError: "",
        customBalanceUrl: "",
        cachedPath: "",
        cachedBaseUrl: "",
        useNewApiUserFormat: false,
        newApiUserId: "",
        useUuidQueryFormat: false,
        uuidQueryValue: "",
      },
    ]);
  };

  const clearAddedModels = async () => {
    const confirmed = await showConfirm(
      "确定要清空已添加模型吗？这会删除会同步到数据库的用户已添加模型，并清空当前浏览器的临时模型缓存。",
    );
    if (!confirmed) return;
    useAppConfig.getState().update((config: any) => {
      config.models = [];
      config.customModels = "";
      config.customModelsUpdatedAt = Date.now();
    });
    useAccessStore.getState().update((access: any) => {
      access.lastUpdateTime = Date.now();
      access.customModels = "";
      access.apiProfiles = (access.apiProfiles || []).map((profile: any) => ({
        ...profile,
        cachedModels: undefined,
        modelCount: undefined,
      }));
    });
    useModelCacheStore.getState().clearProfileCaches();
    setRecentlyUpdatedModelIds(new Set());
    try {
      await useSyncStore.getState().sync([StoreKey.Access, StoreKey.Config], {
        force: true,
        isolateQueue: true,
        manual: true,
      });
      showToast("已清空已添加模型并同步");
    } catch (error) {
      console.error("[Provider Management] 清空模型同步失败", error);
      showToast("已清空本地模型，但同步到数据库失败");
    }
  };

  const deleteApiProfile = async (profileId: string) => {
    const profile = getApiProfile(profileId);
    if (!profile) return;
    const confirmed = await showConfirm(
      `确定删除“${profile.name || profile.id}”吗？该配置在保存并同步后将不再可用。`,
    );
    if (!confirmed) return;
    useAccessStore.getState().update((access: any) => {
      access.lastUpdateTime = Date.now();
      access.apiProfiles = (access.apiProfiles || []).filter(
        (item: any) => item.id !== profileId,
      );
    });
    await syncApiConfig({ silent: true });
    await load();
  };

  const fetchModels = async (
    profileId: string,
    options?: { silentToast?: boolean },
  ) => {
    const profile = getApiProfile(profileId);
    if (!profile) return false;
    if (!String(profile.modelFetchUrl || "").trim()) {
      setModelStatusMap((value) => ({
        ...value,
        [profileId]: { type: "error", text: "请先填写模型获取 URL" },
      }));
      if (!options?.silentToast) showToast("请先填写模型获取 URL");
      return false;
    }
    setFetchingModelIds((ids) => [...new Set([...ids, profileId])]);
    setModelStatusMap((value) => ({
      ...value,
      [profileId]: { type: "querying", text: "正在获取模型..." },
    }));
    if (!options?.silentToast) showToast("开始获取模型");
    try {
      const result = await syncProfileModels(profileId, {
        reason: "manual",
        silent: true,
      });
      setModelStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "success",
          text: `获取成功：${result.total} 个模型`,
        },
      }));
      setRecentlyUpdatedModelIds((ids) => new Set(ids).add(profileId));
      if (!options?.silentToast) showToast("模型获取成功");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setModelStatusMap((value) => ({
        ...value,
        [profileId]: { type: "error", text: message },
      }));
      if (!options?.silentToast) showToast(message);
      return false;
    } finally {
      setFetchingModelIds((ids) => ids.filter((id) => id !== profileId));
    }
  };

  const fetchAllModels = async () => {
    const fetchableProfiles = apiProfiles.filter((profile) =>
      String(profile.modelFetchUrl || "").trim(),
    );
    if (fetchableProfiles.length === 0) {
      showToast("没有填写模型获取 URL 的供应商");
      return;
    }
    setIsFetchingAllModels(true);
    try {
      const results = await Promise.all(
        fetchableProfiles.map((profile) =>
          fetchModels(profile.id, { silentToast: true }),
        ),
      );
      const succeeded = results.filter(Boolean).length;
      showToast(`模型批量获取完成：成功 ${succeeded}/${results.length}`);
    } finally {
      setIsFetchingAllModels(false);
    }
  };

  const getTestModel = (profileId: string) => testModels[profileId] || "";

  const testChat = async (profileId: string) => {
    const profile = getApiProfile(profileId);
    const model = getTestModel(profileId).trim();
    if (!profile?.apiKey?.trim() || !profile.baseUrl?.trim()) {
      showToast("请先填写对话 Base URL 和 API Key");
      return;
    }
    if (!model) {
      showToast("请输入测试对话模型");
      return;
    }
    setTestingProfileIds((ids) => [...new Set([...ids, profileId])]);
    setTestStatusMap((value) => ({
      ...value,
      [profileId]: { type: "querying", text: "正在测试对话..." },
    }));
    showToast("开始测试对话");
    try {
      let reply = "";
      let requestError: Error | null = null;
      let finished = false;
      let responseStatus: number | undefined;
      // 流式客户端在连接建立后即返回 Promise，完成信号只会通过回调到达。
      // 将回调包装为 Promise，避免上游已返回 200 时被误判为“响应未正常完成”。
      await new Promise<void>((resolve, reject) => {
        void getClientApi(ServiceProvider.Custom).llm
          .chat({
            messages: [{ role: "user", content: "请只回复 OK" }],
            config: {
              model,
              providerName: ServiceProvider.Custom,
              profileId,
              stream: true,
            } as any,
            // 固定模型、Key 与请求参数，但保留既有路径探测以兼容不同 OpenAI 兼容端点。
            disableAutoFallback: true,
            enableChatPathFallback: true,
            disablePlugins: true,
            requestBaseUrl: profile.baseUrl,
            requestApiKey: profile.apiKey,
            onRequest: (request) => {
              logger.chat.log("🔄 对话请求尝试 测试:", {
                尝试: "测试",
                供应商: profile.name || profile.id,
                模型: model,
                基础地址: request.baseUrl,
                请求路径: request.chatPath,
                流式请求: request.stream,
              });
            },
            onUpdate: (message) => {
              reply = message;
            },
            onFinish: (message, response) => {
              finished = true;
              responseStatus = response.status;
              reply = message || reply;
              if (!response.ok) {
                requestError = new Error(`HTTP ${response.status}`);
              }
              resolve();
            },
            onError: (error) => {
              requestError = error;
              reject(error);
            },
          })
          .catch(reject);
      });
      if (requestError) throw requestError;
      if (!finished) throw new Error("响应未正常完成");
      const finalReply = reply.trim();
      if (!finalReply) throw new Error("上游未返回有效回复");
      logger.chat.log("✅ 对话请求尝试成功:", {
        尝试: "测试",
        供应商: profile.name || profile.id,
        模型: model,
        状态码: responseStatus,
      });
      setTestStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "success",
          text: `对话测试成功：${finalReply.slice(0, 80)}`,
        },
      }));
      showToast(`对话测试成功：${finalReply.slice(0, 80)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.chat.log(
        isAbortLikeError(error)
          ? "⏹️ 对话请求已停止:"
          : "❌ 对话请求尝试失败:",
        {
          尝试: "测试",
          供应商: profile.name || profile.id,
          模型: model,
          原因: isAbortLikeError(error) ? "请求已中止" : message,
        },
      );
      setTestStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "error",
          text: `对话测试失败：${message}`,
        },
      }));
      showToast(`对话测试失败：${message}`);
    } finally {
      setTestingProfileIds((ids) => ids.filter((id) => id !== profileId));
    }
  };

  const queryOne = async (
    profileId: string,
    options?: { batch?: boolean; signal?: AbortSignal },
  ) => {
    const profile = profiles.find((item) => item.profileId === profileId);
    const profileName = profile?.profileName || profileId;
    const useNewApiUser = getNewApiUserFormatValue(profileId);
    const useUuidQuery = getUuidQueryFormatValue(profileId);
    const queryMode: "custom" | "auto" =
      hasExplicitProviderBalancePath(profile?.customBalanceUrl) ||
      useNewApiUser ||
      useUuidQuery
        ? "custom"
        : "auto";

    if (profileHasUnsavedChanges(profileId)) {
      // 余额查询需要服务端读取余额专用配置；仅保存当前卡片，
      // 不等待或阻塞其他供应商的模型获取、余额查询和对话测试。
      setQueryStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "querying",
          text: "正在保存余额配置...",
          mode: queryMode,
        },
      }));
      const saved = await saveKey(profileId);
      if (!saved) {
        setQueryStatusMap((value) => ({
          ...value,
          [profileId]: {
            type: "error",
            text: "余额配置保存失败，已取消查询",
            attempts: [],
            mode: queryMode,
          },
        }));
        return;
      }
    }

    if (!profile?.hasManagementKey && !getApiProfile(profileId)?.apiKey?.trim()) {
      setQueryStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "error",
          text: "未设置余额专用 Key 或对话 API Key，已跳过查询",
          attempts: [],
          mode: queryMode,
        },
      }));
      return;
    }

    if (!options?.batch) {
      setWorking(`query:${profileId}`);
    }
    setQueryingProfileIds((ids) =>
      ids.includes(profileId) ? ids : [...ids, profileId],
    );
    console.log(
      `[Provider Balance] 🔄 开始查询余额：${profileName}（模式：${
        queryMode === "custom" ? "指定 URL" : "兼容已有配置"
      }）`,
    );
    setQueryStatusMap((value) => ({
      ...value,
      [profileId]: {
        type: "querying-with-log",
        text: "正在查询余额...",
        attempts: [],
        mode: queryMode,
      },
    }));
    let attempts: ProviderBalanceAttempt[] = [];
    try {
      const result = await queryProviderBalanceProfile(profileId, {
        source: options?.batch ? "balances-page-batch" : "balances-page-manual",
        providerName: profileName,
        signal: options?.signal,
      });
      attempts = result.attempts;
      console.log(`[Provider Balance] ✅ ${profileName} 余额查询成功`);

      setProfiles((value) => {
        const nextProfiles = value.map((profile) =>
          profile.profileId === profileId
            ? {
                ...profile,
                balance: result.balance,
                lastError: "",
                cachedPath: result.cachedPath || profile.cachedPath,
                cachedBaseUrl: result.cachedBaseUrl || profile.cachedBaseUrl,
              }
            : profile,
        );
        cacheProviderBalanceProfiles(nextProfiles);
        return nextProfiles;
      });
      // 本次页面会话内查询成功后保持绿色，刷新页面时自然恢复。
      setRecentlyUpdatedIds((prev) => new Set(prev).add(profileId));
      setQueryStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "success",
          text: `查询成功：${toFullBalanceUrl(
            result.cachedBaseUrl || profile?.baseUrl || "",
            result.cachedPath || profile?.customBalanceUrl || "",
          )}`,
          mode: queryMode,
        },
      }));
    } catch (error) {
      if (options?.signal?.aborted) {
        throw error;
      }
      const errorMessage = getProviderBalanceErrorMessage(error);
      // 从 error 对象中提取 attempts
      if (error && typeof error === "object" && "attempts" in error) {
        attempts = (error as any).attempts || [];
      }
      setProfiles((value) =>
        value.map((profile) =>
          profile.profileId === profileId
            ? {
                ...profile,
                lastError: errorMessage,
              }
            : profile,
        ),
      );
      setQueryStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "error",
          text: errorMessage,
          attempts,
          mode: queryMode,
        },
      }));
      showToast(errorMessage);
    } finally {
      if (!options?.batch) {
        setWorking("");
      }
      setQueryingProfileIds((ids) => ids.filter((id) => id !== profileId));
    }
  };

  const getManagementInputValue = (profileId: string) => {
    if (Object.prototype.hasOwnProperty.call(drafts, profileId)) {
      return drafts[profileId] || "";
    }
    return (
      profiles.find((profile) => profile.profileId === profileId)
        ?.managementKey || ""
    );
  };

  const getCustomUrlInputValue = (profileId: string) => {
    if (Object.prototype.hasOwnProperty.call(customUrls, profileId)) {
      return customUrls[profileId] || "";
    }
    return (
      profiles.find((profile) => profile.profileId === profileId)
        ?.customBalanceUrl || ""
    );
  };

  const saveKey = async (profileId: string): Promise<boolean> => {
    const profile = profiles.find((profile) => profile.profileId === profileId);
    const profileName = profile?.profileName || profileId;
    const managementKey = getManagementInputValue(profileId);
    const customUrl = getCustomUrlInputValue(profileId);
    const newApiUserId = getNewApiUserIdInputValue(profileId);
    const useNewApiUser = getNewApiUserFormatValue(profileId);
    const useUuidQuery = getUuidQueryFormatValue(profileId);
    const uuidValue = getUuidQueryValue(profileId);
    const customBalanceUrl = customUrl.trim()
      ? toFullBalanceUrl(profile?.baseUrl || "", customUrl)
      : useNewApiUser
      ? toFullBalanceUrl(profile?.baseUrl || "", "/api/user/self")
      : useUuidQuery
      ? toFullBalanceUrl(profile?.baseUrl || "", "/v1/enterprise/account")
      : "";

    if (useNewApiUser && !newApiUserId.trim()) {
      showToast("请填写 User ID");
      return false;
    }

    if (useUuidQuery && !uuidValue.trim()) {
      showToast("请填写 UUID");
      return false;
    }

    setWorking(`save:${profileId}`);
    setSavingProfileIds((ids) =>
      ids.includes(profileId) ? ids : [...ids, profileId],
    );
    setQueryStatusMap((value) => ({
      ...value,
      [profileId]: { type: "querying", text: "正在保存..." },
    }));
    console.log(`[Provider Balance] 🔄 开始保存：${profileName}`);
    try {
      // 一次性保存所有余额配置字段
      await saveProviderBalanceConfig(profileId, {
        managementKey: managementKey.trim(),
        customBalanceUrl,
        useNewApiUserFormat: useNewApiUser,
        newApiUserId: newApiUserId,
        useUuidQueryFormat: useUuidQuery,
        uuidQueryValue: uuidValue,
      });
      setDrafts((value) => {
        const nextValue = { ...value };
        delete nextValue[profileId];
        return nextValue;
      });
      setCustomUrls((value) => {
        const nextValue = { ...value };
        delete nextValue[profileId];
        return nextValue;
      });
      setNewApiUserIds((value) => {
        const nextValue = { ...value };
        delete nextValue[profileId];
        return nextValue;
      });
      setNewApiUserFormats((value) => {
        const nextValue = { ...value };
        delete nextValue[profileId];
        return nextValue;
      });
      setUuidQueryFormats((value) => {
        const nextValue = { ...value };
        delete nextValue[profileId];
        return nextValue;
      });
      setUuidQueryValues((value) => {
        const nextValue = { ...value };
        delete nextValue[profileId];
        return nextValue;
      });
      await load();
      console.log(`[Provider Balance] ✅ ${profileName} 保存成功`);
      setQueryStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "success",
          text: "保存成功",
        },
      }));
      showToast("保存成功");
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "保存失败";
      console.error(
        `[Provider Balance] ❌ ${profileName} 保存失败：${errorMessage}`,
      );
      setQueryStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "error",
          text: errorMessage,
          attempts: [],
        },
      }));
      showToast("保存失败");
      return false;
    } finally {
      setWorking("");
      setSavingProfileIds((ids) => ids.filter((id) => id !== profileId));
    }
  };

  const queryAll = async () => {
    const queryableProfiles = profiles.filter(
      (profile) =>
        profile.hasManagementKey &&
        !profileHasUnsavedChanges(profile.profileId),
    );
    console.log(
      `[Provider Balance] 🔄 开始批量查询余额（${queryableProfiles.length} 个配置，全部并发执行）`,
    );
    setWorking("all");
    setQueryingProfileIds(
      queryableProfiles.map((profile) => profile.profileId),
    );
    setQueryStatusMap((value) => ({
      ...value,
      ...Object.fromEntries(
        queryableProfiles.map((profile) => [
          profile.profileId,
          {
            type: "querying-with-log",
            text: "正在查询余额...",
            attempts: [],
          } as QueryStatus,
        ]),
      ),
    }));

    try {
      // 所有供应商并发查询；单个上游请求和重试由服务端统一限时，
      // 前端不再用 30 秒总超时截断尚未走完的兼容查询队列。
      const queryPromises = queryableProfiles.map(async (profile) => {
        try {
          await queryOne(profile.profileId, {
            batch: true,
          });
        } catch (error) {
          console.error(
            `[Provider Balance] ❌ ${profile.profileName} 批量查询异常`,
            error instanceof Error ? error.message : String(error),
          );
        }
      });

      await Promise.all(queryPromises);
      console.log(`[Provider Balance] ✅ 批量余额查询流程结束`);
    } finally {
      setWorking("");
      setQueryingProfileIds([]);
    }
  };
  const closePage = async () => {
    if (queryingProfileIds.length > 0) {
      const confirmed = await showConfirm(
        `余额查询正在执行中（还剩${queryingProfileIds.length}个），确认离开吗？`,
      );
      if (!confirmed) return;
    }
    if (hasUnsavedDrafts || hasUnsavedConfigEdits || isSaving) {
      const confirmed = await showConfirm(
        isSaving
          ? "管理 API Key 正在保存中，确认离开吗？"
          : "有未保存的供应商配置，确认离开吗？",
      );
      if (!confirmed) return;
    }
    navigate(Path.Chat);
  };

  return (
    <div className={styles.page} data-top-notice-anchor="true">
      <div className={`window-header`} data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">供应商管理</div>
          <div className="window-header-sub-title">
            在同一处管理对话、模型获取与余额查询；专用 Key 留空时使用对话 API Key
          </div>
        </div>
        <div className="window-actions">
          <div className="window-action-button">
            <IconButton
              aria="关闭"
              icon={<CloseIcon />}
              close
              onClick={() => void closePage()}
            />
          </div>
        </div>
      </div>
      <div className={styles.content}>
        <form
          className={styles.autofillTrap}
          aria-hidden="true"
          onSubmit={(event) => event.preventDefault()}
        >
          <input
            type="text"
            name="username"
            autoComplete="username"
            tabIndex={-1}
          />
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            tabIndex={-1}
          />
        </form>
        <div className={styles.batchAction}>
          <div className={styles.batchActionGroup}>
            <IconButton
              icon={<AddIcon />}
              text="新增配置"
              type="green"
              className={styles.actionButton}
              disabled={syncingConfig || isBatchOperationRunning}
              onClick={addApiProfile}
            />
            <IconButton
              icon={<TrashIcon />}
              text="清空已添加模型"
              className={`${styles.actionButton} nextchat-danger-button-filled`}
              disabled={syncingConfig || isLoading || isBatchOperationRunning}
              onClick={() => void clearAddedModels()}
            />
          </div>
          <div className={styles.batchActionGroup}>
            <IconButton
              icon={<ConfirmIcon />}
              text={
                syncingConfig
                  ? "同步中..."
                  : hasUnsavedConfigEdits || hasUnsavedDrafts
                  ? "保存并同步（有修改）"
                  : "保存并同步"
              }
              type="primary"
              className={styles.actionButton}
              disabled={syncingConfig || isLoading || isBatchOperationRunning}
              onClick={() =>
                void (async () => {
                  if (!(await syncApiConfig({ silent: true }))) return;
                  await Promise.all(
                    profiles
                      .filter((profile) =>
                        profileHasUnsavedChanges(profile.profileId),
                      )
                      .map((profile) => saveKey(profile.profileId)),
                  );
                  clearUnsavedConfigEdits();
                  showToast("所有供应商配置已保存并同步");
                })()
              }
            />
            <IconButton
              icon={<ReloadIcon />}
              text={isFetchingAllModels ? "模型获取中..." : "全部获取模型"}
              type="green"
              className={styles.actionButton}
              disabled={
                isLoading || isFetchingAllModels || apiProfiles.length === 0
              }
              onClick={() => void fetchAllModels()}
            />
            <IconButton
              icon={<ReloadIcon />}
              text={working === "all" ? "余额查询中..." : "全部查询余额"}
              type="green"
              className={styles.actionButton}
              disabled={
                isLoading ||
                working === "all" ||
                savingProfileIds.length > 0 ||
                (profiles.length > 0 &&
                  queryingProfileIds.length === profiles.length)
              }
              onClick={() => void queryAll()}
            />
          </div>
        </div>
        <div className={styles.list}>
          {profiles.length === 0 ? (
            <div className={styles.empty}>暂无 API 配置</div>
          ) : (
            profiles.map((profile) => {
              const apiProfile = getApiProfile(profile.profileId);
              if (!apiProfile) return null;
              const isDialogueTestRunning = testingProfileIds.includes(
                profile.profileId,
              );
              const isModelFetchRunning =
                isFetchingAllModels || fetchingModelIds.includes(profile.profileId);
              const isBalanceQueryRunning =
                working === "all" || queryingProfileIds.includes(profile.profileId);
              return (
              <div
                className={`${styles.card} ${styles.desktopHoverCard}`}
                key={profile.profileId}
                onPointerMove={updateHoverPosition}
              >
                <div className={styles.headerRow}>
                  <div className={styles.headerLeft}>
                    <span className={styles.name}>{profile.profileName}</span>
                    <label className={styles.newApiUserToggle}>
                      <input
                        type="checkbox"
                        checked={getNewApiUserFormatValue(profile.profileId)}
                        disabled={isBalanceQueryRunning}
                        onChange={(e) => {
                          const newValue = e.target.checked;
                          setNewApiUserFormats((value) => ({
                            ...value,
                            [profile.profileId]: newValue,
                          }));
                          if (
                            newValue &&
                            !Object.prototype.hasOwnProperty.call(
                              customUrls,
                              profile.profileId,
                            ) &&
                            !profile.customBalanceUrl
                          ) {
                            setCustomUrls((value) => ({
                              ...value,
                              [profile.profileId]: toFullBalanceUrl(
                                profile.baseUrl,
                                "/api/user/self",
                              ),
                            }));
                          }
                          markConfigEdited();
                        }}
                      />
                      <span>New-API-User</span>
                    </label>
                    <label className={styles.newApiUserToggle}>
                      <input
                        type="checkbox"
                        checked={getUuidQueryFormatValue(profile.profileId)}
                        disabled={isBalanceQueryRunning}
                        onChange={(e) => {
                          const newValue = e.target.checked;
                          setUuidQueryFormats((value) => ({
                            ...value,
                            [profile.profileId]: newValue,
                          }));
                          if (
                            newValue &&
                            !Object.prototype.hasOwnProperty.call(
                              customUrls,
                              profile.profileId,
                            ) &&
                            !profile.customBalanceUrl
                          ) {
                            setCustomUrls((value) => ({
                              ...value,
                              [profile.profileId]: toFullBalanceUrl(
                                profile.baseUrl,
                                "/v1/enterprise/account",
                              ),
                            }));
                          }
                          markConfigEdited();
                        }}
                      />
                      <span>UUID 查询</span>
                    </label>
                  </div>
                  <div className={styles.headerRight}>
                    <span
                      className={`${styles.modelCount} ${
                        recentlyUpdatedModelIds.has(profile.profileId)
                          ? styles.modelUpdated
                          : ""
                      }`}
                    >
                      {recentlyUpdatedModelIds.has(profile.profileId) && (
                        <svg
                          className={`${styles.balanceStatusIcon} ${styles.balanceSuccessIcon}`}
                          viewBox="0 0 16 16"
                          fill="none"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path
                            d="M3 8.25 6.5 11.5 13 4.75"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                      模型：
                      {modelCacheProfiles[profile.profileId]?.modelCount ??
                        apiProfile.modelCount ??
                        0}
                      个
                    </span>
                    <span
                      className={`${styles.balance} ${
                        queryStatusMap[profile.profileId]?.type === "error" ||
                        profile.lastError
                          ? styles.balanceError
                          : recentlyUpdatedIds.has(profile.profileId)
                          ? styles.balanceUpdated
                          : ""
                      }`}
                    >
                      {(queryStatusMap[profile.profileId]?.type === "error" ||
                        profile.lastError) && (
                        <span
                          className={styles.balanceStatusIcon}
                          aria-hidden="true"
                        >
                          ×
                        </span>
                      )}
                      {!queryStatusMap[profile.profileId]?.type?.includes(
                        "error",
                      ) &&
                        !profile.lastError &&
                        recentlyUpdatedIds.has(profile.profileId) && (
                          <svg
                            className={`${styles.balanceStatusIcon} ${styles.balanceSuccessIcon}`}
                            viewBox="0 0 16 16"
                            fill="none"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <path
                              d="M3 8.25 6.5 11.5 13 4.75"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      余额：
                      {profile.balance
                        ? profile.balance.value === -1
                          ? "无限"
                          : `$${profile.balance.value.toFixed(2)}`
                        : "无"}
                    </span>
                  </div>
                </div>
                <div className={styles.sectionCaption}>对话配置</div>
                <div className={styles.row}>
                  <div className={styles.inputWithLabel}>
                    <span className={styles.inputLabel}>Base URL</span>
                    <input
                      className={`nextchat-input-control ${
                        apiProfile.baseUrl?.trim() ? styles.fixedUrlInput : ""
                      }`}
                      type="text"
                      value={apiProfile.baseUrl || ""}
                      onChange={(event) =>
                        updateApiProfile(profile.profileId, {
                          baseUrl: event.target.value,
                        })
                      }
                      placeholder="对话 Base URL"
                      disabled={isDialogueTestRunning}
                    />
                  </div>
                </div>
                <div className={styles.row}>
                  <div className={styles.inputWithLabel}>
                    <span className={styles.inputLabel}>对话 Key</span>
                    <input
                      className="nextchat-input-control"
                      type="text"
                      value={apiProfile.apiKey || ""}
                      onChange={(event) =>
                        updateApiProfile(profile.profileId, {
                          apiKey: event.target.value,
                        })
                      }
                      placeholder="对话 API Key"
                      disabled={isDialogueTestRunning}
                    />
                  </div>
                </div>
                <div className={styles.sectionCaption}>测试对话</div>
                <div className={styles.row}>
                  <div className={styles.inputWithLabel}>
                    <span className={styles.inputLabel}>测试模型</span>
                    <input
                      className="nextchat-input-control"
                      type="text"
                      value={getTestModel(profile.profileId)}
                      onChange={(event) =>
                        setTestModels((value) => ({
                          ...value,
                          [profile.profileId]: event.target.value,
                        }))
                      }
                      placeholder="输入用于测试对话的模型名"
                      disabled={isDialogueTestRunning}
                    />
                  </div>
                  <IconButton
                    icon={<ReloadIcon />}
                    text={
                      testingProfileIds.includes(profile.profileId)
                        ? "测试中..."
                        : "测试对话"
                    }
                    type="primary"
                    className={styles.actionButton}
                    disabled={testingProfileIds.includes(profile.profileId)}
                    onClick={() => void testChat(profile.profileId)}
                  />
                </div>
                {testStatusMap[profile.profileId] && (
                  <div
                    className={
                      testStatusMap[profile.profileId].type === "error"
                        ? styles.statusError
                        : styles.statusSuccess
                    }
                  >
                    {testStatusMap[profile.profileId].text}
                  </div>
                )}
                <div className={styles.sectionCaption}>模型获取</div>
                <div className={styles.configurationSection}>
                <div className={`${styles.row} ${styles.modelKeyRow}`}>
                  <div className={styles.inputWithLabel}>
                    <span className={styles.inputLabel}>模型 Key</span>
                    <input
                      className="nextchat-input-control"
                      type="text"
                      value={apiProfile.modelFetchApiKey || ""}
                      onChange={(event) =>
                        updateApiProfile(profile.profileId, {
                          modelFetchApiKey: event.target.value,
                        })
                      }
                      placeholder="留空则使用对话 API Key"
                      disabled={isModelFetchRunning}
                    />
                  </div>
                </div>
                <div className={`${styles.row} ${styles.modelUrlRow}`}>
                  <div className={styles.inputWithLabel}>
                    <span className={styles.inputLabel}>获取 URL</span>
                    <input
                      className={`nextchat-input-control ${
                        apiProfile.modelFetchUrl?.trim()
                          ? styles.fixedUrlInput
                          : ""
                      }`}
                      type="text"
                      value={apiProfile.modelFetchUrl || ""}
                      onChange={(event) =>
                        updateApiProfile(profile.profileId, {
                          modelFetchUrl: event.target.value,
                        })
                      }
                      placeholder="模型列表 URL"
                      disabled={isModelFetchRunning}
                    />
                  </div>
                  <IconButton
                    icon={<ReloadIcon />}
                    text={
                      fetchingModelIds.includes(profile.profileId)
                        ? "获取中..."
                        : "获取模型"
                    }
                    type="green"
                    className={`${styles.actionButton} nextchat-action-button`}
                    disabled={
                      isModelFetchRunning
                    }
                    onClick={() => void fetchModels(profile.profileId)}
                  />
                </div>
                </div>
                {modelStatusMap[profile.profileId] && (
                  <div
                    className={
                      modelStatusMap[profile.profileId].type === "error"
                        ? styles.statusError
                        : styles.statusSuccess
                    }
                  >
                    {modelStatusMap[profile.profileId].text}
                  </div>
                )}
                <div className={styles.sectionCaption}>余额查询</div>
                <div className={styles.configurationSection}>
                <div className={`${styles.row} ${styles.balanceKeyRow}`}>
                  <div
                    className={`${styles.inputWithLabel} ${styles.balanceKeyInputs}`}
                  >
                    <span className={styles.inputLabel}>API Key</span>
                    <input
                      className="nextchat-input-control"
                      type="text"
                      autoComplete="one-time-code"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-bwignore="true"
                      data-form-type="other"
                      name={`balance-management-key-${profile.profileId}`}
                      value={
                        Object.prototype.hasOwnProperty.call(
                          drafts,
                          profile.profileId,
                        )
                          ? drafts[profile.profileId]
                          : profile.managementKey || ""
                      }
                      onChange={(event) => {
                        setDrafts((value) => ({
                          ...value,
                          [profile.profileId]: event.target.value,
                        }));
                        markConfigEdited();
                      }}
                      placeholder="留空则使用对话 API Key"
                      disabled={isLoading || isBalanceQueryRunning}
                    />
                    {getNewApiUserFormatValue(profile.profileId) && (
                      <>
                        <span className={styles.inputLabel}>User ID</span>
                        <input
                          className={`nextchat-input-control ${styles.newApiUserInput}`}
                          type="text"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          data-lpignore="true"
                          data-1p-ignore="true"
                          data-bwignore="true"
                          data-form-type="other"
                          name={`balance-new-api-user-${profile.profileId}`}
                          value={getNewApiUserIdInputValue(profile.profileId)}
                          onChange={(event) => {
                            setNewApiUserIds((value) => ({
                              ...value,
                              [profile.profileId]: event.target.value,
                            }));
                            markConfigEdited();
                          }}
                          placeholder="用户ID"
                          disabled={isLoading || isBalanceQueryRunning}
                        />
                      </>
                    )}
                    {getUuidQueryFormatValue(profile.profileId) && (
                      <>
                        <span className={styles.inputLabel}>UUID</span>
                        <input
                          className={`nextchat-input-control ${styles.newApiUserInput}`}
                          type="text"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          data-lpignore="true"
                          data-1p-ignore="true"
                          data-bwignore="true"
                          data-form-type="other"
                          name={`balance-uuid-query-${profile.profileId}`}
                          value={getUuidQueryValue(profile.profileId)}
                          onChange={(event) => {
                            setUuidQueryValues((value) => ({
                              ...value,
                              [profile.profileId]: event.target.value,
                            }));
                            markConfigEdited();
                          }}
                          placeholder="账户UUID"
                          disabled={isLoading || isBalanceQueryRunning}
                        />
                      </>
                    )}
                  </div>
                </div>
                <div className={`${styles.row} ${styles.balanceUrlRow}`}>
                  <div className={styles.inputWithLabel}>
                    <span className={styles.inputLabel}>查询 URL</span>
                    {(() => {
                      const savedCustomUrl = profile.customBalanceUrl || "";
                      const savedCustomUrlHasPath =
                        hasExplicitProviderBalancePath(savedCustomUrl);
                      const isAutoFixed =
                        !getNewApiUserFormatValue(profile.profileId) &&
                        !Object.prototype.hasOwnProperty.call(
                          customUrls,
                          profile.profileId,
                        ) &&
                        !savedCustomUrlHasPath &&
                        !!profile.cachedPath;

                      const autoFixedDisplayUrl = isAutoFixed
                        ? toFullBalanceUrl(
                            profile.cachedBaseUrl ||
                              savedCustomUrl ||
                              profile.baseUrl,
                            profile.cachedPath || "",
                          )
                        : "";

                      const hasCustomUrlDraft =
                        Object.prototype.hasOwnProperty.call(
                          customUrls,
                          profile.profileId,
                        );
                      const displayUrlValue = hasCustomUrlDraft
                        ? customUrls[profile.profileId]
                        : savedCustomUrlHasPath
                        ? toFullBalanceUrl(profile.baseUrl, savedCustomUrl)
                        : getNewApiUserFormatValue(profile.profileId)
                        ? toFullBalanceUrl(profile.baseUrl, "/api/user/self")
                        : autoFixedDisplayUrl ||
                          toFullBalanceUrl(profile.baseUrl, savedCustomUrl);
                      const hasFixedUrl = !!displayUrlValue.trim();

                      return (
                        <input
                          className={`nextchat-input-control ${
                            hasFixedUrl ? styles.fixedUrlInput : ""
                          }`}
                          type="text"
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          data-lpignore="true"
                          data-1p-ignore="true"
                          data-bwignore="true"
                          data-form-type="other"
                          name={`balance-custom-url-${profile.profileId}`}
                          value={displayUrlValue}
                          onChange={(event) => {
                            setCustomUrls((value) => ({
                              ...value,
                              [profile.profileId]: event.target.value,
                            }));
                            markConfigEdited();
                          }}
                          placeholder={isAutoFixed ? "" : "自定义余额查询 URL"}
                          disabled={isLoading || isBalanceQueryRunning}
                        />
                      );
                    })()}
                  </div>
                  <IconButton
                    icon={<ReloadIcon />}
                    type="green"
                    className={`${styles.actionButton} nextchat-action-button`}
                    text={
                      queryingProfileIds.includes(profile.profileId)
                        ? "获取中..."
                        : "获取余额"
                    }
                    disabled={
                      isLoading ||
                      working === "all" ||
                      profiles.length === 0 ||
                      savingProfileIds.includes(profile.profileId) ||
                      queryingProfileIds.includes(profile.profileId)
                    }
                    onClick={() => void queryOne(profile.profileId)}
                  />
                </div>
                </div>
                {!queryStatusMap[profile.profileId] && (
                  <div
                    className={
                      profile.lastError
                        ? styles.statusError
                        : recentlyUpdatedIds.has(profile.profileId)
                        ? styles.balanceUpdated
                        : styles.hint
                    }
                  >
                    {profile.lastError
                      ? `上次查询：失败（${profile.lastError}）`
                      : profile.balance
                      ? `更新时间：${new Date(
                          profile.balance.queriedAt,
                        ).toLocaleString("zh-CN", { hour12: false })}`
                      : "尚未查询"}
                  </div>
                )}
                <div className={styles.cardFooter}>
                  {queryStatusMap[profile.profileId] && (
                    <div className={styles.footerStatus}>
                      {queryStatusMap[profile.profileId] && (
                        <div
                          className={
                            queryStatusMap[profile.profileId].type === "error"
                              ? styles.statusError
                              : styles.statusSuccess
                          }
                        >
                          <div>{queryStatusMap[profile.profileId].text}</div>
                          {queryStatusMap[profile.profileId].type === "error" &&
                            (() => {
                              const status = queryStatusMap[profile.profileId];
                              const atts: ProviderBalanceAttempt[] =
                                "attempts" in status &&
                                Array.isArray(status.attempts)
                                  ? status.attempts
                                  : [];
                              if (atts.length === 0) return null;
                              const okAtts = atts.filter((a) => a.ok);
                              const failAtts = atts.filter((a) => !a.ok);
                              const modeTag =
                                status.mode === "custom"
                                  ? "（指定 URL）"
                                  : "（兼容已有配置）";
                              return (
                                <div className={styles.attemptsLog}>
                                  <div className={styles.attemptsSummary}>
                                    上游尝试 {atts.length} 次：成功 {okAtts.length}
                                    ，失败 {failAtts.length} {modeTag}
                                  </div>
                                  {[
                                    ...new Set(
                                      atts.map((attempt) =>
                                        toFullBalanceUrl(
                                          attempt.baseUrl,
                                          attempt.path,
                                        ),
                                      ),
                                    ),
                                  ].map((url) => (
                                    <div key={url}>{url}</div>
                                  ))}
                                </div>
                              );
                            })()}
                        </div>
                      )}
                    </div>
                  )}
                  <IconButton
                    icon={<TrashIcon />}
                    text="删除配置"
                    type="danger"
                    className={`${styles.actionButton} nextchat-danger-button-filled`}
                    disabled={isBatchOperationRunning}
                    onClick={() => void deleteApiProfile(profile.profileId)}
                  />
                </div>
              </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
