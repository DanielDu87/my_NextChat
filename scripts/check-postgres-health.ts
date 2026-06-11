import {
  closePostgresPool,
  pgHealthcheck,
} from "../app/utils/server/postgres";

async function main() {
  const health = await pgHealthcheck();

  console.log(
    JSON.stringify(
      {
        ok: true,
        postgres: health,
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
