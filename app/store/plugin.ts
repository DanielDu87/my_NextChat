import OpenAPIClientAxios from "openapi-client-axios";
import { StoreKey } from "../constant";
import { nanoid } from "nanoid";
import { createPersistStore } from "../utils/store";
import { getClientConfig } from "../config/client";
import yaml from "js-yaml";
import { adapter, getOperationId } from "../utils";
import { runWithImmediateStoreSyncPaused } from "../utils/store";
import { getCurrentAutoSyncScope } from "../utils/startup-sync-scope";
import {
  appendGeneratedFileDownloadLinks,
  assignGeneratedFileAliases,
} from "../utils/generated-file-links";
import tavilySchema from "../../public/plugins-schemas/tavilysearch.json";
import codeInterpreterSchema from "../../public/plugins-schemas/codeinterpreterapi.json";

const isApp = getClientConfig()?.isApp !== false;
export const CODE_INTERPRETER_PLUGIN_ID = "PGy3Tgi25BQL4AU88lI5_";
export const BUILTIN_PLUGIN_IDS = ["tavilysearch"] as const;
export const FIXED_PLUGIN_IDS = [
  "tavilysearch",
  CODE_INTERPRETER_PLUGIN_ID,
] as const;
export const BUILTIN_PLUGIN_ID_SET = new Set<string>(BUILTIN_PLUGIN_IDS);
export const FIXED_PLUGIN_ID_SET = new Set<string>(FIXED_PLUGIN_IDS);

const FIXED_PLUGIN_DEFINITIONS: Record<
  string,
  Partial<Plugin> & { id: string; title: string; createdAt: number }
> = {
  tavilysearch: {
    id: "tavilysearch",
    title: "Tavily Search & Extract",
    version: "1.0.0",
    content: JSON.stringify(tavilySchema, null, "  "),
    builtin: true,
    authType: "bearer",
    authLocation: "header",
    createdAt: 1784728408042,
  },
  [CODE_INTERPRETER_PLUGIN_ID]: {
    id: CODE_INTERPRETER_PLUGIN_ID,
    title: "CodeInterpreter",
    version: "1.0.0",
    content: JSON.stringify(codeInterpreterSchema, null, "  "),
    builtin: true,
    authType: "bearer",
    authLocation: "header",
    createdAt: 1784728297583,
  },
};

// 旧版自定义插件 ID，曾作为内置插件使用，现已迁移到固定 ID
const LEGACY_CODE_INTERPRETER_ID = "codeinterpreterapi";

export function isFixedPluginId(id?: string) {
  return FIXED_PLUGIN_ID_SET.has(String(id || ""));
}

function isLegacyPluginId(id?: string) {
  const normalized = String(id || "");
  return normalized === LEGACY_CODE_INTERPRETER_ID;
}

function normalizeFixedPlugin(plugin: Plugin | undefined, id: string): Plugin {
  const fixed = FIXED_PLUGIN_DEFINITIONS[id];
  const existing = plugin || ({} as Partial<Plugin>);
  const now = Date.now();
  const normalized = {
    ...existing,
    ...fixed,
    enabled: true,
    enabledUpdatedAt: existing.enabledUpdatedAt || fixed.createdAt || now,
    configUpdatedAt: existing.configUpdatedAt || fixed.createdAt || now,
  } as Plugin;

  if (fixed.authType) {
    normalized.authType = fixed.authType;
  }
  if (fixed.authLocation) {
    normalized.authLocation = fixed.authLocation;
  }

  // Token 仍来自本地/数据库配置，避免把真实密钥写进代码。
  if (existing.authToken) {
    normalized.authToken = existing.authToken;
  }
  if (existing.authHeader) {
    normalized.authHeader = existing.authHeader;
  }

  return normalized;
}

export function normalizeFixedPluginState(state: any) {
  const sourcePlugins = state?.plugins || {};
  const deletedPluginIds = Array.isArray(state?.deletedPluginIds)
    ? state.deletedPluginIds.filter((id: string) => !isFixedPluginId(id))
    : [];
  const deletedPluginIdSet = new Set(deletedPluginIds);
  const customPlugins = Object.fromEntries(
    Object.entries(sourcePlugins).filter(
      ([id, plugin]) =>
        !isFixedPluginId(id) &&
        !isLegacyPluginId(id) &&
        !deletedPluginIdSet.has(id) &&
        isValidCustomPlugin(plugin as Plugin),
    ),
  );
  const fixedPlugins = Object.fromEntries(
    FIXED_PLUGIN_IDS.map((id) => [
      id,
      normalizeFixedPlugin(sourcePlugins[id] as Plugin | undefined, id),
    ]),
  ) as Record<string, Plugin>;

  return {
    ...(state || {}),
    plugins: { ...customPlugins, ...fixedPlugins },
    deletedPluginIds,
  };
}

