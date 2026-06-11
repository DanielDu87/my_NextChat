import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { useAppConfig } from "../store";
import { Selector } from "./ui-lib";
import { fetchModelsFromProvider } from "../utils/models";
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

// 模块级缓存：页面刷新即清空，同页面内切换供应商不重复获取
const modelCache = new Map<string, LLMModel[]>();

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
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [pendingSelection, setPendingSelection] = useState<string[]>([]);
  const [showAdded, setShowAdded] = useState(false);
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [selectorResetKey, setSelectorResetKey] = useState(0);
  const fetchCancelRef = useRef(false);

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

  // 切换供应商时获取模型（有缓存则直接使用）
  useEffect(() => {
    if (!activeProfile) return;
    fetchCancelRef.current = false;
    setFetchError("");

    const cached = modelCache.get(selectedProviderId);
    if (cached) {
      setFetchedModels(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    setFetchedModels([]);

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
          const sorted = [...result.models]
            .sort((a, b) => compareModelsForDisplay(a, b))
            .map((model, index) => ({ ...model, sorted: index }));
          modelCache.set(selectedProviderId, sorted);
          setFetchedModels(sorted);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (fetchCancelRef.current) return;
        const msg =
          err instanceof Error ? err.message : String(err || "未知错误");
        setFetchError(msg);
        setFetchedModels([]);
        setLoading(false);
      });

    return () => {
      fetchCancelRef.current = true;
    };
  }, [activeProfile, selectedProviderId]);

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
                  : `${fetchedModels.length} 个模型`}
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
              : `共 ${fetchedModels.length} 个模型可用`}
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
                {pendingSelection.length > 0 && (
                  <span className={styles["add-modal-count"]}>
                    已选 {pendingSelection.length} 个
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  disabled={pendingSelection.length === 0}
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
      }
    />
  );
}
