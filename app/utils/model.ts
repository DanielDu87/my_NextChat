import constants from "../constant";
import type { LLMModel } from "../client/api";
import modelPublishedAtUtils from "./model-published-at";

const { DEFAULT_MODELS, ServiceProvider } = constants;
const {
  applyModelPublishedAt,
  comparePublishedAt,
  extractPublishedAtFromName,
} = modelPublishedAtUtils;

const CustomSeq = {
  val: -1000, //To ensure the custom model located at front, start from -1000, refer to constant.ts
  cache: new Map<string, number>(),
  next: (id: string) => {
    if (CustomSeq.cache.has(id)) {
      return CustomSeq.cache.get(id) as number;
    } else {
      let seq = CustomSeq.val++;
      CustomSeq.cache.set(id, seq);
      return seq;
    }
  },
};

const customProvider = (providerName: string) => ({
  id: providerName.toLowerCase(),
  providerName: providerName,
  providerType: "custom",
  sorted: CustomSeq.next(providerName),
});

type RuntimeCollectedModel = {
  available: boolean;
  name: string;
  displayName: string;
  sorted: number;
  publishedAt?: number;
  publishedAtSource?: LLMModel["publishedAtSource"];
  publishedAtUrl?: LLMModel["publishedAtUrl"];
  publishedAtNote?: LLMModel["publishedAtNote"];
  provider?: LLMModel["provider"];
  vendor?: LLMModel["vendor"];
  category?: LLMModel["category"];
  categorySource?: LLMModel["categorySource"];
  type?: LLMModel["type"];
  types?: LLMModel["types"];
  features?: LLMModel["features"];
  capabilities?: LLMModel["capabilities"];
  categories?: LLMModel["categories"];
  isDefault?: boolean;
  __normalizedSortName?: string;
  __primaryVersion?: number[];
  __publishedAtSortValue?: number;
};

function getModelVersionParts(text: string) {
  const versionMatches = Array.from(
    text.toLowerCase().matchAll(/\d+(?:\.\d+)+|\d{2,4}/g),
  ).map((match) => match[0]);
  const versions = versionMatches.map((value) =>
    value.split(".").map((part) => Number(part)),
  );
  if (versions.length === 0) {
    return [];
  }

  const semanticVersions = versions.filter((parts) => parts.length > 1);
  const candidates = semanticVersions.length > 0 ? semanticVersions : versions;

  return candidates.reduce((best, current) => {
    const maxParts = Math.max(best.length, current.length);
    for (let index = 0; index < maxParts; index += 1) {
      const diff = (current[index] ?? -1) - (best[index] ?? -1);
      if (diff > 0) {
        return current;
      }
      if (diff < 0) {
        return best;
      }
    }
    return best;
  }, candidates[0]);
}

