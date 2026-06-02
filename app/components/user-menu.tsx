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
  conversationCount?: number;
  lastConversationAt?: string | null;
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

  const loadUsers = async () => {
    console.log("🔄 加载用户列表...");
    setLoadingUsers(true);
    try {
      const response: Response = await fetch("/api/admin/users", {
        method: "GET",
        cache: "no-store",
      });
      console.log("📥 收到响应:", response.status, response.statusText);

      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) {
        throw new Error(String(payload?.error || "获取用户列表失败"));
      }

      console.log(
        "✅ 用户列表加载成功，共",
        payload.users?.length || 0,
        "个用户",
      );
      console.log(
        "用户:",
        (payload.users || []).map(
          (u: any) =>
            `${u.username} (${u.role}, ${u.conversationCount ?? 0}个对话)`,
        ),
      );

      setUsers(Array.isArray(payload?.users) ? payload.users : []);
    } catch (error) {
      console.error("❌ 加载用户列表失败:", error);
      showToast(error instanceof Error ? error.message : "获取用户列表失败");
    } finally {
      setLoadingUsers(false);
    }
  };

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

    console.log("=== 开始删除用户 ===");
    console.log("待删除用户数量:", deletableUsers.length);
    console.log(
      "用户列表:",
      deletableUsers.map((u) => `${u.username} (${u.displayName})`),
    );

    try {
      for (const managedUser of deletableUsers) {
        console.log(`\n📤 删除用户: ${managedUser.username}`);
        console.log("用户ID:", managedUser.id);
        console.log("发送请求: DELETE /api/admin/users");

        const response = await fetch("/api/admin/users", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({
            userId: managedUser.id,
          }),
        });

        console.log("📥 收到响应:", response.status, response.statusText);

        const payload = await response.json().catch(() => null);
        console.log("响应数据:", payload);

        if (!response.ok || payload?.ok !== true) {
          throw new Error(String(payload?.error || "删除用户失败"));
        }

        console.log(`✅ 用户 ${managedUser.username} 删除成功`);

        if (effectiveUser.id === managedUser.id && user) {
          console.log("🔄 切换回当前用户...");
          await switchUser(user.id);
        }
      }

      console.log("\n🔄 刷新用户列表...");
      showToast("删除用户成功");
      setDeleteMode(false);
      setSelectedUserIds([]);
      await loadUsers();

      console.log("✅ 用户列表已刷新");
      console.log("=== 删除用户完成 ===\n");
    } catch (error) {
      console.error("❌ 删除用户失败:", error);
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

    console.log("=== 开始新增用户 ===");
    console.log("用户名:", username);

    try {
      console.log("📤 发送请求: POST /api/admin/users");
      const requestBody = {
        username,
        displayName: username,
        password,
      };
      console.log("请求体:", { ...requestBody, password: "***" });

      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(requestBody),
      });

      console.log("📥 收到响应:", response.status, response.statusText);

      const responsePayload: {
        ok?: boolean;
        error?: string;
        user?: any;
      } | null = await response.json().catch(() => null);

      console.log("响应数据:", responsePayload);

      if (!response.ok || responsePayload?.ok !== true) {
        throw new Error(String(responsePayload?.error || "新增用户失败"));
      }

      console.log("✅ 用户创建成功:", responsePayload?.user);
      console.log("🔄 刷新用户列表...");

      showToast("新增用户成功");
      setShowCreateModal(false);
      await loadUsers();

      console.log("✅ 用户列表已刷新");
      console.log("=== 新增用户完成 ===\n");
    } catch (error) {
      console.error("❌ 新增用户失败:", error);
      showToast(error instanceof Error ? error.message : "新增用户失败");
    }
  };

  const handleSwitchUser = async (managedUser: ManagedUser) => {
    if (!user) return;

    setShowManageModal(false);
    try {
      await switchUser(managedUser.id);
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
      await loadUsers();
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

    void loadUsers();
  }, [
    showManageModal,
    currentEffectiveUserId,
    effectiveUserUsername,
    effectiveUserDisplayName,
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
                            lastLoginAt: null,
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
                            lastLoginAt: null,
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
                                <div className={styles.userInfoLabel}>密码</div>
                                <div className={styles.userInfoValue}>
                                  {showAllPasswords
                                    ? managedUser.username
                                    : "******"}
                                </div>
                              </div>
                              <div className={styles.userInfoItem}>
                                <div className={styles.userInfoLabel}>
                                  对话数
                                </div>
                                <div className={styles.userInfoValue}>
                                  {managedUser.conversationCount ?? "-"}
                                </div>
                              </div>
                              <div className={styles.userInfoItem}>
                                <div className={styles.userInfoLabel}>
                                  最后对话
                                </div>
                                <div className={styles.userInfoValue}>
                                  {formatLoginTime(
                                    managedUser.lastConversationAt,
                                  )}
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
            </div>

            <List>
              <ListItem
                title="切换用户"
                subTitle="切换到其他用户"
                onClick={() => {
                  setOpen(false);
                  setShowManageModal(true);
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
                        lastLoginAt: null,
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
                        lastLoginAt: null,
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
                            <div className={styles.userInfoLabel}>密码</div>
                            <div className={styles.userInfoValue}>
                              {showAllPasswords
                                ? managedUser.username
                                : "******"}
                            </div>
                          </div>
                          <div className={styles.userInfoItem}>
                            <div className={styles.userInfoLabel}>对话数</div>
                            <div className={styles.userInfoValue}>
                              {managedUser.conversationCount ?? "-"}
                            </div>
                          </div>
                          <div className={styles.userInfoItem}>
                            <div className={styles.userInfoLabel}>最后对话</div>
                            <div className={styles.userInfoValue}>
                              {formatLoginTime(managedUser.lastConversationAt)}
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
