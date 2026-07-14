import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import CloseIcon from "../icons/close.svg";
import ConfirmIcon from "../icons/confirm.svg";
import ReloadIcon from "../icons/reload.svg";
import { Path } from "../constant";
import { useAccessStore } from "../store";
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
    };
  });
}

export function ProviderBalancesPage() {
  const navigate = useNavigate();
  const apiProfiles = useAccessStore((state) => state.apiProfiles || []);
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
  const [queryStatusMap, setQueryStatusMap] = useState<
    Record<string, QueryStatus>
  >({});
  const [working, setWorking] = useState("");
  const [savingProfileIds, setSavingProfileIds] = useState<string[]>([]);
  const [queryingProfileIds, setQueryingProfileIds] = useState<string[]>([]);
  const [recentlyUpdatedIds, setRecentlyUpdatedIds] = useState<Set<string>>(
    new Set(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const balanceLogSignatureRef = useRef("");
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

  useEffect(() => {
    prepareRouteEntryForSync(Path.ProviderBalances, {
      source: "provider-balances-page",
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
          Boolean(profile.useNewApiUserFormat))
    );
  };

  const queryOne = async (
    profileId: string,
    options?: { batch?: boolean; signal?: AbortSignal },
  ) => {
    const profile = profiles.find((item) => item.profileId === profileId);
    const profileName = profile?.profileName || profileId;
    const useNewApiUser = getNewApiUserFormatValue(profileId);
    const queryMode: "custom" | "auto" =
      hasExplicitProviderBalancePath(profile?.customBalanceUrl) || useNewApiUser
        ? "custom"
        : "auto";

    if (profileHasUnsavedChanges(profileId)) {
      setQueryStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "error",
          text: "配置尚未保存，请先保存后再查询",
          attempts: [],
          mode: queryMode,
        },
      }));
      if (!options?.batch) showToast("配置尚未保存，请先保存后再查询");
      return;
    }

    if (!profile?.hasManagementKey) {
      setQueryStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "error",
          text: "未设置管理 API Key，已跳过查询",
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
        queryMode === "custom" ? "自定义路径" : "自动探测"
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

  const saveKey = async (profileId: string) => {
    const profile = profiles.find((profile) => profile.profileId === profileId);
    const profileName = profile?.profileName || profileId;
    const managementKey = getManagementInputValue(profileId);
    const customUrl = getCustomUrlInputValue(profileId);
    const newApiUserId = getNewApiUserIdInputValue(profileId);
    const useNewApiUser = getNewApiUserFormatValue(profileId);
    const customBalanceUrl = customUrl.trim()
      ? toFullBalanceUrl(profile?.baseUrl || "", customUrl)
      : useNewApiUser
      ? toFullBalanceUrl(profile?.baseUrl || "", "/api/user/self")
      : "";

    if (useNewApiUser && !newApiUserId.trim()) {
      showToast("请填写 User ID");
      return;
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
      // 前端不再用 30 秒总超时截断尚未走完的自动探测队列。
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
    <div className={styles.page} data-top-notice-anchor="true">
      <div className={`window-header`} data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">余额查询</div>
          <div className="window-header-sub-title">
            独立管理查询 Key、批量更新并保存到数据库
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
      <div className={styles.batchActionBar}>
        <div className={styles.headerBatchAction}>
          <IconButton
            icon={<ReloadIcon />}
            text="全部查询"
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
        <div className={styles.mobileBatchAction}>
          <IconButton
            icon={<ReloadIcon />}
            text="全部查询"
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
                <div className={styles.headerRow}>
                  <div className={styles.headerLeft}>
                    <span className={styles.name}>{profile.profileName}</span>
                    <label className={styles.newApiUserToggle}>
                      <input
                        type="checkbox"
                        checked={getNewApiUserFormatValue(profile.profileId)}
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
                        }}
                      />
                      <span>New-API-User</span>
                    </label>
                  </div>
                  <div className={styles.headerRight}>
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
                <div className={styles.row}>
                  <div className={styles.inputWithLabel}>
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
                      onChange={(event) =>
                        setDrafts((value) => ({
                          ...value,
                          [profile.profileId]: event.target.value,
                        }))
                      }
                      placeholder="API Key"
                      disabled={isLoading}
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
                          onChange={(event) =>
                            setNewApiUserIds((value) => ({
                              ...value,
                              [profile.profileId]: event.target.value,
                            }))
                          }
                          placeholder="用户ID"
                          disabled={isLoading}
                        />
                      </>
                    )}
                  </div>
                  <IconButton
                    icon={<ConfirmIcon />}
                    type="primary"
                    className={`${styles.actionButton} nextchat-primary-button`}
                    text={
                      savingProfileIds.includes(profile.profileId)
                        ? "保存中..."
                        : "保存"
                    }
                    disabled={
                      isLoading ||
                      profiles.length === 0 ||
                      working === "all" ||
                      savingProfileIds.includes(profile.profileId) ||
                      queryingProfileIds.includes(profile.profileId)
                    }
                    onClick={() => void saveKey(profile.profileId)}
                  />
                </div>
                <div className={styles.row}>
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
                          onChange={(event) =>
                            setCustomUrls((value) => ({
                              ...value,
                              [profile.profileId]: event.target.value,
                            }))
                          }
                          placeholder={isAutoFixed ? "" : "自定义余额查询 URL"}
                          disabled={isLoading}
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
                        : "更新"
                    }
                    disabled={
                      isLoading ||
                      profiles.length === 0 ||
                      savingProfileIds.includes(profile.profileId) ||
                      queryingProfileIds.includes(profile.profileId)
                    }
                    onClick={() => void queryOne(profile.profileId)}
                  />
                </div>
                {queryStatusMap[profile.profileId] ? (
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
                          "attempts" in status && Array.isArray(status.attempts)
                            ? status.attempts
                            : [];
                        if (atts.length === 0) return null;
                        const okAtts = atts.filter((a) => a.ok);
                        const failAtts = atts.filter((a) => !a.ok);
                        const modeTag =
                          status.mode === "custom"
                            ? "（自定义路径）"
                            : "（自动探测）";
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
                ) : (
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
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
