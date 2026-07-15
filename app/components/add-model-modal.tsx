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
import { getModelDisplayGroup } from "../utils/model-display-group";
import { pruneMissingAddedModelsWithDetails } from "../utils/model-added-prune";
import { LLMModel } from "../client/api";
import DownIcon from "../icons/down.svg";
import ConfirmIcon from "../icons/confirm.svg";
import BotIconDefault from "../icons/llm-icons/default.svg";
import { getEffectiveProviderBaseUrl } from "../utils/provider-url";
import {
  isModelIdentifierStoredAsVendor,
  isOcoolaiProprietaryModelName,
} from "../utils/model-vendor-normalize";
import clsx from "clsx";

function logModelsByVendorGroup(models: LLMModel[]) {
  const groups = new Map<string, LLMModel[]>();
  models.forEach((model) => {
    const vendor = getModelDisplayGroup({
      modelName: model?.name,
      displayName: model?.displayName,
      vendorName: model?.vendor?.name,
      providerName: model?.provider?.providerName,
    });
    const groupedModels = groups.get(vendor) || [];
    groupedModels.push(model);
    groups.set(vendor, groupedModels);
  });
  [...groups]
    .sort(([left], [right]) => compareProviderDisplayNames(left, right))
    .forEach(([vendor, groupedModels]) => {
      const sortedModels = [...groupedModels].sort(
        compareModelsBySeriesVersion,
      );
      console.groupCollapsed(
        `【模型公司】${vendor}（${sortedModels.length} 个）`,
      );
      sortedModels.forEach((model) => console.log(model.name));
      console.groupEnd();
    });
}

function logCachedModelsLoad(
  profileName: string,
  source: string,
  modelCount: number,
) {
  console.log(`【模型缓存】从 ${source} 加载 ${profileName}：${modelCount} 个`);
}

