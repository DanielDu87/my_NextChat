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

// 跨模块共享的首开同步节流窗口：home-bootstrap 和 auto-sync 启动都会更新这个时间戳，
// 双方在判断「是否要跳过重复同步」时统一读这个值，避免 /chat 等路由进入时
// home-bootstrap 跑完 Chat 拉取后又紧跟着被 auto-sync 重复触发一次。
let lastAutoSyncBootstrapAt = 0;

const AUTO_SYNC_BOOTSTRAP_DEDUP_MS = 5000;

export function markRouteSyncBootstrap(source: string) {
  lastAutoSyncBootstrapAt = Date.now();
  if (typeof window !== "undefined") {
    appendRouteSyncTrace(
      "sync-start",
      getCurrentRoutePath(),
      source || "unknown",
    );
  }
}

export function shouldSkipAutoSyncByRecentBootstrap() {
  if (lastAutoSyncBootstrapAt === 0) {
    return false;
  }
  return Date.now() - lastAutoSyncBootstrapAt < AUTO_SYNC_BOOTSTRAP_DEDUP_MS;
}

export function resetRouteSyncBootstrap() {
  lastAutoSyncBootstrapAt = 0;
}

function getCurrentRoutePath() {
  if (typeof window === "undefined") {
    return "";
  }
  return normalizeRouteSyncPath(window.location?.pathname || "");
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
  return true;
}

export function shouldAutoStartRouteSync(path: string) {
  return true;
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
  // 不再打印「[RouteSync] 进入/启动」启动日志：每跳页都打一遍，污染同步汇总。
  // 路由同步准备 / 启动 / 跳过由 appendRouteSyncTrace 内部记 trace，调试时
  // 通过「自动同步」页面的诊断面板或 window.__routeSyncTrace 查看。
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
  // 不再打印「[RouteSync] xxx自动同步已启动」：单跳页会重复输出，留 trace 即可。
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
