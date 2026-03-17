import {
  closePostgresPool,
  pgHealthcheck,
  pgQuery,
} from "../app/utils/server/postgres";

async function main() {
  const [health, modelCount] = await Promise.all([
    pgHealthcheck(),
    pgQuery<{ count: string }>("select count(*)::text as count from model_catalog"),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        postgres: health,
        modelCatalogCount: Number(modelCount.rows[0]?.count ?? 0),
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