function logNoCachedModels(profileName: string) {
  console.log(`【模型缓存】${profileName} 无本地缓存，需手动获取`);
}

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
    if (
      String(model.provider?.id || "")
        .toLowerCase()
        .includes("ocool") &&
      isOcoolaiProprietaryModelName(model.name)
    ) {
      return {
        ...model,
        vendor: { id: -4, name: "Ocoolai", icon: "Box" },
      };
    }

    const inferredVendor = inferVendorFromModelName(model.name);
    if (inferredVendor) {
      return {
        ...model,
        vendor: {
          id: model.vendor?.id ?? -1,
          name: inferredVendor.name,
          icon: inferredVendor.icon,
        },
      };
    }

    // 旧 Ocoolai 缓存会把完整模型 ID 写为 vendor，避免为每个模型生成一张伪分组卡。
    if (
      String(model.provider?.id || "")
        .toLowerCase()
        .includes("ocool") &&
      isModelIdentifierStoredAsVendor(model.name, model.vendor?.name)
    ) {
      return {
        ...model,
        vendor: { id: -4, name: "Ocoolai", icon: "Box" },
      };
    }

    return model;
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
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [selectorResetKey, setSelectorResetKey] = useState(0);
  const fetchCancelRef = useRef(false);
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
    const profileName = activeProfile.name || String(activeProfile.provider);

    const cached = modelCache.get(selectedProviderId);
    if (cached) {
      const sorted = sortModelsForSelector(cached.models);
      modelCache.set(selectedProviderId, { ...cached, models: sorted });
      setFetchedModels(sorted);
      setFetchedTotal(cached.total);
      setLoading(false);
      logCachedModelsLoad(profileName, "内存缓存", sorted.length);
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
            logCachedModelsLoad(profileName, "localStorage", sorted.length);
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
      logCachedModelsLoad(profileName, "ModelCacheStore", sorted.length);
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
      logCachedModelsLoad(profileName, "运行时模型", sorted.length);
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
      logCachedModelsLoad(profileName, "缓存模型名", sorted.length);
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
    const profileName = activeProfile.name || String(activeProfile.provider);
    fetchCancelRef.current = false;
    setFetchError("");
    setLoading(false);
    if (!loadCachedModels()) {
      logNoCachedModels(profileName);
      setFetchedModels([]);
      setFetchedTotal(0);
    }
  }, [activeProfile, loadCachedModels, selectedProviderId]);

  const fetchRemoteModels = useCallback(async () => {
    if (!activeProfile) return;
    fetchCancelRef.current = false;
    setFetchError("");
    setLoading(true);
    console.clear();

    const p = activeProfile as any;
    const modelFetchKey = String(p.modelFetchApiKey || "").trim();
    const modelFetchUrl = String(p.modelFetchUrl || "").trim();
    console.log(`【正在获取】${activeProfile.name}`);
    console.log(`【请求URL】${modelFetchUrl || "(默认)"}`);
    if (!modelFetchKey || !modelFetchUrl) {
      setLoading(false);
      setFetchError("请先在模型获取配置页面填写 API Key 和获取 URL");
      return;
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
      {},
      [],
      activeProfile.openAICompatible,
      {
        authType: p.authType,
        authQueryParam: p.authQueryParam,
        extraHeaders: p.extraHeaders,
        modelFetchUrl,
        silentLogs: true,
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
              `【模型去重】${result.models.length} -> ${uniqueModels.length}`,
            );
          }
          const sorted = uniqueModels
            .sort(compareModelsBySeriesVersion)
            .map((model, index) => ({ ...model, sorted: index }));
          console.log(`【模型总数】${sorted.length} 个`);
          logModelsByVendorGroup(sorted);

          // 清理不再提供的模型（仅检查当前供应商）
          const currentCustomModels = String(
            useAppConfig.getState().customModels || "",
          );
          const providerId = String(
            getProfileProviderId(activeProfile),
          ).toLowerCase();
          console.log(`【开始检查】${displayName} 的已添加模型`);
          const pruneResult = pruneMissingAddedModelsWithDetails(
            currentCustomModels,
            [providerId],
            sorted.map((m) => m.name),
          );
          if (pruneResult.customModels !== currentCustomModels) {
            console.log(
              `【模型清理】需要清理 ${pruneResult.removedModelNames.length} 个，已清理 ${pruneResult.removedModelNames.length} 个`,
            );
            pruneResult.removedModelNames.forEach((modelName) =>
              console.log(`【清理模型】${modelName}`),
            );
            useAppConfig.getState().update((state: any) => {
              state.customModels = pruneResult.customModels;
              state.customModelsUpdatedAt = Date.now();
            });
          } else {
            console.log(`【模型清理】无需清理（0 个）`);
          }

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
        console.log(`【模型获取】失败：${msg}`);
        setFetchError(msg);
        setLoading(false);
      });
  }, [activeProfile, selectedProviderId]);

  useEffect(() => {
    return () => {
      fetchCancelRef.current = true;
    };
  }, []);

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
          title: fetchedModel?.displayName || model.name,
          value: model.key,
          group: getModelDisplayGroup({
            modelName,
            displayName: fetchedModel?.displayName,
            vendorName: fetchedModel?.vendor?.name,
            providerName: fetchedModel?.provider?.providerName,
          }),
          disable: false,
          searchText: `${fetchedModel?.displayName || ""} ${model.name}`,
          order: fetchedModel?.sorted,
          publishedAt: fetchedModel?.publishedAt,
          publishedAtSource: fetchedModel?.publishedAtSource,
          catalogRank: fetchedModel?.catalogRank,
          remoteRank: fetchedModel?.remoteRank,
          remoteRankSource: fetchedModel?.remoteRankSource,
          sortKey: modelName,
          meta: {
            category: fetchedModel?.category,
            categorySource: fetchedModel?.categorySource,
            type: fetchedModel?.type,
            types: fetchedModel?.types,
            features: fetchedModel?.features,
            capabilities: fetchedModel?.capabilities,
            categories: fetchedModel?.categories,
            vendorName: fetchedModel?.vendor?.name,
          },
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
        group: getModelDisplayGroup({
          modelName: model.name,
          displayName: model.displayName,
          vendorName: model.vendor?.name,
          providerName: model.provider?.providerName,
        }),
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
          ) : !fetchError ? (
            <span className={"model-selector-hint-count"}>
              {loading ? "正在获取模型..." : `共 ${displayTotal} 个模型可用`}
            </span>
          ) : null}
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
        <div
          className={clsx("nextchat-modal-footer", {
            "nextchat-modal-footer-show-added": showAdded,
          })}
        >
          {showAdded ? (
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
          ) : (
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
          )}
        </div>
      }
    />
  );
}
