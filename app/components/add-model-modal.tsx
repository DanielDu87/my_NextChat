import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { useAppConfig } from "../store/config";
import { useModelCacheStore } from "../store/model-cache";
import { Selector } from "./ui-lib";
import {
  fetchModelsFromProvider,
  inferVendorFromModelName,
  modelsToCustomModelsString,
} from "../utils/models";
import { getProfileProviderId, ApiProfile } from "../utils/provider-sync";
import {
  compareModelsBySeriesVersion,
  compareProviderDisplayNames,
} from "../utils/model-series-order";
import { LLMModel } from "../client/api";
import DownIcon from "../icons/down.svg";
import ConfirmIcon from "../icons/confirm.svg";
import BotIconDefault from "../icons/llm-icons/default.svg";
import { getEffectiveProviderBaseUrl } from "../utils/provider-url";
import { loadProviderBalanceProfiles } from "../utils/provider-balance";
import clsx from "clsx";

// 移除文字自适应缩放功能，改用 CSS overflow: hidden + hover 滚动

// 模块级缓存用于本次页面生命周期；跨刷新由 model-cache-store 持久化。
const modelCache = new Map<string, { models: LLMModel[]; total: number }>();

function normalizeModelAlias(name: unknown) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\bgpt-40\b/g, "gpt-4o")
    .replace(/\bgpt-40(?=[-_.])/g, "gpt-4o")
    .replace(/\bchatgpt-40\b/g, "chatgpt-4o")
    .replace(/\bchatgpt-40(?=[-_.])/g, "chatgpt-4o");
}

function dedupeFetchedModels(models: LLMModel[]) {
  const modelMap = new Map<string, LLMModel>();

  models.forEach((model) => {
    const key = `${normalizeModelAlias(model.name)}@${String(
      model.provider?.id || "",
    ).toLowerCase()}`;
    if (key === "@" || modelMap.has(key)) {
      return;
    }
    modelMap.set(key, model);
  });

  return [...modelMap.values()];
}

function createModelFromCachedName(
  rawModelName: string,
  profile: ApiProfile,
  providerId: string,
  sorted: number,
): LLMModel {
  const inferredVendor = inferVendorFromModelName(rawModelName);
  return {
    name: rawModelName,
    displayName: rawModelName,
    available: true,
    sorted,
    provider: {
      id: providerId,
      providerName: profile.provider,
      providerType: profile.provider === "Local" ? "openai" : "custom",
      sorted: 0,
    },
    vendor: inferredVendor
      ? {
          id: -1,
          name: inferredVendor.name,
          icon: inferredVendor.icon,
        }
      : undefined,
  };
}

function sortModelsForSelector(models: LLMModel[]) {
  const normalizedModels = models.map((model) => {
    const inferredVendor = inferVendorFromModelName(model.name);
    if (!inferredVendor) return model;

    return {
      ...model,
      vendor: {
        id: model.vendor?.id ?? -1,
        name: inferredVendor.name,
        icon: inferredVendor.icon,
      },
    };
  });

  return dedupeFetchedModels(normalizedModels)
    .sort(compareModelsBySeriesVersion)
    .map((model, index) => ({ ...model, sorted: index }));
}

function parseCachedModelNames(cachedModels?: string) {
  return String(cachedModels || "")
    .split(",")
    .map((item) => item.trim().replace(/^[+-]/, ""))
    .filter(Boolean);
}

