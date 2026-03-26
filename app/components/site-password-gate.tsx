"use client";

import { FormEvent, useState } from "react";
import { IconButton } from "./button";
import { PasswordInput, showToast } from "./ui-lib";
import Logo from "../icons/logo.svg";
import styles from "./site-password-gate.module.scss";

export default function SitePasswordGate() {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!password.trim()) {
      setError("请输入访问密码");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/site-auth", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        const message = payload.error || "验证失败，请稍后重试";
        setError(message);
        return;
      }

      showToast("验证成功");
      window.location.reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : "验证失败，请稍后重试");
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
        <div className={styles.title}>访问验证</div>
        <div className={styles.desc}>
          请输入站点访问密码。验证成功后，当前浏览器 60 天内无需再次输入。
        </div>
        <div className={styles.input}>
          <PasswordInput
            aria="站点访问密码"
            aria-label="站点访问密码"
            value={password}
            placeholder="请输入访问密码"
            autoFocus
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
                {submitting ? "验证中..." : "进入系统"}
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
          密码已存入数据库，修改后旧 cookie 会自动失效。
        </div>
      </form>
    </div>
  );
}
