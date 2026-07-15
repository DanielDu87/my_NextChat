const API_PATH_MEMORY_STORAGE_KEY = "nextchat:api-path-memory";

export type RememberedChatEndpoint = {
  path: string;
  method?: "POST";
  format?: string;
};

type ApiPathMemoryRecord = {
  modelListPath?: string;
  modelListApiKey?: string;
  chatPath?: string;
  chatEndpoint?: RememberedChatEndpoint;
  updatedAt?: number;
};

function normalizeBaseUrl(baseUrl?: string) {
  return String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1$/i, "");
}

function normalizePath(path?: string) {
  const value = String(path || "").trim();
  if (!value) return "";
  if (value.startsWith("http")) {
    try {
      const url = new URL(value);
      return `${url.pathname}${url.search}`.replace(/^\/+/, "");
    } catch {
      return value.replace(/^\/+/, "");
    }
  }
  return value.replace(/^\/+/, "");
}

function normalizeChatEndpoint(endpoint?: RememberedChatEndpoint) {
  const normalizedPath = normalizePath(endpoint?.path);
  if (!normalizedPath) return undefined;
  return {
    path: normalizedPath,
    method: endpoint?.method || "POST",
    format: endpoint?.format || "openai-chat",
  } satisfies RememberedChatEndpoint;
}

function getMemoryKey(params: {
  provider?: string;
  profileId?: string;
  profileName?: string;
  baseUrl?: string;
}) {
  return [
    String(params.provider || "custom").toLowerCase(),
    String(params.profileId || params.profileName || "default").toLowerCase(),
    normalizeBaseUrl(params.baseUrl).toLowerCase(),
  ].join("::");
}

function readMemory(): Record<string, ApiPathMemoryRecord> {
  try {
    const raw = globalThis.localStorage?.getItem(API_PATH_MEMORY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMemory(memory: Record<string, ApiPathMemoryRecord>) {
  try {
    globalThis.localStorage?.setItem(
      API_PATH_MEMORY_STORAGE_KEY,
      JSON.stringify(memory),
    );
  } catch {
    // localStorage 不可用时跳过，保持自动探测但不缓存。
  }
}

export function getRememberedModelListPath(params: {
  provider?: string;
  profileId?: string;
  profileName?: string;
  baseUrl?: string;
}) {
  return readMemory()[getMemoryKey(params)]?.modelListPath || "";
}

export function getRememberedModelListApiKey(params: {
  provider?: string;
  profileId?: string;
  profileName?: string;
  baseUrl?: string;
}) {
  return readMemory()[getMemoryKey(params)]?.modelListApiKey || "";
}

export function getRememberedModelListUpdatedAt(params: {
  provider?: string;
  profileId?: string;
  profileName?: string;
  baseUrl?: string;
}) {
  return Number(readMemory()[getMemoryKey(params)]?.updatedAt || 0);
}

export function rememberModelListPath(
  params: {
    provider?: string;
    profileId?: string;
    profileName?: string;
    baseUrl?: string;
  },
  path?: string,
  apiKey?: string,
) {
  const memory = readMemory();
  const key = getMemoryKey(params);
  if (!path) {
    if (memory[key]) {
      delete memory[key].modelListPath;
      delete memory[key].modelListApiKey;
      writeMemory(memory);
    }
    return;
  }
  const normalizedPath = normalizePath(path);
  if (!normalizedPath) return;
  memory[key] = {
    ...(memory[key] || {}),
    modelListPath: `/${normalizedPath}`,
    modelListApiKey: String(apiKey || "").trim() || undefined,
    updatedAt: Date.now(),
  };
  writeMemory(memory);
}

export function getRememberedChatEndpoint(params: {
  provider?: string;
  profileId?: string;
  profileName?: string;
  baseUrl?: string;
}) {
  const record = readMemory()[getMemoryKey(params)];
  return normalizeChatEndpoint(
    record?.chatEndpoint ||
      (record?.chatPath ? { path: record.chatPath } : undefined),
  );
}

export function rememberChatEndpoint(
  params: {
    provider?: string;
    profileId?: string;
    profileName?: string;
    baseUrl?: string;
  },
  endpoint?: RememberedChatEndpoint,
) {
  const normalizedEndpoint = normalizeChatEndpoint(endpoint);
  if (!normalizedEndpoint) return;
  const memory = readMemory();
  const key = getMemoryKey(params);
  memory[key] = {
    ...(memory[key] || {}),
    chatPath: normalizedEndpoint.path,
    chatEndpoint: normalizedEndpoint,
    updatedAt: Date.now(),
  };
  writeMemory(memory);
}

export function getRememberedChatPath(params: {
  provider?: string;
  profileId?: string;
  profileName?: string;
  baseUrl?: string;
}) {
  return getRememberedChatEndpoint(params)?.path || "";
}

export function rememberChatPath(
  params: {
    provider?: string;
    profileId?: string;
    profileName?: string;
    baseUrl?: string;
  },
  path?: string,
) {
  rememberChatEndpoint(params, { path: path || "" });
}
