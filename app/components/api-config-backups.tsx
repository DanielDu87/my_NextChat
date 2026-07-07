import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import CloseIcon from "../icons/close.svg";
import ConfirmIcon from "../icons/confirm.svg";
import LoadingIcon from "../icons/three-dots.svg";
import TrashIcon from "../icons/trash.svg";
import UploadIcon from "../icons/upload.svg";
import { Path } from "../constant";
import { useAccessStore } from "../store";
import { unwrapPersistedStoreState } from "../utils/sync-store-keys";
import { IconButton } from "./button";
import { List, ListItem, showConfirm, showToast } from "./ui-lib";
import styles from "./api-config-backups.module.scss";
import apiConfigStyles from "./api-config.module.scss";

type Settings = {
  enabled: boolean;
  intervalMinutes: number;
  maxBackups: number;
};
type Backup = {
  id: string;
  source: "auto" | "manual" | "pre_restore";
  profileCount: number;
  createdAt: string;
};

const SOURCE_LABEL = {
  auto: "自动备份",
  manual: "手动备份",
  pre_restore: "恢复前备份",
};

export function ApiConfigBackupsPage() {
  const navigate = useNavigate();
  const accessStore = useAccessStore();
  const [settings, setSettings] = useState<Settings>({
    enabled: true,
    intervalMinutes: 1440,
    maxBackups: 10,
  });
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [settingsSyncStatus, setSettingsSyncStatus] =
    useState("正在读取服务器设置...");
  const settingsReadyRef = useRef(false);
  const syncedSettingsRef = useRef("");

  const updateHoverPosition = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--hover-x",
      `${event.clientX - rect.left}px`,
    );
    event.currentTarget.style.setProperty(
      "--hover-y",
      `${event.clientY - rect.top}px`,
    );
  };

  const load = useCallback(async () => {
    console.log("===== 📚 API配置备份列表 =====");
    console.log("[API Config] 🔄 正在读取备份设置和历史记录...");
    setLoading(true);
    try {
      const response = await fetch("/api/db/api-config-backups", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(data.error || "load_failed");
      setSettings(data.settings);
      setBackups(data.backups);
      syncedSettingsRef.current = JSON.stringify(data.settings);
      settingsReadyRef.current = true;
      setSettingsSyncStatus(
        data.degraded ? "服务器暂不可用，显示默认设置" : "已与服务器同步",
      );
      console.log("[API Config] ✅ 备份设置和历史记录读取完成", {
        备份数量: data.backups.length,
        自动备份: data.settings.enabled,
        备份间隔分钟: data.settings.intervalMinutes,
        最大保留数量: data.settings.maxBackups,
        降级读取: Boolean(data.degraded),
      });
      console.log("===== ✅ API配置备份列表读取完成 =====");
    } catch (error) {
      console.error("[API Config] ❌ 读取备份列表失败", error);
      showToast("读取 API 配置备份失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!settingsReadyRef.current) return;
    const settingsSnapshot = JSON.stringify(settings);
    if (settingsSnapshot === syncedSettingsRef.current) return;
    setSettingsSyncStatus("等待同步...");
    const timer = window.setTimeout(async () => {
      console.log("===== ⚙️ API配置备份设置同步 =====");
      console.log("[API Config] 📤 正在同步备份设置到服务器...", settings);
      setWorking("settings");
      setSettingsSyncStatus("正在同步到服务器...");
      try {
        const response = await fetch("/api/db/api-config-backups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "settings", ...settings }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok)
          throw new Error(data.error || "save_failed");
        syncedSettingsRef.current = JSON.stringify(data.settings);
        setSettingsSyncStatus("已与服务器同步");
        console.log("[API Config] ✅ 备份设置已同步到服务器");
        console.log("===== ✅ API配置备份设置同步完成 =====");
      } catch (error) {
        console.error("[API Config] ❌ 备份设置同步失败", error);
        setSettingsSyncStatus("同步失败，请修改后重试");
        showToast("自动备份设置同步失败");
      } finally {
        setWorking("");
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [settings]);

  const request = async (body: unknown) => {
    const response = await fetch("/api/db/api-config-backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok || !data.ok)
      throw new Error(data.error || "request_failed");
    return data;
  };

  const createBackup = async () => {
    console.log("===== 💾 手动创建API配置备份 =====");
    console.log("[API Config] 🚀 开始创建手动备份...");
    setWorking("backup");
    try {
      const data = await request({ action: "backup" });
      console.log("[API Config] ✅ 手动备份创建成功", data.result);
      console.log("===== ✅ 手动创建API配置备份完成 =====");
      showToast("API 配置备份已创建");
      await load();
    } catch (error) {
      console.error("[API Config] ❌ 手动备份创建失败", error);
      showToast("创建 API 配置备份失败");
    } finally {
      setWorking("");
    }
  };

  const restore = async (backup: Backup) => {
    if (
      !(await showConfirm(
        "确定恢复此备份？当前配置会先自动备份，然后由该备份完整覆盖。备份中包含的供应商余额管理密钥、最近一次余额快照和查询错误信息也会一起恢复。",
      ))
    )
      return;
    setWorking(backup.id);
    console.log("===== ♻️ 恢复API配置备份 =====");
    console.log("[API Config] 🚀 开始恢复备份", {
      备份ID: backup.id,
      来源: backup.source,
      配置数量: backup.profileCount,
      创建时间: backup.createdAt,
    });
    try {
      const data = await request({ action: "restore", id: backup.id });
      const restoredState = unwrapPersistedStoreState(data.payload);
      accessStore.update((state) => Object.assign(state, restoredState));
      console.log("[API Config] ✅ 服务器和本地配置均已恢复");
      console.log("===== ✅ 恢复API配置备份完成 =====");
      showToast("API 配置已恢复");
      await load();
    } catch (error) {
      console.error("[API Config] ❌ 恢复备份失败", error);
      showToast("恢复 API 配置失败");
    } finally {
      setWorking("");
    }
  };

  const remove = async (backup: Backup) => {
    if (!(await showConfirm("确定删除这份备份？删除后无法恢复。"))) return;
    setWorking(backup.id);
    console.log("===== 🗑️ 删除API配置备份 =====");
    console.log("[API Config] 🚀 开始删除备份", { 备份ID: backup.id });
    try {
      const response = await fetch(
        `/api/db/api-config-backups?id=${encodeURIComponent(backup.id)}`,
        { method: "DELETE" },
      );
      const data = await response.json();
      if (!response.ok || !data.ok)
        throw new Error(data.error || "delete_failed");
      console.log("[API Config] ✅ 备份已删除", { 备份ID: backup.id });
      console.log("===== ✅ 删除API配置备份完成 =====");
      showToast("备份已删除");
      await load();
    } catch (error) {
      console.error("[API Config] ❌ 删除备份失败", error);
      showToast("删除备份失败");
    } finally {
      setWorking("");
    }
  };

  return (
    <div className={styles.page} data-top-notice-anchor="true">
      <div className="window-header" data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">API 配置备份与恢复</div>
          <div className="window-header-sub-title">
            设置自动备份并恢复历史 API 配置
          </div>
        </div>
        <div className="window-actions">
          <IconButton
            aria="关闭"
            icon={<CloseIcon />}
            close
            bordered
            onClick={() => navigate(Path.ApiConfig)}
          />
        </div>
      </div>
      <div className={styles.content}>
        <List>
          <ListItem
            className={styles.hoverCard}
            onPointerMove={updateHoverPosition}
            title="自动备份设置"
            subTitle="备份间隔按分钟计算，可自定义保留数量。"
            vertical
          >
            <div className={styles.settings}>
              <label>
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      enabled: e.currentTarget.checked,
                    })
                  }
                />
                启用自动备份
              </label>
              <label>
                备份间隔（分钟）
                <input
                  className={apiConfigStyles.textInput}
                  type="number"
                  min={1}
                  max={525600}
                  value={settings.intervalMinutes}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      intervalMinutes: Math.max(
                        1,
                        Number(e.currentTarget.value) || 1,
                      ),
                    })
                  }
                />
              </label>
              <label>
                最大保留数量
                <input
                  className={apiConfigStyles.textInput}
                  type="number"
                  min={1}
                  max={100}
                  value={settings.maxBackups}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      maxBackups: Math.max(
                        1,
                        Number(e.currentTarget.value) || 1,
                      ),
                    })
                  }
                />
              </label>
              <div className={styles.syncStatus}>
                {working === "settings" && <LoadingIcon />}
                <span>{settingsSyncStatus}</span>
              </div>
            </div>
          </ListItem>
          <ListItem
            className={styles.hoverCard}
            onPointerMove={updateHoverPosition}
            title={
              <div className={styles.historyHeader}>
                <div className={styles.historyHeaderText}>
                  <div className={styles.historyTitle}>配置备份历史</div>
                  <div className={styles.historySubTitle}>
                    恢复会覆盖 API
                    配置和供应商余额管理密钥、最近一次余额快照；不影响聊天、插件及其他数据。
                  </div>
                </div>
                <IconButton
                  icon={working === "backup" ? <LoadingIcon /> : <UploadIcon />}
                  text={working === "backup" ? "备份中..." : "立即备份"}
                  type="primary"
                  bordered
                  className={styles.createBackupButton}
                  disabled={!!working}
                  onClick={() => void createBackup()}
                />
              </div>
            }
            vertical
          >
            {loading ? (
              <div className={styles.empty}>正在读取备份...</div>
            ) : backups.length === 0 ? (
              <div className={styles.empty}>暂无备份</div>
            ) : (
              <div className={styles.backups}>
                {backups.map((backup) => (
                  <div
                    className={`${styles.backup} ${styles.hoverCard}`}
                    key={backup.id}
                    onPointerMove={updateHoverPosition}
                  >
                    <div>
                      <div className={styles.backupTitle}>
                        {SOURCE_LABEL[backup.source]}
                      </div>
                      <div className={styles.backupMeta}>
                        {new Date(backup.createdAt).toLocaleString()} ·{" "}
                        {backup.profileCount} 条配置
                      </div>
                    </div>
                    <div className={styles.backupActions}>
                      <IconButton
                        icon={
                          working === backup.id ? (
                            <LoadingIcon />
                          ) : (
                            <ConfirmIcon />
                          )
                        }
                        text="恢复"
                        type="primary"
                        bordered
                        disabled={!!working}
                        onClick={() => void restore(backup)}
                      />
                      <IconButton
                        icon={<TrashIcon />}
                        text="删除"
                        type="danger"
                        bordered
                        className={`${apiConfigStyles.dangerButton} ${apiConfigStyles.profileDeleteButton}`}
                        disabled={!!working}
                        onClick={() => void remove(backup)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ListItem>
        </List>
      </div>
    </div>
  );
}
