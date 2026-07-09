import { useCallback, useEffect, useMemo, useState } from "react";
import type { PointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import CloseIcon from "../icons/close.svg";
import ConfirmIcon from "../icons/confirm.svg";
import ReloadIcon from "../icons/reload.svg";
import { Path } from "../constant";
import { useAccessStore } from "../store";
import {
  cacheProviderBalance,
  getProviderBalanceErrorMessage,
  loadProviderBalanceProfiles,
  queryProviderBalanceProfile,
  readCachedProviderBalance,
  saveProviderManagementKey,
  type ProviderBalanceProfile,
} from "../utils/provider-balance";
import { prepareRouteEntryForSync } from "../utils/route-sync-entry";
import { IconButton } from "./button";
import { showConfirm, showToast } from "./ui-lib";
import apiConfigStyles from "./api-config.module.scss";
import styles from "./provider-balances.module.scss";

const LOG_SEPARATOR = "=".repeat(5);
const BATCH_QUERY_CONCURRENCY = 2;
const profileMemoryCache = new Map<string, ProviderBalanceProfile[]>();

type QueryStatus =
  | { type: "querying"; text: string }
  | { type: "success"; text: string }
  | { type: "error"; text: string };

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
  const remoteMap = new Map(
    remoteProfiles.map((profile) => [profile.profileId, profile]),
  );
  return localProfiles.map((profile) => {
    const remote = remoteMap.get(profile.profileId);
    return remote
      ? {
          ...profile,
          ...remote,
          balance: remote.balance || profile.balance,
        }
      : profile;
  });
}

