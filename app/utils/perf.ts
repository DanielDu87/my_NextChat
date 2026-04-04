const PERF_DEBUG_KEY = "nextchat_perf_debug";

export const PERF_FEATURE_DEFAULTS = {
  PERF_ENABLE_MODEL_SELECTOR_INDEX: true,
  PERF_ENABLE_MODEL_SELECTOR_VIRTUAL_LIST: true,
  PERF_ENABLE_LIGHT_STARTUP_SYNC: true,
  PERF_ENABLE_CHAT_LAZY_HYDRATE: true,
  PERF_ENABLE_SYNC_CHECKSUM_SKIP: true,
  PERF_ENABLE_SYNC_LIMITED_CONCURRENCY: false,
  PERF_ENABLE_TAB_LEADER_COORDINATION: true,
  PERF_ENABLE_WORKER_PARSE: false,
} as const;

export type PerfFeatureFlag = keyof typeof PERF_FEATURE_DEFAULTS;

function parseBooleanFlag(value: string | null | undefined) {
  if (value == null) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "off", "no"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function readRuntimeFlag(name: string) {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const directValue = window.localStorage.getItem(name);
    const scopedValue = window.localStorage.getItem(`nextchat:${name}`);
    return parseBooleanFlag(directValue) ?? parseBooleanFlag(scopedValue);
  } catch {
    return undefined;
  }
}

function readEnvFlag(name: string) {
  const env = process.env as Record<string, string | undefined>;
  return (
    parseBooleanFlag(env[`NEXT_PUBLIC_${name}`]) ?? parseBooleanFlag(env[name])
  );
}

export function isPerfDebugEnabled() {
  try {
    if (typeof window === "undefined") {
      return process.env.NEXT_PUBLIC_PERF_DEBUG === "1";
    }

    return (
      window.localStorage.getItem(PERF_DEBUG_KEY) === "1" ||
      process.env.NEXT_PUBLIC_PERF_DEBUG === "1"
    );
  } catch {
    return process.env.NEXT_PUBLIC_PERF_DEBUG === "1";
  }
}

export function isPerfFeatureEnabled(flag: PerfFeatureFlag) {
  return (
    readRuntimeFlag(flag) ?? readEnvFlag(flag) ?? PERF_FEATURE_DEFAULTS[flag]
  );
}

export function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function logPerfSummary(
  scope: string,
  metrics: Record<string, unknown>,
  options?: {
    always?: boolean;
  },
) {
  if (!options?.always && !isPerfDebugEnabled()) {
    return;
  }

  console.info(`[Perf][${scope}]`, metrics);
}

export async function measurePerfAsync<T>(
  scope: string,
  task: () => Promise<T>,
  metrics?: Record<string, unknown>,
) {
  const startedAt = nowMs();
  try {
    return await task();
  } finally {
    logPerfSummary(scope, {
      ...metrics,
      durationMs: Number((nowMs() - startedAt).toFixed(2)),
    });
  }
}
