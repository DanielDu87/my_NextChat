import OpenAPIClientAxios from "openapi-client-axios";
import { StoreKey } from "../constant";
import { nanoid } from "nanoid";
import { createPersistStore } from "../utils/store";
import { getClientConfig } from "../config/client";
import yaml from "js-yaml";
import { adapter, getOperationId } from "../utils";
import { runWithImmediateStoreSyncPaused } from "../utils/store";
import { getCurrentAutoSyncScope } from "../utils/startup-sync-scope";

const isApp = getClientConfig()?.isApp !== false;
export const BUILTIN_PLUGIN_IDS = [
  "tavilysearch",
  "codeinterpreterapi",
] as const;
export const BUILTIN_PLUGIN_ID_SET = new Set<string>(BUILTIN_PLUGIN_IDS);

function isValidCustomPlugin(plugin?: Plugin) {
  return (
    plugin &&
    plugin.builtin === false &&
    Boolean(plugin.title?.trim() || plugin.content?.trim())
  );
}

export function prunePlugins<T extends Record<string, Plugin | undefined>>(
  plugins: T | undefined,
  deletedPluginIds: string[] = [],
) {
  const deletedPluginIdSet = new Set(deletedPluginIds);
  return Object.fromEntries(
    Object.entries(plugins || {}).filter(
      ([id, plugin]) =>
        !deletedPluginIdSet.has(id) &&
        (BUILTIN_PLUGIN_ID_SET.has(id) || isValidCustomPlugin(plugin)),
    ),
  ) as Record<string, Plugin>;
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

  if (plugin.authType && !plugin.authToken?.trim()) {
    return false;
  }

  return true;
}

function getPluginConfigSignature(plugin: Plugin) {
  return JSON.stringify(
    Object.fromEntries(
      PLUGIN_CONFIG_FIELDS.map((field) => [field, plugin[field] ?? null]),
    ),
  );
}

function shouldPrefetchBuiltinPluginSchema(schemaUrl?: string) {
  const url = String(schemaUrl || "").trim();
  if (!url) {
    return false;
  }

  // 开发环境下 raw.githubusercontent.com 经常不可达，页面启动时不预拉取，
  // 避免控制台持续出现 500。需要时用户仍可在插件页手动加载。
  if (url.startsWith("/api/github-raw/")) {
    return false;
  }

  return true;
}

