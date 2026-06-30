"use client";

import { Path } from "../constant";
import type { AutoSyncScope } from "./sync-store-keys";

function normalizeSyncPath(path: string) {
  return path.replace(/\/+$/, "") || Path.Home;
}

export function getCurrentHashPath() {
  if (typeof window === "undefined") {
    return Path.Home;
  }

  const hashPath = String(window.location.hash || "")
    .replace(/^#/, "")
    .trim();
  if (hashPath) {
    return normalizeSyncPath(hashPath.split("?")[0]) || Path.Home;
  }

  return normalizeSyncPath(window.location.pathname) || Path.Home;
}

export function getCurrentAutoSyncScope(): AutoSyncScope {
  const path = getCurrentHashPath();

  if (
    path === Path.Draw ||
    path === Path.DrawHistory ||
    path === "/sd" ||
    path === "/sd/history" ||
    path === "/sd-new"
  ) {
    return "draw";
  }

  if (path === Path.Home) {
    return "home";
  }

  if (
    path === Path.Chat ||
    path === Path.NewChat ||
    path === Path.SearchChat ||
    /^\/chat\/[^/]+$/.test(path)
  ) {
    return "chat";
  }

  return "app";
}
