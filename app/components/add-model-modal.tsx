import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { useAppConfig, useModelCacheStore } from "../store";
import { Selector } from "./ui-lib";
import {
  fetchModelsFromProvider,
  inferVendorFromModelName,
  modelsToCustomModelsString,
} from "../utils/models";
import { getProfileProviderId, ApiProfile } from "../utils/provider-sync";
import { compareModelsForDisplay } from "../utils/model-published-at";
import { LLMModel } from "../client/api";
import DownIcon from "../icons/down.svg";
import ConfirmIcon from "../icons/confirm.svg";
import BotIconDefault from "../icons/llm-icons/default.svg";
import { getProviderIcon } from "../config/provider-icons";
import { getEffectiveProviderBaseUrl } from "../utils/provider-url";
import styles from "./chat.module.scss";
import clsx from "clsx";

// 模块级缓存：页面刷新即清空，同页面内切换供应商不重复获取。
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
  return dedupeFetchedModels(models)
    .sort((a, b) => compareModelsForDisplay(a, b))
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
}) {
  const config = useAppConfig();
  const { profiles, initialProviderId, onClose } = props;
  const [selectedProviderId, setSelectedProviderId] =
    useState(initialProviderId);
  const [fetchedModels, setFetchedModels] = useState<LLMModel[]>([]);
  const [fetchedTotal, setFetchedTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [pendingSelection, setPendingSelection] = useState<string[]>([]);
  const [showAdded, setShowAdded] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customModelName, setCustomModelName] = useState("");
  const [customModelError, setCustomModelError] = useState("");
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
        (p) => getProfileProviderId(p).toLowerCase() === selectedProviderId,
      ),
    [profiles, selectedProviderId],
  );

  const addedModelKeys = useMemo(() => {
    const customModels = config.customModels || "";
    return new Set(
      customModels
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
        .map((m) => m.replace(/^[+-]/, "")),
    );
  }, [config.customModels]);

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
      });
  }, [addedModelKeys, selectedProviderId]);

  // 切换供应商时获取模型（已有本地/持久缓存则直接使用）
  useEffect(() => {
    if (!activeProfile) return;
    fetchCancelRef.current = false;
    setFetchError("");

    const cached = modelCache.get(selectedProviderId);
    if (cached) {
      setFetchedModels(cached.models);
      setFetchedTotal(cached.total);
      setLoading(false);
      return;
    }

    const profileCache = modelCacheProfiles?.[activeProfile.id];
    const providerModels = (config.models || []).filter(
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
      return;
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
      return;
    }

    setLoading(true);
    setFetchedModels([]);
    setFetchedTotal(0);

    const p = activeProfile as any;
    const modelFetchKey =
      p.modelFetchApiKey || p.apiKeyGroups?.default || p.apiKey;

    fetchModelsFromProvider(
      activeProfile.provider,
      getEffectiveProviderBaseUrl(
        activeProfile.provider,
        activeProfile.baseUrl,
      ),
      modelFetchKey,
      activeProfile.name,
      activeProfile.apiKeyGroups,
      (activeProfile as any).multiKeyGroupOrder,
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
            .sort((a, b) => compareModelsForDisplay(a, b))
            .map((model, index) => ({ ...model, sorted: index }));
          modelCache.set(selectedProviderId, {
            models: sorted,
            total: result.total || sorted.length,
          });
          useModelCacheStore.getState().upsertProfileCache?.(activeProfile.id, {
            cachedModels: modelsToCustomModelsString(result.models),
            modelCount: result.total || sorted.length,
            source: "remote",
            syncStatus: "ready",
            hydrated: true,
            hasRemoteChecked: true,
            lastSyncAt: Date.now(),
            lastError: undefined,
          });
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
        setFetchedModels([]);
        setFetchedTotal(0);
        setLoading(false);
      });

    return () => {
      fetchCancelRef.current = true;
    };
  }, [activeProfile, config.models, modelCacheProfiles, selectedProviderId]);

  const removeModel = useCallback(
    (key: string) => {
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
    },
    [config],
  );

  const removeAll = useCallback(() => {
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
  }, [config, selectedProviderId]);

  const selectorItems = useMemo(() => {
    // 已添加模式：只显示已添加的模型，右边显示删除按钮
    if (showAdded) {
      return addedModelsList.map((model) => {
        const modelName = model.key.split("@")[0];
        const fetchedModel = fetchedModels.find((m) => m.name === modelName);
        return {
          title: model.name,
          value: model.key,
          group:
            fetchedModel?.vendor?.name ||
            fetchedModel?.provider?.providerName ||
            "已添加",
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
    return fetchedModels.map((model) => {
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
    fetchedModels,
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
  }, [config, onClose, pendingSelection]);

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
    selectedProviderId,
  ]);

  const displayTotal = fetchedTotal || fetchedModels.length;
  const confirmDisabled =
    loading || !!fetchError || pendingSelection.length === 0;

  return (
    <Selector
      title={
        loading ? (
          <>
            正在获取 <span style={{ color: "#2563eb" }}>{displayName}</span>
             模型
          </>
        ) : fetchError ? (
          <span style={{ color: "#ef4444" }}>
            获取 {displayName} 模型失败：{fetchError}
          </span>
        ) : (
          "管理模型"
        )
      }
      items={selectorItems}
      multiple={true}
      showSearch={true}
      showGroupFilter={true}
      hiddenGroupFilterOptions={["已添加", "Custom"]}
      onSelection={handleSelectionChange}
      onClose={handleClose}
      resetKey={selectorResetKey}
      enableVirtualization={true}
      virtualizationThreshold={50}
      headerHint={
        <div className={styles["model-selector-hint"]}>
          <span className={styles["model-selector-hint-label"]}>
            当前供应商
          </span>
          <button
            type="button"
            className={clsx(
              styles["model-selector-hint-provider-button"],
              providerDropdownOpen && styles["model-selector-provider-open"],
            )}
            onClick={() => setProviderDropdownOpen(!providerDropdownOpen)}
          >
            <span>
              {displayName}
              <span className={styles["model-selector-hint-count-inline"]}>
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
          <span className={styles["model-selector-hint-count"]}>
            {loading
              ? "正在获取模型..."
              : fetchError
                ? "获取失败，请检查网络或配置"
                : `共 ${displayTotal} 个模型可用`}
          </span>
          {providerDropdownOpen && (
            <div
              className={styles["model-selector-provider-menu"]}
              style={{
                flexBasis: "100%",
                width: "100%",
                position: "relative",
                zIndex: 99999999999999,
                pointerEvents: "auto",
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                gap: 10,
                padding: 12,
                borderRadius: 20,
                background: "#ffffff",
                border: "1px solid rgba(191, 219, 254, 0.95)",
                boxShadow: "0 18px 36px rgba(15, 23, 42, 0.12)",
              }}
            >
              {profiles.map((p) => {
                const pid = getProfileProviderId(p).toLowerCase();
                const pName = p.name || String(p.provider);
                const isActive = pid === selectedProviderId;
                const providerIcon =
                  getProviderIcon(p.provider) || getProviderIcon(pName);
                return (
                  <button
                    type="button"
                    key={p.id}
                    className={clsx(
                      styles["model-selector-provider-option"],
                      isActive &&
                        styles["model-selector-provider-option-active"],
                    )}
                    style={{
                      position: "relative",
                      zIndex: 99999999999999,
                      pointerEvents: "auto",
                      minHeight: 52,
                      padding: "0 16px",
                      borderRadius: 12,
                      border: "1px solid rgba(226, 232, 240, 0.95)",
                      background: isActive ? "#eff6ff" : "#ffffff",
                      color: isActive ? "#1d4ed8" : "#0f172a",
                      fontSize: 14,
                      fontWeight: isActive ? 700 : 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
                      transition:
                        "background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.15s ease",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedProviderId(pid);
                      setProviderDropdownOpen(false);
                      setPendingSelection([]);
                      setSelectorResetKey((k) => k + 1);
                    }}
                  >
                    <span
                      className={
                        styles["model-selector-provider-option-leading"]
                      }
                    >
                      {providerIcon ? (
                        <span
                          className={styles["model-selector-option-icon-frame"]}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            alt={`${pName} icon`}
                            className={
                              styles["model-selector-option-icon-image"]
                            }
                            src={providerIcon}
                          />
                        </span>
                      ) : (
                        <div className="no-dark">
                          <BotIconDefault
                            className="user-avatar"
                            width={16}
                            height={16}
                          />
                        </div>
                      )}
                    </span>
                    <span
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        minWidth: 0,
                      }}
                    >
                      {pName}
                    </span>
                    {isActive ? <ConfirmIcon /> : null}
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
            <div className={styles["add-modal-custom-popover"]}>
              <form
                className={styles["add-modal-custom-form"]}
                onSubmit={(event) => {
                  event.preventDefault();
                  addCustomModel();
                }}
              >
                <div className={styles["add-modal-custom-title"]}>
                  添加自定义模型到 {displayName}
                </div>
                <div className={styles["add-modal-custom-row"]}>
                  <input
                    className={styles["add-modal-custom-input"]}
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
                    className={styles["add-modal-btn-confirm"]}
                  >
                    添加
                  </button>
                  <button
                    type="button"
                    className={styles["add-modal-btn"]}
                    onClick={() => {
                      setShowCustomInput(false);
                      setCustomModelError("");
                    }}
                  >
                    取消
                  </button>
                </div>
                {customModelError ? (
                  <div className={styles["add-modal-custom-error"]}>
                    {customModelError}
                  </div>
                ) : null}
              </form>
            </div>
          ) : null}
          <div className={styles["add-modal-footer"]}>
            {showAdded ? (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => setShowAdded(false)}
                    className={styles["add-modal-btn"]}
                  >
                    浏览模型
                  </button>
                  <button
                    type="button"
                    onClick={removeAll}
                    disabled={addedModelsList.length === 0}
                    className={styles["add-modal-btn-danger"]}
                  >
                    全部删除
                  </button>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className={styles["add-modal-btn"]}
                >
                  关闭
                </button>
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={() => setShowAdded(true)}
                    className={styles["add-modal-btn"]}
                  >
                    已添加 ({addedModelsList.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomInput((visible) => !visible);
                      setCustomModelError("");
                    }}
                    className={styles["add-modal-btn"]}
                  >
                    自定义模型
                  </button>
                  {pendingSelection.length > 0 && (
                    <span className={styles["add-modal-count"]}>
                      已选 {pendingSelection.length} 个
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    type="button"
                    disabled={confirmDisabled}
                    onClick={handleConfirm}
                    className={styles["add-modal-btn-confirm"]}
                  >
                    确认添加
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className={styles["add-modal-btn"]}
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
