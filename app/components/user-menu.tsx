"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import styles from "./user-menu.module.scss";
import {
  Popover,
  Modal,
  List,
  ListItem,
  showConfirm,
  showToast,
} from "./ui-lib";
import { IconButton } from "./button";
import { useAuthStore } from "../store/auth";
import { Path } from "../constant";
import { useNavigate } from "react-router-dom";
import {
  bootstrapManagedUsers,
  getCachedManagedUsers,
  preloadManagedUsers,
  type ManagedUser,
} from "../utils/managed-users";
import { isAbortLikeError } from "../utils/stale-revalidate";
import { getClientConfig } from "../config/client";

function getUserInitial(name: string) {
  return (
    String(name || "?")
      .trim()
      .slice(0, 1)
      .toUpperCase() || "?"
  );
}

function formatLoginTime(value?: string | null) {
  if (!value) {
    return "未登录";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未登录";
  }

  return date.toLocaleString("zh-CN", {
    hour12: false,
  });
}

function CreateUserModal(props: {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: { username: string; password: string }) => Promise<void>;
}) {
  const { open, onClose, onConfirm } = props;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open) {
      setUsername("");
      setPassword("");
    }
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const handleClose = () => {
    setUsername("");
    setPassword("");
    onClose();
  };

  return createPortal(
    <div className="modal-mask">
      <Modal
        title="新增用户"
        className={styles.createModal}
        isSmall
        hideMaxToggle
        onClose={handleClose}
        actions={[
          <IconButton
            key="cancel"
            text="取消"
            bordered
            onClick={handleClose}
          />,
          <IconButton
            key="confirm"
            text="确认新增"
            bordered
            type="primary"
            onClick={() =>
              void onConfirm({
                username,
                password,
              })
            }
          />,
        ]}
      >
        <div className={styles.createForm}>
          <input
            className={styles.createInput}
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            placeholder="用户名"
            autoFocus
          />
          <input
            className={styles.createInput}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            placeholder="密码"
            type="text"
          />
        </div>
      </Modal>
    </div>,
    document.body,
  );
}

function EditUsernameModal(props: {
  open: boolean;
  currentUsername: string;
  onClose: () => void;
  onConfirm: (newUsername: string) => Promise<void>;
}) {
  const { open, currentUsername, onClose, onConfirm } = props;
  const [username, setUsername] = useState(currentUsername);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setUsername(currentUsername);
  }, [open, currentUsername]);

  if (!open || typeof document === "undefined") return null;

  const handleConfirm = async () => {
    const trimmed = username.trim();
    if (!trimmed) {
      showToast("用户名不能为空");
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm(trimmed);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="modal-mask">
      <Modal
        title="修改用户名"
        className={styles.editModal}
        isSmall
        hideMaxToggle
        onClose={onClose}
        actions={[
          <IconButton key="cancel" text="取消" bordered onClick={onClose} />,
          <IconButton
            key="confirm"
            text={submitting ? "保存中..." : "确认"}
            bordered
            type="primary"
            disabled={submitting}
            onClick={handleConfirm}
          />,
        ]}
      >
        <div className={styles.createForm}>
          <input
            className={styles.createInput}
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            placeholder="新用户名"
            autoFocus
          />
        </div>
      </Modal>
    </div>,
    document.body,
  );
}

function EditPasswordModal(props: {
  open: boolean;
  onClose: () => void;
  onConfirm: (newPassword: string) => Promise<void>;
}) {
  const { open, onClose, onConfirm } = props;
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword("");
      setConfirmPassword("");
    }
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const handleConfirm = async () => {
    if (!password.trim()) {
      showToast("密码不能为空");
      return;
    }
    if (password !== confirmPassword) {
      showToast("两次密码不一致");
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm(password);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="modal-mask">
      <Modal
        title="修改密码"
        className={styles.editModal}
        isSmall
        hideMaxToggle
        onClose={onClose}
        actions={[
          <IconButton key="cancel" text="取消" bordered onClick={onClose} />,
          <IconButton
            key="confirm"
            text={submitting ? "保存中..." : "确认"}
            bordered
            type="primary"
            disabled={submitting}
            onClick={handleConfirm}
          />,
        ]}
      >
        <div className={styles.createForm}>
          <input
            className={styles.createInput}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            placeholder="新密码"
            type="text"
            autoFocus
          />
          <input
            className={styles.createInput}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.currentTarget.value)}
            placeholder="确认密码"
            type="text"
          />
        </div>
      </Modal>
    </div>,
    document.body,
  );
}

