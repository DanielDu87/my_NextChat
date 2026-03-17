import { STORAGE_KEY, StoreKey } from "@/app/constant";
import { SyncStore } from "@/app/store/sync";

export type WebDAVConfig = SyncStore["webdav"];
export type WebDavClient = ReturnType<typeof createWebDavClient>;

const FILE_NAMES: Record<string, string> = {
  [StoreKey.Chat]: "chat-index.json",
  [StoreKey.Access]: "access.json",
  [StoreKey.Config]: "config.json",
  [StoreKey.Mask]: "mask.json",
  [StoreKey.Prompt]: "prompt.json",
};

const FILE_DISPLAY_NAMES: Record<string, string> = {
  "chat-index.json": "聊天索引",
  "access.json": "访问配置",
  "config.json": "应用配置",
  "models.json": "模型数据",
  "index.json": "模型索引",
  "mask.json": "Prompt模板",
  "prompt.json": "自定义Prompt",
};

const CHAT_RECORDS_DIR = "chat-records";
const MODELS_DIR = "models";
const MODELS_INDEX_FILE_NAME = `${MODELS_DIR}/index.json`;
const MODELS_EXPLANATION_FILE_NAME = `${MODELS_DIR}/category-explanation.json`;
const LEGACY_MODELS_FILE_NAME = "models.json";

type JsonObject = Record<string, any>;
type LogMode = "verbose" | "silent";
type ModelsIndexItem = {
  providerId: string;
  filePath: string;
  count: number;
};

function stringifyJson(value: unknown) {
  return JSON.stringify(value, null, "\t");
}

function formatJsonString(value: string) {
  try {
    return stringifyJson(JSON.parse(value));
  } catch {
    return value;
  }
}