export function ProviderBalancesPage() {
  const navigate = useNavigate();
  const apiProfiles = useAccessStore((state) => state.apiProfiles || []);
  const profileCacheKey = "shared";
  const localProfiles = useMemo(() => {
    const cachedProfiles = profileMemoryCache.get(profileCacheKey) || [];
    const cachedProfileMap = new Map(
      cachedProfiles.map((profile) => [profile.profileId, profile]),
    );
    return apiProfiles
      .filter((profile) => Boolean(profile?.id))
      .map((profile) => {
        const cachedBalance = readCachedProviderBalance(
          profileCacheKey,
          profile.id,
        );
        const cachedProfile = cachedProfileMap.get(profile.id);
        return {
          profileId: profile.id,
          profileName: profile.name || profile.provider || profile.id,
          hasManagementKey: cachedProfile?.hasManagementKey || false,
          maskedManagementKey: cachedProfile?.maskedManagementKey || "",
          managementKey: cachedProfile?.managementKey || "",
          balance: cachedBalance,
          lastError: "",
        };
      });
  }, [apiProfiles, profileCacheKey]);
  const [profiles, setProfiles] =
    useState<ProviderBalanceProfile[]>(localProfiles);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [queryStatusMap, setQueryStatusMap] = useState<
    Record<string, QueryStatus>
  >({});
  const [working, setWorking] = useState("");
  const [savingProfileIds, setSavingProfileIds] = useState<string[]>([]);
  const [queryingProfileIds, setQueryingProfileIds] = useState<string[]>([]);
  const [recentlyUpdatedIds, setRecentlyUpdatedIds] = useState<Set<string>>(
    new Set(),
  );
  const hasUnsavedDrafts = useMemo(
    () =>
      Object.entries(drafts).some(([profileId, value]) => {
        const savedValue =
          profiles.find((profile) => profile.profileId === profileId)
            ?.managementKey || "";
        return value !== savedValue;
      }),
    [drafts, profiles],
  );
  const isSaving = working.startsWith("save:");

  useEffect(() => {
    console.clear();
    console.log(`${LOG_SEPARATOR} 💰 余额查询页面 ${LOG_SEPARATOR}`);
    console.log("[Provider Balance] 进入余额查询页面，已清空控制台日志");
    prepareRouteEntryForSync(Path.ProviderBalances, {
      source: "provider-balances-page",
    });
  }, []);

  const load = useCallback(async () => {
    console.log("[Provider Balance] 🔄 正在读取余额配置...");
    const remoteProfiles = await loadProviderBalanceProfiles();
    const mergedProfiles = mergeProfiles(localProfiles, remoteProfiles);
    profileMemoryCache.set(profileCacheKey, mergedProfiles);
    setProfiles(mergedProfiles);
    console.log("[Provider Balance] ✅ 余额配置读取完成", {
      profileCount: remoteProfiles.length,
    });
  }, [localProfiles, profileCacheKey]);

  useEffect(() => {
    setProfiles((current) => mergeProfiles(localProfiles, current));
  }, [localProfiles]);

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

  const queryOne = async (profileId: string, options?: { batch?: boolean }) => {
    const profileName =
      profiles.find((profile) => profile.profileId === profileId)
        ?.profileName || profileId;
    if (!options?.batch) {
      setWorking(`query:${profileId}`);
    }
    setQueryingProfileIds((ids) =>
      ids.includes(profileId) ? ids : [...ids, profileId],
    );
    console.log(`${LOG_SEPARATOR} 💰 余额查询 ${LOG_SEPARATOR}`);
    console.log("[Provider Balance] 🔎 开始查询余额", {
      profileId,
      profileName,
    });
    setQueryStatusMap((value) => ({
      ...value,
      [profileId]: { type: "querying", text: "正在查询余额..." },
    }));
    try {
      const { balance } = await queryProviderBalanceProfile(profileId, {
        source: options?.batch ? "balances-page-batch" : "balances-page-manual",
        providerName: profileName,
      });
      cacheProviderBalance(profileCacheKey, profileId, balance);
      setProfiles((value) =>
        value.map((profile) =>
          profile.profileId === profileId
            ? { ...profile, balance, lastError: "" }
            : profile,
        ),
      );
      console.log(
        "[Provider Balance] ✅ 余额查询成功，已保存到数据库和 localStorage",
        {
          profileId,
          profileName,
          balance: balance.value,
          queriedAt: balance.queriedAt,
        },
      );
      console.log(LOG_SEPARATOR);
      // 本次页面会话内查询成功后保持绿色，刷新页面时自然恢复。
      setRecentlyUpdatedIds((prev) => new Set(prev).add(profileId));
      const updatedAt = new Date(
        balance.queriedAt || Date.now(),
      ).toLocaleString("zh-CN", { hour12: false });
      setQueryStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "success",
          text: `查询成功，余额已更新 · 更新时间：${updatedAt}`,
        },
      }));
    } catch (error) {
      const errorMessage = getProviderBalanceErrorMessage(error);
      // 如果错误对象中包含 balance 数据（来自服务端的返回），使用它
      let fallbackBalance = null;
      if (error && typeof error === "object" && "balance" in error) {
        const balanceFromError = (error as any).balance;
        // 只有当余额数据有效时才使用
        if (balanceFromError && Number.isFinite(balanceFromError?.value)) {
          fallbackBalance = balanceFromError;
        }
      }
      setProfiles((value) =>
        value.map((profile) =>
          profile.profileId === profileId
            ? {
                ...profile,
                lastError: errorMessage,
                // 如果有返回的余额数据就使用，否则保持原有的余额
                balance: fallbackBalance || profile.balance,
              }
            : profile,
        ),
      );
      console.error(
        "[Provider Balance] ❌ 余额查询失败，失败结果已保存到数据库",
        {
          profileId,
          profileName,
          error: errorMessage,
        },
      );
      console.log(LOG_SEPARATOR);
      setQueryStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "error",
          text: errorMessage,
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

  const saveKey = async (profileId: string) => {
    const profileName =
      profiles.find((profile) => profile.profileId === profileId)
        ?.profileName || profileId;
    const managementKey = getManagementInputValue(profileId);
    setWorking(`save:${profileId}`);
    setSavingProfileIds((ids) =>
      ids.includes(profileId) ? ids : [...ids, profileId],
    );
    setQueryStatusMap((value) => ({
      ...value,
      [profileId]: { type: "querying", text: "正在保存管理 API Key..." },
    }));
    console.log(`${LOG_SEPARATOR} 🔐 余额管理 Key 保存 ${LOG_SEPARATOR}`);
    console.log("[Provider Balance] 💾 正在保存管理 API Key，并同步到数据库", {
      profileId,
      profileName,
      hasKey: Boolean(managementKey),
    });
    try {
      await saveProviderManagementKey(profileId, managementKey);
      console.log(
        "[Provider Balance] 🔄 管理 API Key 数据库同步完成，正在刷新页面状态",
        {
          profileId,
          profileName,
        },
      );
      setDrafts((value) => {
        const nextValue = { ...value };
        delete nextValue[profileId];
        return nextValue;
      });
      await load();
      console.log("[Provider Balance] ✅ 管理 API Key 已保存并同步到数据库", {
        profileId,
        profileName,
      });
      console.log(LOG_SEPARATOR);
      setQueryStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "success",
          text: "保存成功，管理 API Key 已更新",
        },
      }));
      showToast("管理 API Key 已保存");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "保存管理 API Key 失败";
      console.error("[Provider Balance] ❌ 管理 API Key 保存失败", {
        profileId,
        profileName,
        error: errorMessage,
      });
      console.log(LOG_SEPARATOR);
      setQueryStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "error",
          text: errorMessage,
        },
      }));
      showToast("保存管理 API Key 失败");
    } finally {
      setWorking("");
      setSavingProfileIds((ids) => ids.filter((id) => id !== profileId));
    }
  };

  const queryAll = async () => {
    console.log(`${LOG_SEPARATOR} 💰 批量余额查询 ${LOG_SEPARATOR}`);
    console.log("[Provider Balance] 🔎 开始批量查询余额", {
      profileCount: profiles.length,
      concurrency: BATCH_QUERY_CONCURRENCY,
    });
    setWorking("all");
    setQueryingProfileIds(profiles.map((profile) => profile.profileId));
    setQueryStatusMap((value) => ({
      ...value,
      ...Object.fromEntries(
        profiles.map((profile) => [
          profile.profileId,
          { type: "querying", text: "等待批量查询..." } as QueryStatus,
        ]),
      ),
    }));

    try {
      for (
        let index = 0;
        index < profiles.length;
        index += BATCH_QUERY_CONCURRENCY
      ) {
        const batch = profiles.slice(index, index + BATCH_QUERY_CONCURRENCY);
        await Promise.all(
          batch.map((profile) => queryOne(profile.profileId, { batch: true })),
        );
      }
      console.log("[Provider Balance] ✅ 批量余额查询流程结束");
      console.log(LOG_SEPARATOR);
    } finally {
      setWorking("");
    }
  };

  const closePage = async () => {
    if (hasUnsavedDrafts || isSaving) {
      const confirmed = await showConfirm(
        isSaving
          ? "管理 API Key 正在保存中，确认离开吗？"
          : "有未保存的管理 API Key，确认离开吗？",
      );
      if (!confirmed) return;
    }
    navigate(Path.Chat);
  };

  return (
    <div className={apiConfigStyles.page} data-top-notice-anchor="true">
      <div
        className={`window-header ${styles.pageHeader}`}
        data-tauri-drag-region
      >
        <div className={styles.headerInner}>
          <div className="window-header-title">
            <div className="window-header-main-title">余额查询</div>
            <div className="window-header-sub-title">
              独立管理查询 Key、批量更新并保存到数据库
            </div>
          </div>
          <div className="window-actions">
            <div
              className={`window-action-button ${styles.desktopBatchAction}`}
            >
              <IconButton
                icon={<ReloadIcon />}
                text="全部查询"
                type="green"
                className={styles.actionButton}
                disabled={
                  working === "all" ||
                  savingProfileIds.length > 0 ||
                  (profiles.length > 0 &&
                    queryingProfileIds.length === profiles.length)
                }
                onClick={() => void queryAll()}
              />
            </div>
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
      </div>
      <div className={styles.content}>
        <div className={styles.autofillTrap} aria-hidden="true">
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
        </div>
        <div className={styles.mobileBatchAction}>
          <IconButton
            icon={<ReloadIcon />}
            text="全部查询"
            type="green"
            className={styles.actionButton}
            disabled={
              working === "all" ||
              savingProfileIds.length > 0 ||
              (profiles.length > 0 &&
                queryingProfileIds.length === profiles.length)
            }
            onClick={() => void queryAll()}
          />
        </div>
        <div className={styles.list}>
          {profiles.length === 0 ? (
            <div className={styles.empty}>暂无 API 配置</div>
          ) : (
            profiles.map((profile) => (
              <div
                className={`${styles.card} ${styles.desktopHoverCard}`}
                key={profile.profileId}
                onPointerMove={updateHoverPosition}
              >
                <div className={styles.header}>
                  <span className={styles.name}>{profile.profileName}</span>
                  <span
                    className={`${styles.balance} ${
                      recentlyUpdatedIds.has(profile.profileId)
                        ? styles.balanceUpdated
                        : ""
                    }`}
                  >
                    余额：
                    {profile.balance
                      ? profile.balance.value === -1
                        ? "无限"
                        : `$${profile.balance.value.toFixed(2)}`
                      : "无"}
                  </span>
                </div>
                <div className={styles.row}>
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
                    onChange={(event) =>
                      setDrafts((value) => ({
                        ...value,
                        [profile.profileId]: event.target.value,
                      }))
                    }
                    placeholder={
                      profile.profileName.toLowerCase().includes("yuto") ||
                      profile.profileName.toLowerCase().includes("gptapi")
                        ? "Yuto 配置格式：API_Key|User_ID"
                        : "管理 API Key（与对话 Key 分离，可选）"
                    }
                  />
                  <IconButton
                    icon={<ConfirmIcon />}
                    type="primary"
                    className={styles.actionButton}
                    text={
                      savingProfileIds.includes(profile.profileId)
                        ? "保存中..."
                        : "保存"
                    }
                    disabled={
                      working === "all" ||
                      savingProfileIds.includes(profile.profileId) ||
                      queryingProfileIds.includes(profile.profileId)
                    }
                    onClick={() => void saveKey(profile.profileId)}
                  />
                  <IconButton
                    icon={<ReloadIcon />}
                    type="green"
                    className={styles.actionButton}
                    text={
                      queryingProfileIds.includes(profile.profileId)
                        ? "获取中..."
                        : "更新"
                    }
                    disabled={
                      working === "all" ||
                      savingProfileIds.includes(profile.profileId) ||
                      queryingProfileIds.includes(profile.profileId)
                    }
                    onClick={() => void queryOne(profile.profileId)}
                  />
                </div>
                {(profile.profileName.toLowerCase().includes("yuto") ||
                  profile.profileName.toLowerCase().includes("gptapi")) && (
                  <div className={styles.hint}>
                    💡 Yuto 配置提示：请使用格式 <code>API_Key|User_ID</code>
                    ，例如 <code>your_api_key|your_user_id</code>
                  </div>
                )}
                {queryStatusMap[profile.profileId] ? (
                  <div
                    className={
                      queryStatusMap[profile.profileId].type === "error"
                        ? styles.statusError
                        : styles.statusSuccess
                    }
                  >
                    {queryStatusMap[profile.profileId].text}
                  </div>
                ) : (
                  <div
                    className={
                      profile.lastError ? styles.statusError : styles.hint
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
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
