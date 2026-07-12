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
             chat-input-send / chat-export-action 也是同理：聊天发送按钮（圆形绝对定位）
             和导出/分享按钮的视觉与窗口其他按钮略有差异，所有状态都由 chat.module.scss
             完整控制，不依赖任何公共类样式。 */
          "nextchat-default-button":
            !props.close &&
            !props.type &&
            !props.className?.includes("nextchat-action-button") &&
            !props.className?.includes("nextchat-primary-button") &&
            !props.className?.includes("nextchat-danger-button") &&
            !props.className?.includes("nextchat-green-button") &&
            !props.className?.includes("chat-input-send") &&
            !props.className?.includes("chat-export-action"),
          "nextchat-primary-button": props.type === "primary",
          "nextchat-danger-button": props.type === "danger",
          "nextchat-green-button": props.type === "green",
        },
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
               invert(0.5) 滤镜。chat-input-send / chat-export-action / prompt-picker-manage
               也是同理：需要阻止全局反相滤镜覆盖图标颜色。 */
            "no-dark":
              props.type === "primary" ||
              props.className?.includes("chat-input-send") ||
              props.className?.includes("chat-export-action") ||
              props.className?.includes("prompt-picker-manage"),
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