function fetchPluginSchema(schemaUrl: string) {
  return fetch(schemaUrl)
    .then((res) => {
      if (res.ok) {
        return res;
      }

      throw new Error(`schema_fetch_failed:${res.status}`);
    })
    .catch(() => {
      const url = new URL(schemaUrl);
      return fetch(`/api/proxy/${url.pathname}?${url.search}`, {
        headers: {
          "X-Base-URL": url.origin,
        },
      }).then((res) => {
        if (res.ok) {
          return res;
        }

        throw new Error(`schema_proxy_failed:${res.status}`);
      });
    });
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
    const serverURL = definition?.servers?.[0]?.url;
    const baseURL = !isApp ? "/api/proxy" : serverURL;
    const headers: Record<string, string | undefined> = {
      "X-Base-URL": !isApp ? serverURL : undefined,
    };
    if (authLocation == "header" && headerName && tokenValue) {
      headers[headerName] = tokenValue;
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
            console.log("[Plugin] 调用成功", {
              pluginId: plugin.id,
              operationId,
              durationMs: Math.round(performance.now() - startedAt),
              status: result?.status,
            });
            return result;
          } catch (error) {
            console.error("[Plugin] 调用失败", {
              pluginId: plugin.id,
              operationId,
              durationMs: Math.round(performance.now() - startedAt),
              error: getPluginErrorDetail(error),
            });
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
      const plugins = get().plugins;
      const id = plugin?.id || nanoid();
      const deletedPluginIds = get().deletedPluginIds.filter(
        (deletedId) => deletedId !== id,
      );
      plugins[id] = {
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
      const updatePlugin = { ...plugin };
      const beforeEnabled = updatePlugin.enabled;
      const beforeConfig = getPluginConfigSignature(updatePlugin);
      updater(updatePlugin);
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
      delete plugins[id];
      delete FunctionToolService.tools[id];
      const deletedPluginIds = [...new Set([...get().deletedPluginIds, id])];
      set(() => ({ plugins, deletedPluginIds }));
      get().markUpdate();
    },

    getAsTools(
      _ids?: string[],
    ): [FunctionToolItem[], Record<string, Function>] {
      const selected = Object.values(
        prunePlugins(get().plugins, get().deletedPluginIds),
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
      return get().plugins[id ?? 1145141919810];
    },
    getAll() {
      return Object.values(
        prunePlugins(get().plugins, get().deletedPluginIds),
      ).sort((a, b) => b.createdAt - a.createdAt);
    },
  }),
  {
    name: StoreKey.Plugin,
    version: 6,
    migrate(state: any, version: number) {
      const newState = JSON.parse(JSON.stringify(state));
      newState.deletedPluginIds = Array.isArray(newState.deletedPluginIds)
        ? newState.deletedPluginIds
        : [];
      // 当前插件页只保留内置的三个插件，历史插件和空插件统一清理。
      if (version < 3) {
        newState.plugins = prunePlugins(
          newState.plugins,
          newState.deletedPluginIds,
        );
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
      return newState;
    },
    onRehydrateStorage(state) {
      // Skip store rehydration on server side
      if (typeof window === "undefined") {
        return;
      }

      fetch("./plugins.json")
        .then((res) => res.json())
        .then((res) => {
          runWithImmediateStoreSyncPaused(async () => {
            const deletedPluginIds = state.deletedPluginIds.filter(
              (id) => !BUILTIN_PLUGIN_ID_SET.has(id),
            );
            if (deletedPluginIds.length !== state.deletedPluginIds.length) {
              state.update((updater) => {
                updater.deletedPluginIds = deletedPluginIds;
              });
            }

            // 清理不在 plugins.json 中的历史插件和空插件。
            const validIds = new Set(
              res
                .map((item: any) => item.id)
                .filter((id: string) => BUILTIN_PLUGIN_ID_SET.has(id)),
            );
            const existingPlugins = Object.values(state.plugins || {});
            existingPlugins.forEach((p) => {
              if (!validIds.has(p.id) && !isValidCustomPlugin(p)) {
                state.delete(p.id);
              } else if (
                BUILTIN_PLUGIN_ID_SET.has(p.id) &&
                p.enabled === undefined
              ) {
                state.updatePlugin(p.id, (plugin) => {
                  plugin.enabled = true;
                  plugin.enabledUpdatedAt = Date.now();
                });
              } else if (BUILTIN_PLUGIN_ID_SET.has(p.id)) {
                state.updatePlugin(
                  p.id,
                  (plugin) => {
                    applyBuiltinPluginDefaults(plugin);
                  },
                  { preserveConfigUpdatedAt: true },
                );
              }
            });

            const builtinPlugins = await Promise.all(
              res.map((item: any) =>
                // skip get schema
                !shouldPrefetchBuiltinPluginSchema(item.schema)
                  ? item
                  : fetchPluginSchema(item.schema)
                      .then((res) => res.text())
                      .then((content) => ({
                        ...item,
                        content,
                      }))
                      .catch(() => item),
              ),
            );

            builtinPlugins
              .filter((item: any) => item?.content)
              .forEach((item: any) => {
                const plugin = state.get(item.id) || state.create(item);
                state.updatePlugin(
                  plugin.id,
                  (plugin) => {
                    plugin.content = item.content;
                    const tool = FunctionToolService.add(plugin, true);
                    const info = tool?.api?.definition?.info;
                    plugin.title =
                      info?.title ||
                      plugin.title ||
                      item.title ||
                      item.name ||
                      item.id;
                    plugin.version = info?.version || plugin.version || "";
                    plugin.builtin = true;
                    applyBuiltinPluginDefaults(plugin);
                    plugin.enabled = true;
                    plugin.enabledUpdatedAt = Date.now();
                  },
                  { preserveConfigUpdatedAt: true },
                );
              });
          })
            .catch((error) => {
              console.error("[Plugin] ❌ 初始化内置插件失败:", error);
            })
            .finally(() => {
              if (getCurrentAutoSyncScope() === "draw") {
                console.log(
                  "[Plugin] ⏭️ 当前为 draw 页面，跳过页面初始化插件同步",
                );
                return;
              }
              console.log("[Plugin] 🔄 页面初始化后同步插件状态到数据库", {
                pluginStates: Object.fromEntries(
                  Object.entries(state.plugins || {}).map(([id, plugin]) => [
                    id,
                    plugin?.enabled !== false,
                  ]),
                ),
              });
              import("./sync")
                .then(({ useSyncStore }) =>
                  useSyncStore.getState().sync([StoreKey.Plugin]),
                )
                .then(() => {
                  console.log("[Plugin] ✅ 页面初始化插件状态同步完成");
                })
                .catch((error) => {
                  console.error(
                    "[Plugin] ❌ 页面初始化插件状态同步失败",
                    error,
                  );
                });
            });
        });
    },
  },
);
