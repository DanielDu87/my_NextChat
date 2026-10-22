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
            /* no-dark 标记“图标颜色由按钮自身控制”的按钮（主按钮、绿按钮及 chat-input-send 等），
               暗色全局反相滤镜已移除，这里仅保留为样式钩子。 */
            "no-dark":
              props.type === "primary" ||
              props.type === "green" ||
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
