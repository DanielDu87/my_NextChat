import { Path } from "../constant";

export type RouteSyncTracePhase = "prepared" | "sync-start";
export const ROUTE_SYNC_ENTRY_EVENT = "nextchat:route-sync-entry";

export type RouteSyncTraceEntry = {
  phase: RouteSyncTracePhase;
  path: string;
  source: string;
  at: number;
};

declare global {
  interface Window {
    __NEXTCHAT_ROUTE_SYNC_TRACE__?: RouteSyncTraceEntry[];
  }
}

let lastPreparedRoute = "";

function getRouteSyncLogName(path: string) {
  switch (path) {
    case Path.Home:
      return "首页";
    case Path.ApiConfig:
      return "API 配置页";
    case Path.Draw:
      return "绘画页";
    case Path.DrawHistory:
      return "绘画历史页";
    default:
      return path;
  }
}

function formatRouteEnterPrefix(path: string) {
  const routeName = getRouteSyncLogName(path);

  return routeName.startsWith("/") ? `进入 ${routeName}` : `进入 ${routeName}`;
}

function normalizeRouteSyncPath(path: string) {
  if (path === "/sd") {
    return Path.Draw;
  }

  if (path === "/sd/history" || path === "/sd-new") {
    return Path.DrawHistory;
  }

  return path;
}

function appendRouteSyncTrace(
  phase: RouteSyncTracePhase,
  path: string,
  source: string,
) {
  if (typeof window === "undefined") {
    return;
  }

  const nextEntry: RouteSyncTraceEntry = {
    phase,
    path,
    source,
    at: Date.now(),
  };
  const currentTrace = Array.isArray(window.__NEXTCHAT_ROUTE_SYNC_TRACE__)
    ? window.__NEXTCHAT_ROUTE_SYNC_TRACE__
    : [];

  currentTrace.push(nextEntry);
  window.__NEXTCHAT_ROUTE_SYNC_TRACE__ = currentTrace.slice(-50);
}

export function shouldPrepareRouteEntryForSync(path: string) {
  const normalizedPath = normalizeRouteSyncPath(path);

  return (
    normalizedPath === Path.Home ||
    normalizedPath === Path.Chat ||
    normalizedPath === Path.NewChat ||
    normalizedPath === Path.SearchChat ||
    normalizedPath === Path.Draw ||
    normalizedPath === Path.DrawHistory ||
    /^\/chat\/[^/]+$/.test(normalizedPath) ||
    normalizedPath === Path.ApiConfig
  );
}

export function shouldAutoStartRouteSync(path: string) {
  const normalizedPath = normalizeRouteSyncPath(path);

  return (
    normalizedPath === Path.Home ||
    normalizedPath === Path.Chat ||
    normalizedPath === Path.NewChat ||
    normalizedPath === Path.SearchChat ||
    normalizedPath === Path.Draw ||
    normalizedPath === Path.DrawHistory ||
    /^\/chat\/[^/]+$/.test(normalizedPath)
  );
}

export function prepareRouteEntryForSync(
  path: string,
  options?: {
    source?: string;
    force?: boolean;
  },
) {
  const normalizedPath = normalizeRouteSyncPath(path);

  if (!shouldPrepareRouteEntryForSync(normalizedPath)) {
    lastPreparedRoute = "";
    return false;
  }

  if (!options?.force && lastPreparedRoute === normalizedPath) {
    return false;
  }

  lastPreparedRoute = normalizedPath;
  appendRouteSyncTrace(
    "prepared",
    normalizedPath,
    options?.source ?? "unknown",
  );
  const canAutoStart = shouldAutoStartRouteSync(normalizedPath);
  console.info(
    canAutoStart
      ? `[RouteSync] ${formatRouteEnterPrefix(
          normalizedPath,
        )}，准备启动自动同步`
      : `[RouteSync] ${formatRouteEnterPrefix(normalizedPath)}，自动同步已关闭`,
    {
      path: normalizedPath,
      source: options?.source ?? "unknown",
    },
  );
  notifyRouteSyncEntry(normalizedPath, options?.source ?? "unknown", {
    autoStart: canAutoStart,
  });
  return true;
}

export function markRouteSyncStart(path: string, source: string) {
  const normalizedPath = normalizeRouteSyncPath(path);

  if (
    !shouldPrepareRouteEntryForSync(normalizedPath) ||
    !shouldAutoStartRouteSync(normalizedPath)
  ) {
    return;
  }

  appendRouteSyncTrace("sync-start", normalizedPath, source);
  console.info(
    `[RouteSync] ${getRouteSyncLogName(normalizedPath)}自动同步已启动`,
    {
      path: normalizedPath,
      source,
    },
  );
}

export function notifyRouteSyncEntry(
  path: string,
  source: string,
  options?: { autoStart?: boolean },
) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(ROUTE_SYNC_ENTRY_EVENT, {
      detail: {
        path: normalizeRouteSyncPath(path),
        source,
        autoStart: options?.autoStart ?? shouldAutoStartRouteSync(path),
      },
    }),
  );
}
