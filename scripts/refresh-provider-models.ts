import { closePostgresPool } from "../app/utils/server/postgres";
import { refreshConfiguredProviderModels } from "../app/utils/server/provider-model-sync";

async function main() {
  const result = await refreshConfiguredProviderModels("manual");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(
      `[refresh-provider-models] ${
        error instanceof Error ? error.stack || error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
