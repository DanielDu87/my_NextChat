import { closePostgresPool } from "../app/utils/server/postgres";

type ModelsIndexEntry = {
  providerId: string;
  filePath: string;
  count: number;
  updatedAt?: string;
};

type ModelsIndex = {
  entries: ModelsIndexEntry[];
  updatedAt?: string;
};

const WEBDAV_BASE_URL =
  process.env.WEBDAV_BASE_URL || "https://webdav.dyxcloud.com/chatgpt-next-web";
const WEBDAV_USERNAME = process.env.WEBDAV_USERNAME || "";
const WEBDAV_PASSWORD = process.env.WEBDAV_PASSWORD || "";
const MODELS_INDEX_FILE = "models/index.json";

function toAbsoluteUrl(pathOrUrl: string) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${WEBDAV_BASE_URL.replace(/\/+$/, "")}/${pathOrUrl.replace(/^\/+/, "")}`;
}

function authHeaders(): Record<string, string> {
  if (!WEBDAV_USERNAME && !WEBDAV_PASSWORD) return {};
  return {
    Authorization: `Basic ${Buffer.from(
      `${WEBDAV_USERNAME}:${WEBDAV_PASSWORD}`,
    ).toString("base64")}`,
  };
}

async function readWebDavJson<T>(filePath: string): Promise<T> {
  const response = await fetch(toAbsoluteUrl(filePath), {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(
      `[sync-models-to-postgres] 读取 ${filePath} 失败: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as T;
}

async function main() {
  const index = await readWebDavJson<ModelsIndex>(MODELS_INDEX_FILE);

  console.log(
    JSON.stringify(
      {
        ok: true,
        skipped: true,
        reason:
          "总体模型数据按当前策略只在运行期获取，不再同步到 PostgreSQL。",
        providerCount: index.entries.length,
        updatedAt: index.updatedAt ?? null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(async (error) => {
    console.error(
      `[sync-models-to-postgres] ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
