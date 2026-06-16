import {
  closePostgresPool,
  ensureSyncStorageSchema,
  pgQuery,
} from "../app/utils/server/postgres";

async function main() {
  await ensureSyncStorageSchema();

  const rows = await pgQuery<{
    username: string | null;
    draw_count: number;
    size_bytes: number;
    updated_at: string;
  }>(
    `select
       u.username,
       jsonb_array_length(coalesce(d.payload_json -> 'state' -> 'draw', '[]'::jsonb))::int as draw_count,
       pg_column_size(d.payload_json)::int as size_bytes,
       d.updated_at::text as updated_at
     from user_draw_stores d
     left join app_users u on u.id = d.user_id
     order by d.updated_at desc`,
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        table: "user_draw_stores",
        rowCount: rows.rowCount,
        rows: rows.rows,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
