import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  saveProviderCustomUrl,
  type ProviderBalanceProfile,
  type ProviderBalanceAttempt,
} from "../utils/provider-balance";
import { prepareRouteEntryForSync } from "../utils/route-sync-entry";
import { isYutoProfileLike } from "../utils/multi-key";
import { IconButton } from "./button";
import { showConfirm, showToast } from "./ui-lib";
import apiConfigStyles from "./api-config.module.scss";
import styles from "./provider-balances.module.scss";

const profileMemoryCache = new Map<string, ProviderBalanceProfile[]>();

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
          customBalanceUrl: remote.customBalanceUrl || profile.customBalanceUrl,
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
          customBalanceUrl: cachedProfile?.customBalanceUrl || "",
        };
      })
      .sort((a, b) =>
        a.profileName.localeCompare(b.profileName, "en", {
          sensitivity: "base",
        }),
      );
  }, [apiProfiles, profileCacheKey]);
  const [profiles, setProfiles] =
    useState<ProviderBalanceProfile[]>(localProfiles);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [customUrls, setCustomUrls] = useState<Record<string, string>>({});
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
    prepareRouteEntryForSync(Path.ProviderBalances, {
      source: "provider-balances-page",
    });
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const remoteProfiles = await loadProviderBalanceProfiles();
      const mergedProfiles = mergeProfiles(localProfiles, remoteProfiles).sort(
        (a, b) =>
          a.profileName.localeCompare(b.profileName, "en", {
            sensitivity: "base",
          }),
      );
      profileMemoryCache.set(profileCacheKey, mergedProfiles);
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
    const profile = profiles.find((item) => item.profileId === profileId);
    const profileName = profile?.profileName || profileId;
    const managementKeyValue = getManagementInputValue(profileId);
    const customBalanceUrl = getCustomUrlInputValue(profileId);
    const queryMode: "custom" | "auto" = customBalanceUrl.trim()
      ? "custom"
      : "auto";

    if (!managementKeyValue.trim()) {
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
        text:
          queryMode === "custom"
            ? "正在使用自定义路径查询余额..."
            : "正在查询余额...",
        attempts: [],
        mode: queryMode,
      },
    }));
    let attempts: ProviderBalanceAttempt[] = [];
    try {
      const result = await queryProviderBalanceProfile(profileId, {
        source: options?.batch ? "balances-page-batch" : "balances-page-manual",
        providerName: profileName,
        customBalanceUrl: customBalanceUrl || undefined,
      });
      attempts = result.attempts;
      cacheProviderBalance(profileCacheKey, profileId, result.balance);
      console.log(`[Provider Balance] ✅ ${profileName} 余额查询成功`);

      // 自动模式成功后将成功路径保存到数据库
      const successPath = (result as any).cachedPath;
      const successBaseUrl = (result as any).cachedBaseUrl;
      if (queryMode === "auto" && successPath) {
        const fullPath = successBaseUrl
          ? `${successBaseUrl.replace(/\/$/, "")}/${successPath}`
          : successPath;
        console.log(`[Provider Balance] 💾 保存成功路径：${fullPath}`);
        // 保存到数据库
        saveProviderCustomUrl(profileId, fullPath).catch(() => {});
        // 更新本地状态
        setCustomUrls((value) => ({
          ...value,
          [profileId]: fullPath,
        }));
      }

      setProfiles((value) =>
        value.map((profile) =>
          profile.profileId === profileId
            ? { ...profile, balance: result.balance, lastError: "" }
            : profile,
        ),
      );
      // 本次页面会话内查询成功后保持绿色，刷新页面时自然恢复。
      setRecentlyUpdatedIds((prev) => new Set(prev).add(profileId));
      setQueryStatusMap((value) => ({
        ...value,
        [profileId]: {
          type: "success",
          text: queryMode === "custom" ? `查询成功（自定义路径）` : `查询成功`,
          mode: queryMode,
        },
      }));
    } catch (error) {
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
                balance: null,
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
    const profileName =
      profiles.find((profile) => profile.profileId === profileId)
        ?.profileName || profileId;
    const managementKey = getManagementInputValue(profileId);
    const customUrl = getCustomUrlInputValue(profileId);
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
      // 同时保存 key 和自定义 URL
      await Promise.all([
        saveProviderManagementKey(profileId, managementKey),
        saveProviderCustomUrl(profileId, customUrl),
      ]);
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
    const queryableProfiles = profiles.filter((profile) =>
      getManagementInputValue(profile.profileId).trim(),
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

    // 添加超时处理
    const TIMEOUT_MS = 30000; // 30秒超时

    try {
      // 所有查询同时发起，不等待
      const queryPromises = queryableProfiles.map(async (profile) => {
        const timeoutPromise = new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), TIMEOUT_MS),
        );

        const queryPromise = queryOne(profile.profileId, { batch: true });

        const result = await Promise.race([queryPromise, timeoutPromise]);

        if (result === "timeout") {
          console.warn(
            `[Provider Balance] ⚠️ ${profile.profileName} 余额查询超时（${
              TIMEOUT_MS / 1000
            }秒）`,
          );
          const errorMessage = `查询超时（${TIMEOUT_MS / 1000}秒）`;
          setProfiles((value) =>
            value.map((p) =>
              p.profileId === profile.profileId
                ? { ...p, lastError: errorMessage }
                : p,
            ),
          );
          setQueryStatusMap((value) => ({
            ...value,
            [profile.profileId]: {
              type: "error",
              text: errorMessage,
              attempts: [],
            },
          }));
          showToast(`${profile.profileName} 查询超时`);
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
                  isLoading ||
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
                    disabled={isLoading}
                  />
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
                  <input
                    className="nextchat-input-control"
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
                    value={
                      isYutoProfileLike({ name: profile.profileName })
                        ? "/api/user/self"
                        : Object.prototype.hasOwnProperty.call(
                            customUrls,
                            profile.profileId,
                          )
                        ? customUrls[profile.profileId]
                        : profile.customBalanceUrl || ""
                    }
                    onChange={(event) =>
                      !isYutoProfileLike({ name: profile.profileName }) &&
                      setCustomUrls((value) => ({
                        ...value,
                        [profile.profileId]: event.target.value,
                      }))
                    }
                    placeholder="自定义余额查询 URL（不填则自动尝试）"
                    disabled={
                      isLoading ||
                      isYutoProfileLike({ name: profile.profileName })
                    }
                  />
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
