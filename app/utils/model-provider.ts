import constants from "../constant";
import type { LLMModel } from "../client/api";

const { DEFAULT_MODELS, ServiceProvider } = constants;

const customProvider = (providerName: string) => ({
  id: providerName.toLowerCase(),
  providerName,
  providerType: "custom",
  sorted: -1000,
});

export function getModelProvider(modelWithProvider: string): [string, string?] {
  const [model, provider] = modelWithProvider.split(/@(?!.*@)/);
  return [model, provider];
}

function collectModelTable(models: readonly LLMModel[], customModels: string) {
  const modelTable: Record<
    string,
    {
      available: boolean;
      name: string;
      provider?: LLMModel["provider"];
    }
  > = {};

  models.forEach((model) => {
    modelTable[`${model.name}@${model?.provider?.id}`] = {
      available: model.available,
      name: model.name,
      provider: model.provider,
    };
  });

  customModels
    .split(",")
    .filter(Boolean)
    .forEach((rawModel) => {
      const available = !rawModel.startsWith("-");
      const nameConfig =
        rawModel.startsWith("+") || rawModel.startsWith("-")
          ? rawModel.slice(1)
          : rawModel;
      const [name] = nameConfig.split("=");

      if (name === "all") {
        Object.values(modelTable).forEach((model) => {
          model.available = available;
        });
        return;
      }

      const [customModelName, customProviderName] = getModelProvider(name);
      let count = 0;
      for (const fullName in modelTable) {
        const [modelName, providerName] = getModelProvider(fullName);
        if (
          customModelName === modelName &&
          (customProviderName === undefined ||
            customProviderName === providerName)
        ) {
          count += 1;
          modelTable[fullName].available = available;
        }
      }

      if (count === 0) {
        const provider = customProvider(customProviderName || customModelName);
        modelTable[`${customModelName}@${provider.id}`] = {
          name: customModelName,
          available,
          provider,
        };
      }
    });

  return modelTable;
}

function isGPT4Model(modelName: string): boolean {
  return (
    (modelName.startsWith("gpt-4") ||
      modelName.startsWith("chatgpt-4o") ||
      modelName.startsWith("o1")) &&
    !modelName.startsWith("gpt-4o-mini")
  );
}

export function isModelNotavailableInServer(
  customModels: string,
  modelName: string,
  providerNames: string | string[],
): boolean {
  if (
    process.env.DISABLE_GPT4 === "1" &&
    isGPT4Model(modelName.toLowerCase())
  ) {
    return true;
  }

  const modelTable = collectModelTable(DEFAULT_MODELS, customModels);
  const providerNamesArray = Array.isArray(providerNames)
    ? providerNames
    : [providerNames];

  for (const providerName of providerNamesArray) {
    if (providerName === ServiceProvider.ByteDance) {
      return !Object.values(modelTable).filter((v) => v.name === modelName)?.[0]
        ?.available;
    }

    const fullName = `${modelName}@${providerName.toLowerCase()}`;
    if (modelTable?.[fullName]?.available === true) {
      return false;
    }
  }

  return true;
}
