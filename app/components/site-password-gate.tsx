"use client";

import { FormEvent, KeyboardEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "../icons/logo.svg";
import EyeIcon from "../icons/eye.svg";
import EyeOffIcon from "../icons/eye-off.svg";
import styles from "./site-password-gate.module.scss";

export default function SitePasswordGate(props: { initialError?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(props.initialError || "");

  useEffect(() => {
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event("nextchat:theme-ready"));
    });
  }, []);

  const handlePasswordKey = (event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(event.getModifierState?.("CapsLock") === true);
  };

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (submitting) {
      return;
    }
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
        setSubmitting(false);
        return;
      }

      router.replace("/");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "登录失败");
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.page}>
      <form
        className={styles.card}
        onSubmit={handleSubmit}
        aria-labelledby="site-login-title"
        noValidate
      >
        <header className={styles.header}>
          <div className={`${styles.logo} no-dark`} aria-hidden="true">
            <Logo />
          </div>
          <h1 id="site-login-title" className={styles.title}>
            登录 NextChat
          </h1>
          <p className={styles.desc}>使用管理员为你创建的账号登录</p>
        </header>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="site-login-username">
            用户名
          </label>
          <input
            id="site-login-username"
            name="username"
            className={`nextchat-input-control ${styles.input}`}
            value={username}
            placeholder="请输入用户名"
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            required
            aria-invalid={error === "请输入用户名" || undefined}
            onChange={(e) => {
              setUsername(e.currentTarget.value);
              if (error) {
                setError("");
              }
            }}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="site-login-password">
            密码
          </label>
          <div className={styles.passwordBox}>
            <input
              id="site-login-password"
              name="password"
              className={`nextchat-input-control ${styles.input} ${styles.passwordInput}`}
              value={password}
              placeholder="请输入密码"
              type={passwordVisible ? "text" : "password"}
              autoComplete="current-password"
              required
              aria-invalid={error === "请输入密码" || undefined}
              aria-describedby={capsLockOn ? "site-login-caps" : undefined}
              onKeyDown={handlePasswordKey}
              onKeyUp={handlePasswordKey}
              onBlur={() => setCapsLockOn(false)}
              onChange={(e) => {
                setPassword(e.currentTarget.value);
                if (error) {
                  setError("");
                }
              }}
            />
            <button
              type="button"
              className={styles.passwordToggle}
              aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
              aria-pressed={passwordVisible}
              aria-controls="site-login-password"
              onClick={() => setPasswordVisible((visible) => !visible)}
            >
              {passwordVisible ? <EyeIcon /> : <EyeOffIcon />}
            </button>
          </div>
          {capsLockOn && (
            <p id="site-login-caps" className={styles.hint}>
              大写锁定已开启
            </p>
          )}
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          className={`nextchat-primary-button ${styles.submit}`}
          disabled={submitting}
          aria-busy={submitting}
        >
          {submitting && <span className={styles.spinner} aria-hidden="true" />}
          <span>{submitting ? "登录中…" : "登录"}</span>
        </button>

        <p className={styles.footnote}>忘记账号或密码，请联系管理员重置</p>
      </form>
    </main>
  );
}
