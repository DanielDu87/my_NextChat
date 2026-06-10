import {
  closePostgresPool,
  pgHealthcheck,
  pgQuery,
} from "../app/utils/server/postgres";

async function getModelCatalogCount() {
  try {
    const modelCount = await pgQuery<{ count: string }>(
      "select count(*)::text as count from model_catalog",
    );
    return Number(modelCount.rows[0]?.count ?? 0);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
    ) {
      return 0;
    }
    throw error;
  }
}

async function main() {
  const [health, modelCatalogCount] = await Promise.all([
    pgHealthcheck(),
    getModelCatalogCount(),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        postgres: health,
        modelCatalogCount,
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
