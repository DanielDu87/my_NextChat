import * as React from "react";

import styles from "./button.module.scss";
import { CSSProperties } from "react";
import clsx from "clsx";

export type ButtonType = "primary" | "danger" | "green" | null;

export function IconButton(props: {
  onClick?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  icon?: JSX.Element;
  type?: ButtonType;
  text?: React.ReactNode;
  bordered?: boolean;
  shadow?: boolean;
  className?: string;
  title?: string;
  disabled?: boolean;
  tabIndex?: number;
  autoFocus?: boolean;
  style?: CSSProperties;
  aria?: string;
  close?: boolean;
}) {
  return (
    <button
      className={clsx(
        {
          [styles["icon-button"]]: !props.close,
          [styles.border]: props.bordered,
          [styles.shadow]: props.shadow,
          "nextchat-close-button": props.close,
          /* 用户 className 已经包含 nextchat-action-button 时，
             不再自动加 nextchat-default-button，避免类名重复。
             chat-input-send 也是同理：聊天发送/停止按钮是 chat.module.scss 自己
             完整控制的特殊按钮（圆形绝对定位），不依赖任何公共类样式。 */
          "nextchat-default-button":
            !props.close &&
            !props.type &&
            !props.className?.includes("nextchat-action-button") &&
            !props.className?.includes("nextchat-primary-button") &&
            !props.className?.includes("nextchat-danger-button") &&
            !props.className?.includes("nextchat-green-button") &&
            !props.className?.includes("chat-input-send"),
          "nextchat-primary-button": props.type === "primary",
          "nextchat-danger-button": props.type === "danger",
          "nextchat-green-button": props.type === "green",
        },
        styles[props.type ?? ""],
        props.className,
      )}
      onClick={props.onClick}
      onMouseDown={props.onMouseDown}
      onTouchStart={props.onTouchStart}
      title={props.title}
      disabled={props.disabled}
      role="button"
      tabIndex={props.tabIndex}
      autoFocus={props.autoFocus}
      style={props.style}
      aria-label={props.aria}
      data-close-button={props.close ? "true" : undefined}
    >
      {props.icon && (
        <div
          aria-label={props.aria || props.title}
          className={clsx(styles["icon-button-icon"], {
            /* type=primary 时 no-dark 用于排除暗色模式 div:not(.no-dark) > svg 的
               invert(0.5) 滤镜。chat-input-send 同样不依赖公共类，也需要排除。 */
            "no-dark":
              props.type === "primary" ||
              props.className?.includes("chat-input-send"),
          })}
        >
          {props.icon}
        </div>
      )}

      {props.text && (
        <div
          aria-label={props.aria || props.title}
          className={styles["icon-button-text"]}
        >
          {props.text}
        </div>
      )}
    </button>
  );
}
