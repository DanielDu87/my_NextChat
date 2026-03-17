import type { PoolClient } from "pg";
import { withPgTransaction } from "./postgres";

export type ModelCatalogUpsertRow = {
  providerId: string;
  providerName?: string;
  sourceFile?: string;
  modelName: string;
  displayName?: string;
  vendorName?: string;
  vendorIcon?: string;
  modelType?: string;
  category?: string;
  categorySource?: number;
  types?: string[];
  categories?: string[];
  features?: string[];
  capabilities?: string[];
  publishedAtInt?: number;
  publishedAtSource?: string;
  publishedAtUrl?: string;
  publishedAtNote?: string;
  isAvailable?: boolean;
  sortOrder?: number;
  apiKeyGroup?: string;
  rawPayload?: unknown;
};

function toJson(value: unknown, fallback: unknown) {
  return value === undefined ? JSON.stringify(fallback) : JSON.stringify(value);
}

async function upsertOne(client: PoolClient, row: ModelCatalogUpsertRow) {
  await client.query(
    `insert into model_catalog (
      provider_id,
      provider_name,
      source_file,
      model_name,
      display_name,
      vendor_name,
      vendor_icon,
      model_type,
      category,
      category_source,
      types,
      categories,
      features,
      capabilities,
      published_at_int,
      published_at_source,
      published_at_url,
      published_at_note,
      is_available,
      sort_order,
      api_key_group,
      raw_payload,
      first_seen_at,
      last_seen_at
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,
      $15,$16,$17,$18,$19,$20,$21,$22::jsonb,
      now(),now()
    )
    on conflict (provider_id, model_name) do update set
      provider_name = excluded.provider_name,
      source_file = excluded.source_file,
      display_name = excluded.display_name,
      vendor_name = excluded.vendor_name,
      vendor_icon = excluded.vendor_icon,
      model_type = excluded.model_type,
      category = excluded.category,
      category_source = excluded.category_source,
      types = excluded.types,
      categories = excluded.categories,
      features = excluded.features,
      capabilities = excluded.capabilities,
      published_at_int = excluded.published_at_int,
      published_at_source = excluded.published_at_source,
      published_at_url = excluded.published_at_url,
      published_at_note = excluded.published_at_note,
      is_available = excluded.is_available,
      sort_order = excluded.sort_order,
      api_key_group = excluded.api_key_group,
      raw_payload = excluded.raw_payload,
      last_seen_at = now()`,
    [
      row.providerId,
      row.providerName ?? row.providerId,
      row.sourceFile ?? null,
      row.modelName,
      row.displayName ?? row.modelName,
      row.vendorName ?? null,
      row.vendorIcon ?? null,
      row.modelType ?? null,
      row.category ?? null,
      row.categorySource ?? null,
      toJson(row.types, []),
      toJson(row.categories, []),
      toJson(row.features, []),
      toJson(row.capabilities, []),
      row.publishedAtInt ?? null,
      row.publishedAtSource ?? null,
      row.publishedAtUrl ?? null,
      row.publishedAtNote ?? null,
      row.isAvailable ?? true,
      row.sortOrder ?? null,
      row.apiKeyGroup ?? null,
      toJson(row.rawPayload, {}),
    ],
  );
}

export async function upsertModelCatalogRows(rows: ModelCatalogUpsertRow[]) {
  await withPgTransaction(async (client) => {
    for (const row of rows) {
      await upsertOne(client, row);
    }
  });
}
