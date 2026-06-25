"use client";

import React from "react";
import clsx from "clsx";

import styles from "./loading-panel.module.scss";

export type LoadingPanelAction = {
  label: string;
  onClick?: () => void;
  tone?: "primary" | "secondary" | "danger";
  disabled?: boolean;
};

export function LoadingPanel(props: {
  title: string;
  message?: string;
  progress?: number;
  progressLabel?: string;
  fileName?: string;
  metaItems?: string[];
  icon?: React.ReactNode;
  actions?: LoadingPanelAction[];
  layout?: "surface" | "plain" | "fullscreen";
  className?: string;
}) {
  const progress =
    typeof props.progress === "number"
      ? Math.min(1, Math.max(0, props.progress))
      : undefined;

  return (
    <div
      className={clsx(
        styles["loading-panel"],
        styles[`loading-panel-${props.layout || "surface"}`],
        props.className,
      )}
    >
      <div className={styles["loading-panel-card"]}>
        {props.icon && (
          <div className={styles["loading-panel-icon"]}>{props.icon}</div>
        )}
        <div className={styles["loading-panel-title"]}>{props.title}</div>
        {props.fileName && (
          <div
            className={styles["loading-panel-file-name"]}
            title={props.fileName}
          >
            {props.fileName}
          </div>
        )}
        {props.message && (
          <div className={styles["loading-panel-message"]}>{props.message}</div>
        )}
        {typeof progress === "number" && (
          <div className={styles["loading-panel-progress"]}>
            <div className={styles["loading-panel-progress-track"]}>
              <div
                className={styles["loading-panel-progress-bar"]}
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className={styles["loading-panel-progress-label"]}>
              {props.progressLabel || `${Math.round(progress * 100)}%`}
            </div>
          </div>
        )}
        {props.metaItems && props.metaItems.length > 0 && (
          <div className={styles["loading-panel-meta"]}>
            {props.metaItems.map((item) => (
              <span key={item} className={styles["loading-panel-meta-item"]}>
                {item}
              </span>
            ))}
          </div>
        )}
        {props.actions && props.actions.length > 0 && (
          <div className={styles["loading-panel-actions"]}>
            {props.actions.map((action) => (
              <button
                key={`${action.label}-${action.tone || "secondary"}`}
                type="button"
                className={clsx(
                  styles["loading-panel-action"],
                  styles[`loading-panel-action-${action.tone || "secondary"}`],
                )}
                disabled={action.disabled}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
