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

function createLogger(scope: string) {
  const prefix = (msg: string) => `${formatTimestamp()} [${scope}] ${msg}`;
  return {
    log: (msg: string, ...payload: unknown[]) =>
      payload.length === 0
        ? console.log(prefix(msg))
        : console.log(prefix(msg), ...payload),
    info: (msg: string, ...payload: unknown[]) =>
      payload.length === 0
        ? console.info(prefix(msg))
        : console.info(prefix(msg), ...payload),
    warn: (msg: string, ...payload: unknown[]) =>
      payload.length === 0
        ? console.warn(prefix(msg))
        : console.warn(prefix(msg), ...payload),
    error: (msg: string, ...payload: unknown[]) =>
      payload.length === 0
        ? console.error(prefix(msg))
        : console.error(prefix(msg), ...payload),
    banner: (title: string, detail?: string) => {
      const line = "=".repeat(40);
      console.info(
        detail
          ? `${formatTimestamp()} ${line} ${title} | ${detail} ${line}`
          : `${formatTimestamp()} ${line} ${title} ${line}`,
      );
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
