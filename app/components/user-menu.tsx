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
  showPrompt,
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

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const response = await fetch("/api/admin/users", {
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
                  isImpersonating ? (
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
                  user.role === "admin" ? (
                    <IconButton
                      key="create"
                      text="新增用户"
                      bordered
                      onClick={async () => {
                        const username = (
                          await showPrompt("请输入新用户名", "", 1, {
                            isSmall: true,
                            submitOnEnter: true,
                          })
                        ).trim();
                        if (!username) {
                          return;
                        }

                        const displayName = (
                          await showPrompt("请输入显示名称（可留空）", "", 1, {
                            isSmall: true,
                            submitOnEnter: true,
                          })
                        ).trim();
                        const password = (
                          await showPrompt("请输入初始密码", "", 1, {
                            isSmall: true,
                            submitOnEnter: true,
                          })
                        ).trim();
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
                              displayName,
                              password,
                              role: "user",
                            }),
                          });
                          const payload = await response
                            .json()
                            .catch(() => null);
                          if (!response.ok || payload?.ok !== true) {
                            throw new Error(
                              String(payload?.error || "新增用户失败"),
                            );
                          }

                          showToast("新增用户成功");
                          await loadUsers();
                        } catch (error) {
                          showToast(
                            error instanceof Error
                              ? error.message
                              : "新增用户失败",
                          );
                        }
                      }}
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
                            {effectiveUser.id === managedUser.id && (
                              <div className={styles.badge}>当前</div>
                            )}
                          </div>
                        }
                        subTitle={!managedUser.isActive ? "已禁用" : undefined}
                        onClick={() => {
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
              {isImpersonating && (
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
              user.role === "admin" ? (
                <IconButton
                  key="create"
                  text="新增用户"
                  bordered
                  onClick={async () => {
                    const username = (
                      await showPrompt("请输入新用户名", "", 1, {
                        isSmall: true,
                        submitOnEnter: true,
                      })
                    ).trim();
                    if (!username) {
                      return;
                    }

                    const displayName = (
                      await showPrompt("请输入显示名称（可留空）", "", 1, {
                        isSmall: true,
                        submitOnEnter: true,
                      })
                    ).trim();
                    const password = (
                      await showPrompt("请输入初始密码", "", 1, {
                        isSmall: true,
                        submitOnEnter: true,
                      })
                    ).trim();
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
                          displayName,
                          password,
                          role: "user",
                        }),
                      });
                      const payload = await response.json().catch(() => null);
                      if (!response.ok || payload?.ok !== true) {
                        throw new Error(
                          String(payload?.error || "新增用户失败"),
                        );
                      }

                      showToast("新增用户成功");
                      await loadUsers();
                    } catch (error) {
                      showToast(
                        error instanceof Error ? error.message : "新增用户失败",
                      );
                    }
                  }}
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
                        <div className={styles.badge}>
                          {effectiveUser.id === managedUser.id
                            ? "当前"
                            : "查看"}
                        </div>
                      </div>
                    }
                    subTitle={!managedUser.isActive ? "已禁用" : undefined}
                    onClick={() => {
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
    </>
  );
}
