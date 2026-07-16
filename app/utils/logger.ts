// 统一日志工具 - 所有模块共用，带时间戳
// 格式: YYYY-MM-DD HH:MM:SS [模块名] 消息

function formatTimestamp(date: Date = new Date()): string {
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

const SENSITIVE_KEY_PATTERN =
  /(?:api[-_]?key|authorization|password|secret|token|cookie|access[-_]?code)/i;
const MAX_LOG_VALUE_LENGTH = 500;
const MAX_DEDUP_ENTRIES = 200;

function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return "[truncated]";
  if (typeof value === "string") {
    return value.length > MAX_LOG_VALUE_LENGTH
      ? `${value.slice(0, MAX_LOG_VALUE_LENGTH)}…[truncated]`
      : value;
  }
  if (value instanceof Error)
    return { name: value.name, message: value.message };
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => sanitizeLogValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 30)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEY_PATTERN.test(key)
            ? "[redacted]"
            : sanitizeLogValue(item, depth + 1),
        ]),
    );
  }
  return value;
}

function getDedupKey(scope: string, level: string, message: string) {
  return `${scope}|${level}|${message}`;
}

function createLogger(scope: string) {
  const prefix = (msg: string) => `${formatTimestamp()} [${scope}] ${msg}`;
  const line = "=".repeat(5);
  const dedupMap = new Map<string, number>();
  const shouldSkipDuplicate = (
    level: string,
    msg: string,
    _payload: unknown[],
  ) => {
    if (level === "warn" || level === "error") {
      return false;
    }

    const key = getDedupKey(scope, level, msg);
    const now = Date.now();
    const lastAt = dedupMap.get(key) || 0;
    if (now - lastAt < 1500) {
      return true;
    }
    dedupMap.set(key, now);
    if (dedupMap.size > MAX_DEDUP_ENTRIES) {
      const oldestKey = dedupMap.keys().next().value;
      if (oldestKey) dedupMap.delete(oldestKey);
    }
    return false;
  };
  return {
    log: (msg: string, ...payload: unknown[]) => {
      if (shouldSkipDuplicate("log", msg, payload)) return;
      payload.length === 0
        ? console.log(prefix(msg))
        : console.log(
            prefix(msg),
            ...payload.map((item) => sanitizeLogValue(item)),
          );
    },
    info: (msg: string, ...payload: unknown[]) => {
      if (shouldSkipDuplicate("info", msg, payload)) return;
      payload.length === 0
        ? console.info(prefix(msg))
        : console.info(
            prefix(msg),
            ...payload.map((item) => sanitizeLogValue(item)),
          );
    },
    warn: (msg: string, ...payload: unknown[]) =>
      payload.length === 0
        ? console.warn(prefix(msg))
        : console.warn(
            prefix(msg),
            ...payload.map((item) => sanitizeLogValue(item)),
          ),
    error: (msg: string, ...payload: unknown[]) =>
      payload.length === 0
        ? console.error(prefix(msg))
        : console.error(
            prefix(msg),
            ...payload.map((item) => sanitizeLogValue(item)),
          ),
    debug: (msg: string, ...payload: unknown[]) => {
      if (process.env.NODE_ENV === "production") return;
      if (shouldSkipDuplicate("debug", msg, payload)) return;
      payload.length === 0
        ? console.debug(prefix(msg))
        : console.debug(
            prefix(msg),
            ...payload.map((item) => sanitizeLogValue(item)),
          );
    },
    banner: (title: string, detail?: string) => {
      console.info(`${formatTimestamp()} ${line} ${title} ${line}`);
      if (detail) {
        console.info(prefix(detail));
      }
    },
  };
}

export const logger = {
  autoSync: createLogger("AutoSync"),
  sync: createLogger("Sync"),
  chat: createLogger("Chat"),
  draw: createLogger("Draw"),
  chatIndex: createLogger("ChatIndex"),
  chatPersist: createLogger("ChatPersist"),
  providerSync: createLogger("ProviderSync"),
  store: createLogger("Store"),
  indexedDB: createLogger("IndexedDB"),
};
