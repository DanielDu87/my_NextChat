import { closePostgresPool, pgQuery } from "../app/utils/server/postgres";
import {
  type ModelCatalogUpsertRow,
  upsertModelCatalogRows,
} from "../app/utils/server/model-catalog-repository";

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

type ModelRecord = {
  name?: string;
  displayName?: string;
  type?: string;
  types?: string[];
  features?: string[];
  capabilities?: string[];
  categories?: string[];
  category?: string;
  categorySource?: number;
  publishedAt?: number;
  publishedAtSource?: string;
  publishedAtUrl?: string;
  publishedAtNote?: string;
  apiKeyGroup?: string;
  sortOrder?: number;
  available?: boolean;
  vendor?: {
    name?: string;
    icon?: string;
  };
  [key: string]: unknown;
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

function toRows(
  entry: ModelsIndexEntry,
  records: ModelRecord[],
): ModelCatalogUpsertRow[] {
  return records
    .filter((item) => typeof item.name === "string" && item.name.length > 0)
    .map((item) => ({
      providerId: entry.providerId,
      providerName: entry.providerId,
      sourceFile: entry.filePath,
      modelName: item.name as string,
      displayName:
        typeof item.displayName === "string" && item.displayName.length > 0
          ? item.displayName
          : (item.name as string),
      vendorName: item.vendor?.name,
      vendorIcon: item.vendor?.icon,
      modelType: item.type,
      category: item.category,
      categorySource: item.categorySource,
      types: item.types,
      categories: item.categories,
      features: item.features,
      capabilities: item.capabilities,
      publishedAtInt: item.publishedAt,
      publishedAtSource: item.publishedAtSource,
      publishedAtUrl: item.publishedAtUrl,
      publishedAtNote: item.publishedAtNote,
      apiKeyGroup: item.apiKeyGroup,
      sortOrder: item.sortOrder,
      isAvailable:
        typeof item.available === "boolean" ? item.available : true,
      rawPayload: item,
    }));
}

async function main() {
  const index = await readWebDavJson<ModelsIndex>(MODELS_INDEX_FILE);
  let totalProviders = 0;
  let totalModels = 0;

  await pgQuery(
    `insert into model_sync_runs (trigger_source, provider_id, status, summary_json, started_at)
     values ($1, $2, $3, $4::jsonb, now())`,
    ["manual", "all", "running", JSON.stringify({ source: "webdav-models-index" })],
  );

  for (const entry of index.entries) {
    const records = await readWebDavJson<ModelRecord[]>(entry.filePath);
    const rows = toRows(entry, records);
    await upsertModelCatalogRows(rows);
    totalProviders += 1;
    totalModels += rows.length;
    console.log(
      `[sync-models-to-postgres] provider=${entry.providerId} rows=${rows.length}`,
    );
  }

  await pgQuery(
    `insert into sync_artifacts (artifact_type, artifact_path, payload_json)
     values ($1, $2, $3::jsonb)
     on conflict (artifact_type, artifact_path) do update set
       payload_json = excluded.payload_json,
       updated_at = now()`,
    [
      "models_index",
      MODELS_INDEX_FILE,
      JSON.stringify({
        updatedAt: index.updatedAt ?? null,
        providerCount: totalProviders,
        modelCount: totalModels,
      }),
    ],
  );

  await pgQuery(
    `update model_sync_runs
     set status = $2,
         summary_json = $3::jsonb,
         finished_at = now()
     where id = (
       select id from model_sync_runs
       where trigger_source = $1 and provider_id = $4 and status = 'running'
       order by started_at desc
       limit 1
     )`,
    [
      "manual",
      "completed",
      JSON.stringify({
        providerCount: totalProviders,
        modelCount: totalModels,
        updatedAt: index.updatedAt ?? null,
      }),
      "all",
    ],
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        providerCount: totalProviders,
        modelCount: totalModels,
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
    try {
      await pgQuery(
        `update model_sync_runs
         set status = 'failed',
             error_message = $1,
             finished_at = now()
         where id = (
           select id from model_sync_runs
           where trigger_source = 'manual' and provider_id = 'all' and status = 'running'
           order by started_at desc
           limit 1
         )`,
        [error instanceof Error ? error.message : String(error)],
      );
    } catch (updateError) {
      console.error(
        `[sync-models-to-postgres] 记录失败状态也失败: ${
          updateError instanceof Error ? updateError.message : String(updateError)
        }`,
      );
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
