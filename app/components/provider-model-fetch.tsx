import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import CloseIcon from "../icons/close.svg";
import ConfirmIcon from "../icons/confirm.svg";
import ReloadIcon from "../icons/reload.svg";
import { Path, StoreKey } from "../constant";
import { useAccessStore } from "../store";
import { useModelCacheStore } from "../store/model-cache";
import { useSyncStore } from "../store/sync";
import { syncProfileModels } from "../utils/provider-sync";
import {
  compareModelsBySeriesVersion,
  compareProviderDisplayNames,
} from "../utils/model-series-order";
import { getModelDisplayGroup } from "../utils/model-display-group";
import { IconButton } from "./button";
import { showConfirm, showToast } from "./ui-lib";
import styles from "./provider-balances.module.scss";

type FetchStatus = {
  type: "querying" | "success" | "error";
  text: string;
};

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

function logModelsByWebVendorGroup(models: any[]) {
  const groups = new Map<string, any[]>();
  models.forEach((model) => {
    const vendor = getModelDisplayGroup({
      modelName: model?.name,
      displayName: model?.displayName,
      vendorName: model?.vendor?.name,
      vendorId: model?.vendor?.id,
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

function logModelFetchStart(options: {
  profileName: string;
  requestUrl: string;
}) {
  console.log(`[Provider Model] 🔄 正在获取 ${options.profileName}`);
  console.log(`[Provider Model] 📌 请求 URL：${options.requestUrl}`);
}

function logModelFetchTotal(total: number) {
  console.log(`[Provider Model] 📊 模型总数：${total} 个`);
}

function logModelCleanup(removedModelNames: string[]) {
  if (removedModelNames.length === 0) {
    console.log(`[Provider Model] 🧹 模型清理：无需清理（0 个）`);
    return;
  }
  console.log(
    `[Provider Model] 🧹 模型清理：需要清理 ${removedModelNames.length} 个，已清理 ${removedModelNames.length} 个`,
  );
  removedModelNames.forEach((modelName) =>
    console.log(`[Provider Model] 🗑️ 清理模型：${modelName}`),
  );
}

export function ProviderModelFetchPage() {
  const navigate = useNavigate();
  const profiles = useAccessStore((state) => state.apiProfiles || []);
  const modelCacheProfiles = useModelCacheStore((state) => state.profiles);
  const sortedProfiles = useMemo(
    () =>
      [...profiles].sort((a, b) =>
        String(a.name || a.id).localeCompare(String(b.name || b.id), "en", {
          sensitivity: "base",
        }),
      ),
    [profiles],
  );
  const hasLoggedPageEntryRef = useRef(false);

  // 初始化日志：页面打开时输出当前配置状态
  useEffect(() => {
    if (hasLoggedPageEntryRef.current) return;
    hasLoggedPageEntryRef.current = true;
    console.clear();
    const configured = sortedProfiles.filter(
      (p) =>
        String(p.modelFetchApiKey || "").trim() &&
        String(p.modelFetchUrl || "").trim(),
    );
    const withCache = sortedProfiles.filter(
      (p) => (modelCacheProfiles?.[p.id]?.modelCount || 0) > 0,
    );
    console.log(
      `[Provider Model] 📋 已读取模型配置（${sortedProfiles.length} 个；已配置 API Key+URL ${configured.length} 个，已有缓存 ${withCache.length} 个）：`,
    );
    if (sortedProfiles.length) {
      sortedProfiles.forEach((p) => {
        console.log(`  - ${p.name}`);
      });
    } else {
      console.log("  - 无");
    }
  }, [sortedProfiles, modelCacheProfiles]);

  const [keys, setKeys] = useState<Record<string, string>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [fetchingIds, setFetchingIds] = useState<string[]>([]);
  const [fetchStatusMap, setFetchStatusMap] = useState<
    Record<string, FetchStatus>
  >({});
  const [recentlyUpdatedIds, setRecentlyUpdatedIds] = useState<Set<string>>(
    new Set(),
  );
  const [fetchAllRunning, setFetchAllRunning] = useState(false);

  const getKey = (profile: (typeof profiles)[number]) =>
    Object.prototype.hasOwnProperty.call(keys, profile.id)
      ? keys[profile.id]
      : String((profile as any).modelFetchApiKey || "");
  const getUrl = (profile: (typeof profiles)[number]) =>
    Object.prototype.hasOwnProperty.call(urls, profile.id)
      ? urls[profile.id]
      : String((profile as any).modelFetchUrl || "");

  const hasUnsavedDrafts = sortedProfiles.some(
    (profile) =>
      (Object.prototype.hasOwnProperty.call(keys, profile.id) &&
        getKey(profile) !== String((profile as any).modelFetchApiKey || "")) ||
      (Object.prototype.hasOwnProperty.call(urls, profile.id) &&
        getUrl(profile) !== String((profile as any).modelFetchUrl || "")),
  );

  const saveProfile = async (
    profileId: string,
    options?: { silent?: boolean },
  ) => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return false;
    const modelFetchApiKey = getKey(profile).trim();
    const modelFetchUrl = getUrl(profile).trim();
    if (!modelFetchApiKey || !modelFetchUrl) {
      setFetchStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "error",
          text: "请填写模型获取 API Key 和 URL",
        },
      }));
      showToast("请填写模型获取 API Key 和 URL");
      return false;
    }
    try {
      new URL(modelFetchUrl);
    } catch {
      setFetchStatusMap((value) => ({
        ...value,
        [profileId]: { type: "error", text: "模型获取 URL 格式不正确" },
      }));
      showToast("模型获取 URL 格式不正确");
      return false;
    }
    if (!options?.silent) {
      setSavingIds((ids) => [...new Set([...ids, profileId])]);
    }
    try {
      useAccessStore.getState().update((access: any) => {
        access.lastUpdateTime = Date.now();
        access.apiProfiles = (access.apiProfiles || []).map((item: any) =>
          item.id === profileId
            ? { ...item, modelFetchApiKey, modelFetchUrl }
            : item,
        );
      });
      await useSyncStore.getState().sync([StoreKey.Access], {
        force: true,
        isolateQueue: true,
      });
      if (!options?.silent) {
        console.log(`[Provider Model] 💾 保存成功：${profile.name}`);
        setFetchStatusMap((value) => ({
          ...value,
          [profileId]: { type: "success", text: "保存成功" },
        }));
        showToast("模型获取配置已保存");
      }
      return true;
    } catch (error) {
      if (!options?.silent) {
        console.error(`[Provider Model] ❌ 保存失败：${profile.name}`, error);
        setFetchStatusMap((value) => ({
          ...value,
          [profileId]: { type: "error", text: "保存失败" },
        }));
      }
      showToast("模型获取配置保存失败");
      return false;
    } finally {
      if (!options?.silent) {
        setSavingIds((ids) => ids.filter((id) => id !== profileId));
      }
    }
  };

  const fetchProfile = async (
    profileId: string,
    options?: { batch?: boolean },
  ) => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return null;
    if (!options?.batch) {
      console.clear();
    }
    logModelFetchStart({
      profileName: profile.name,
      requestUrl: getUrl(profile).trim(),
    });
    setFetchingIds((ids) => [...new Set([...ids, profileId])]);
    setRecentlyUpdatedIds((value) => {
      const next = new Set(value);
      next.delete(profileId);
      return next;
    });
    setFetchStatusMap((value) => ({
      ...value,
      [profileId]: { type: "querying", text: "正在获取模型..." },
    }));
    if (!(await saveProfile(profileId, { silent: true }))) {
      setFetchingIds((ids) => ids.filter((id) => id !== profileId));
      setFetchStatusMap((value) => ({
        ...value,
        [profileId]: { type: "error", text: "配置保存失败" },
      }));
      return { name: profile.name, success: false, message: "配置保存失败" };
    }
    try {
      const result = await syncProfileModels(profileId, {
        reason: "manual",
        silent: true,
      });
      setFetchStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "success",
          text: `获取成功：${result.total} 个模型`,
        },
      }));
      setRecentlyUpdatedIds((value) => new Set(value).add(profileId));
      if (!options?.batch) showToast("模型获取成功");
      const removedAddedModelNames = Array.isArray(
        (result as any).removedAddedModelNames,
      )
        ? ((result as any).removedAddedModelNames as string[])
        : [];
      logModelCleanup(removedAddedModelNames);
      if (!options?.batch) {
        logModelFetchTotal(result.total);
        logModelsByWebVendorGroup(result.models);
      }
      return {
        name: profile.name,
        success: true,
        message: `获取成功：${result.total} 个模型`,
        models: result.models,
        requestUrl: getUrl(profile).trim(),
        total: result.total,
        removedAddedModelNames,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFetchStatusMap((value) => ({
        ...value,
        [profileId]: { type: "error", text: message },
      }));
      if (!options?.batch) {
        console.error(`[Provider Model] ❌ 获取失败：${profile.name}`, message);
      }
      if (!options?.batch) showToast(message);
      return { name: profile.name, success: false, message };
    } finally {
      setFetchingIds((ids) => ids.filter((id) => id !== profileId));
    }
  };

  const fetchAll = async () => {
    console.clear();
    const configured = sortedProfiles.filter(
      (profile) => getKey(profile).trim() && getUrl(profile).trim(),
    );
    if (configured.length === 0) {
      showToast("暂无已配置 API Key 和 URL 的供应商");
      return;
    }
    setFetchAllRunning(true);
    try {
      await Promise.all(
        configured.map((profile) => fetchProfile(profile.id, { batch: true })),
      );
    } finally {
      setFetchAllRunning(false);
    }
  };

  const closePage = async () => {
    if (fetchingIds.length > 0) {
      const confirmed = await showConfirm(
        `模型获取正在执行中（还剩${fetchingIds.length}个），确认离开吗？`,
      );
      if (!confirmed) return;
    }
    if (hasUnsavedDrafts || savingIds.length > 0) {
      const confirmed = await showConfirm(
        savingIds.length > 0
          ? "模型获取配置正在保存中，确认离开吗？"
          : "有未保存的模型获取配置，确认离开吗？",
      );
      if (!confirmed) return;
    }
    navigate(Path.Chat);
  };

  return (
    <div className={styles.page} data-top-notice-anchor="true">
      <div className="window-header" data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">模型获取</div>
          <div className="window-header-sub-title">
            独立配置获取 URL 和 API Key，手动更新模型
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
        <div className={styles.batchAction}>
          <IconButton
            icon={<ReloadIcon />}
            text="全部获取"
            type="green"
            className={styles.actionButton}
            disabled={
              fetchAllRunning || savingIds.length > 0 || fetchingIds.length > 0
            }
            onClick={() => void fetchAll()}
          />
        </div>
        <div className={styles.list}>
          {sortedProfiles.length === 0 ? (
            <div className={styles.empty}>暂无 API 配置</div>
          ) : (
            sortedProfiles.map((profile) => (
              <form
                key={profile.id}
                className={`${styles.card} ${styles.desktopHoverCard}`}
                onPointerMove={updateHoverPosition}
                onSubmit={(event) => event.preventDefault()}
              >
                <div className={styles.headerRow}>
                  <div className={styles.headerLeft}>
                    <span className={styles.name}>{profile.name}</span>
                  </div>
                  <div className={styles.headerRight}>
                    <span
                      className={`${styles.balance} ${
                        fetchStatusMap[profile.id]?.type === "error"
                          ? styles.balanceError
                          : recentlyUpdatedIds.has(profile.id)
                          ? styles.balanceUpdated
                          : ""
                      }`}
                    >
                      {fetchStatusMap[profile.id]?.type === "error" && (
                        <span
                          className={styles.balanceStatusIcon}
                          aria-hidden="true"
                        >
                          ×
                        </span>
                      )}
                      {fetchStatusMap[profile.id]?.type !== "error" &&
                        recentlyUpdatedIds.has(profile.id) && (
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
                      {modelCacheProfiles[profile.id]?.modelCount ??
                        profile.modelCount ??
                        0}{" "}
                      个
                    </span>
                  </div>
                </div>
                <div className={styles.row}>
                  <div className={styles.inputWithLabel}>
                    <span className={styles.inputLabel}>API Key</span>
                    <input
                      className="nextchat-input-control"
                      type="text"
                      name={`model-fetch-key-${profile.id}`}
                      value={getKey(profile)}
                      onChange={(event) =>
                        setKeys((value) => ({
                          ...value,
                          [profile.id]: event.target.value,
                        }))
                      }
                      autoComplete="one-time-code"
                      autoCorrect="off"
                      autoCapitalize="off"
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-bwignore="true"
                      data-form-type="other"
                      spellCheck={false}
                      placeholder="API Key"
                    />
                  </div>
                  <IconButton
                    icon={<ConfirmIcon />}
                    type="primary"
                    className={`${styles.actionButton} nextchat-primary-button`}
                    text={savingIds.includes(profile.id) ? "保存中..." : "保存"}
                    disabled={
                      savingIds.includes(profile.id) ||
                      fetchingIds.includes(profile.id) ||
                      fetchAllRunning
                    }
                    onClick={() => void saveProfile(profile.id)}
                  />
                </div>
                <div className={styles.row}>
                  <div className={styles.inputWithLabel}>
                    <span className={styles.inputLabel}>获取 URL</span>
                    <input
                      className={`nextchat-input-control ${
                        getUrl(profile).trim() ? styles.fixedUrlInput : ""
                      }`}
                      type="text"
                      name={`model-fetch-url-${profile.id}`}
                      value={getUrl(profile)}
                      onChange={(event) =>
                        setUrls((value) => ({
                          ...value,
                          [profile.id]: event.target.value,
                        }))
                      }
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-bwignore="true"
                      data-form-type="other"
                      placeholder="自定义模型获取 URL"
                    />
                  </div>
                  <IconButton
                    icon={<ReloadIcon />}
                    type="green"
                    className={`${styles.actionButton} nextchat-action-button`}
                    text={
                      fetchingIds.includes(profile.id) ? "获取中..." : "获取"
                    }
                    disabled={
                      savingIds.includes(profile.id) ||
                      fetchingIds.includes(profile.id) ||
                      fetchAllRunning
                    }
                    onClick={() => void fetchProfile(profile.id)}
                  />
                </div>
                {fetchStatusMap[profile.id] ? (
                  <div
                    className={
                      fetchStatusMap[profile.id].type === "error"
                        ? styles.statusError
                        : styles.statusSuccess
                    }
                  >
                    {fetchStatusMap[profile.id].text}
                  </div>
                ) : (
                  <div className={styles.hint}>尚未获取</div>
                )}
              </form>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
