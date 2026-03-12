import { STORAGE_KEY, StoreKey } from "@/app/constant";
import { SyncStore } from "@/app/store/sync";

export type WebDAVConfig = SyncStore["webdav"];
export type WebDavClient = ReturnType<typeof createWebDavClient>;

// 分文件存储的文件名映射
const FILE_NAMES = {
  [StoreKey.Chat]: "chat.json",
  [StoreKey.Access]: "access.json",
  [StoreKey.Config]: "config.json",
  [StoreKey.Mask]: "mask.json",
  [StoreKey.Prompt]: "prompt.json",
};

// 旧的单文件名
const LEGACY_FILE_NAME = "backup.json";

export function createWebDavClient(store: SyncStore) {
  const folder = STORAGE_KEY;
  const config = store.webdav;
  const proxyUrl =
    store.useProxy && store.proxyUrl.length > 0 ? store.proxyUrl : undefined;

  return {
    async check() {
      try {
        const res = await fetch(this.path(folder, proxyUrl, "MKCOL"), {
          method: "GET",
          headers: this.headers(),
        });
        const success = [201, 200, 404, 405, 301, 302, 307, 308].includes(
          res.status,
        );
        console.log(
          `[WebDav] check ${success ? "success" : "failed"}, ${res.status} ${
            res.statusText
          }`,
        );
        return success;
      } catch (e) {
        console.error("[WebDav] failed to check", e);
      }

      return false;
    },

    async get(key: string) {
      // 根据不同的 store key 获取对应的文件
      const fileName =
        FILE_NAMES[key as keyof typeof FILE_NAMES] || LEGACY_FILE_NAME;
      const filePath = `${folder}/${fileName}`;

      const res = await fetch(this.path(filePath, proxyUrl), {
        method: "GET",
        headers: this.headers(),
      });

      console.log(
        "[WebDav] get key = ",
        key,
        "file = ",
        fileName,
        res.status,
        res.statusText,
      );

      if (404 == res.status) {
        return "";
      }

      return await res.text();
    },

    async set(key: string, value: string) {
      // 根据不同的 store key 存储到对应的文件
      const fileName =
        FILE_NAMES[key as keyof typeof FILE_NAMES] || LEGACY_FILE_NAME;
      const filePath = `${folder}/${fileName}`;

      const res = await fetch(this.path(filePath, proxyUrl), {
        method: "PUT",
        headers: this.headers(),
        body: value,
      });

      console.log(
        "[WebDav] set key = ",
        key,
        "file = ",
        fileName,
        res.status,
        res.statusText,
      );
    },

    // 新增：获取旧的备份数据（用于迁移）
    async getLegacy() {
      const filePath = `${folder}/${LEGACY_FILE_NAME}`;
      const res = await fetch(this.path(filePath, proxyUrl), {
        method: "GET",
        headers: this.headers(),
      });

      if (404 == res.status) {
        return "";
      }

      return await res.text();
    },

    // 新增：删除旧的备份文件
    async deleteLegacy() {
      const filePath = `${folder}/${LEGACY_FILE_NAME}`;
      const res = await fetch(this.path(filePath, proxyUrl, "DELETE"), {
        method: "DELETE",
        headers: this.headers(),
      });

      console.log("[WebDav] delete legacy file", res.status, res.statusText);
      return res.ok;
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
