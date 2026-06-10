import { ensureSyncStorageSchema, pgQuery } from "./postgres";

async function ensureModelSourceIndexSchema() {
  await pgQuery(`
    create table if not exists model_source_index_snapshots (
      source_key text primary key,
      payload_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pgQuery(`
    create or replace trigger trg_model_source_index_snapshots_updated_at
    before update on model_source_index_snapshots
    for each row execute function set_updated_at()
  `);
}

export async function setModelSourceIndexSnapshot(
  sourceKey: string,
  payload: unknown,
) {
  await ensureSyncStorageSchema();
  await ensureModelSourceIndexSchema();
  await pgQuery(
    `insert into model_source_index_snapshots (source_key, payload_json)
     values ($1, $2::jsonb)
     on conflict (source_key) do update set
       payload_json = excluded.payload_json,
       updated_at = now()`,
    [sourceKey, JSON.stringify(payload ?? {})],
  );
}
