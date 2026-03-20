import { Client } from "pg";
import { collectModelsWithDefaultModel } from "../app/utils/model";
import {
  buildAutoModelCandidates,
  isAutoModelNameAllowed,
  matchAutoModelSeries,
} from "../app/utils/auto-model";

function unwrap(payload: any) {
  if (payload && typeof payload === "object" && "state" in payload) {
    return payload.state || {};
  }
  return payload || {};
}

function parseSeriesArg() {
  const raw =
    process.env.AUTO_MODEL_SERIES ||
    process.argv
      .find((arg) => arg.startsWith("--series="))
      ?.split("=")
      .slice(1)
      .join("=") ||
    "gpt,deepseek,doubao";

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getProviderIdFromProfile(profile: any) {
  return profile.provider === "Custom"
    ? `custom_${profile.name}`.toLowerCase()
    : String(profile.provider).toLowerCase();
}

async function main() {
  const client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    ssl: false,
  });

  await client.connect();

  try {
    const result = await client.query(
      "select artifact_path, updated_at::text as updated_at, payload_json from sync_artifacts where artifact_type = 'store_state' and artifact_path in ('access-control', 'app-config') order by artifact_path",
    );

    const rows = Object.fromEntries(
      result.rows.map((row: any) => [row.artifact_path, row]),
    ) as Record<string, any>;

    const access = unwrap(rows["access-control"]?.payload_json || {});
    const config = unwrap(rows["app-config"]?.payload_json || {});
    const profiles = Array.isArray(access.apiProfiles) ? access.apiProfiles : [];
    const allModels = collectModelsWithDefaultModel(
      Array.isArray(config.models) ? config.models : [],
      String(config.customModels || access.customModels || ""),
      String(access.defaultModel || ""),
    );
    const simulatedSeries = parseSeriesArg();

    const filteredModels = allModels
      .filter((model) => !!model.available)
      .filter((model) => isAutoModelNameAllowed(model))
      .map((model) => ({
        providerId: String(model.provider?.id || "").toLowerCase(),
        providerName: model.provider?.providerName || "",
        providerDisplayName:
          profiles.find(
            (profile: any) =>
              getProviderIdFromProfile(profile) ===
              String(model.provider?.id || "").toLowerCase(),
          )?.name ||
          model.provider?.providerName ||
          "",
        series: matchAutoModelSeries(model) || null,
        name: model.name,
        displayName: model.displayName || model.name,
        publishedAt: model.publishedAt || null,
        vendor: model.vendor?.name || "",
      }));

    const attemptOrder = buildAutoModelCandidates(
      allModels,
      profiles,
      simulatedSeries as any,
    ).map((candidate, index) => ({
      index: index + 1,
      provider: candidate.providerDisplayName,
      series: candidate.series,
      model: candidate.model,
    }));

    const providerSummary = profiles.map((profile: any, index: number) => {
      const providerId = getProviderIdFromProfile(profile);
      const providerModels = filteredModels.filter(
        (model) => model.providerId === providerId,
      );
      return {
        index,
        id: profile.id,
        providerId,
        name: profile.name,
        provider: profile.provider,
        enabled: !!profile.enabled,
        baseUrl: profile.baseUrl || "",
        filteredCount: providerModels.length,
      };
    });

    console.log(
      JSON.stringify(
        {
          updatedAt: {
            access: rows["access-control"]?.updated_at || null,
            config: rows["app-config"]?.updated_at || null,
          },
          simulatedSeries,
          totals: {
            modelCount: allModels.length,
            filteredCount: filteredModels.length,
            providerCount: profiles.length,
          },
          providers: providerSummary,
          attemptOrder,
          filteredModels,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
