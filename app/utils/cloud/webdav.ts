import { STORAGE_KEY, StoreKey } from "@/app/constant";
import { SyncStore } from "@/app/store/sync";

export type WebDAVConfig = SyncStore["webdav"];
export type WebDavClient = ReturnType<typeof createWebDavClient>;

// 分文件存储的文件名映射
const FILE_NAMES: Record<string, string> = {
  [StoreKey.Chat]: "chat.json",
  [StoreKey.Access]: "access.json",
  [StoreKey.Config]: "config.json",
  [StoreKey.Mask]: "mask.json",
  [StoreKey.Prompt]: "prompt.json",
};

// 文件显示名称映射
const FILE_DISPLAY_NAMES: Record<string, string> = {
  "chat.json": "聊天记录",
  "access.json": "访问配置",
  "config.json": "应用配置",
  "mask.json": "Prompt模板",
  "prompt.json": "自定义Prompt",
};

export function createWebDavClient(store: SyncStore) {
  const folder = STORAGE_KEY;
  const config = store.webdav;
  const proxyUrl =
    store.useProxy && store.proxyUrl.length > 0 ? store.proxyUrl : undefined;

  return {
    async check() {
      console.log("[WebDav] 🔍 正在检查连接...");
      try {
        const res = await fetch(this.path(folder, proxyUrl, "MKCOL"), {
          method: "GET",
          headers: this.headers(),
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
      const fileName = FILE_NAMES[key];
      if (!fileName) {
        console.warn(`[WebDav] ⚠️ 未知的 store key: ${key}`);
        return "";
      }
      const displayName = FILE_DISPLAY_NAMES[fileName] || fileName;
      const filePath = `${folder}/${fileName}`;

      console.log(`[WebDav] ⬇️ 正在下载: ${displayName} (${fileName})...`);

      try {
        const res = await fetch(this.path(filePath, proxyUrl), {
          method: "GET",
          headers: this.headers(),
        });

        if (res.status === 404) {
          console.log(`[WebDav] ℹ️ 文件不存在: ${displayName}`);
          return "";
        }

        if (res.ok) {
          const content = await res.text();
          const sizeKB = (content.length / 1024).toFixed(1);
          console.log(`[WebDav] ✅ 下载成功: ${displayName} (${sizeKB}KB)`);
          return content;
        }

        console.error(
          `[WebDav] ❌ 下载失败: ${displayName} - ${res.status} ${res.statusText}`,
        );
        return "";
      } catch (e) {
        console.error(`[WebDav] ❌ 下载异常: ${displayName}`, e);
        return "";
      }
    },

    async set(key: string, value: string) {
      const fileName = FILE_NAMES[key];
      if (!fileName) {
        console.warn(`[WebDav] ⚠️ 未知的 store key: ${key}`);
        return;
      }
      const displayName = FILE_DISPLAY_NAMES[fileName] || fileName;
      const filePath = `${folder}/${fileName}`;
      const sizeKB = (value.length / 1024).toFixed(1);

      console.log(`[WebDav] ⬆️ 正在上传: ${displayName} (${sizeKB}KB)...`);

      try {
        const res = await fetch(this.path(filePath, proxyUrl), {
          method: "PUT",
          headers: this.headers(),
          body: value,
        });

        if (res.ok) {
          console.log(`[WebDav] ✅ 上传成功: ${displayName}`);
        } else {
          console.error(
            `[WebDav] ❌ 上传失败: ${displayName} - ${res.status} ${res.statusText}`,
          );
        }
      } catch (e) {
        console.error(`[WebDav] ❌ 上传异常: ${displayName}`, e);
      }
    },

    headers() {
      const auth = btoa(config.username + ":" + config.password);

      return {
        authorization: `Basic ${auth}`,
      };
    },
    path(path: string, proxyUrl: string = "", proxyMethod: string = "") {
      if (path.startsWith("/")) {
        path = path.slice(1);
      }

      if (proxyUrl.endsWith("/")) {
        proxyUrl = proxyUrl.slice(0, -1);
      }

      let url;
      const pathPrefix = "/api/webdav/";

      try {
        let u = new URL(proxyUrl + pathPrefix + path);
        // add query params
        u.searchParams.append("endpoint", config.endpoint);
        proxyMethod && u.searchParams.append("proxy_method", proxyMethod);
        url = u.toString();
      } catch (e) {
        url = pathPrefix + path + "?endpoint=" + config.endpoint;
        if (proxyMethod) {
          url += "&proxy_method=" + proxyMethod;
        }
      }

      return url;
    },
  };
}
