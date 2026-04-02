"use client";

import { useEffect, useState } from "react";
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

type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt?: string | null;
};

function getUserInitial(name: string) {
  return (
    String(name || "?")
      .trim()
      .slice(0, 1)
      .toUpperCase() || "?"
  );
}

function formatRole(role: string) {
  return role === "admin" ? "管理员" : "用户";
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
  onConfirm: (payload: {
    username: string;
    password: string;
    isAdmin: boolean;
  }) => Promise<void>;
}) {
  const { open, onClose, onConfirm } = props;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!open) {
      setUsername("");
      setPassword("");
      setIsAdmin(false);
    }
  }, [open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const handleClose = () => {
    setUsername("");
    setPassword("");
    setIsAdmin(false);
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
                isAdmin,
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
          <label className={styles.adminCheck}>
            <input
              type="checkbox"
              checked={isAdmin}
              onChange={(e) => setIsAdmin(e.currentTarget.checked)}
            />
            <span className={styles.adminCheckText}>设为管理员</span>
          </label>
        </div>
      </Modal>
    </div>,
    document.body,
  );
}

export function UserMenu(props?: { variant?: "default" | "chat-floating" }) {
  const user = useAuthStore((state) => state.user);
  const effectiveUser = useAuthStore((state) => state.effectiveUser);
  const isImpersonating = useAuthStore((state) => state.isImpersonating);
  const readOnly = useAuthStore((state) => state.readOnly);
  const logout = useAuthStore((state) => state.logout);
  const switchUser = useAuthStore((state) => state.switchUser);
  const exitSwitch = useAuthStore((state) => state.exitSwitch);

  const [open, setOpen] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const currentEffectiveUserId = effectiveUser?.id ?? "";
  const canManageUsers =
    user?.role === "admin" && effectiveUser?.role === "admin";

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const response: Response = await fetch("/api/admin/users", {
        method: "GET",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) {
        throw new Error(String(payload?.error || "获取用户列表失败"));
      }

      setUsers(Array.isArray(payload?.users) ? payload.users : []);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "获取用户列表失败");
    } finally {
      setLoadingUsers(false);
    }
  };

  const isDeletableUser = (managedUser: ManagedUser) => {
    return (
      !!user &&
      user.role === "admin" &&
      managedUser.role !== "admin" &&
      user.id !== managedUser.id
    );
  };

  const handleDeleteUsers = async (targetUsers: ManagedUser[]) => {
    if (!user || !effectiveUser || user.role !== "admin") {
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

        if (effectiveUser.id === managedUser.id && isImpersonating) {
          await exitSwitch();
        }
      }

      showToast("删除用户成功");
      setDeleteMode(false);
      setSelectedUserIds([]);
      await loadUsers();
    } catch (error) {
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
    isAdmin: boolean;
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
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          username,
          displayName: username,
          password,
          role: form.isAdmin ? "admin" : "user",
        }),
      });
      const responsePayload: { ok?: boolean; error?: string } | null =
        await response.json().catch(() => null);
      if (!response.ok || responsePayload?.ok !== true) {
        throw new Error(String(responsePayload?.error || "新增用户失败"));
      }

      showToast("新增用户成功");
      setShowCreateModal(false);
      await loadUsers();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "新增用户失败");
    }
  };

  const renderRowAction = (managedUser: ManagedUser) => {
    const isCurrent = currentEffectiveUserId === managedUser.id;
    const isSelected = selectedUserIds.includes(managedUser.id);

    if (deleteMode && isDeletableUser(managedUser)) {
      return (
        <div className={styles.rowAction}>
          <label className={styles.selectMark}>
            <input type="checkbox" readOnly checked={isSelected} />
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
    if (!showManageModal || !user || !effectiveUser) {
      return;
    }

    if (user.role === "admin") {
      void loadUsers();
      return;
    }

    setUsers([
      {
        id: effectiveUser.id,
        username: effectiveUser.username,
        displayName: effectiveUser.displayName,
        role: user.role,
        isActive: true,
        lastLoginAt: null,
      },
    ]);
  }, [
    showManageModal,
    user?.role,
    effectiveUser?.id,
    effectiveUser?.username,
    effectiveUser?.displayName,
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
    return (
      <>
        <div
          className={clsx(styles.trigger, styles.chatFloatingTrigger)}
          onClick={() => setShowManageModal(true)}
        >
          <div className={styles.chatFloatingText}>
            <div className={clsx(styles.chatFloatingLabel, "one-line")}>
              当前用户（切换）
            </div>
            <div className={clsx(styles.chatFloatingValue, "one-line")}>
              {effectiveUser.displayName || effectiveUser.username}
            </div>
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
                actions={[
                  isImpersonating && effectiveUser.role === "admin" ? (
                    <IconButton
                      key="exit"
                      text="退出查看"
                      bordered
                      onClick={async () => {
                        try {
                          await exitSwitch();
                        } catch (error) {
                          showToast(
                            error instanceof Error
                              ? error.message
                              : "退出查看失败",
                          );
                        }
                      }}
                    />
                  ) : null,
                  canManageUsers ? (
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
                    />
                  ) : null,
                  canManageUsers ? (
                    <IconButton
                      key="create"
                      text="新增用户"
                      bordered
                      onClick={() => setShowCreateModal(true)}
                    />
                  ) : null,
                  <IconButton
                    key="close"
                    text="关闭"
                    bordered
                    onClick={() => setShowManageModal(false)}
                  />,
                ].filter(Boolean as any)}
              >
                <List className={styles.manageList}>
                  {loadingUsers ? (
                    <ListItem
                      className={styles.manageListItem}
                      title="加载中..."
                    />
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
                            <div className={styles.userInfoGrid}>
                              <div className={styles.userInfoItem}>
                                <div className={styles.userInfoLabel}>
                                  用户名
                                </div>
                                <div className={styles.userInfoValue}>
                                  {managedUser.displayName ||
                                    managedUser.username}
                                </div>
                              </div>
                              <div className={styles.userInfoItem}>
                                <div className={styles.userInfoLabel}>身份</div>
                                <div className={styles.userInfoValue}>
                                  {formatRole(managedUser.role)}
                                </div>
                              </div>
                              <div className={styles.userInfoItem}>
                                <div className={styles.userInfoLabel}>
                                  最后登录
                                </div>
                                <div className={styles.userInfoValue}>
                                  {formatLoginTime(managedUser.lastLoginAt)}
                                </div>
                              </div>
                            </div>
                            {renderRowAction(managedUser)}
                          </div>
                        }
                        subTitle={!managedUser.isActive ? "已禁用" : undefined}
                        onClick={() => {
                          if (toggleUserSelection(managedUser)) {
                            return;
                          }

                          if (effectiveUser.id === managedUser.id) {
                            setShowManageModal(false);
                            return;
                          }

                          if (user.role !== "admin") {
                            return;
                          }

                          void switchUser(managedUser.id).catch((error) => {
                            showToast(
                              error instanceof Error
                                ? error.message
                                : "切换用户失败",
                            );
                          });
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
              {readOnly && (
                <div className={styles.readonly}>
                  当前为只读查看模式，不能修改该用户数据。
                </div>
              )}
            </div>

            <List>
              {user.role === "admin" && (
                <ListItem
                  title="切换查看用户"
                  subTitle="查看任意用户的聊天与配置"
                  onClick={() => {
                    setOpen(false);
                    setShowManageModal(true);
                  }}
                />
              )}
              {isImpersonating && effectiveUser.role === "admin" && (
                <ListItem
                  title="退出查看"
                  subTitle="回到管理员自己的数据视角"
                  onClick={() => {
                    setOpen(false);
                    void exitSwitch().catch((error) => {
                      showToast(
                        error instanceof Error ? error.message : "退出查看失败",
                      );
                    });
                  }}
                />
              )}
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
            <div className={clsx(styles.sub, "one-line")}>
              {isImpersonating
                ? `管理员查看 ${effectiveUser.username}`
                : formatRole(user.role)}
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
            actions={[
              canManageUsers ? (
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
                />
              ) : null,
              canManageUsers ? (
                <IconButton
                  key="create"
                  text="新增用户"
                  bordered
                  onClick={() => setShowCreateModal(true)}
                />
              ) : null,
              <IconButton
                key="close"
                text="关闭"
                bordered
                onClick={() => setShowManageModal(false)}
              />,
            ]}
          >
            <List className={styles.manageList}>
              {loadingUsers ? (
                <ListItem className={styles.manageListItem} title="加载中..." />
              ) : (
                users.map((managedUser) => (
                  <ListItem
                    key={managedUser.id}
                    className={styles.manageListItem}
                    title={
                      <div className={styles.userRow}>
                        <div className={styles.userInfoGrid}>
                          <div className={styles.userInfoItem}>
                            <div className={styles.userInfoLabel}>用户名</div>
                            <div className={styles.userInfoValue}>
                              {managedUser.displayName || managedUser.username}
                            </div>
                          </div>
                          <div className={styles.userInfoItem}>
                            <div className={styles.userInfoLabel}>身份</div>
                            <div className={styles.userInfoValue}>
                              {formatRole(managedUser.role)}
                            </div>
                          </div>
                          <div className={styles.userInfoItem}>
                            <div className={styles.userInfoLabel}>最后登录</div>
                            <div className={styles.userInfoValue}>
                              {formatLoginTime(managedUser.lastLoginAt)}
                            </div>
                          </div>
                        </div>
                        {renderRowAction(managedUser)}
                      </div>
                    }
                    subTitle={!managedUser.isActive ? "已禁用" : undefined}
                    onClick={() => {
                      if (toggleUserSelection(managedUser)) {
                        return;
                      }

                      if (effectiveUser.id === managedUser.id) {
                        setShowManageModal(false);
                        return;
                      }

                      void switchUser(managedUser.id).catch((error) => {
                        showToast(
                          error instanceof Error
                            ? error.message
                            : "切换用户失败",
                        );
                      });
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
    </>
  );
}