function isValidCustomPlugin(plugin?: Plugin) {
  return (
    plugin &&
    plugin.builtin === false &&
    Boolean(plugin.title?.trim() || plugin.content?.trim())
  );
}

export function prunePlugins<T extends Record<string, Plugin | undefined>>(
  plugins: T | undefined,
) {
  return normalizeFixedPluginState({ plugins }).plugins as Record<
    string,
    Plugin
  >;
}

function getPluginErrorDetail(error: any) {
  const data = error?.response?.data;
  const dataText =
    typeof data === "string" ? data : data ? JSON.stringify(data) : undefined;

  return {
    message: error?.message,
    code: error?.code,
    status: error?.response?.status,
    statusText: error?.response?.statusText,
    responseData: dataText ? dataText.slice(0, 500) : undefined,
  };
}

type PluginGeneratedFile = {
  base64?: string;
  contentType?: string;
  size?: number;
};

function decodeBase64File(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function getGeneratedCacheFileId(url: string) {
  const fileName = url.split(/[?#]/, 1)[0].split("/").pop() || "";
  const id = fileName.split(".")[0];
  return /^[0-9a-f-]{36}$/i.test(id) ? id : "";
}

async function materializePluginGeneratedFiles(result: any) {
  const generatedFiles = result?.data?.files as
    Record<string, PluginGeneratedFile> | undefined;
  if (!generatedFiles || typeof generatedFiles !== "object") {
    return result;
  }

  const downloadableFiles: Record<
    string,
    { url: string; contentType: string; size: number }
  > = {};
  const cacheIds: string[] = [];

  for (const [rawName, generated] of Object.entries(generatedFiles)) {
    const fileName = rawName.split(/[\\/]/).pop()?.trim() || "generated-file";
    const base64 = generated?.base64;
    if (!base64) continue;

    const contentType = generated.contentType || "application/octet-stream";
    const bytes = decodeBase64File(base64);
    const form = new FormData();
    form.append("file", new File([bytes], fileName, { type: contentType }));

    const uploadResponse = await fetch("/api/cache/upload", {
      method: "POST",
      body: form,
    });
    const uploaded = await uploadResponse.json().catch(() => null);
    if (!uploadResponse.ok || uploaded?.code !== 0 || !uploaded?.data) {
      throw new Error(`生成文件保存失败: ${fileName}`);
    }

    const url = String(uploaded.data);
    downloadableFiles[fileName] = {
      url,
      contentType,
      size: generated.size ?? bytes.byteLength,
    };
    console.log("[Plugin] 生成文件已保存", {
      fileName,
      url,
      size: generated.size ?? bytes.byteLength,
    });
    const cacheId = getGeneratedCacheFileId(url);
    if (cacheId) cacheIds.push(cacheId);
  }

  if (cacheIds.length > 0) {
    const commitResponse = await fetch("/api/cache/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: cacheIds }),
    }).catch(() => undefined);
    if (!commitResponse?.ok) {
      console.warn("[Plugin] 生成文件缓存提交失败", {
        count: cacheIds.length,
        status: commitResponse?.status,
      });
    }
  }

  result.data.files = assignGeneratedFileAliases(
    String(result.data.output || ""),
    downloadableFiles,
  );
  if (Object.keys(downloadableFiles).length > 0) {
    result.data.output = appendGeneratedFileDownloadLinks(
      String(result.data.output || ""),
      downloadableFiles,
    );
  }
  return result;
}

const PLUGIN_CONFIG_FIELDS: Array<keyof Plugin> = [
  "title",
  "version",
  "content",
  "builtin",
  "authType",
  "authLocation",
  "authHeader",
  "authToken",
];

function definitionUsesBearerAuth(definition: any) {
  const securitySchemes = definition?.components?.securitySchemes || {};
  return Object.values(securitySchemes).some(
    (scheme: any) =>
      scheme?.type === "http" &&
      String(scheme?.scheme || "").toLowerCase() === "bearer",
  );
}

export function applyBuiltinPluginDefaults(plugin: Plugin) {
  if (!BUILTIN_PLUGIN_ID_SET.has(plugin.id)) {
    return false;
  }

  let definition: any;
  try {
    definition = plugin.content ? yaml.load(plugin.content) : undefined;
  } catch (_) {
    return false;
  }

  if (!definitionUsesBearerAuth(definition)) {
    return false;
  }

  let changed = false;
  if (!plugin.authType || plugin.authType === "none") {
    plugin.authType = "bearer";
    changed = true;
  }
  if (!plugin.authLocation) {
    plugin.authLocation = "header";
    changed = true;
  }

  return changed;
}

function isPluginRunnable(plugin?: Plugin) {
  if (!plugin || plugin.enabled === false || !plugin.content?.trim()) {
    return false;
  }

  const needsAuth = plugin.authType && !plugin.authToken?.trim();
  if (!needsAuth) {
    return true;
  }

  // 本地 Code Interpreter 允许无 Token 运行
  const isLocalCodeInterpreter =
    plugin.id === CODE_INTERPRETER_PLUGIN_ID &&
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (isLocalCodeInterpreter) {
    return true;
  }

  return false;
}

function getPluginConfigSignature(plugin: Plugin) {
  return JSON.stringify(
    Object.fromEntries(
      PLUGIN_CONFIG_FIELDS.map((field) => [field, plugin[field] ?? null]),
    ),
  );
}

export type Plugin = {
  id: string;
  createdAt: number;
  title: string;
  version: string;
  content: string;
  builtin: boolean;
  enabled?: boolean;
  enabledUpdatedAt?: number;
  configUpdatedAt?: number;
  authType?: string;
  authLocation?: string;
  authHeader?: string;
  authToken?: string;
};

export type FunctionToolItem = {
  type: string;
  function: {
    name: string;
    description?: string;
    parameters: Object;
  };
};

type FunctionToolServiceItem = {
  api: OpenAPIClientAxios;
  length: number;
  tools: FunctionToolItem[];
  funcs: Record<string, Function>;
};

export const FunctionToolService = {
  tools: {} as Record<string, FunctionToolServiceItem>,
  add(plugin: Plugin, replace = false) {
    if (!replace && this.tools[plugin.id]) return this.tools[plugin.id];
    const headerName = (
      plugin?.authType == "custom" ? plugin?.authHeader : "Authorization"
    ) as string;
    const rawAuthToken = plugin?.authToken?.trim();
    const tokenValue = !rawAuthToken
      ? undefined
      : plugin?.authType == "basic"
        ? `Basic ${rawAuthToken}`
        : plugin?.authType == "bearer"
          ? `Bearer ${rawAuthToken}`
          : rawAuthToken;
    const authLocation = plugin?.authLocation || "header";
    const definition = yaml.load(plugin.content) as any;
    const configuredServerURL = definition?.servers?.[0]?.url;
    const isNextChatCodeInterpreter =
      plugin.id === CODE_INTERPRETER_PLUGIN_ID ||
      /^https:\/\/chat\.dyxcloud\.com\/codeinterpreter\/?$/i.test(
        String(configuredServerURL || "").trim(),
      );
    const serverURL =
      !isApp &&
      isNextChatCodeInterpreter &&
      ["localhost", "127.0.0.1"].includes(window.location.hostname)
        ? "http://codeinterpreter-local:5000"
        : configuredServerURL;
    const baseURL = !isApp ? "/api/proxy" : serverURL;
    const headers: Record<string, any> = {
      common: {
        ...(!isApp ? { "X-Base-URL": serverURL } : {}),
      },
    };
    if (authLocation == "header" && headerName && tokenValue) {
      headers.common[headerName] = tokenValue;
    }
    const api = new OpenAPIClientAxios({
      definition: yaml.load(plugin.content) as any,
      axiosConfigDefaults: {
        adapter: (window.__TAURI__ ? adapter : ["xhr"]) as any,
        baseURL,
        headers,
      },
    });
    try {
      api.initSync();
    } catch (e) {}
    const operations = api.getOperations();
    return (this.tools[plugin.id] = {
      api,
      length: operations.length,
      tools: operations.map((o) => {
        // @ts-ignore
        const parameters = o?.requestBody?.content["application/json"]
          ?.schema || {
          type: "object",
          properties: {},
        };
        if (!parameters["required"]) {
          parameters["required"] = [];
        }
        if (o.parameters instanceof Array) {
          o.parameters.forEach((p) => {
            // @ts-ignore
            if (p?.in == "query" || p?.in == "path") {
              // const name = `${p.in}__${p.name}`
              // @ts-ignore
              const name = p?.name;
              parameters["properties"][name] = {
                // @ts-ignore
                type: p.schema.type,
                // @ts-ignore
                description: p.description,
              };
              // @ts-ignore
              if (p.required) {
                parameters["required"].push(name);
              }
            }
          });
        }
        return {
          type: "function",
          function: {
            name: getOperationId(o),
            description: o.description || o.summary,
            parameters: parameters,
          },
        } as FunctionToolItem;
      }),
      funcs: operations.reduce((s, o) => {
        // @ts-ignore
        s[getOperationId(o)] = async function (args) {
          const operationId = getOperationId(o);
          const startedAt = performance.now();
          const requestArgs = { ...(args || {}) };
          const parameters: Record<string, any> = {};
          if (plugin.authType && !rawAuthToken) {
            throw new Error(
              `${
                plugin.title || plugin.id
              } 缺少 API Key，请在插件编辑页填写 Token。`,
            );
          }
          if (o.parameters instanceof Array) {
            o.parameters.forEach((p) => {
              // @ts-ignore
              parameters[p?.name] = requestArgs[p?.name];
              // @ts-ignore
              delete requestArgs[p?.name];
            });
          }
          if (authLocation == "query" && headerName && tokenValue) {
            parameters[headerName] = tokenValue;
          } else if (authLocation == "body" && headerName && tokenValue) {
            requestArgs[headerName] = tokenValue;
          }
          console.log("[Plugin] 调用开始", {
            pluginId: plugin.id,
            pluginTitle: plugin.title,
            operationId,
            method: o.method,
            path: o.path,
            serverURL,
            authLocation: plugin.authType ? authLocation : "none",
          });
          try {
            // @ts-ignore if o.operationId is null, then using o.path and o.method
            const result = await api.client.paths[o.path][o.method](
              parameters,
              requestArgs,
              api.axiosConfigDefaults,
            );
            await materializePluginGeneratedFiles(result);
            console.log("[Plugin] 调用成功", {
              pluginId: plugin.id,
              operationId,
              durationMs: Math.round(performance.now() - startedAt),
              status: result?.status,
            });
            return result;
          } catch (error) {
            const detail = getPluginErrorDetail(error);
            console.error("[Plugin] 调用失败", {
              pluginId: plugin.id,
              operationId,
              durationMs: Math.round(performance.now() - startedAt),
              error: detail,
            });
            if (detail.responseData) {
              console.error("[Plugin] 上游错误正文:", detail.responseData);
            }
            throw error;
          }
        };
        return s;
      }, {}),
    });
  },
  get(id: string) {
    return this.tools[id];
  },
};

export const createEmptyPlugin = () =>
  ({
    id: nanoid(),
    title: "New Plugin",
    version: "1.0.0",
    content: "",
    builtin: false,
    enabled: true,
    enabledUpdatedAt: Date.now(),
    configUpdatedAt: Date.now(),
    createdAt: Date.now(),
  }) as Plugin;

export const DEFAULT_PLUGIN_STATE = {
  plugins: {} as Record<string, Plugin>,
  deletedPluginIds: [] as string[],
};

export const usePluginStore = createPersistStore(
  { ...DEFAULT_PLUGIN_STATE },

  (set, get) => ({
    create(plugin?: Partial<Plugin>) {
      const plugins = normalizeFixedPluginState(get()).plugins;
      const id = plugin?.id || nanoid();
      const deletedPluginIds = get().deletedPluginIds.filter(
        (deletedId) => deletedId !== id,
      );
      plugins[id] = isFixedPluginId(id)
        ? normalizeFixedPlugin(plugin as Plugin, id)
        : {
            ...createEmptyPlugin(),
            ...plugin,
            id,
            builtin: false,
          };
      set(() => ({ plugins, deletedPluginIds }));
      get().markUpdate();
      return plugins[id];
    },
    updatePlugin(
      id: string,
      updater: (plugin: Plugin) => void,
      options?: { preserveConfigUpdatedAt?: boolean },
    ) {
      const plugins = get().plugins;
      const plugin = plugins[id];
      if (!plugin) return;
      if (isFixedPluginId(id)) {
        return;
      }
      const updatePlugin = { ...plugin };
      const beforePlugin = JSON.stringify(updatePlugin);
      const beforeEnabled = updatePlugin.enabled;
      const beforeConfig = getPluginConfigSignature(updatePlugin);
      updater(updatePlugin);
      if (beforePlugin === JSON.stringify(updatePlugin)) {
        FunctionToolService.add(updatePlugin, true);
        return;
      }
      if (beforeEnabled !== updatePlugin.enabled) {
        updatePlugin.enabledUpdatedAt = Date.now();
        console.log("[Plugin] 全局启用状态变更", {
          pluginId: id,
          title: updatePlugin.title,
          enabled: updatePlugin.enabled !== false,
          enabledUpdatedAt: updatePlugin.enabledUpdatedAt,
        });
      }
      if (
        beforeConfig !== getPluginConfigSignature(updatePlugin) &&
        !options?.preserveConfigUpdatedAt
      ) {
        updatePlugin.configUpdatedAt = Date.now();
        console.log("[Plugin] 全局配置变更", {
          pluginId: id,
          title: updatePlugin.title,
          configUpdatedAt: updatePlugin.configUpdatedAt,
          authType: updatePlugin.authType || "none",
          authLocation: updatePlugin.authLocation || "header",
          hasAuthToken: Boolean(updatePlugin.authToken),
        });
      }
      plugins[id] = updatePlugin;
      FunctionToolService.add(updatePlugin, true);
      set(() => ({ plugins }));
      get().markUpdate();
    },
    delete(id: string) {
      const plugins = get().plugins;
      if (isFixedPluginId(id)) {
        set(() => normalizeFixedPluginState(get()));
        return;
      }
      delete plugins[id];
      delete FunctionToolService.tools[id];
      const deletedPluginIds = [...new Set([...get().deletedPluginIds, id])];
      set(() =>
        normalizeFixedPluginState({ ...get(), plugins, deletedPluginIds }),
      );
      get().markUpdate();
    },

    getAsTools(
      _ids?: string[],
    ): [FunctionToolItem[], Record<string, Function>] {
      const selected = (
        Object.values(normalizeFixedPluginState(get()).plugins) as Plugin[]
      )
        .filter((i) => isPluginRunnable(i))
        .map((p) => FunctionToolService.add(p));
      return [
        selected.reduce<FunctionToolItem[]>((s, i) => s.concat(i.tools), []),
        selected.reduce<Record<string, Function>>(
          (s, i) => Object.assign(s, i.funcs),
          {},
        ),
      ];
    },
    get(id?: string) {
      if (!id) return undefined;
      return normalizeFixedPluginState(get()).plugins[id];
    },
    getAll(): Plugin[] {
      return (
        Object.values(normalizeFixedPluginState(get()).plugins) as Plugin[]
      ).sort((a, b) => b.createdAt - a.createdAt);
    },
  }),
  {
    name: StoreKey.Plugin,
    version: 7,
    migrate(state: any, version: number) {
      const newState = normalizeFixedPluginState(
        JSON.parse(JSON.stringify(state || {})),
      );
      newState.deletedPluginIds = Array.isArray(newState.deletedPluginIds)
        ? newState.deletedPluginIds
        : [];
      // 插件集合固定为两个内置能力，历史插件和空插件统一清理。
      if (version < 3) {
        newState.plugins = prunePlugins(newState.plugins);
      }
      if (version < 4) {
        Object.entries(newState.plugins || {}).forEach(([id, plugin]: any) => {
          if (BUILTIN_PLUGIN_ID_SET.has(id)) {
            plugin.enabled = true;
            plugin.enabledUpdatedAt = Date.now();
          }
        });
      }
      if (version < 5) {
        Object.entries(newState.plugins || {}).forEach(([id, plugin]: any) => {
          if (
            BUILTIN_PLUGIN_ID_SET.has(id) &&
            plugin.enabled === false &&
            !plugin.enabledUpdatedAt
          ) {
            plugin.enabled = true;
            plugin.enabledUpdatedAt = Date.now();
          }
        });
      }
      if (version < 6) {
        Object.values(newState.plugins || {}).forEach((plugin: any) => {
          plugin.configUpdatedAt =
            plugin.configUpdatedAt ||
            plugin.enabledUpdatedAt ||
            plugin.createdAt ||
            Date.now();
        });
      }
      return normalizeFixedPluginState(newState);
    },
    onRehydrateStorage(_state) {
      // Skip store rehydration on server side
      if (typeof window === "undefined") {
        return;
      }

      return () => {
        runWithImmediateStoreSyncPaused(async () => undefined).finally(() => {
          if (getCurrentAutoSyncScope() === "draw") {
            return;
          }
          // 不再打印任何「页面初始化后同步插件状态」相关日志：
          // 同步结果由 sync.ts 的 logOverallSyncSummary 统一输出（已同步插件: N 个），
          // 这里属于「启动」阶段，再加提示会污染页面打开数据汇总。
          // 失败路径走 console.error 兜底即可。
          import("./sync")
            .then(({ useSyncStore }) =>
              useSyncStore.getState().sync([StoreKey.Plugin]),
            )
            .catch((error) => {
              console.error("[Plugin] ❌ 页面初始化插件状态同步失败", error);
            });
        });
      };
    },
  },
);
