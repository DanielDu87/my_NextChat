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

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createLogger(scope: string) {
  const prefix = (msg: string) => `${formatTimestamp()} [${scope}] ${msg}`;
  const line = "=".repeat(5);
  const dedupMap = new Map<string, number>();
  const shouldSkipDuplicate = (
    level: string,
    msg: string,
    payload: unknown[],
  ) => {
    if (level === "warn" || level === "error") {
      return false;
    }

    const key = `${scope}|${level}|${msg}|${safeStringify(payload)}`;
    const now = Date.now();
    const lastAt = dedupMap.get(key) || 0;
    if (now - lastAt < 1500) {
      return true;
    }
    dedupMap.set(key, now);
    return false;
  };
  return {
    log: (msg: string, ...payload: unknown[]) => {
      if (shouldSkipDuplicate("log", msg, payload)) return;
      payload.length === 0
        ? console.log(prefix(msg))
        : console.log(prefix(msg), ...payload);
    },
    info: (msg: string, ...payload: unknown[]) => {
      if (shouldSkipDuplicate("info", msg, payload)) return;
      payload.length === 0
        ? console.info(prefix(msg))
        : console.info(prefix(msg), ...payload);
    },
    warn: (msg: string, ...payload: unknown[]) =>
      payload.length === 0
        ? console.warn(prefix(msg))
        : console.warn(prefix(msg), ...payload),
    error: (msg: string, ...payload: unknown[]) =>
      payload.length === 0
        ? console.error(prefix(msg))
        : console.error(prefix(msg), ...payload),
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
  chatIndex: createLogger("ChatIndex"),
  chatPersist: createLogger("ChatPersist"),
  providerSync: createLogger("ProviderSync"),
  store: createLogger("Store"),
  indexedDB: createLogger("IndexedDB"),
};