function formatDateSegment(timestamp?: number) {
  const date = new Date(timestamp || Date.now());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildChatSessionFileName(session: {
  id?: string;
  lastUpdate?: number;
  storagePath?: string;
}) {
  if (session.storagePath) {
    return session.storagePath;
  }

  const datePart = formatDateSegment(session.lastUpdate);
  return `${CHAT_RECORDS_DIR}/${datePart}-${session.id}.json`;
}

function omitSessionMessages(session: JsonObject) {
  const { messages, ...rest } = session;
  return {
    ...rest,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    storagePath: buildChatSessionFileName(session),
  };
}

function buildChatIndexPayload(chatState: JsonObject) {
  return {
    ...chatState,
    sessions: Array.isArray(chatState.sessions)
      ? chatState.sessions.map((session: JsonObject) =>
          omitSessionMessages(session),
        )
      : [],
  };
}

function buildConfigPayload(configState: JsonObject) {
  const { models, ...rest } = configState;
  return {
    config: rest,
    models: Array.isArray(models) ? models : [],
  };
}

function extractEmbeddedModels(configState: JsonObject) {
  return Array.isArray(configState.models) ? configState.models : [];
}

function getModelProviderId(model: JsonObject) {
  const providerId = model?.provider?.id;
  if (typeof providerId === "string" && providerId.trim()) {
    return providerId.trim();
  }

  if (typeof providerId === "number") {
    return String(providerId);
  }

  return "unknown";
}

function sanitizeProviderId(providerId: string) {
  return providerId.toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
}

function buildModelsProviderFilePath(providerId: string) {
  return `${MODELS_DIR}/${sanitizeProviderId(providerId)}.json`;
}

function buildModelsIndex(models: JsonObject[]) {
  const providerMap = new Map<string, JsonObject[]>();

  models.forEach((model) => {
    const providerId = getModelProviderId(model);
    const existing = providerMap.get(providerId) || [];
    existing.push(model);
    providerMap.set(providerId, existing);
  });

  const entries = [...providerMap.entries()].map(
    ([providerId, providerModels]) => ({
      providerId,
      filePath: buildModelsProviderFilePath(providerId),
      count: providerModels.length,
    }),
  );

  return {
    entries,
    updatedAt: new Date().toISOString(),
    providerMap,
  };
}

function buildModelsCategoryExplanation() {
  return {
    title: "模型字段说明",
    description:
      "这个文件用于解释 models 目录中每个模型对象里分类与发布时间字段的写法。供应商模型文件本身仍然只保存模型数据。",
    fields: {
      category: {
        type: "string",
        required: false,
        description:
          "主分类字段。当前用于界面筛选和主分类判断。手动修改模型分类时，优先改这个字段。",
        allowedValues: ["image", "video", "web", "thinking"],
      },
      categorySource: {
        type: "number",
        required: false,
        description:
          "分类来源。0 表示自动分类，1 表示手动分类。手动修改后建议设为 1，避免后续自动刷新覆盖。",
        allowedValues: {
          0: "自动分类",
          1: "手动分类",
        },
      },
      categories: {
        type: "string[]",
        required: false,
        description:
          "扩展分类列表。可同时保存多个分类标签。主判断优先使用 category，这个字段用于补充标签。",
        allowedValues: ["image", "video", "web", "thinking"],
      },
      type: {
        type: "string",
        required: false,
        description:
          "模型主类型。常见值如 image、video、thinking。主要用于兼容旧逻辑和部分能力判断。",
      },
      types: {
        type: "string[]",
        required: false,
        description:
          "模型类型列表。通常包含更细的类型信息，例如 image_generation、video_generation。",
      },
      features: {
        type: "string[]",
        required: false,
        description:
          "功能特征列表。常见值如 thinking、web、web_search，用于界面筛选和能力提示。",
      },
      capabilities: {
        type: "string[]",
        required: false,
        description:
          "能力列表。常见值如 generate-image、generate-video、reasoning、search。",
      },
      publishedAt: {
        type: "number",
        required: false,
        description:
          "模型正式发布时间，固定使用 YYYYMMDD 整数格式。例如 20250807。",
      },
      publishedAtSource: {
        type: "string",
        required: false,
        description: "发布时间来源标记，用于区分字段是如何确认的。",
        allowedValues: {
          name: "直接从模型名里的完整日期解析得到",
          official: "该模型名本身有独立官方发布时间",
          family: "该条目没有独立官方日期，回退到官方模型家族发布日期",
          manual: "手动维护或人工确认的发布时间",
          openrouter: "来自 OpenRouter 模型 API 的 created 时间戳",
          llm_stats: "来自 llm-stats.com 模型页或时间线",
          huggingface: "来自 huggingface.co 模型 API 或模型页元数据",
          artificial_analysis: "来自 artificialanalysis.ai 模型页元数据",
        },
      },
      publishedAtUrl: {
        type: "string",
        required: false,
        description:
          "最终采用发布时间对应的官方来源链接。official 和 family 场景都应尽量填写。",
      },
      publishedAtNote: {
        type: "string",
        required: false,
        description:
          "必要时补充简短说明，例如模型别名、供应商包装名，或回退到家族发布日期的原因。",
      },
    },
    examples: [
      {
        name: "手动把模型标记为图片模型",
        model: {
          category: "image",
          categorySource: 1,
          categories: ["image"],
          publishedAt: 20250423,
          publishedAtSource: "official",
          publishedAtUrl: "https://example.com/official-release",
        },
      },
      {
        name: "自动识别为联网推理模型",
        model: {
          category: "web",
          categorySource: 0,
          categories: ["web", "thinking"],
          features: ["web", "web_search", "thinking"],
          capabilities: ["search", "web", "reasoning"],
          publishedAt: 20250617,
          publishedAtSource: "family",
          publishedAtUrl: "https://example.com/family-release",
          publishedAtNote: "模型别名，回退到对应家族正式发布日期",
        },
      },
    ],
    notes: [
      "如果只需要改一个模型的分类，通常只改 category 和 categorySource 就够了。",
      "当 categorySource 为 1 时，同步合并时会优先保留这个手动分类。",
      "发布时间优先以模型对象上的 publishedAt 系列字段为准，不再依赖组件内硬编码规则。",
      "如果模型名没有完整日期且也找不到独立官方发布日期，可回退到官方模型家族发布日期，并将 publishedAtSource 记为 family。",
      "二手来源允许直接作为发布时间来源入库，但必须在 publishedAtSource 中显式区分。",
      "供应商模型文件名由 provider.id 生成，例如 models/openai.json。",
    ],
  };
}

export function createWebDavClient(store: SyncStore) {
  const folder = STORAGE_KEY;
  const config = store.webdav;
  const proxyUrl =
    store.useProxy && store.proxyUrl.length > 0 ? store.proxyUrl : undefined;

  const headers = () => {
    const auth = btoa(config.username + ":" + config.password);

    return {
      authorization: `Basic ${auth}`,
    };
  };

  const path = (path: string, proxyMethod: string = "") => {
    let normalizedPath = path;
    if (normalizedPath.startsWith("/")) {
      normalizedPath = normalizedPath.slice(1);
    }

    let normalizedProxyUrl = proxyUrl || "";
    if (normalizedProxyUrl.endsWith("/")) {
      normalizedProxyUrl = normalizedProxyUrl.slice(0, -1);
    }

    let url;
    const pathPrefix = "/api/webdav/";

    try {
      const u = new URL(normalizedProxyUrl + pathPrefix + normalizedPath);
      u.searchParams.append("endpoint", config.endpoint);
      proxyMethod && u.searchParams.append("proxy_method", proxyMethod);
      url = u.toString();
    } catch {
      url = pathPrefix + normalizedPath + "?endpoint=" + config.endpoint;
      if (proxyMethod) {
        url += "&proxy_method=" + proxyMethod;
      }
    }

    return url;
  };

  const readTextFile = async (
    filePath: string,
    displayName?: string,
    logMode: LogMode = "verbose",
  ) => {
    const fileName = filePath.split("/").pop() || filePath;
    const shownName = displayName || FILE_DISPLAY_NAMES[fileName] || fileName;

    if (logMode === "verbose") {
      console.log(`[WebDav] ⬇️ 正在下载: ${shownName} (${filePath})...`);
    }

    const res = await fetch(path(`${folder}/${filePath}`), {
      method: "GET",
      headers: headers(),
    });

    if (res.status === 404) {
      if (logMode === "verbose") {
        console.log(`[WebDav] ℹ️ 文件不存在: ${shownName}`);
      }
      return "";
    }

    if (!res.ok) {
      throw new Error(`${shownName} 下载失败: ${res.status} ${res.statusText}`);
    }

    const content = await res.text();
    if (logMode === "verbose") {
      const sizeKB = (content.length / 1024).toFixed(1);
      console.log(`[WebDav] ✅ 下载成功: ${shownName} (${sizeKB}KB)`);
    }
    return content;
  };

  const writeTextFile = async (
    filePath: string,
    value: string,
    displayName?: string,
    logMode: LogMode = "verbose",
  ) => {
    const fileName = filePath.split("/").pop() || filePath;
    const shownName = displayName || FILE_DISPLAY_NAMES[fileName] || fileName;

    if (logMode === "verbose") {
      const sizeKB = (value.length / 1024).toFixed(1);
      console.log(
        `[WebDav] ⬆️ 正在上传: ${shownName} (${filePath}, ${sizeKB}KB)...`,
      );
    }

    const res = await fetch(path(`${folder}/${filePath}`), {
      method: "PUT",
      headers: headers(),
      body: value,
    });

    if (!res.ok) {
      throw new Error(`${shownName} 上传失败: ${res.status} ${res.statusText}`);
    }

    if (logMode === "verbose") {
      console.log(`[WebDav] ✅ 上传成功: ${shownName}`);
    }
  };

  const getChatState = async () => {
    const indexText = await readTextFile(FILE_NAMES[StoreKey.Chat], "聊天索引");
    if (!indexText) {
      return "";
    }

    const chatIndex = JSON.parse(indexText) as JsonObject;
    const sessions = Array.isArray(chatIndex.sessions)
      ? chatIndex.sessions
      : [];

    const hydratedSessions = await Promise.all(
      sessions.map(async (session: JsonObject) => {
        const storagePath = buildChatSessionFileName(session);

        try {
          const sessionText = await readTextFile(
            storagePath,
            `聊天记录 ${session.topic || session.id || ""}`.trim(),
            "silent",
          );
          const payload = sessionText ? JSON.parse(sessionText) : {};
          return {
            ...session,
            ...payload,
            messages: Array.isArray(payload.messages) ? payload.messages : [],
            storagePath,
          };
        } catch (error) {
          console.error(`[WebDav] ❌ 读取聊天记录失败: ${storagePath}`, error);
          return {
            ...session,
            messages: [],
            storagePath,
          };
        }
      }),
    );

    console.log(`[WebDav] ✅ 已加载 ${hydratedSessions.length} 个聊天分片`);

    return JSON.stringify({
      ...chatIndex,
      sessions: hydratedSessions,
    });
  };

  const setChatState = async (value: string) => {
    const chatState = JSON.parse(value) as JsonObject;
    const sessions = Array.isArray(chatState.sessions)
      ? chatState.sessions
      : [];

    await Promise.all(
      sessions.map(async (session: JsonObject) => {
        const storagePath = buildChatSessionFileName(session);
        await writeTextFile(
          storagePath,
          stringifyJson({
            id: session.id,
            lastUpdate: session.lastUpdate,
            messages: Array.isArray(session.messages) ? session.messages : [],
          }),
          `聊天记录 ${session.topic || session.id || ""}`.trim(),
          "silent",
        );
      }),
    );

    console.log(`[WebDav] ✅ 已上传 ${sessions.length} 个聊天分片`);

    await writeTextFile(
      FILE_NAMES[StoreKey.Chat],
      stringifyJson(buildChatIndexPayload(chatState)),
      "聊天索引",
    );
  };

  const getConfigState = async () => {
    const configText = await readTextFile(
      FILE_NAMES[StoreKey.Config],
      "应用配置",
    );
    if (!configText) {
      return "";
    }

    const configState = JSON.parse(configText) as JsonObject;
    let modelsState: JsonObject[] = [];

    const modelsIndexText = await readTextFile(
      MODELS_INDEX_FILE_NAME,
      "模型索引",
      "silent",
    );

    if (modelsIndexText) {
      const parsedIndex = JSON.parse(modelsIndexText) as {
        entries?: ModelsIndexItem[];
      };
      const entries = Array.isArray(parsedIndex.entries)
        ? parsedIndex.entries
        : [];
      const providerModels = await Promise.all(
        entries.map(async (entry) => {
          const modelsText = await readTextFile(
            entry.filePath,
            entry.providerId,
            "silent",
          );
          if (!modelsText) {
            return [];
          }
          const parsedModels = JSON.parse(modelsText);
          return Array.isArray(parsedModels) ? parsedModels : [];
        }),
      );
      modelsState = providerModels.flat();
      console.log(
        `[WebDav] ✅ 已加载 ${entries.length} 个供应商模型文件，共 ${modelsState.length} 个模型`,
      );
    } else {
      const legacyModelsText = await readTextFile(
        LEGACY_MODELS_FILE_NAME,
        "模型数据",
        "silent",
      );

      modelsState = legacyModelsText
        ? JSON.parse(legacyModelsText)
        : extractEmbeddedModels(configState);

      if (legacyModelsText) {
        console.log("[WebDav] ℹ️ 检测到旧版 models.json，已自动回退读取");
      }
    }

    if (
      modelsState.length === 0 &&
      extractEmbeddedModels(configState).length > 0 &&
      !modelsIndexText
    ) {
      console.log(
        "[WebDav] ℹ️ 检测到旧版 config.json 内嵌 models，已自动回退读取",
      );
      modelsState = extractEmbeddedModels(configState);
    }

    return JSON.stringify({
      ...configState,
      models: Array.isArray(modelsState) ? modelsState : [],
    });
  };

  const setConfigState = async (value: string) => {
    const { config: configState, models } = buildConfigPayload(
      JSON.parse(value) as JsonObject,
    );
    const { entries, providerMap, updatedAt } = buildModelsIndex(
      Array.isArray(models) ? models : [],
    );

    await writeTextFile(
      FILE_NAMES[StoreKey.Config],
      stringifyJson(configState),
      "应用配置",
    );

    await Promise.all(
      entries.map(async (entry) => {
        await writeTextFile(
          entry.filePath,
          stringifyJson(providerMap.get(entry.providerId) || []),
          entry.providerId,
          "silent",
        );
      }),
    );

    await writeTextFile(
      MODELS_INDEX_FILE_NAME,
      stringifyJson({ entries, updatedAt }),
      "模型索引",
    );

    await writeTextFile(
      MODELS_EXPLANATION_FILE_NAME,
      stringifyJson(buildModelsCategoryExplanation()),
      "模型分类说明",
      "silent",
    );

    console.log(
      `[WebDav] ✅ 已上传 ${entries.length} 个供应商模型文件，共 ${models.length} 个模型`,
    );
  };

  return {
    async check() {
      console.log("[WebDav] 🔍 正在检查连接...");
      try {
        const res = await fetch(path(folder, "MKCOL"), {
          method: "GET",
          headers: headers(),
        });
        const success = [201, 200, 404, 405, 301, 302, 307, 308].includes(
          res.status,
        );
        if (success) {
          console.log("[WebDav] ✅ 连接成功");
        } else {
          console.error(
            `[WebDav] ❌ 连接失败: ${res.status} ${res.statusText}`,
          );
        }
        return success;
      } catch (e) {
        console.error("[WebDav] ❌ 连接异常:", e);
      }

      return false;
    },

    async get(key: string) {
      try {
        if (key === StoreKey.Chat) {
          return await getChatState();
        }

        if (key === StoreKey.Config) {
          return await getConfigState();
        }

        const fileName = FILE_NAMES[key];
        if (!fileName) {
          console.warn(`[WebDav] ⚠️ 未知的 store key: ${key}`);
          return "";
        }

        return await readTextFile(fileName);
      } catch (e) {
        console.error(`[WebDav] ❌ 下载异常: ${key}`, e);
        return "";
      }
    },

    async set(key: string, value: string) {
      try {
        if (key === StoreKey.Chat) {
          await setChatState(value);
          return;
        }

        if (key === StoreKey.Config) {
          await setConfigState(value);
          return;
        }

        const fileName = FILE_NAMES[key];
        if (!fileName) {
          console.warn(`[WebDav] ⚠️ 未知的 store key: ${key}`);
          return;
        }

        await writeTextFile(fileName, formatJsonString(value));
      } catch (e) {
        console.error(`[WebDav] ❌ 上传异常: ${key}`, e);
      }
    },

    headers,
    path,
  };
}
