"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { IconButton } from "./button";
import { PasswordInput } from "./ui-lib";
import Logo from "../icons/logo.svg";
import styles from "./site-password-gate.module.scss";

export default function SitePasswordGate(props: { initialError?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(props.initialError || "");

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!username.trim()) {
      setError("请输入用户名");
      return;
    }
    if (!password.trim()) {
      setError("请输入密码");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok || payload?.ok !== true) {
        setError(String(payload?.error || "登录失败"));
        return;
      }

      router.refresh();
      window.location.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <div className={styles.logo}>
          <Logo />
        </div>
        <div className={styles.title}>账号登录</div>
        <div className={styles.desc}>请使用管理员创建的账号进入系统。</div>
        <div className={`${styles.input} ${styles.usernameInput}`}>
          <input
            aria-label="用户名"
            value={username}
            placeholder="请输入用户名"
            autoFocus
            required
            onChange={(e) => {
              setUsername(e.currentTarget.value);
              if (error) {
                setError("");
              }
            }}
          />
        </div>
        <div className={`${styles.input} ${styles.passwordInput}`}>
          <PasswordInput
            aria="登录密码"
            aria-label="登录密码"
            value={password}
            placeholder="请输入密码"
            required
            onChange={(e) => {
              setPassword(e.currentTarget.value);
              if (error) {
                setError("");
              }
            }}
          />
        </div>
        <div className={styles.actions}>
          <IconButton
            type="primary"
            text={
              <span className={styles.actionText}>
                {submitting ? "登录中..." : "进入系统"}
              </span>
            }
            disabled={submitting}
          />
        </div>
        <div className={styles.errorWrap}>
          <div
            className={styles.error}
            data-visible={error ? "true" : "false"}
            aria-live="polite"
          >
            {error || " "}
          </div>
        </div>
        <div className={styles.tips}>
          首次启动默认管理员账号为 `admin`，密码为
          `admin123`，建议登录后立即新增正式账号。
        </div>
      </form>
    </div>
  );
}
