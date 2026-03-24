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
      `select
         updated_at::text as updated_at,
         security_settings -> 'access-control' as access_payload,
         model_settings -> 'app-config' as config_payload
       from app_settings
       order by updated_at desc
       limit 1`,
    );

    const row = result.rows[0] || {};
    const access = unwrap(row.access_payload || {});
    const config = unwrap(row.config_payload || {});
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
            access: row.updated_at || null,
            config: row.updated_at || null,
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