function compareVersionPartsDesc(left: number[] = [], right: number[] = []) {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const diff = (right[index] ?? -1) - (left[index] ?? -1);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function applyRuntimeModelSortFields<T extends RuntimeCollectedModel>(
  model: T,
) {
  model.__normalizedSortName = String(model.name || "").toLowerCase();
  model.__primaryVersion = getModelVersionParts(model.name || "");
  model.__publishedAtSortValue =
    model.publishedAt ?? extractPublishedAtFromName(model.name) ?? 0;
  return model;
}

/**
 * Sorts an array of models based on specified rules.
 *
 * First, sorted by provider; if the same, sorted by model
 */
const sortModelTable = <T extends RuntimeCollectedModel>(models: T[]) =>
  models.sort((a, b) => {
    const publishedAtDiff =
      (b.__publishedAtSortValue ?? 0) - (a.__publishedAtSortValue ?? 0);
    if (publishedAtDiff !== 0) {
      return publishedAtDiff;
    }

    const versionDiff = compareVersionPartsDesc(
      a.__primaryVersion,
      b.__primaryVersion,
    );
    if (versionDiff !== 0) {
      return versionDiff;
    }

    const orderDiff =
      Number(a.sorted ?? Number.MAX_SAFE_INTEGER) -
      Number(b.sorted ?? Number.MAX_SAFE_INTEGER);
    if (orderDiff !== 0) {
      return orderDiff;
    }

    return String(a.__normalizedSortName || a.name || "").localeCompare(
      String(b.__normalizedSortName || b.name || ""),
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    );
  });

/**
 * get model name and provider from a formatted string,
 * e.g. `gpt-4@OpenAi` or `claude-3-5-sonnet@20240620@Google`
 * @param modelWithProvider model name with provider separated by last `@` char,
 * @returns [model, provider] tuple, if no `@` char found, provider is undefined
 */
export function getModelProvider(modelWithProvider: string): [string, string?] {
  const [model, provider] = modelWithProvider.split(/@(?!.*@)/);
  return [model, provider];
}

export function collectModelTable(
  models: readonly LLMModel[],
  customModels: string,
) {
  const modelTable: Record<string, RuntimeCollectedModel> = {};
  const fullNameByModelName = new Map<string, string[]>();
  const fullNameByModelAndProvider = new Map<string, string>();

  const registerModelTableEntry = (fullName: string) => {
    const [modelName, providerName] = getModelProvider(fullName);
    const normalizedModelName = String(modelName || "").toLowerCase();
    const normalizedProviderName = String(providerName || "").toLowerCase();
    const currentEntries = fullNameByModelName.get(normalizedModelName) ?? [];
    if (!currentEntries.includes(fullName)) {
      currentEntries.push(fullName);
      fullNameByModelName.set(normalizedModelName, currentEntries);
    }
    fullNameByModelAndProvider.set(
      `${normalizedModelName}@${normalizedProviderName}`,
      fullName,
    );
  };

  // default models
  models.forEach((m) => {
    // using <modelName>@<providerId> as fullName
    const fullName = `${m.name}@${m?.provider?.id}`;
    modelTable[fullName] = applyRuntimeModelSortFields({
      ...m,
      displayName: m.name, // 'provider' is copied over if it exists
    });
    registerModelTableEntry(fullName);
  });

  // server custom models
  customModels
    .split(",")
    .filter((v) => !!v && v.length > 0)
    .forEach((m) => {
      const available = !m.startsWith("-");
      const nameConfig =
        m.startsWith("+") || m.startsWith("-") ? m.slice(1) : m;
      let [name, displayName] = nameConfig.split("=");

      // enable or disable all models
      if (name === "all") {
        Object.values(modelTable).forEach(
          (model) => (model.available = available),
        );
      } else {
        // 1. find model by name, and set available value
        const [customModelName, customProviderName] = getModelProvider(name);
        const normalizedModelName = String(customModelName || "").toLowerCase();
        const normalizedProviderName = String(
          customProviderName || "",
        ).toLowerCase();
        const matchedFullNames = normalizedProviderName
          ? ([
              fullNameByModelAndProvider.get(
                `${normalizedModelName}@${normalizedProviderName}`,
              ),
            ].filter(Boolean) as string[])
          : fullNameByModelName.get(normalizedModelName) ?? [];

        let count = 0;
        matchedFullNames.forEach((fullName) => {
          const [modelName, providerName] = getModelProvider(fullName);
          const targetModel = modelTable[fullName];
          if (!targetModel) {
            return;
          }

          count += 1;
          targetModel.available = available;
          // swap name and displayName for bytedance
          if (providerName === "bytedance" && displayName) {
            [name, displayName] = [displayName, modelName];
            targetModel.name = name;
            applyRuntimeModelSortFields(targetModel);
          }
          if (displayName) {
            targetModel.displayName = displayName;
          }
        });
        // 2. if model not exists, create new model with available value
        if (count === 0) {
          let [customModelName, customProviderName] = getModelProvider(name);
          const provider = customProvider(
            customProviderName || customModelName,
          );
          // swap name and displayName for bytedance
          if (displayName && provider.providerName == "ByteDance") {
            [customModelName, displayName] = [displayName, customModelName];
          }
          const fullName = `${customModelName}@${provider?.id}`;
          modelTable[fullName] = applyRuntimeModelSortFields({
            name: customModelName,
            displayName: displayName || customModelName,
            available,
            provider, // Use optional chaining
            sorted: CustomSeq.next(`${customModelName}@${provider?.id}`),
          });
          registerModelTableEntry(fullName);
        }
      }
    });

  return modelTable;
}

export function collectModelTableWithDefaultModel(
  models: readonly LLMModel[],
  customModels: string,
  defaultModel: string,
) {
  let modelTable = collectModelTable(models, customModels);
  if (defaultModel && defaultModel !== "") {
    if (defaultModel.includes("@")) {
      if (defaultModel in modelTable) {
        modelTable[defaultModel].isDefault = true;
      }
    } else {
      for (const key of Object.keys(modelTable)) {
        if (
          modelTable[key].available &&
          getModelProvider(key)[0] == defaultModel
        ) {
          modelTable[key].isDefault = true;
          break;
        }
      }
    }
  }
  return modelTable;
}

/**
 * Generate full model table.
 */
export function collectModels(
  models: readonly LLMModel[],
  customModels: string,
) {
  const modelTable = collectModelTable(models, customModels);
  let allModels = Object.values(modelTable);

  allModels = sortModelTable(allModels);

  return allModels;
}

export function collectModelsWithDefaultModel(
  models: readonly LLMModel[],
  customModels: string,
  defaultModel: string,
) {
  const modelTable = collectModelTableWithDefaultModel(
    models,
    customModels,
    defaultModel,
  );
  let allModels = Object.values(modelTable);

  allModels = sortModelTable(allModels);

  return allModels;
}

type ProviderScopedModelConfig = {
  model?: string;
  providerName?: (typeof ServiceProvider)[keyof typeof ServiceProvider];
};

type AccessProfileLike = {
  name: string;
  provider: (typeof ServiceProvider)[keyof typeof ServiceProvider];
  enabled: boolean;
};

type ModelLike = ReturnType<typeof collectModelsWithDefaultModel>[number];
type ServiceProviderValue =
  (typeof ServiceProvider)[keyof typeof ServiceProvider];

function isOfficialProviderName(providerName: string | undefined) {
  return (
    !!providerName &&
    providerName !== ServiceProvider.Custom &&
    providerName !== ServiceProvider.Local
  );
}

function isReservedDefaultModelAlias(
  modelName: string | undefined,
  exactModelName: string,
) {
  const normalizedModelName = String(modelName || "").toLowerCase();
  const normalizedExactModelName = String(exactModelName || "").toLowerCase();
  return (
    normalizedModelName === normalizedExactModelName ||
    normalizedModelName.startsWith(`${normalizedExactModelName}-`)
  );
}

export function normalizeReservedDisplayModelName(
  modelName: string | undefined,
  exactModelName = "gpt-5.4",
) {
  const rawModelName = String(modelName || "").trim();
  if (!rawModelName) {
    return rawModelName;
  }

  const [nameOnly] = rawModelName.split(/@(?!.*@)/);
  if (isReservedDefaultModelAlias(nameOnly, exactModelName)) {
    return exactModelName;
  }

  return nameOnly;
}

function getExactModelForProviderId(
  allModels: readonly ModelLike[],
  providerId: string | undefined,
  exactModelName: string,
) {
  const normalizedProviderId = String(providerId || "").toLowerCase();
  if (!normalizedProviderId) {
    return undefined;
  }

  return allModels.find(
    (model) =>
      model.available &&
      model.name === exactModelName &&
      String(model.provider?.id || "").toLowerCase() === normalizedProviderId,
  );
}

function getEnabledProviderId(
  providerName: string | undefined,
  accessProfiles: readonly AccessProfileLike[],
) {
  if (!providerName) {
    return undefined;
  }

  if (providerName === ServiceProvider.Custom) {
    const enabledCustomProfile = accessProfiles.find(
      (profile) =>
        profile.enabled && profile.provider === ServiceProvider.Custom,
    );
    if (enabledCustomProfile) {
      return `custom_${enabledCustomProfile.name}`.toLowerCase();
    }
    return undefined;
  }

  if (providerName === ServiceProvider.Local) {
    const enabledLocalProfile = accessProfiles.find(
      (profile) =>
        profile.enabled && profile.provider === ServiceProvider.Local,
    );
    if (enabledLocalProfile) {
      return `${String(enabledLocalProfile.provider).toLowerCase()}_${
        enabledLocalProfile.name
      }`.toLowerCase();
    }
    return undefined;
  }

  return String(providerName).toLowerCase();
}

export function resolveModelProviderId(
  allModels: readonly ModelLike[],
  currentModelConfig: ProviderScopedModelConfig | undefined,
  accessProfiles: readonly AccessProfileLike[] = [],
) {
  const providerName = currentModelConfig?.providerName;
  const modelName = currentModelConfig?.model;
  if (!providerName) {
    return undefined;
  }

  const preferredEnabledProviderId = getEnabledProviderId(
    providerName,
    accessProfiles,
  );

  const matchedProviderIds = Array.from(
    new Set(
      allModels
        .filter(
          (model) =>
            model.available &&
            model.name === modelName &&
            model.provider?.providerName === providerName,
        )
        .map((model) => String(model.provider?.id || "").toLowerCase())
        .filter(Boolean),
    ),
  );

  if (
    preferredEnabledProviderId &&
    matchedProviderIds.includes(preferredEnabledProviderId)
  ) {
    return preferredEnabledProviderId;
  }

  if (matchedProviderIds.length === 1) {
    return matchedProviderIds[0];
  }

  if (preferredEnabledProviderId) {
    return preferredEnabledProviderId;
  }

  return String(providerName).toLowerCase();
}

function isOpenAIChatModel(model: ModelLike) {
  if (!model.available) {
    return false;
  }

  const text = [
    model.name,
    model.displayName || "",
    model.vendor?.name || "",
    model.provider?.providerName || "",
    model.type || "",
    ...(model.types || []),
    ...(model.categories || []),
    ...(model.capabilities || []),
    ...(model.features || []),
  ]
    .join(" ")
    .toLowerCase();

  if (
    /(embedding|moderation|whisper|transcri|tts|speech|realtime|audio|dall-e|dalle|image|video|vision|sora|omni-moderation|computer-use|search-preview)/i.test(
      text,
    )
  ) {
    return false;
  }

  return /(^|[^a-z])(gpt|chatgpt|o1|o3|o4|o5)([^a-z]|$)/i.test(model.name);
}

function isPureOpenAIMainModel(model: ModelLike) {
  if (!isOpenAIChatModel(model)) {
    return false;
  }

  const name = model.name.toLowerCase();

  if (!/^gpt-\d+(?:\.\d+)?$/i.test(name)) {
    return false;
  }

  return true;
}

function isFallbackOpenAIMainModel(model: ModelLike) {
  if (!isOpenAIChatModel(model)) {
    return false;
  }

  const name = model.name.toLowerCase();

  if (!/^gpt-\d+(?:\.\d+)?(?:[-_.].+)?$/i.test(name)) {
    return false;
  }

  if (isPureOpenAIMainModel(model)) {
    return false;
  }

  return !/(?:^|[-_.])(pro|mini|nano)(?:$|[-_.])/i.test(name);
}

function getOpenAIMainModelBaseVersion(model: ModelLike) {
  const match = String(model.name || "")
    .toLowerCase()
    .match(/^gpt-(\d+(?:\.\d+)?)/i);
  if (!match?.[1]) {
    return [];
  }
  return match[1].split(".").map((part) => Number(part));
}

function compareOpenAIMainModelPriority(left: ModelLike, right: ModelLike) {
  const baseVersionDiff = compareVersionPartsDesc(
    getOpenAIMainModelBaseVersion(left),
    getOpenAIMainModelBaseVersion(right),
  );
  if (baseVersionDiff !== 0) {
    return baseVersionDiff;
  }

  const leftPure = isPureOpenAIMainModel(left);
  const rightPure = isPureOpenAIMainModel(right);
  if (leftPure !== rightPure) {
    return leftPure ? -1 : 1;
  }

  const publishedDiff = comparePublishedAt(
    applyModelPublishedAt(left as any),
    applyModelPublishedAt(right as any),
  );
  if (publishedDiff !== 0) {
    return publishedDiff;
  }

  return String(left.name || "").localeCompare(String(right.name || ""));
}

export function getLatestOpenAIModelForCurrentSupplier(
  allModels: readonly ModelLike[],
  currentModelConfig: ProviderScopedModelConfig | undefined,
  accessProfiles: readonly AccessProfileLike[] = [],
): { model: string; providerName: ServiceProviderValue } | undefined {
  const preferredProviderId =
    resolveModelProviderId(allModels, currentModelConfig, accessProfiles) ||
    String(currentModelConfig?.providerName || "").toLowerCase();

  if (!preferredProviderId) {
    return undefined;
  }

  const scopedModels = allModels.filter((model) => {
    const providerId = String(model.provider?.id || "").toLowerCase();
    return providerId === preferredProviderId;
  });

  const candidates = scopedModels
    .filter(
      (model) =>
        isPureOpenAIMainModel(model) || isFallbackOpenAIMainModel(model),
    )
    .slice()
    .sort(compareOpenAIMainModelPriority);

  const matchedModel = candidates[0];
  if (!matchedModel?.provider?.providerName) {
    return undefined;
  }

  return {
    model: matchedModel.name,
    providerName: matchedModel.provider.providerName as ServiceProviderValue,
  };
}

export function getPreferredDefaultChatModel(
  allModels: readonly ModelLike[],
  currentModelConfig: ProviderScopedModelConfig | undefined,
  accessProfiles: readonly AccessProfileLike[] = [],
  exactModelName = "gpt-5.4",
): { model: string; providerName: ServiceProviderValue } | undefined {
  const preferredProviderId = resolveModelProviderId(
    allModels,
    currentModelConfig,
    accessProfiles,
  );
  const currentProviderName = currentModelConfig?.providerName;

  if (isOfficialProviderName(currentProviderName)) {
    const preferredExactModel = getExactModelForProviderId(
      allModels,
      preferredProviderId,
      exactModelName,
    );
    if (preferredExactModel?.provider?.providerName) {
      return {
        model: preferredExactModel.name,
        providerName: preferredExactModel.provider
          .providerName as ServiceProviderValue,
      };
    }
  }

  const enabledOfficialProviderIds = accessProfiles
    .filter(
      (profile) => profile.enabled && isOfficialProviderName(profile.provider),
    )
    .map((profile) => String(profile.provider).toLowerCase());

  for (const providerId of enabledOfficialProviderIds) {
    const matchedModel = getExactModelForProviderId(
      allModels,
      providerId,
      exactModelName,
    );
    if (matchedModel?.provider?.providerName) {
      return {
        model: matchedModel.name,
        providerName: matchedModel.provider
          .providerName as ServiceProviderValue,
      };
    }
  }

  const anyOfficialExactModel = allModels.find(
    (model) =>
      model.available &&
      model.name === exactModelName &&
      isOfficialProviderName(
        model.provider?.providerName as string | undefined,
      ),
  );
  if (anyOfficialExactModel?.provider?.providerName) {
    return {
      model: anyOfficialExactModel.name,
      providerName: anyOfficialExactModel.provider
        .providerName as ServiceProviderValue,
    };
  }

  return getLatestOpenAIModelForCurrentSupplier(
    allModels,
    currentModelConfig,
    accessProfiles,
  );
}

export function getPreferredDisplayModelConfig(
  allModels: readonly ModelLike[],
  currentModelConfig: ProviderScopedModelConfig | undefined,
  accessProfiles: readonly AccessProfileLike[] = [],
  exactModelName = "gpt-5.4",
): { model: string; providerName: ServiceProviderValue } | undefined {
  if (
    isReservedDefaultModelAlias(currentModelConfig?.model, exactModelName) &&
    currentModelConfig?.providerName &&
    currentModelConfig?.providerName !== ServiceProvider.Custom
  ) {
    if (currentModelConfig.providerName === ServiceProvider.Local) {
      const preferredDefaultModel = getPreferredDefaultChatModel(
        allModels,
        currentModelConfig,
        accessProfiles,
        exactModelName,
      );

      return {
        model: exactModelName,
        providerName:
          preferredDefaultModel?.providerName || ServiceProvider.OpenAI,
      };
    }

    return {
      model: exactModelName,
      providerName: currentModelConfig.providerName,
    };
  }

  if (
    currentModelConfig?.providerName !== ServiceProvider.Local ||
    !isReservedDefaultModelAlias(currentModelConfig?.model, exactModelName)
  ) {
    return undefined;
  }

  const preferredDefaultModel = getPreferredDefaultChatModel(
    allModels,
    currentModelConfig,
    accessProfiles,
    exactModelName,
  );

  return {
    model: exactModelName,
    providerName: preferredDefaultModel?.providerName || ServiceProvider.OpenAI,
  };
}

export function getPreferredRuntimeModelConfig(
  allModels: readonly ModelLike[],
  currentModelConfig: ProviderScopedModelConfig | undefined,
  accessProfiles: readonly AccessProfileLike[] = [],
  exactModelName = "gpt-5.4",
): { model: string; providerName: ServiceProviderValue } | undefined {
  if (!isReservedDefaultModelAlias(currentModelConfig?.model, exactModelName)) {
    return undefined;
  }

  return getPreferredDefaultChatModel(
    allModels,
    currentModelConfig,
    accessProfiles,
    exactModelName,
  );
}

export function getLatestOpenAIModelForProviderId(
  allModels: readonly ModelLike[],
  providerId: string | undefined,
): { model: string; providerName: ServiceProviderValue } | undefined {
  const normalizedProviderId = String(providerId || "").toLowerCase();
  if (!normalizedProviderId) {
    return undefined;
  }

  const scopedModels = allModels.filter(
    (model) =>
      String(model.provider?.id || "").toLowerCase() === normalizedProviderId,
  );

  const candidates = scopedModels
    .filter(
      (model) =>
        isPureOpenAIMainModel(model) || isFallbackOpenAIMainModel(model),
    )
    .slice()
    .sort(compareOpenAIMainModelPriority);

  const matchedModel = candidates[0];
  if (!matchedModel?.provider?.providerName) {
    return undefined;
  }

  return {
    model: matchedModel.name,
    providerName: matchedModel.provider.providerName as ServiceProviderValue,
  };
}

export function isModelAvailableInServer(
  customModels: string,
  modelName: string,
  providerName: string,
) {
  const fullName = `${modelName}@${providerName}`;
  const modelTable = collectModelTable(DEFAULT_MODELS, customModels);
  return modelTable[fullName]?.available === false;
}

/**
 * Check if the model name is a GPT-4 related model
 *
 * @param modelName The name of the model to check
 * @returns True if the model is a GPT-4 related model (excluding gpt-4o-mini)
 */
export function isGPT4Model(modelName: string): boolean {
  return (
    (modelName.startsWith("gpt-4") ||
      modelName.startsWith("chatgpt-4o") ||
      modelName.startsWith("o1")) &&
    !modelName.startsWith("gpt-4o-mini")
  );
}

/**
 * Checks if a model is not available on any of the specified providers in the server.
 *
 * @param {string} customModels - A string of custom models, comma-separated.
 * @param {string} modelName - The name of the model to check.
 * @param {string|string[]} providerNames - A string or array of provider names to check against.
 *
 * @returns {boolean} True if the model is not available on any of the specified providers, false otherwise.
 */
export function isModelNotavailableInServer(
  customModels: string,
  modelName: string,
  providerNames: string | string[],
): boolean {
  // Check DISABLE_GPT4 environment variable
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
    // if model provider is bytedance, use model config name to check if not avaliable
    if (providerName === ServiceProvider.ByteDance) {
      return !Object.values(modelTable).filter((v) => v.name === modelName)?.[0]
        ?.available;
    }
    const fullName = `${modelName}@${providerName.toLowerCase()}`;
    if (modelTable?.[fullName]?.available === true) return false;
  }
  return true;
}