export function UserMenu(props?: { variant?: "default" | "chat-floating" }) {
  const user = useAuthStore((state) => state.user);
  const effectiveUser = useAuthStore((state) => state.effectiveUser);
  const logout = useAuthStore((state) => state.logout);
  const switchUser = useAuthStore((state) => state.switchUser);
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditUsernameModal, setShowEditUsernameModal] = useState(false);
  const [showEditPasswordModal, setShowEditPasswordModal] = useState(false);
  const [editTargetUser, setEditTargetUser] = useState<ManagedUser | null>(
    null,
  );
  const [showAllPasswords, setShowAllPasswords] = useState(false);
  const currentEffectiveUserId = effectiveUser?.id ?? "";
  const effectiveUserDisplayName = effectiveUser?.displayName ?? "";
  const effectiveUserUsername = effectiveUser?.username ?? "";

  const openManageModal = () => {
    if (typeof document !== "undefined") {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    if (typeof window !== "undefined") {
      const resetScroll = () => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      };
      resetScroll();
      window.requestAnimationFrame(resetScroll);
      window.setTimeout(resetScroll, 120);
    }
    const cachedUsers = user ? getCachedManagedUsers(user.id) : null;
    if (cachedUsers) setUsers(cachedUsers);
    setLoadingUsers(!cachedUsers);
    setShowManageModal(true);
  };

  const loadUsers = useCallback(
    async (force = false) => {
      if (!user) return;

      if (!force) {
        const bootstrap = bootstrapManagedUsers({ ownerUserId: user.id });
        console.log("[UserMenu] 打开用户切换界面，静默更新用户对话数量");
        if (bootstrap.cachedData) {
          setUsers(bootstrap.cachedData);
          setLoadingUsers(false);
        } else {
          setLoadingUsers(true);
        }

        void bootstrap.revalidatePromise
          .then((nextUsers) => {
            setUsers(nextUsers);
            console.log("[UserMenu] 用户对话数量静默更新完成", {
              count: nextUsers.length,
            });
          })
          .catch((error) => {
            if (isAbortLikeError(error)) return;
            console.error(
              "[UserMenu] 用户列表后台更新失败:",
              error instanceof Error ? error.message : "unknown_error",
            );
          })
          .finally(() => setLoadingUsers(false));
        return;
      }

      setLoadingUsers(true);
      try {
        const loadedUsers = await preloadManagedUsers({
          ownerUserId: user.id,
          force,
          source: force ? "user-refresh" : "user-menu",
        });
        setUsers(loadedUsers);
      } catch (error) {
        if (isAbortLikeError(error)) return;
        console.error(
          "[UserMenu] 用户列表加载失败:",
          error instanceof Error ? error.message : "unknown_error",
        );
        showToast(error instanceof Error ? error.message : "获取用户列表失败");
      } finally {
        setLoadingUsers(false);
      }
    },
    [user],
  );

  const isDeletableUser = (managedUser: ManagedUser) => {
    return !!user && user.id !== managedUser.id;
  };

  const handleDeleteUsers = async (targetUsers: ManagedUser[]) => {
    if (!user || !effectiveUser) {
      return;
    }

    const deletableUsers = targetUsers.filter(isDeletableUser);
    if (deletableUsers.length === 0) {
      setDeleteMode(false);
      setSelectedUserIds([]);
      return;
    }

    const confirmed = await showConfirm(
      `确认删除 ${deletableUsers.length} 个用户吗？删除后这些用户的聊天记录也会一起删除。`,
    );
    if (!confirmed) {
      return;
    }

    try {
      for (const managedUser of deletableUsers) {
        const response = await fetch("/api/admin/users", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({
            userId: managedUser.id,
          }),
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok || payload?.ok !== true) {
          throw new Error(String(payload?.error || "删除用户失败"));
        }

        if (effectiveUser.id === managedUser.id && user) {
          await switchUser(user.id);
        }
      }

      showToast("删除用户成功");
      setDeleteMode(false);
      setSelectedUserIds([]);
      await loadUsers(true);
    } catch (error) {
      console.error(
        "[UserMenu] 删除用户失败:",
        error instanceof Error ? error.message : "unknown_error",
      );
      showToast(error instanceof Error ? error.message : "删除用户失败");
    }
  };

  const toggleDeleteMode = () => {
    if (deleteMode) {
      if (selectedUserIds.length === 0) {
        setDeleteMode(false);
        return;
      }

      void handleDeleteUsers(
        users.filter((managedUser) => selectedUserIds.includes(managedUser.id)),
      );
      return;
    }

    setDeleteMode(true);
    setSelectedUserIds([]);
  };

  const toggleUserSelection = (managedUser: ManagedUser) => {
    if (!deleteMode || !isDeletableUser(managedUser)) {
      return false;
    }

    setSelectedUserIds((current) =>
      current.includes(managedUser.id)
        ? current.filter((id) => id !== managedUser.id)
        : [...current, managedUser.id],
    );
    return true;
  };

  const handleCreateUser = async (form: {
    username: string;
    password: string;
  }) => {
    const username = form.username.trim();
    const password = form.password.trim();

    if (!username) {
      showToast("用户名不能为空");
      return;
    }

    if (!password) {
      showToast("密码不能为空");
      return;
    }

    try {
      const requestBody = {
        username,
        displayName: username,
        password,
      };

      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(requestBody),
      });

      const responsePayload: {
        ok?: boolean;
        error?: string;
        user?: any;
      } | null = await response.json().catch(() => null);

      if (!response.ok || responsePayload?.ok !== true) {
        throw new Error(String(responsePayload?.error || "新增用户失败"));
      }

      showToast("新增用户成功");
      setShowCreateModal(false);
      await loadUsers(true);
    } catch (error) {
      console.error(
        "[UserMenu] 新增用户失败:",
        error instanceof Error ? error.message : "unknown_error",
      );
      showToast(error instanceof Error ? error.message : "新增用户失败");
    }
  };

  const handleSwitchUser = async (managedUser: ManagedUser) => {
    if (!user) return;

    setShowManageModal(false);
    try {
      await switchUser(managedUser.id, {
        username: managedUser.username,
        displayName: managedUser.displayName,
      });
      navigate(Path.NewChat, { replace: true });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "切换用户失败");
    }
  };

  const handleEditUsername = async (userId: string, newUsername: string) => {
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ userId, username: newUsername }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) {
        throw new Error(String(payload?.error || "修改用户名失败"));
      }
      showToast("用户名已修改");
      setShowEditUsernameModal(false);
      setEditTargetUser(null);
      await loadUsers(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "修改用户名失败");
    }
  };

  const handleEditPassword = async (userId: string, newPassword: string) => {
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ userId, password: newPassword }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) {
        throw new Error(String(payload?.error || "修改密码失败"));
      }
      showToast("密码已修改");
      setShowEditPasswordModal(false);
      setEditTargetUser(null);
      await loadUsers(true);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "修改密码失败");
    }
  };

  const renderRowAction = (managedUser: ManagedUser) => {
    const isCurrent = currentEffectiveUserId === managedUser.id;
    const isSelected = selectedUserIds.includes(managedUser.id);

    if (deleteMode && isDeletableUser(managedUser)) {
      return (
        <div
          className={styles.rowAction}
          onClick={(event) => {
            event.stopPropagation();
            toggleUserSelection(managedUser);
          }}
        >
          <label className={styles.selectMark}>
            <input
              type="checkbox"
              readOnly
              checked={isSelected}
              onClick={(event) => {
                event.stopPropagation();
                toggleUserSelection(managedUser);
              }}
            />
          </label>
        </div>
      );
    }

    if (!deleteMode && isCurrent) {
      return <div className={styles.badge}>当前</div>;
    }

    return <div className={styles.rowAction} />;
  };

  useEffect(() => {
    if (!showManageModal || !currentEffectiveUserId) {
      return;
    }

    void loadUsers(false);
  }, [
    showManageModal,
    currentEffectiveUserId,
    effectiveUserUsername,
    effectiveUserDisplayName,
    loadUsers,
  ]);

  useEffect(() => {
    if (!showManageModal) {
      setDeleteMode(false);
      setSelectedUserIds([]);
    }
  }, [showManageModal]);

  if (!user || !effectiveUser) {
    return null;
  }

  if (props?.variant === "chat-floating") {
    const buildConfig = getClientConfig();
    return (
      <>
        <div
          className={clsx(styles.trigger, styles.chatFloatingTrigger)}
          onClick={openManageModal}
        >
          <div className={styles.chatFloatingText}>
            <div className={clsx(styles.chatFloatingLabel, "one-line")}>
              当前用户（切换）
            </div>
            <div className={clsx(styles.chatFloatingValue, "one-line")}>
              {effectiveUser.displayName || effectiveUser.username}
            </div>
            {buildConfig && (
              <div
                className={clsx(styles.chatFloatingLabel, "one-line")}
                style={{ fontSize: "11px", fontWeight: 600, opacity: 0.7 }}
              >
                当前版本：
                {buildConfig.commitHash && buildConfig.commitHash !== "unknown"
                  ? buildConfig.commitHash.substring(0, 8)
                  : "unknown"}
              </div>
            )}
          </div>
        </div>

        {showManageModal &&
          typeof document !== "undefined" &&
          createPortal(
            <div className="modal-mask">
              <Modal
                title="用户管理"
                className={styles.manageModal}
                hideMaxToggle
                onClose={() => setShowManageModal(false)}
                leftActions={[
                  currentEffectiveUserId ? (
                    <IconButton
                      key="edit-username"
                      text="修改用户名"
                      bordered
                      onClick={() => {
                        if (effectiveUser) {
                          setEditTargetUser({
                            id: effectiveUser.id,
                            username: effectiveUser.username,
                            displayName: effectiveUser.displayName,
                            role: effectiveUser.role,
                            isActive: true,
                            lastChatAt: null,
                          });
                          setShowEditUsernameModal(true);
                        }
                      }}
                    />
                  ) : null,
                  currentEffectiveUserId ? (
                    <IconButton
                      key="edit-password"
                      text="修改密码"
                      bordered
                      onClick={() => {
                        if (effectiveUser) {
                          setEditTargetUser({
                            id: effectiveUser.id,
                            username: effectiveUser.username,
                            displayName: effectiveUser.displayName,
                            role: effectiveUser.role,
                            isActive: true,
                            lastChatAt: null,
                          });
                          setShowEditPasswordModal(true);
                        }
                      }}
                    />
                  ) : null,
                  <IconButton
                    key="toggle-password"
                    text={showAllPasswords ? "隐藏密码" : "显示密码"}
                    bordered
                    onClick={() => setShowAllPasswords(!showAllPasswords)}
                  />,
                ]}
                actions={[
                  <IconButton
                    key="delete"
                    text={
                      deleteMode
                        ? selectedUserIds.length > 0
                          ? `确认删除 (${selectedUserIds.length})`
                          : "取消删除"
                        : "删除用户"
                    }
                    bordered
                    type={deleteMode ? "danger" : undefined}
                    onClick={() => toggleDeleteMode()}
                  />,
                  <IconButton
                    key="create"
                    text="新增用户"
                    bordered
                    onClick={() => setShowCreateModal(true)}
                  />,
                  <IconButton
                    key="close"
                    text="关闭"
                    bordered
                    onClick={() => setShowManageModal(false)}
                  />,
                ].filter(Boolean as any)}
              >
                <List
                  className={clsx(styles.manageList, {
                    [styles.manageListLoading]: loadingUsers,
                  })}
                >
                  {loadingUsers ? (
                    <div className={styles.loadingState}>
                      <span className={styles.loadingDots}>
                        <i />
                        <i />
                        <i />
                      </span>
                      <span>正在加载用户...</span>
                    </div>
                  ) : (
                    users.map((managedUser) => (
                      <ListItem
                        key={managedUser.id}
                        className={clsx(styles.manageListItem, {
                          [styles.manageListItemActive]:
                            effectiveUser.id === managedUser.id,
                        })}
                        title={
                          <div className={styles.userRow}>
                            <div className={styles.userIdentity}>
                              <div className={styles.userAvatar}>
                                {getUserInitial(
                                  managedUser.displayName ||
                                    managedUser.username,
                                )}
                              </div>
                              <div className={styles.userIdentityText}>
                                <div className={styles.userName}>
                                  {managedUser.displayName ||
                                    managedUser.username}
                                </div>
                                {!managedUser.isActive && (
                                  <div className={styles.userMeta}>
                                    <span className={styles.disabledState}>
                                      已禁用
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className={styles.userDetails}>
                              <div className={styles.userDetail}>
                                <span className={styles.userInfoLabel}>
                                  密码
                                </span>
                                <span className={styles.userInfoValue}>
                                  {showAllPasswords
                                    ? managedUser.username
                                    : "******"}
                                </span>
                              </div>
                              <div className={styles.userDetail}>
                                <span className={styles.userInfoLabel}>
                                  对话数量
                                </span>
                                <span className={styles.userInfoValue}>
                                  {managedUser.conversationCount ?? "-"} 条
                                </span>
                              </div>
                              <div
                                className={clsx(
                                  styles.userDetail,
                                  styles.userDetailWide,
                                )}
                              >
                                <span className={styles.userInfoLabel}>
                                  最近对话
                                </span>
                                <span className={styles.userInfoValue}>
                                  {formatLoginTime(
                                    managedUser.lastConversationAt,
                                  )}
                                </span>
                              </div>
                            </div>
                            {renderRowAction(managedUser)}
                          </div>
                        }
                        onClick={() => {
                          if (toggleUserSelection(managedUser)) {
                            return;
                          }

                          if (effectiveUser.id === managedUser.id) {
                            setShowManageModal(false);
                            return;
                          }

                          handleSwitchUser(managedUser);
                        }}
                      />
                    ))
                  )}
                </List>
              </Modal>
            </div>,
            document.body,
          )}
        <CreateUserModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onConfirm={handleCreateUser}
        />
        {editTargetUser && (
          <EditUsernameModal
            open={showEditUsernameModal}
            currentUsername={
              editTargetUser.displayName || editTargetUser.username
            }
            onClose={() => {
              setShowEditUsernameModal(false);
              setEditTargetUser(null);
            }}
            onConfirm={(newUsername) =>
              handleEditUsername(editTargetUser.id, newUsername)
            }
          />
        )}
        {editTargetUser && (
          <EditPasswordModal
            open={showEditPasswordModal}
            onClose={() => {
              setShowEditPasswordModal(false);
              setEditTargetUser(null);
            }}
            onConfirm={(newPassword) =>
              handleEditPassword(editTargetUser.id, newPassword)
            }
          />
        )}
      </>
    );
  }

  return (
    <>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        content={
          <div className={styles.menu}>
            <div className={styles.status}>
              <div>当前登录：{user.displayName || user.username}</div>
              <div>
                当前查看：{effectiveUser.displayName || effectiveUser.username}
              </div>
              {(() => {
                const buildConfig = getClientConfig();
                if (buildConfig) {
                  return (
                    <div
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        opacity: 0.7,
                        marginTop: "4px",
                      }}
                    >
                      当前版本：
                      {buildConfig.commitHash &&
                      buildConfig.commitHash !== "unknown"
                        ? buildConfig.commitHash.substring(0, 8)
                        : "unknown"}
                    </div>
                  );
                }
                return null;
              })()}
            </div>

            <List>
              <ListItem
                title="切换用户"
                subTitle="切换到其他用户"
                onClick={() => {
                  setOpen(false);
                  openManageModal();
                }}
              />
              <ListItem
                title="退出登录"
                subTitle="清除当前登录会话"
                onClick={() => {
                  setOpen(false);
                  void logout();
                }}
              />
            </List>
          </div>
        }
      >
        <div className={styles.trigger} onClick={() => setOpen(!open)}>
          <div className={styles.avatar}>
            {getUserInitial(
              effectiveUser.displayName || effectiveUser.username,
            )}
          </div>
          <div className={styles.triggerText}>
            <div className={clsx(styles.name, "one-line")}>
              {effectiveUser.displayName || effectiveUser.username}
            </div>
          </div>
        </div>
      </Popover>

      {showManageModal && (
        <div className="modal-mask">
          <Modal
            title="用户管理"
            className={styles.manageModal}
            onClose={() => setShowManageModal(false)}
            leftActions={[
              currentEffectiveUserId ? (
                <IconButton
                  key="edit-username"
                  text="修改用户名"
                  bordered
                  onClick={() => {
                    if (effectiveUser) {
                      setEditTargetUser({
                        id: effectiveUser.id,
                        username: effectiveUser.username,
                        displayName: effectiveUser.displayName,
                        role: effectiveUser.role,
                        isActive: true,
                        lastChatAt: null,
                      });
                      setShowEditUsernameModal(true);
                    }
                  }}
                />
              ) : null,
              currentEffectiveUserId ? (
                <IconButton
                  key="edit-password"
                  text="修改密码"
                  bordered
                  onClick={() => {
                    if (effectiveUser) {
                      setEditTargetUser({
                        id: effectiveUser.id,
                        username: effectiveUser.username,
                        displayName: effectiveUser.displayName,
                        role: effectiveUser.role,
                        isActive: true,
                        lastChatAt: null,
                      });
                      setShowEditPasswordModal(true);
                    }
                  }}
                />
              ) : null,
              <IconButton
                key="toggle-password"
                text={showAllPasswords ? "隐藏密码" : "显示密码"}
                bordered
                onClick={() => setShowAllPasswords(!showAllPasswords)}
              />,
            ]}
            actions={[
              <IconButton
                key="delete"
                text={
                  deleteMode
                    ? selectedUserIds.length > 0
                      ? `确认删除 (${selectedUserIds.length})`
                      : "取消删除"
                    : "删除用户"
                }
                bordered
                type={deleteMode ? "danger" : undefined}
                onClick={() => toggleDeleteMode()}
              />,
              <IconButton
                key="create"
                text="新增用户"
                bordered
                onClick={() => setShowCreateModal(true)}
              />,
              <IconButton
                key="close"
                text="关闭"
                bordered
                onClick={() => setShowManageModal(false)}
              />,
            ]}
          >
            <List
              className={clsx(styles.manageList, {
                [styles.manageListLoading]: loadingUsers,
              })}
            >
              {loadingUsers ? (
                <div className={styles.loadingState}>
                  <span className={styles.loadingDots}>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>正在加载用户...</span>
                </div>
              ) : (
                users.map((managedUser) => (
                  <ListItem
                    key={managedUser.id}
                    className={clsx(styles.manageListItem, {
                      [styles.manageListItemActive]:
                        effectiveUser.id === managedUser.id,
                    })}
                    title={
                      <div className={styles.userRow}>
                        <div className={styles.userIdentity}>
                          <div className={styles.userAvatar}>
                            {getUserInitial(
                              managedUser.displayName || managedUser.username,
                            )}
                          </div>
                          <div className={styles.userIdentityText}>
                            <div className={styles.userName}>
                              {managedUser.displayName || managedUser.username}
                            </div>
                            {!managedUser.isActive && (
                              <div className={styles.userMeta}>
                                <span className={styles.disabledState}>
                                  已禁用
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className={styles.userDetails}>
                          <div className={styles.userDetail}>
                            <span className={styles.userInfoLabel}>密码</span>
                            <span className={styles.userInfoValue}>
                              {showAllPasswords
                                ? managedUser.username
                                : "******"}
                            </span>
                          </div>
                          <div className={styles.userDetail}>
                            <span className={styles.userInfoLabel}>
                              对话数量
                            </span>
                            <span className={styles.userInfoValue}>
                              {managedUser.conversationCount ?? "-"} 条
                            </span>
                          </div>
                          <div
                            className={clsx(
                              styles.userDetail,
                              styles.userDetailWide,
                            )}
                          >
                            <span className={styles.userInfoLabel}>
                              最近对话
                            </span>
                            <span className={styles.userInfoValue}>
                              {formatLoginTime(managedUser.lastConversationAt)}
                            </span>
                          </div>
                        </div>
                        {renderRowAction(managedUser)}
                      </div>
                    }
                    onClick={() => {
                      if (toggleUserSelection(managedUser)) {
                        return;
                      }

                      if (effectiveUser.id === managedUser.id) {
                        setShowManageModal(false);
                        return;
                      }

                      handleSwitchUser(managedUser);
                    }}
                  />
                ))
              )}
            </List>
          </Modal>
        </div>
      )}

      <CreateUserModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onConfirm={handleCreateUser}
      />
      {editTargetUser && (
        <EditUsernameModal
          open={showEditUsernameModal}
          currentUsername={
            editTargetUser.displayName || editTargetUser.username
          }
          onClose={() => {
            setShowEditUsernameModal(false);
            setEditTargetUser(null);
          }}
          onConfirm={(newUsername) =>
            handleEditUsername(editTargetUser.id, newUsername)
          }
        />
      )}
      {editTargetUser && (
        <EditPasswordModal
          open={showEditPasswordModal}
          onClose={() => {
            setShowEditPasswordModal(false);
            setEditTargetUser(null);
          }}
          onConfirm={(newPassword) =>
            handleEditPassword(editTargetUser.id, newPassword)
          }
        />
      )}
    </>
  );
}
