import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { useAppConfig } from "../store";
import { Selector } from "./ui-lib";
import { fetchModelsFromProvider } from "../utils/models";
import { getProfileProviderId, ApiProfile } from "../utils/provider-sync";
import { comparePublishedAt } from "../utils/model-published-at";
import { LLMModel } from "../client/api";
import DownIcon from "../icons/down.svg";
import ConfirmIcon from "../icons/confirm.svg";
import BotIconOpenAI from "../icons/llm-icons/openai.svg";
import { getProviderIcon } from "../config/provider-icons";
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
  const { profiles } = props;
  const [selectedProviderId, setSelectedProviderId] = useState(
    props.initialProviderId,
  );
  const [fetchedModels, setFetchedModels] = useState<LLMModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [pendingSelection, setPendingSelection] = useState<string[]>([]);
  const [showAdded, setShowAdded] = useState(false);
  const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
  const [selectorResetKey, setSelectorResetKey] = useState(0);
  const fetchCancelRef = useRef(false);

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
      p.balanceQueryApiKey ||
      p.modelFetchApiKey ||
      p.apiKeyGroups?.default ||
      p.apiKey;

    fetchModelsFromProvider(
      activeProfile.provider,
      activeProfile.baseUrl,
      modelFetchKey,
      activeProfile.name,
      activeProfile.apiKeyGroups,
    )
      .then((result) => {
        if (fetchCancelRef.current) return;
        if (result.models.length === 0) {
          setFetchError("未获取到模型，请检查网络或 API Key 配置");
        } else {
          const sorted = [...result.models]
            .sort((a, b) => comparePublishedAt(a, b))
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

  const selectorItems = useMemo(() => {
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
  }, [fetchedModels, addedModelKeys, selectedProviderId]);

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
    config.update((state) => {
      state.customModels = uniqueModels.join(",");
    });
    setPendingSelection([]);
    props.onClose();
  }, [config, pendingSelection, props.onClose]);

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
      config.update((state) => {
        state.customModels = updated.join(",");
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
    const updated = models.filter((m) => {
      const cleaned = m.replace(/^[+-]/, "");
      const atIdx = cleaned.lastIndexOf("@");
      const provider = atIdx > 0 ? cleaned.substring(atIdx + 1) : "";
      return provider !== selectedProviderId;
    });
    config.update((state) => {
      state.customModels = updated.join(",");
    });
  }, [config, selectedProviderId]);

  const displayName =
    activeProfile?.name || String(activeProfile?.provider || "");

  const btnBase: React.CSSProperties = {
    padding: "6px 14px",
    borderRadius: 8,
    border: "var(--border-in-light)",
    background: "var(--second)",
    color: "var(--primary)",
    cursor: "pointer",
    fontSize: 13,
  };

  // 已添加视图
  if (showAdded) {
    return (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          height: "100vh",
          width: "100vw",
          background: "rgba(15, 23, 42, 0.24)",
          backdropFilter: "blur(10px)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          zIndex: 99999999999999,
          padding: "44px 20px 32px",
          animation: "fadeIn 0.15s ease",
        }}
        onClick={props.onClose}
      >
        <div
          style={{
            background: "var(--second)",
            borderRadius: 12,
            boxShadow: "var(--card-shadow)",
            width: "100%",
            maxWidth: 520,
            maxHeight: "70vh",
            display: "flex",
            flexDirection: "column",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 20px",
              borderBottom: "1px solid var(--border-in-light)",
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: 16,
                color: "var(--primary)",
              }}
            >
              已添加 - {displayName} ({addedModelsList.length})
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={removeAll}
                disabled={addedModelsList.length === 0}
                style={{
                  ...btnBase,
                  fontSize: 12,
                  padding: "4px 10px",
                  borderColor:
                    addedModelsList.length > 0
                      ? "rgba(239,68,68,0.4)"
                      : undefined,
                  color: addedModelsList.length > 0 ? "#ef4444" : "var(--gray)",
                }}
              >
                全部删除
              </button>
              <button
                type="button"
                onClick={() => setShowAdded(false)}
                style={{ ...btnBase, fontSize: 12, padding: "4px 10px" }}
              >
                ← 返回添加
              </button>
              <button
                type="button"
                onClick={props.onClose}
                style={{ ...btnBase, fontSize: 12, padding: "4px 10px" }}
              >
                关闭
              </button>
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1, padding: "4px 0" }}>
            {addedModelsList.length === 0 ? (
              <div
                style={{
                  padding: "24px 20px",
                  textAlign: "center",
                  color: "var(--primary)",
                  opacity: 0.5,
                  fontSize: 14,
                }}
              >
                暂无已添加的模型
              </div>
            ) : (
              addedModelsList.map((model) => (
                <div
                  key={model.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 20px",
                    gap: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        color: "var(--primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {model.name}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeModel(model.key)}
                    style={{
                      padding: "4px 8px",
                      borderRadius: 4,
                      border: "none",
                      background: "transparent",
                      color: "#ef4444",
                      cursor: "pointer",
                      fontSize: 18,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

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
      onClose={props.onClose}
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
                          <BotIconOpenAI
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            borderTop: "1px solid var(--border-in-light)",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => setShowAdded(true)}
            style={btnBase}
          >
            已添加 ({addedModelsList.length})
          </button>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {pendingSelection.length > 0 && (
              <span
                style={{
                  fontSize: 13,
                  color: "var(--primary)",
                  opacity: 0.7,
                }}
              >
                已选 {pendingSelection.length} 个
              </span>
            )}
            <button type="button" onClick={props.onClose} style={btnBase}>
              关闭
            </button>
            <button
              type="button"
              disabled={pendingSelection.length === 0}
              onClick={handleConfirm}
              style={{
                ...btnBase,
                border: "none",
                background:
                  pendingSelection.length > 0 ? "#2563eb" : "var(--gray)",
                color: pendingSelection.length > 0 ? "#fff" : "var(--primary)",
                cursor: pendingSelection.length > 0 ? "pointer" : "not-allowed",
                fontWeight: 600,
              }}
            >
              确认添加
            </button>
          </div>
        </div>
      }
    />
  );
}
