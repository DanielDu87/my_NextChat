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

const REACT_ROUTER_HISTORY_BRIDGE_MARK = "__nextchatReactRouterHistoryBridge";

type MarkedHistoryMethod = History["pushState"] & {
  [REACT_ROUTER_HISTORY_BRIDGE_MARK]?: true;
};

function mergeNextHistoryState(data: unknown) {
  const currentState = window.history.state;
  const currentObject =
    currentState && typeof currentState === "object" ? currentState : {};
  const nextObject = data && typeof data === "object" ? data : {};

  // Next.js 14 会包装 pushState/replaceState，并把 React Router 的普通路径
  // 变化当作 App Router 导航。保留当前 Next tree 且标记为内部 history
  // 写入，可以只更新地址栏与 BrowserRouter，不重新请求同一个 catch-all 页面。
  return {
    ...currentObject,
    ...nextObject,
    __NA: true,
  };
}

/**
 * 让 React Router 的站内普通路径导航不触发 Next App Router 重新取 RSC。
 *
 * Next 的 history 包装在父组件 effect 中安装，因此本函数允许重复调用：如果
 * Fast Refresh 或 Next 后续重新包装了 history，外层会再次补上桥接；已是当前
 * 最外层时则直接跳过。
 */
export function installReactRouterHistoryBridge() {
  if (typeof window === "undefined") {
    return;
  }

  const history = window.history;
  const currentPushState = history.pushState as MarkedHistoryMethod;
  const currentReplaceState = history.replaceState as MarkedHistoryMethod;
  if (
    currentPushState[REACT_ROUTER_HISTORY_BRIDGE_MARK] &&
    currentReplaceState[REACT_ROUTER_HISTORY_BRIDGE_MARK]
  ) {
    return;
  }

  const pushState: MarkedHistoryMethod = function (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    return currentPushState.call(
      history,
      mergeNextHistoryState(data),
      unused,
      url,
    );
  };
  const replaceState: MarkedHistoryMethod = function (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) {
    return currentReplaceState.call(
      history,
      mergeNextHistoryState(data),
      unused,
      url,
    );
  };

  pushState[REACT_ROUTER_HISTORY_BRIDGE_MARK] = true;
  replaceState[REACT_ROUTER_HISTORY_BRIDGE_MARK] = true;
  history.pushState = pushState;
  history.replaceState = replaceState;
}

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
  // `/chat` 与 `/chat/:id` 只是同一聊天页面内的会话定位变化。
  // 新对话发送第一条消息时会把 URL 从 `/chat` 补全为 `/chat/:id`，
  // 不能因此重新调度整页自动同步，否则历史 -> 新对话的首轮回复期间
  // 会出现一次类似页面刷新的重新水合。
  if (path === Path.Chat || /^\/chat\/[^/]+$/.test(path)) {
    return Path.Chat;
  }

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