export function AddModelSelector(props: {
  onClose: () => void;
  profiles: ApiProfile[];
  initialProviderId: string;
  providerIdResolver?: (profile: ApiProfile) => string;
  managedModelKeys?: string[];
  runtimeModels?: LLMModel[];
  onAddModels?: (keys: string[]) => void;
  onRemoveModel?: (keys: string[]) => void;
}) {
  const config = useAppConfig();
  const {
    profiles,
    initialProviderId,
    onClose,
    providerIdResolver,
    managedModelKeys,
    runtimeModels,
    onAddModels,
    onRemoveModel,
  } = props;
  const resolveProviderId = useCallback(
    (profile: ApiProfile) =>
      String(
        (providerIdResolver || getProfileProviderId)(profile) || "",
      ).trim(),
    [providerIdResolver],
  );
  const [selectedProviderId, setSelectedProviderId] =
    useState(initialProviderId);
  const [fetchedModels, setFetchedModels] = useState<LLMModel[]>([]);
  const [fetchedTotal, setFetchedTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [pendingSelection, setPendingSelection] = useState<string[]>([]);
  const [showAdded, setShowAdded] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customModelName, setCustomModelName] = useState("");
  const [customModelError, setCustomModelError] = useState("");
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [selectorResetKey, setSelectorResetKey] = useState(0);
  const fetchCancelRef = useRef(false);
  const customModelPopoverRef = useRef<HTMLDivElement>(null);
  const customModelTriggerRef = useRef<HTMLButtonElement>(null);
  const modelCacheProfiles = useModelCacheStore((state) => state.profiles);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const activeProfile = useMemo(
    () =>
      profiles.find(
        (p) => resolveProviderId(p).toLowerCase() === selectedProviderId,
      ),
    [profiles, resolveProviderId, selectedProviderId],
  );

  const addedModelKeys = useMemo(() => {
    if (managedModelKeys) {
      return new Set(
        managedModelKeys
          .map((m) => String(m || "").trim())
          .filter(Boolean)
          .map((m) => m.replace(/^[+-]/, "")),
      );
    }
    const customModels = config.customModels || "";
    return new Set(
      customModels
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
        .map((m) => m.replace(/^[+-]/, "")),
    );
  }, [config.customModels, managedModelKeys]);

  const addedModelsList = useMemo(() => {
    return Array.from(addedModelKeys)
      .filter((key) => {
        const atIdx = key.lastIndexOf("@");
        const provider = atIdx > 0 ? key.substring(atIdx + 1) : "";
        return provider === selectedProviderId;
      })
      .map((key) => {
        const atIdx = key.lastIndexOf("@");
        const name = atIdx > 0 ? key.substring(0, atIdx) : key;
        return { key, name };
      })
      .sort(compareModelsBySeriesVersion);
  }, [addedModelKeys, selectedProviderId]);

  const sortedProfiles = useMemo(
    () =>
      profiles
        .slice()
        .sort((left, right) =>
          compareProviderDisplayNames(
            left.name || String(left.provider),
            right.name || String(right.provider),
          ),
        ),
    [profiles],
  );

  const loadCachedModels = useCallback(() => {
    if (!activeProfile) return false;

    const cached = modelCache.get(selectedProviderId);
    if (cached) {
      const sorted = sortModelsForSelector(cached.models);
      modelCache.set(selectedProviderId, { ...cached, models: sorted });
      setFetchedModels(sorted);
      setFetchedTotal(cached.total);
      setLoading(false);
      return true;
    }

    if (typeof window !== "undefined") {
      try {
        const localData = localStorage.getItem(
          `nextchat-fetched-models-${activeProfile.id}`,
        );
        if (localData) {
          const parsed = JSON.parse(localData);
          if (
            parsed &&
            Array.isArray(parsed.models) &&
            parsed.models.length > 0
          ) {
            const sorted = sortModelsForSelector(parsed.models);
            const total = Number(parsed.total || 0) || sorted.length;
            modelCache.set(selectedProviderId, { models: sorted, total });
            setFetchedModels(sorted);
            setFetchedTotal(total);
            setLoading(false);
            return true;
          }
        }
      } catch (e) {
        console.error(
          "[ModelManager] Failed to load models from localStorage",
          e,
        );
      }
    }

    const profileCache = modelCacheProfiles?.[activeProfile.id];
    if (profileCache?.models && profileCache.models.length > 0) {
      const sorted = sortModelsForSelector(profileCache.models);
      const total = Number(profileCache.modelCount || 0) || sorted.length;
      modelCache.set(selectedProviderId, { models: sorted, total });
      setFetchedModels(sorted);
      setFetchedTotal(total);
      setLoading(false);
      return true;
    }

    const sourceRuntimeModels = runtimeModels || config.models || [];
    const providerModels = sourceRuntimeModels.filter(
      (model) =>
        String(model.provider?.id || "").toLowerCase() === selectedProviderId,
    );
    if (providerModels.length > 0) {
      const sorted = sortModelsForSelector(providerModels);
      const total =
        Number(profileCache?.modelCount || activeProfile.modelCount || 0) ||
        sorted.length;
      modelCache.set(selectedProviderId, { models: sorted, total });
      setFetchedModels(sorted);
      setFetchedTotal(total);
      setLoading(false);
      return true;
    }

    const cachedModelNames = parseCachedModelNames(
      profileCache?.cachedModels || activeProfile.cachedModels,
    );
    if (cachedModelNames.length > 0) {
      const cachedModels = cachedModelNames.map((name, index) =>
        createModelFromCachedName(
          name,
          activeProfile,
          selectedProviderId,
          index,
        ),
      );
      const sorted = sortModelsForSelector(cachedModels);
      const total =
        Number(profileCache?.modelCount || activeProfile.modelCount || 0) ||
        cachedModelNames.length;
      modelCache.set(selectedProviderId, { models: sorted, total });
      setFetchedModels(sorted);
      setFetchedTotal(total);
      setLoading(false);
      return true;
    }

    return false;
  }, [
    activeProfile,
    config.models,
    modelCacheProfiles,
    runtimeModels,
    selectedProviderId,
  ]);

  // 打开或切换供应商时优先显示本地缓存；没有缓存才显示空列表。
  useEffect(() => {
    if (!activeProfile) return;
    fetchCancelRef.current = false;
    setFetchError("");
    setLoading(false);
    if (!loadCachedModels()) {
      setFetchedModels([]);
      setFetchedTotal(0);
    }
  }, [activeProfile, loadCachedModels, selectedProviderId]);

  const fetchRemoteModels = useCallback(async () => {
    if (!activeProfile) return;
    fetchCancelRef.current = false;
    setFetchError("");
    setLoading(true);
    console.log(
      `[ModelManager] 🔄 正在获取 ${activeProfile.name} 平台的模型...`,
    );

    const p = activeProfile as any;
    const modelFetchKey =
      p.modelFetchApiKey || p.apiKeyGroups?.default || p.apiKey;
    const apiKeyGroups = { ...(p.apiKeyGroups || {}) };
    const multiKeyGroupOrder = [...(p.multiKeyGroupOrder || [])];

    // 余额查询密钥常与模型目录接口共用；它只作为本次请求的兜底，
    // 不写回模型分组或访问态，避免把管理密钥误保存为业务分组密钥。
    try {
      const balanceProfile = (await loadProviderBalanceProfiles()).find(
        (profile) => profile.profileId === activeProfile.id,
      );
      const balanceQueryKey = balanceProfile?.managementKey?.trim();
      const configuredKeys = new Set([
        modelFetchKey,
        ...Object.values(apiKeyGroups),
      ]);
      if (balanceQueryKey && !configuredKeys.has(balanceQueryKey)) {
        apiKeyGroups.__balance_query_key = balanceQueryKey;
        multiKeyGroupOrder.unshift("__balance_query_key");
        console.log(
          `[ModelManager] 🔑 ${activeProfile.name} 模型获取已加入余额查询 Key 兜底`,
        );
      }
    } catch (error) {
      console.warn(
        `[ModelManager] ⚠️ ${activeProfile.name} 读取余额查询 Key 失败，将继续使用已配置模型 Key`,
        error instanceof Error ? error.message : String(error),
      );
    }

    if (fetchCancelRef.current) return;

    fetchModelsFromProvider(
      activeProfile.provider,
      getEffectiveProviderBaseUrl(
        activeProfile.provider,
        activeProfile.baseUrl,
      ),
      modelFetchKey,
      activeProfile.name,
      apiKeyGroups,
      multiKeyGroupOrder,
      activeProfile.openAICompatible,
      {
        authType: p.authType,
        authQueryParam: p.authQueryParam,
        extraHeaders: p.extraHeaders,
      },
    )
      .then((result) => {
        if (fetchCancelRef.current) return;
        if (result.models.length === 0) {
          setFetchError("未获取到模型，请检查网络或 API Key 配置");
        } else {
          const uniqueModels = dedupeFetchedModels(result.models);
          if (uniqueModels.length !== result.models.length) {
            console.log(
              `[ModelManager] 模型去重：${result.models.length} -> ${uniqueModels.length}`,
            );
          }
          const sorted = uniqueModels
            .sort(compareModelsBySeriesVersion)
            .map((model, index) => ({ ...model, sorted: index }));
          console.log(
            `[ModelManager] ✅ 已获取到 ${activeProfile.name} 平台的模型 ${sorted.length} 个`,
          );
          modelCache.set(selectedProviderId, {
            models: sorted,
            total: result.total || sorted.length,
          });
          useModelCacheStore.getState().upsertProfileCache?.(activeProfile.id, {
            cachedModels: modelsToCustomModelsString(result.models),
            models: sorted,
            modelCount: result.total || sorted.length,
            source: "remote",
            syncStatus: "ready",
            hydrated: true,
            hasRemoteChecked: true,
            lastSyncAt: Date.now(),
            lastError: undefined,
          });
          if (typeof window !== "undefined") {
            try {
              localStorage.setItem(
                `nextchat-fetched-models-${activeProfile.id}`,
                JSON.stringify({
                  models: sorted,
                  total: result.total || sorted.length,
                }),
              );
            } catch (e) {
              console.error(
                "[ModelManager] Failed to save models to localStorage",
                e,
              );
            }
          }
          setFetchedModels(sorted);
          setFetchedTotal(result.total || sorted.length);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (fetchCancelRef.current) return;
        const msg =
          err instanceof Error ? err.message : String(err || "未知错误");
        setFetchError(msg);
        setLoading(false);
      });
  }, [activeProfile, selectedProviderId]);

  useEffect(() => {
    return () => {
      fetchCancelRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!showCustomInput) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        customModelPopoverRef.current?.contains(target) ||
        customModelTriggerRef.current?.contains(target)
      ) {
        return;
      }
      setShowCustomInput(false);
      setCustomModelError("");
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [showCustomInput]);

  const removeModel = useCallback(
    (key: string) => {
      if (managedModelKeys) {
        const atIdx = key.lastIndexOf("@");
        const modelName = atIdx > 0 ? key.substring(0, atIdx) : key;
        console.log(`[ModelManager] ➖ 删除模型: ${modelName}`);
        onRemoveModel?.([key]);
        return;
      }
      const customModels = config.customModels || "";
      const models = customModels
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);
      const updated = models.filter((m) => {
        const cleaned = m.replace(/^[+-]/, "");
        return cleaned !== key;
      });
      const atIdx = key.lastIndexOf("@");
      const modelName = atIdx > 0 ? key.substring(0, atIdx) : key;
      console.log(`[ModelManager] ➖ 删除模型: ${modelName}`);
      config.update((state) => {
        state.customModels = updated.join(",");
        (state as any).customModelsUpdatedAt = Date.now();
      });
      onRemoveModel?.([key]);
    },
    [config, managedModelKeys, onRemoveModel],
  );

  const removeAll = useCallback(() => {
    if (managedModelKeys) {
      const removed = managedModelKeys
        .map((m) => String(m || "").replace(/^[+-]/, ""))
        .filter((cleaned) => {
          const atIdx = cleaned.lastIndexOf("@");
          const provider = atIdx > 0 ? cleaned.substring(atIdx + 1) : "";
          return provider === selectedProviderId;
        });
      console.log(
        `[ModelManager] 🗑️ 全部删除 ${removed.length} 个模型: ${removed.join(
          "、",
        )}`,
      );
      onRemoveModel?.(removed);
      return;
    }
    const customModels = config.customModels || "";
    const models = customModels
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const removed = models.filter((m) => {
      const cleaned = m.replace(/^[+-]/, "");
      const atIdx = cleaned.lastIndexOf("@");
      const provider = atIdx > 0 ? cleaned.substring(atIdx + 1) : "";
      return provider === selectedProviderId;
    });
    const updated = models.filter((m) => {
      const cleaned = m.replace(/^[+-]/, "");
      const atIdx = cleaned.lastIndexOf("@");
      const provider = atIdx > 0 ? cleaned.substring(atIdx + 1) : "";
      return provider !== selectedProviderId;
    });
    console.log(
      `[ModelManager] 🗑️ 全部删除 ${removed.length} 个模型: ${removed.join(
        "、",
      )}`,
    );
    config.update((state) => {
      state.customModels = updated.join(",");
      (state as any).customModelsUpdatedAt = Date.now();
    });
    onRemoveModel?.(removed.map((model) => model.replace(/^[+-]/, "")));
  }, [config, managedModelKeys, onRemoveModel, selectedProviderId]);

  const candidateFetchedModels = fetchedModels;

  const selectorItems = useMemo(() => {
    // 已添加模式：只显示已添加的模型，右边显示删除按钮
    if (showAdded) {
      return addedModelsList.map((model) => {
        const modelName = model.key.split("@")[0];
        const fetchedModel = candidateFetchedModels.find(
          (m) => m.name === modelName,
        );
        return {
          title: model.name,
          value: model.key,
          group:
            fetchedModel?.vendor?.name ||
            fetchedModel?.provider?.providerName ||
            "Added",
          disable: false,
          searchText: model.name,
          rightAction: {
            text: "删除",
            onClick: (value: string) => removeModel(value),
          },
        };
      });
    }

    // 添加模式：显示所有可获取的模型
    return candidateFetchedModels.map((model) => {
      const modelKey = `${model.name}@${selectedProviderId}`;
      const isAdded = addedModelKeys.has(modelKey);
      return {
        title: model.displayName || model.name,
        value: modelKey,
        group: model.vendor?.name || model.provider?.providerName || "Other",
        disable: isAdded,
        searchText: `${model.displayName} ${model.name}`,
        order: model.sorted,
        publishedAt: model.publishedAt,
        publishedAtSource: model.publishedAtSource,
        catalogRank: model.catalogRank,
        remoteRank: model.remoteRank,
        remoteRankSource: model.remoteRankSource,
        sortKey: model.name,
        meta: {
          category: model.category,
          categorySource: model.categorySource,
          type: model.type,
          types: model.types,
          features: model.features,
          capabilities: model.capabilities,
          categories: model.categories,
          vendorName: model.vendor?.name,
        },
      };
    });
  }, [
    showAdded,
    addedModelsList,
    candidateFetchedModels,
    addedModelKeys,
    selectedProviderId,
    removeModel,
  ]);

  const handleSelectionChange = useCallback(
    (selected: string[]) => {
      setPendingSelection(selected.filter((s) => !addedModelKeys.has(s)));
    },
    [addedModelKeys],
  );

  const handleConfirm = useCallback(() => {
    if (pendingSelection.length === 0) return;
    if (managedModelKeys) {
      onAddModels?.(pendingSelection);
      setPendingSelection([]);
      onClose();
      return;
    }
    const currentCustomModels = config.customModels || "";
    const currentModels = currentCustomModels
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const newModels = pendingSelection.map((m) => `+${m}`);
    const allModels = [...currentModels, ...newModels];
    const uniqueModels = Array.from(new Set(allModels));
    const after = uniqueModels.join(",");
    config.update((state) => {
      state.customModels = after;
      (state as any).customModelsUpdatedAt = Date.now();
    });

    setPendingSelection([]);
    onClose();
  }, [config, managedModelKeys, onAddModels, onClose, pendingSelection]);

  const displayName =
    activeProfile?.name || String(activeProfile?.provider || "");

  const addCustomModel = useCallback(() => {
    if (!activeProfile) return;

    const modelName = customModelName.trim();
    if (!modelName) {
      setCustomModelError("请输入模型名称");
      return;
    }

    if (modelName.includes(",")) {
      setCustomModelError("模型名称不能包含英文逗号");
      return;
    }

    const modelKey = `${modelName}@${selectedProviderId}`;
    if (addedModelKeys.has(modelKey)) {
      setCustomModelError("这个模型已经添加过了");
      return;
    }

    if (managedModelKeys) {
      onAddModels?.([modelKey]);

      const syntheticModel = createModelFromCachedName(
        modelName,
        activeProfile,
        selectedProviderId,
        fetchedModels.length,
      );
      const nextModels = sortModelsForSelector([
        ...fetchedModels,
        syntheticModel,
      ]);
      const nextTotal = Math.max(fetchedTotal, nextModels.length);

      modelCache.set(selectedProviderId, {
        models: nextModels,
        total: nextTotal,
      });
      setFetchedModels(nextModels);
      setFetchedTotal(nextTotal);
      setPendingSelection((selected) =>
        selected.filter((item) => item !== modelKey),
      );
      setCustomModelName("");
      setCustomModelError("");
      setShowCustomInput(false);
      return;
    }

    const currentModels = (config.customModels || "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const after = Array.from(new Set([...currentModels, `+${modelKey}`])).join(
      ",",
    );

    config.update((state) => {
      state.customModels = after;
      (state as any).customModelsUpdatedAt = Date.now();
    });

    const syntheticModel = createModelFromCachedName(
      modelName,
      activeProfile,
      selectedProviderId,
      fetchedModels.length,
    );
    const nextModels = sortModelsForSelector([
      ...fetchedModels,
      syntheticModel,
    ]);
    const nextTotal = Math.max(fetchedTotal, nextModels.length);

    modelCache.set(selectedProviderId, {
      models: nextModels,
      total: nextTotal,
    });
    setFetchedModels(nextModels);
    setFetchedTotal(nextTotal);
    setPendingSelection((selected) =>
      selected.filter((item) => item !== modelKey),
    );
    setCustomModelName("");
    setCustomModelError("");
    setShowCustomInput(false);
  }, [
    activeProfile,
    addedModelKeys,
    config,
    customModelName,
    fetchedModels,
    fetchedTotal,
    managedModelKeys,
    onAddModels,
    selectedProviderId,
  ]);

  const displayTotal = showAdded
    ? addedModelsList.length
    : selectorItems.length || fetchedTotal || candidateFetchedModels.length;
  const confirmDisabled = loading || pendingSelection.length === 0;

  return (
    <Selector
      className="model-selector-panel"
      title={
        fetchError ? (
          <span style={{ color: "var(--danger-color)" }}>
            获取 {displayName} 模型失败：{fetchError}
          </span>
        ) : null
      }
      items={selectorItems}
      multiple={true}
      showSearch={true}
      showGroupFilter={true}
      sortGroupsAlphabetically={true}
      hiddenGroupFilterOptions={["已添加", "Added"]}
      itemsArePreSorted={true}
      disableOpenAnimation={true}
      disableHoverAnimation={true}
      onSelection={handleSelectionChange}
      onClose={handleClose}
      resetKey={selectorResetKey}
      enableVirtualization={true}
      virtualizationThreshold={50}
      headerHint={
        <div className={"model-selector-hint"}>
          <span className={"model-selector-hint-label"}>当前供应商</span>
          <button
            type="button"
            className={clsx(
              "model-selector-hint-provider-button",
              "nextchat-default-button",
              "nextchat-pill-button",
              "nextchat-no-hover-motion",
              providerDropdownOpen && "model-selector-provider-open",
            )}
            onClick={() => setProviderDropdownOpen(!providerDropdownOpen)}
          >
            <span>
              {displayName}
              <span className={"model-selector-hint-count-inline"}>
                （
                {loading
                  ? "获取中"
                  : fetchError
                  ? "获取失败"
                  : `${displayTotal} 个模型`}
                ）
              </span>
            </span>
            <DownIcon />
          </button>
          {!loading && !fetchError && displayTotal === 0 ? (
            <button
              type="button"
              className={clsx(
                "model-selector-hint-count",
                "model-selector-hint-fetch",
                "nextchat-default-button",
                "nextchat-pill-button",
                "nextchat-no-hover-motion",
              )}
              onClick={fetchRemoteModels}
            >
              点击获取模型
            </button>
          ) : (
            <span className={"model-selector-hint-count"}>
              {loading
                ? "正在获取模型..."
                : fetchError
                ? "获取失败，请检查网络或配置"
                : `共 ${displayTotal} 个模型可用`}
            </span>
          )}
          {!loading && (displayTotal > 0 || fetchError) ? (
            <button
              type="button"
              onClick={fetchRemoteModels}
              className={clsx(
                "model-selector-hint-fetch",
                "nextchat-default-button",
                "nextchat-pill-button",
                "nextchat-no-hover-motion",
              )}
            >
              重新获取
            </button>
          ) : null}
          {providerDropdownOpen && (
            <div
              className={clsx(
                "model-selector-provider-menu",
                "nextchat-selector-menu",
                "nextchat-no-hover-motion",
              )}
            >
              {sortedProfiles.map((p) => {
                const pid = resolveProviderId(p).toLowerCase();
                const pName = p.name || String(p.provider);
                const isActive = pid === selectedProviderId;
                return (
                  <button
                    type="button"
                    key={p.id}
                    className={clsx(
                      "model-selector-provider-option",
                      "nextchat-menu-option",
                      "nextchat-menu-option-bordered",
                      "nextchat-no-hover-motion",
                      "nextchat-selector-menu-option",
                      isActive && "model-selector-provider-option-active",
                      isActive && "nextchat-menu-option-active",
                      isActive && "nextchat-selector-menu-option-active",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedProviderId(pid);
                      setProviderDropdownOpen(false);
                      setPendingSelection([]);
                      setSelectorResetKey((k) => k + 1);
                    }}
                  >
                    <span
                      className={clsx(
                        "model-selector-provider-option-leading",
                        "nextchat-selector-menu-option-leading",
                      )}
                    >
                      <div className="no-dark">
                        <BotIconDefault
                          className={clsx(
                            "model-selector-provider-default-icon",
                            "nextchat-selector-menu-icon-image",
                          )}
                          width={16}
                          height={16}
                          viewBox="0 0 30 30"
                          preserveAspectRatio="xMidYMid meet"
                        />
                      </div>
                    </span>
                    <span className="model-selector-provider-option-text">
                      {pName}
                    </span>
                    {isActive ? (
                      <ConfirmIcon className="nextchat-model-selector-check" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      }
      footer={
        <>
          {showCustomInput ? (
            <div
              className="nextchat-modal-custom-popover"
              ref={customModelPopoverRef}
            >
              <form
                className="nextchat-modal-custom-form"
                autoComplete="off"
                onSubmit={(event) => {
                  event.preventDefault();
                  addCustomModel();
                }}
              >
                <div className="nextchat-modal-custom-title">
                  添加自定义模型到 {displayName}
                </div>
                <div className="nextchat-modal-custom-row">
                  <input
                    className="nextchat-input-control model-selector-custom-input"
                    name="custom-model-name"
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    value={customModelName}
                    onChange={(event) => {
                      setCustomModelName(event.currentTarget.value);
                      setCustomModelError("");
                    }}
                    autoFocus
                    placeholder="输入模型名称，例如 gpt-4.1-custom"
                  />
                  <button
                    type="submit"
                    className={clsx(
                      "nextchat-pill-button",
                      "nextchat-green-button",
                    )}
                  >
                    添加
                  </button>
                  <button
                    type="button"
                    className={clsx(
                      "nextchat-pill-button",
                      "nextchat-default-button",
                    )}
                    onClick={() => {
                      setShowCustomInput(false);
                      setCustomModelError("");
                    }}
                  >
                    取消
                  </button>
                </div>
                {customModelError ? (
                  <div className="nextchat-modal-custom-error">
                    {customModelError}
                  </div>
                ) : null}
              </form>
            </div>
          ) : null}
          <div
            className={clsx("nextchat-modal-footer", {
              "nextchat-modal-footer-show-added": showAdded,
            })}
          >
            {showAdded ? (
              <>
                <div className="nextchat-modal-footer-group">
                  <button
                    type="button"
                    onClick={() => setShowAdded(false)}
                    className={clsx(
                      "nextchat-pill-button",
                      "nextchat-default-button",
                    )}
                  >
                    浏览模型
                  </button>
                  <button
                    type="button"
                    onClick={removeAll}
                    disabled={addedModelsList.length === 0}
                    className={clsx(
                      "nextchat-pill-button",
                      "nextchat-danger-button",
                    )}
                  >
                    全部删除
                  </button>
                </div>
                <div className="nextchat-modal-footer-group">
                  <button
                    type="button"
                    onClick={onClose}
                    className={clsx(
                      "nextchat-pill-button",
                      "nextchat-default-button",
                    )}
                  >
                    关闭
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="nextchat-modal-footer-group">
                  <button
                    type="button"
                    onClick={() => setShowAdded(true)}
                    className={clsx(
                      "nextchat-pill-button",
                      "nextchat-default-button",
                    )}
                  >
                    已添加 ({addedModelsList.length})
                  </button>
                  <button
                    type="button"
                    ref={customModelTriggerRef}
                    onClick={() => {
                      setShowCustomInput((visible) => !visible);
                      setCustomModelError("");
                    }}
                    className={clsx(
                      "nextchat-pill-button",
                      "nextchat-default-button",
                    )}
                  >
                    自定义模型
                  </button>
                </div>
                <div className="nextchat-modal-footer-group">
                  {pendingSelection.length > 0 && (
                    <span className="nextchat-modal-count">
                      已选 {pendingSelection.length} 个
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={confirmDisabled}
                    onClick={handleConfirm}
                    className={clsx(
                      "nextchat-pill-button",
                      "nextchat-green-button",
                    )}
                  >
                    确认添加
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className={clsx(
                      "nextchat-pill-button",
                      "nextchat-default-button",
                    )}
                  >
                    关闭
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      }
    />
  );
}
