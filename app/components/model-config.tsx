import { ServiceProvider } from "@/app/constant";
import { ModelConfig } from "../store";
import { useAccessStore } from "../store/access";

import Locale from "../locales";
import { InputRange } from "./input-range";
import { ButtonSelect, ListItem, Select } from "./ui-lib";
import { compareSelectorItems } from "./ui-lib";
import { getModelDisplayGroup } from "../utils/model-display-group";
import { useUserModels } from "../utils/hooks";
import { groupBy } from "lodash-es";
import styles from "./model-config.module.scss";
import {
  getModelProvider,
  getPreferredDisplayModelConfig,
} from "../utils/model";
import { ModalConfigValidator } from "../store/config";
import {
  getCapabilityHint,
  getModelParameterSupport,
  getKnownContextWindow,
  getKnownMaxOutputTokens,
  getReasoningEffortOptions,
  getTemperatureRange,
  getTopPRange,
  isGemini3Model,
  isNonConversationalCapability,
  sanitizeModelConfigForCapability,
} from "../client/model-parameter-rules";
import { getSupportedVideoDurations, getModelSizes } from "../utils";
import {
  DRAW_GENERATION_PARAM_DEFINITIONS,
  getDrawParamDefault,
  getDrawParamOptions,
  getDrawParamRange,
  isDrawParamSupported,
  type DrawParamKey,
} from "../utils/draw-model-params";

export function ModelConfigList(props: {
  modelConfig: ModelConfig;
  updateConfig: (updater: (config: ModelConfig) => void) => void;
  readonlyModel?: boolean;
  readonly?: boolean;
  showAllParameters?: boolean;
  section?: "all" | "models" | "parameters";
  parameterGroup?: "all" | "inputs" | "toggles" | "generation";
}) {
  const allModels = useUserModels();
  const apiProfiles = useAccessStore((state) => state.apiProfiles);
  const readonly = Boolean(props.readonly);
  const readonlyModel = readonly || Boolean(props.readonlyModel);

  // 按供应商分组，如果没有供应商信息则按 provider 分组
  const groupModels = groupBy(
    allModels.filter((v) => v.available),
    (model) => {
      return getModelDisplayGroup({
        modelName: model.name,
        vendorName: model.vendor?.name,
        vendorId: model.vendor?.id,
        providerName: model.provider?.providerName,
      });
    },
  );

  // 按供应商名称排序（常用供应商优先，其余按 aihubmix developer_id 顺序）
  const sortedGroupNames = Object.keys(groupModels).sort((a, b) => {
    const vendorOrder = [
      "OpenAI",
      "Anthropic",
      "Google",
      "DeepSeek",
      "xAI",
      "AihubMix",
      "Alibaba",
      // 以下按 aihubmix developer_id 顺序补充
      "ByteDance",
      "Zhipu",
      "Cohere",
      "Mistral",
      "Meta",
      "Microsoft",
      "01.AI",
      "Moonshot",
      "StepFun",
      "Nvidia",
      "Minimax",
      "Perplexity",
      "Baichuan",
      "Tencent",
      "Baidu",
      "Ideogram",
      "Jina AI",
      "Stability",
      "Flux",
      "Meituan",
      "InclusionAI",
      "BAAI",
      "Xiaomi",
    ];
    const aIndex = vendorOrder.indexOf(a);
    const bIndex = vendorOrder.indexOf(b);
    if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    return a.localeCompare(b);
  });

  const displayModelConfig =
    getPreferredDisplayModelConfig(allModels, props.modelConfig, apiProfiles) ||
    props.modelConfig;
  const value = `${displayModelConfig.model}@${displayModelConfig?.providerName}`;
  const hasCurrentModelOption = allModels.some(
    (model) =>
      model.available &&
      model.name === displayModelConfig.model &&
      model.provider?.providerName === displayModelConfig.providerName,
  );
  const parameterSupport = getModelParameterSupport(props.modelConfig.model);
  const showAllParameters = readonly || Boolean(props.showAllParameters);
  const supportsTemperature = parameterSupport.temperature;
  const supportsTopP = parameterSupport.top_p;
  const supportsTopK = parameterSupport.top_k;
  const supportsPresencePenalty = parameterSupport.presence_penalty;
  const supportsFrequencyPenalty = parameterSupport.frequency_penalty;
  const supportsMaxTokens = parameterSupport.max_tokens;
  const usesMaxCompletionTokens = parameterSupport.max_completion_tokens;
  const supportsWebSearchToggle = parameterSupport.web_search;
  const isReasoningModel = parameterSupport.reasoning;
  const supportsReasoningEffort = parameterSupport.reasoning_effort;
  const supportsReasoningMaxTokens = parameterSupport.reasoning_max_tokens;
  const supportsThoughtDisplay = parameterSupport.include_thoughts;
  const isClaudeModel = parameterSupport.anthropic_beta;
  const supportsStructuredOutput = parameterSupport.structured_output;
  const supportsJsonSchema = parameterSupport.json_schema;
  const supportsMediaResolution = parameterSupport.media_resolution;
  const supportsStopSequences = parameterSupport.stop_sequences;
  const supportsToolChoice = parameterSupport.tool_choice;
  const supportsSafetySettings = parameterSupport.safety_settings;
  const supportsPromptCache = parameterSupport.prompt_cache;
  const supportsSeed = parameterSupport.seed;
  const supportsModalities = parameterSupport.modalities;
  const stopSequenceLimit = parameterSupport.stop_sequence_limit;
  const temperatureRange = getTemperatureRange(props.modelConfig.model);
  const topPRange = getTopPRange(props.modelConfig.model);
  const contextWindowTokens = getKnownContextWindow(props.modelConfig.model);
  const maxOutputTokens = getKnownMaxOutputTokens(props.modelConfig.model);
  const maxTokenControlLimit =
    maxOutputTokens || Math.min(contextWindowTokens || 512000, 512000);
  const supportsConversationParameters = parameterSupport.conversation;
  const supportsStream = parameterSupport.stream;
  const reasoningEffortOptions = getReasoningEffortOptions(
    props.modelConfig.model,
  );
  const videoSizeOptions = getModelSizes(props.modelConfig.model);
  const videoDurationOptions = getSupportedVideoDurations(
    props.modelConfig.model,
  );
  const supportsVideoSize = videoSizeOptions.length > 0;
  const supportsVideoDuration = videoDurationOptions.length > 0;
  const includeSavedOption = (
    options: readonly string[],
    savedValue: string | undefined,
  ) => Array.from(new Set([...(savedValue ? [savedValue] : []), ...options]));
  const isNonConversational = isNonConversationalCapability(
    parameterSupport.capability,
  );
  const capabilityHint = getCapabilityHint(parameterSupport.capability);
  const showModelItems = props.section !== "parameters";
  const showParameterItems = props.section !== "models";
  const parameterGroup = props.parameterGroup ?? "all";
  const showInputParameters = ["all", "inputs"].includes(parameterGroup);
  const showToggleParameters = ["all", "toggles"].includes(parameterGroup);
  const showGenerationParameters = ["all", "generation"].includes(
    parameterGroup,
  );
  const showParameter = (supported: boolean) => showAllParameters || supported;
  // 全局设置应允许预先保存任意参数值；请求层仍会按实际模型能力过滤
  // 不兼容字段，避免 UI 的可编辑性被上游能力矩阵限制。
  const parameterDisabled = (_supported: boolean) => readonly;
  const parameterSubTitle = (
    supported: boolean,
    supportedText: string,
    unsupportedText = "当前模型不支持，发送请求时自动忽略",
  ) => (supported ? supportedText : unsupportedText);
  const generationParams = props.modelConfig.generationParams ?? {};
  const generationProvider = String(props.modelConfig.providerName || "");
  const getGenerationParamValue = (field: DrawParamKey) => {
    const storedValue = generationParams[field];
    if (
      storedValue !== undefined &&
      storedValue !== null &&
      storedValue !== ""
    ) {
      return storedValue;
    }
    if (["image_size", "resolution"].includes(field)) {
      return props.modelConfig.size ?? "";
    }
    if (field === "quality") return props.modelConfig.quality ?? "";
    if (field === "style") return props.modelConfig.style ?? "";
    const definition = DRAW_GENERATION_PARAM_DEFINITIONS.find(
      (item) => item.value === field,
    );
    return getDrawParamDefault(
      props.modelConfig.model,
      field,
      definition?.default ?? "",
      generationProvider,
    );
  };
  const updateGenerationParam = (
    field: DrawParamKey,
    value: string | number,
  ) => {
    props.updateConfig((config) => {
      config.generationParams = {
        ...(config.generationParams ?? {}),
        [field]: value,
      };
      if (field === "image_size" || field === "resolution") {
        config.size = value as any;
      } else if (field === "quality") {
        config.quality = value as any;
      } else if (field === "style") {
        config.style = value as any;
      }
    });
  };
  return (
    <>
      {showModelItems && (
        <ListItem title={Locale.Settings.Model}>
          <Select
            aria-label={Locale.Settings.Model}
            className={
              readonlyModel ? styles["readonly-model-select"] : undefined
            }
            value={value}
            align="left"
            disabled={readonlyModel}
            onChange={(e) => {
              const [model, providerName] = getModelProvider(
                e.currentTarget.value,
              );
              props.updateConfig((config) => {
                config.model = ModalConfigValidator.model(model);
                config.providerName = providerName as ServiceProvider;
                Object.assign(config, sanitizeModelConfigForCapability(config));
              });
            }}
          >
            {!hasCurrentModelOption && (
              <option value={value}>{displayModelConfig.model}</option>
            )}
            {sortedGroupNames.map((vendorName, index) => (
              <optgroup label={vendorName} key={index}>
                {groupModels[vendorName]
                  .slice()
                  .sort((a, b) =>
                    compareSelectorItems(
                      {
                        title: a.displayName || a.name,
                        value: `${a.name}@${a.provider?.providerName}`,
                        sortKey: a.name,
                        order: a.sorted,
                        publishedAt: a.publishedAt,
                        publishedAtSource: a.publishedAtSource,
                        catalogRank: a.catalogRank,
                        remoteRank: a.remoteRank,
                        remoteRankSource: a.remoteRankSource,
                      },
                      {
                        title: b.displayName || b.name,
                        value: `${b.name}@${b.provider?.providerName}`,
                        sortKey: b.name,
                        order: b.sorted,
                        publishedAt: b.publishedAt,
                        publishedAtSource: b.publishedAtSource,
                        catalogRank: b.catalogRank,
                        remoteRank: b.remoteRank,
                        remoteRankSource: b.remoteRankSource,
                      },
                    ),
                  )
                  .map((v, i) => (
                    <option
                      value={`${v.name}@${v.provider?.providerName}`}
                      key={i}
                    >
                      {v.displayName}
                    </option>
                  ))}
              </optgroup>
            ))}
          </Select>
        </ListItem>
      )}
      {showParameterItems && (
        <div className={styles["model-parameter-list"]}>
          {parameterGroup === "generation" && (
            <div
              className={styles["generation-parameter-heading"]}
              role="heading"
              aria-level={3}
            >
              {parameterSupport.capability === "image"
                ? "绘图模型参数"
                : parameterSupport.capability === "video"
                  ? "视频模型参数"
                  : "绘图与视频模型参数"}
            </div>
          )}
          {showToggleParameters && (
            <ListItem
              title="流式响应"
              subTitle={parameterSubTitle(supportsStream, "请求参数 stream")}
            >
              <input
                aria-label="流式响应"
                className={styles["model-config-control"]}
                type="checkbox"
                checked={props.modelConfig.stream !== false}
                disabled={parameterDisabled(supportsStream)}
                onChange={(e) =>
                  props.updateConfig(
                    (config) => (config.stream = e.currentTarget.checked),
                  )
                }
              ></input>
            </ListItem>
          )}
          {showInputParameters && showParameter(supportsTemperature) && (
            <ListItem
              title={Locale.Settings.Temperature.Title}
              subTitle={parameterSubTitle(
                supportsTemperature,
                `${Locale.Settings.Temperature.SubTitle}（全局默认 1.0）`,
                isGemini3Model(props.modelConfig.model)
                  ? "Gemini 3 官方建议固定使用默认温度 1.0"
                  : undefined,
              )}
            >
              <InputRange
                className={styles["model-config-range"]}
                aria={Locale.Settings.Temperature.Title}
                value={props.modelConfig.temperature?.toFixed(1)}
                min={String(temperatureRange.min)}
                max={String(temperatureRange.max)}
                step={String(temperatureRange.step)}
                disabled={parameterDisabled(supportsTemperature)}
                onChange={(e) => {
                  props.updateConfig(
                    (config) =>
                      (config.temperature = ModalConfigValidator.temperature(
                        e.currentTarget.valueAsNumber,
                      )),
                  );
                }}
              ></InputRange>
            </ListItem>
          )}
          {showInputParameters && showParameter(supportsTopP) && (
            <ListItem
              title={Locale.Settings.TopP.Title}
              subTitle={parameterSubTitle(
                supportsTopP,
                `${Locale.Settings.TopP.SubTitle}（全局推荐 1.0，仅调整 Temperature）`,
                isGemini3Model(props.modelConfig.model)
                  ? "Gemini 3 使用官方默认采样，发送时自动忽略"
                  : undefined,
              )}
            >
              <InputRange
                className={styles["model-config-range"]}
                aria={Locale.Settings.TopP.Title}
                value={(props.modelConfig.top_p ?? 1).toFixed(
                  topPRange.step < 0.1 ? 2 : 1,
                )}
                min={String(topPRange.min)}
                max={String(topPRange.max)}
                step={String(topPRange.step)}
                disabled={parameterDisabled(supportsTopP)}
                onChange={(e) => {
                  props.updateConfig(
                    (config) =>
                      (config.top_p = ModalConfigValidator.top_p(
                        e.currentTarget.valueAsNumber,
                      )),
                  );
                }}
              ></InputRange>
            </ListItem>
          )}
          {showInputParameters && showParameter(supportsTopK) && (
            <ListItem
              title="Top K"
              subTitle={parameterSubTitle(
                supportsTopK,
                "Gemini 非 3 系列采样候选上限；0 表示自动且不发送",
              )}
            >
              <input
                aria-label="Top K"
                className={styles["model-config-control"]}
                type="number"
                min={0}
                max={128}
                value={props.modelConfig.top_k ?? 0}
                disabled={parameterDisabled(supportsTopK)}
                onChange={(event) =>
                  props.updateConfig(
                    (config) =>
                      (config.top_k = ModalConfigValidator.top_k(
                        event.currentTarget.valueAsNumber,
                      )),
                  )
                }
              />
            </ListItem>
          )}
          {showInputParameters && showParameter(supportsMaxTokens) && (
            <ListItem
              title={Locale.Settings.MaxTokens.Title}
              subTitle={parameterSubTitle(
                supportsMaxTokens,
                usesMaxCompletionTokens
                  ? `该模型实际按 max_completion_tokens 生效${
                      maxOutputTokens > 0 ? `；官方上限 ${maxOutputTokens}` : ""
                    }`
                  : `${Locale.Settings.MaxTokens.SubTitle}${
                      maxOutputTokens > 0 ? `；官方上限 ${maxOutputTokens}` : ""
                    }`,
              )}
            >
              <input
                aria-label={Locale.Settings.MaxTokens.Title}
                className={styles["model-config-control"]}
                type="number"
                min={1024}
                max={maxTokenControlLimit}
                value={props.modelConfig.max_tokens}
                disabled={parameterDisabled(supportsMaxTokens)}
                onChange={(e) =>
                  props.updateConfig(
                    (config) =>
                      (config.max_tokens = Math.min(
                        ModalConfigValidator.max_tokens(
                          e.currentTarget.valueAsNumber,
                        ),
                        maxTokenControlLimit,
                      )),
                  )
                }
              ></input>
            </ListItem>
          )}
          {showInputParameters && (
            <ListItem
              title="上下文窗口"
              subTitle={
                contextWindowTokens > 0
                  ? "模型只读能力，不是可发送的请求参数"
                  : "当前模型未提供可信的上下文容量元数据"
              }
            >
              <input
                aria-label="上下文窗口"
                className={styles["model-config-control"]}
                type="number"
                value={contextWindowTokens || 0}
                disabled
                readOnly
              />
            </ListItem>
          )}
          {showInputParameters && showParameter(supportsStopSequences) && (
            <ListItem
              title="停止序列"
              subTitle={parameterSubTitle(
                supportsStopSequences,
                `每行一个停止序列，当前模型最多发送 ${stopSequenceLimit} 个`,
              )}
            >
              <textarea
                aria-label="停止序列"
                className={`${styles["model-config-control"]} nextchat-input-control`}
                value={props.modelConfig.stopSequences ?? ""}
                disabled={parameterDisabled(supportsStopSequences)}
                onChange={(e) =>
                  props.updateConfig(
                    (config) => (config.stopSequences = e.currentTarget.value),
                  )
                }
              />
            </ListItem>
          )}
          {showInputParameters && showParameter(supportsSeed) && (
            <ListItem
              title="随机种子"
              subTitle={parameterSubTitle(
                supportsSeed,
                "设置数值可复现生成结果，-1 或空表示随机",
              )}
            >
              <input
                aria-label="随机种子"
                className={styles["model-config-control"]}
                type="number"
                min={-1}
                max={2147483647}
                value={props.modelConfig.seed ?? -1}
                disabled={parameterDisabled(supportsSeed)}
                onChange={(e) =>
                  props.updateConfig(
                    (config) => (config.seed = e.currentTarget.valueAsNumber),
                  )
                }
              />
            </ListItem>
          )}
          {showInputParameters && (
            <ListItem
              title="生成数量 (n)"
              subTitle="当前聊天 UI 只消费单个结果，固定为 1"
            >
              <input
                aria-label="生成数量 (n)"
                className={styles["model-config-control"]}
                type="number"
                min={1}
                max={1}
                value={1}
                disabled
                readOnly
              />
            </ListItem>
          )}
          {showInputParameters && showParameter(supportsModalities) && (
            <ListItem
              title="输出模式"
              subTitle={parameterSubTitle(
                supportsModalities,
                "text=文本，audio=音频（需模型支持）",
              )}
            >
              <ButtonSelect
                ariaLabel="输出模式"
                className={styles["parameter-button-select"]}
                value={String(
                  props.modelConfig.modalities?.join(",") || "text",
                )}
                disabled={parameterDisabled(supportsModalities)}
                options={[
                  { value: "text", label: "仅文本" },
                  { value: "text,audio", label: "文本+音频" },
                ]}
                onChange={(value) =>
                  props.updateConfig((config) => {
                    config.modalities =
                      value === "text" ? [] : value.split(",");
                  })
                }
              />
            </ListItem>
          )}
          {showInputParameters && (
            <ListItem
              title="工具调用策略"
              subTitle={parameterSubTitle(
                supportsToolChoice,
                "仅在流式请求且存在已启用工具时发送",
              )}
            >
              <ButtonSelect
                ariaLabel="工具调用策略"
                className={styles["parameter-button-select"]}
                value={props.modelConfig.toolChoice ?? "auto"}
                disabled={parameterDisabled(supportsToolChoice)}
                options={[
                  {
                    value: "auto",
                    label: "auto",
                    disabled: false,
                  },
                  {
                    value: "required",
                    label: "required",
                    disabled: false,
                  },
                  {
                    value: "none",
                    label: "none",
                    disabled: false,
                  },
                ]}
                onChange={(value) =>
                  props.updateConfig((config) => (config.toolChoice = value))
                }
              />
            </ListItem>
          )}
          {showInputParameters && (
            <ListItem
              title="安全设置"
              subTitle={parameterSubTitle(
                supportsSafetySettings,
                "映射 Gemini safetySettings 的统一过滤等级",
              )}
            >
              <ButtonSelect
                ariaLabel="安全设置"
                className={styles["parameter-button-select"]}
                value={props.modelConfig.safetySettings ?? ""}
                disabled={parameterDisabled(supportsSafetySettings)}
                options={[
                  { value: "", label: "自动（供应商默认）" },
                  { value: "BLOCK_NONE", label: "BLOCK_NONE" },
                  { value: "OFF", label: "OFF" },
                  { value: "BLOCK_ONLY_HIGH", label: "BLOCK_ONLY_HIGH" },
                  {
                    value: "BLOCK_MEDIUM_AND_ABOVE",
                    label: "BLOCK_MEDIUM_AND_ABOVE",
                  },
                  {
                    value: "BLOCK_LOW_AND_ABOVE",
                    label: "BLOCK_LOW_AND_ABOVE",
                  },
                ]}
                onChange={(value) =>
                  props.updateConfig(
                    (config) => (config.safetySettings = value),
                  )
                }
              />
            </ListItem>
          )}
          {showToggleParameters && showParameter(supportsWebSearchToggle) && (
            <ListItem
              title="联网搜索"
              subTitle={parameterSubTitle(
                supportsWebSearchToggle,
                "为支持的模型启用 web_search_options",
              )}
            >
              <input
                aria-label="联网搜索"
                className={styles["model-config-control"]}
                type="checkbox"
                checked={props.modelConfig.webSearch ?? false}
                disabled={parameterDisabled(supportsWebSearchToggle)}
                onChange={(e) =>
                  props.updateConfig(
                    (config) => (config.webSearch = e.currentTarget.checked),
                  )
                }
              ></input>
            </ListItem>
          )}
          {showInputParameters && showParameter(supportsWebSearchToggle) && (
            <ListItem
              title="搜索上下文"
              subTitle={parameterSubTitle(
                supportsWebSearchToggle,
                "可选：low / medium / high",
              )}
            >
              <ButtonSelect
                ariaLabel="搜索上下文"
                className={styles["parameter-button-select"]}
                value={props.modelConfig.webSearchContextSize ?? ""}
                disabled={parameterDisabled(supportsWebSearchToggle)}
                options={[
                  { value: "", label: "自动" },
                  { value: "low", label: "low" },
                  { value: "medium", label: "medium" },
                  { value: "high", label: "high" },
                ]}
                onChange={(value) =>
                  props.updateConfig(
                    (config) => (config.webSearchContextSize = value),
                  )
                }
              />
            </ListItem>
          )}
          {showInputParameters && showParameter(isReasoningModel) && (
            <>
              <ListItem
                title="推理强度"
                subTitle={parameterSubTitle(
                  supportsReasoningEffort,
                  `编程推荐 high；当前模型：${reasoningEffortOptions
                    .filter((option) => option.value)
                    .map((option) => option.label)
                    .join(" / ")}`,
                  isReasoningModel
                    ? "当前模型仅支持推理 Token 或固定思考模式"
                    : undefined,
                )}
              >
                <ButtonSelect
                  ariaLabel="推理强度"
                  className={styles["parameter-button-select"]}
                  value={props.modelConfig.reasoningEffort ?? ""}
                  disabled={parameterDisabled(supportsReasoningEffort)}
                  options={reasoningEffortOptions.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  onChange={(value) =>
                    props.updateConfig(
                      (config) => (config.reasoningEffort = value),
                    )
                  }
                />
              </ListItem>
              <ListItem
                title="推理 Token"
                subTitle={parameterSubTitle(
                  supportsReasoningMaxTokens,
                  "映射 reasoning.max_tokens 或 thinking budget",
                  isReasoningModel
                    ? "当前模型使用推理强度或固定思考模式，不接受 Token 预算"
                    : undefined,
                )}
              >
                <input
                  aria-label="推理 Token"
                  className={styles["model-config-control"]}
                  type="number"
                  min={0}
                  max={512000}
                  value={props.modelConfig.reasoningMaxTokens ?? 0}
                  disabled={parameterDisabled(supportsReasoningMaxTokens)}
                  onChange={(e) =>
                    props.updateConfig(
                      (config) =>
                        (config.reasoningMaxTokens =
                          e.currentTarget.valueAsNumber || 0),
                    )
                  }
                />
              </ListItem>
            </>
          )}
          {showToggleParameters && showParameter(isReasoningModel) && (
            <ListItem
              title="展示思考"
              subTitle={parameterSubTitle(
                supportsThoughtDisplay,
                "为支持的模型展示 includeThoughts / reasoning 输出",
              )}
            >
              <input
                aria-label="展示思考"
                className={styles["model-config-control"]}
                type="checkbox"
                checked={props.modelConfig.includeThoughts ?? true}
                disabled={parameterDisabled(supportsThoughtDisplay)}
                onChange={(e) =>
                  props.updateConfig(
                    (config) =>
                      (config.includeThoughts = e.currentTarget.checked),
                  )
                }
              ></input>
            </ListItem>
          )}
          {showToggleParameters && (
            <ListItem
              title="提示缓存"
              subTitle={
                supportsPromptCache
                  ? "Claude 自动提示缓存；发送 cache_control，默认 5 分钟"
                  : parameterSupport.prompt_cache_automatic
                    ? "供应商自动缓存；当前 API 没有通用布尔开关"
                    : "当前模型或客户端不支持显式提示缓存开关"
              }
            >
              <input
                aria-label="提示缓存"
                className={styles["model-config-control"]}
                type="checkbox"
                checked={props.modelConfig.promptCache !== false}
                disabled={parameterDisabled(supportsPromptCache)}
                readOnly={readonly}
                onChange={(e) =>
                  props.updateConfig(
                    (config) => (config.promptCache = e.currentTarget.checked),
                  )
                }
              />
            </ListItem>
          )}
          {showInputParameters && showParameter(isClaudeModel) && (
            <ListItem
              title="Anthropic Beta"
              subTitle={parameterSubTitle(
                isClaudeModel,
                "可选：透传 anthropic-beta 请求头，多个值用逗号分隔",
              )}
            >
              <input
                aria-label="Anthropic Beta"
                className={styles["model-config-control"]}
                type="text"
                value={props.modelConfig.anthropicBeta ?? ""}
                disabled={parameterDisabled(isClaudeModel)}
                onChange={(e) =>
                  props.updateConfig(
                    (config) => (config.anthropicBeta = e.currentTarget.value),
                  )
                }
              />
            </ListItem>
          )}
          {showInputParameters && showParameter(supportsMediaResolution) && (
            <ListItem
              title="媒体分辨率"
              subTitle={parameterSubTitle(
                supportsMediaResolution,
                "Gemini 3：low / medium / high，默认自动",
              )}
            >
              <ButtonSelect
                ariaLabel="媒体分辨率"
                className={styles["parameter-button-select"]}
                value={props.modelConfig.mediaResolution ?? ""}
                disabled={parameterDisabled(supportsMediaResolution)}
                options={[
                  { value: "", label: "自动" },
                  { value: "low", label: "low" },
                  { value: "medium", label: "medium" },
                  { value: "high", label: "high" },
                ]}
                onChange={(value) =>
                  props.updateConfig(
                    (config) => (config.mediaResolution = value),
                  )
                }
              />
            </ListItem>
          )}
          {showGenerationParameters &&
            DRAW_GENERATION_PARAM_DEFINITIONS.map((definition) => {
              const supported = isDrawParamSupported(
                props.modelConfig.model,
                definition.value,
                generationProvider,
              );
              const outputFormat = String(
                getGenerationParamValue("output_format") || "",
              );
              const conditionallyDisabled =
                definition.value === "output_compression" &&
                !["jpeg", "webp"].includes(outputFormat);
              const disabled = parameterDisabled(supported);
              const value = getGenerationParamValue(definition.value);
              const subTitle = supported
                ? conditionallyDisabled
                  ? "仅在输出格式为 JPEG 或 WebP 时发送；可预先保存"
                  : definition.help || definition.sub || "按当前绘图模型发送"
                : "当前绘图模型不支持，发送请求时自动忽略";

              if (definition.type === "select") {
                const options = getDrawParamOptions(
                  props.modelConfig.model,
                  definition.value,
                  definition.options,
                  generationProvider,
                );
                return (
                  <ListItem
                    key={definition.value}
                    title={definition.name}
                    subTitle={subTitle}
                  >
                    <ButtonSelect
                      ariaLabel={definition.name}
                      className={styles["parameter-button-select"]}
                      value={String(value ?? "")}
                      disabled={disabled}
                      options={options.map((option) => ({
                        value: option.value,
                        label: option.name,
                      }))}
                      onChange={(nextValue) =>
                        updateGenerationParam(definition.value, nextValue)
                      }
                    />
                  </ListItem>
                );
              }

              if (definition.type === "number") {
                const range = getDrawParamRange(
                  props.modelConfig.model,
                  definition.value,
                  {
                    min: definition.min,
                    max: definition.max,
                    float: definition.float,
                  },
                  generationProvider,
                );
                return (
                  <ListItem
                    key={definition.value}
                    title={definition.name}
                    subTitle={subTitle}
                  >
                    <input
                      aria-label={definition.name}
                      className={styles["model-config-control"]}
                      type="number"
                      min={range.min}
                      max={range.max}
                      step={range.float ? "any" : 1}
                      value={value as number | string}
                      disabled={disabled}
                      onChange={(event) =>
                        updateGenerationParam(
                          definition.value,
                          event.currentTarget.valueAsNumber,
                        )
                      }
                    />
                  </ListItem>
                );
              }

              return (
                <ListItem
                  key={definition.value}
                  title={definition.name}
                  subTitle={subTitle}
                >
                  <textarea
                    aria-label={definition.name}
                    className={styles["model-config-control"]}
                    rows={definition.rows ?? 3}
                    value={String(value ?? "")}
                    disabled={disabled}
                    placeholder={disabled ? "" : definition.placeholder}
                    onChange={(event) =>
                      updateGenerationParam(
                        definition.value,
                        event.currentTarget.value,
                      )
                    }
                  />
                </ListItem>
              );
            })}
          {showGenerationParameters && (
            <>
              <ListItem
                title="视频尺寸"
                subTitle={parameterSubTitle(
                  supportsVideoSize,
                  "按当前视频模型支持的画面尺寸发送",
                )}
              >
                <ButtonSelect
                  ariaLabel="视频尺寸"
                  className={styles["parameter-button-select"]}
                  value={props.modelConfig.size ?? ""}
                  disabled={parameterDisabled(supportsVideoSize)}
                  options={includeSavedOption(
                    videoSizeOptions,
                    props.modelConfig.size,
                  ).map((option) => ({ value: option, label: option }))}
                  onChange={(value) =>
                    props.updateConfig((config) => (config.size = value as any))
                  }
                />
              </ListItem>
              <ListItem
                title="视频时长"
                subTitle={parameterSubTitle(
                  supportsVideoDuration,
                  "按当前视频模型支持的秒数发送",
                )}
              >
                <ButtonSelect
                  ariaLabel="视频时长"
                  className={styles["parameter-button-select"]}
                  value={props.modelConfig.seconds ?? ""}
                  disabled={parameterDisabled(supportsVideoDuration)}
                  options={includeSavedOption(
                    videoDurationOptions,
                    props.modelConfig.seconds,
                  ).map((option) => ({
                    value: option,
                    label: `${option} 秒`,
                  }))}
                  onChange={(value) =>
                    props.updateConfig((config) => (config.seconds = value))
                  }
                />
              </ListItem>
            </>
          )}
          {showToggleParameters && showParameter(supportsStructuredOutput) && (
            <ListItem
              title="结构化输出"
              subTitle={parameterSubTitle(
                supportsStructuredOutput,
                parameterSupport.structured_output_mode === "json_object"
                  ? "启用 response_format=json_object"
                  : "启用 JSON Schema 结构化输出",
              )}
            >
              <input
                aria-label="结构化输出"
                className={styles["model-config-control"]}
                type="checkbox"
                checked={props.modelConfig.structuredOutput ?? false}
                disabled={parameterDisabled(supportsStructuredOutput)}
                onChange={(e) =>
                  props.updateConfig(
                    (config) =>
                      (config.structuredOutput = e.currentTarget.checked),
                  )
                }
              ></input>
            </ListItem>
          )}
          {showInputParameters &&
            showParameter(supportsJsonSchema) &&
            (props.modelConfig.structuredOutput || showAllParameters) && (
              <ListItem
                title="JSON Schema"
                subTitle={parameterSubTitle(
                  supportsJsonSchema,
                  "填入 schema 字符串，按 json_schema 透传",
                  supportsStructuredOutput
                    ? "当前模型仅支持 JSON Object，不接受 JSON Schema"
                    : undefined,
                )}
              >
                <input
                  aria-label="JSON Schema"
                  className={styles["model-config-control"]}
                  type="text"
                  value={props.modelConfig.jsonSchema ?? ""}
                  disabled={parameterDisabled(supportsJsonSchema)}
                  onChange={(e) =>
                    props.updateConfig(
                      (config) => (config.jsonSchema = e.currentTarget.value),
                    )
                  }
                />
              </ListItem>
            )}
          {showToggleParameters && isNonConversational && capabilityHint && (
            <ListItem title="能力说明" subTitle={capabilityHint} />
          )}

          {props.modelConfig?.providerName == ServiceProvider.Google &&
          !supportsPresencePenalty &&
          !supportsFrequencyPenalty &&
          !showAllParameters ? null : (
            <>
              {showInputParameters &&
                showParameter(supportsPresencePenalty) && (
                  <ListItem
                    title={Locale.Settings.PresencePenalty.Title}
                    subTitle={parameterSubTitle(
                      supportsPresencePenalty,
                      Locale.Settings.PresencePenalty.SubTitle,
                      isGemini3Model(props.modelConfig.model)
                        ? "Gemini 3 使用官方默认采样，发送时自动忽略"
                        : undefined,
                    )}
                  >
                    <InputRange
                      className={styles["model-config-range"]}
                      aria={Locale.Settings.PresencePenalty.Title}
                      value={props.modelConfig.presence_penalty?.toFixed(1)}
                      min="-2"
                      max="2"
                      step="0.1"
                      disabled={parameterDisabled(supportsPresencePenalty)}
                      onChange={(e) => {
                        props.updateConfig(
                          (config) =>
                            (config.presence_penalty =
                              ModalConfigValidator.presence_penalty(
                                e.currentTarget.valueAsNumber,
                              )),
                        );
                      }}
                    ></InputRange>
                  </ListItem>
                )}

              {showInputParameters &&
                showParameter(supportsFrequencyPenalty) && (
                  <ListItem
                    title={Locale.Settings.FrequencyPenalty.Title}
                    subTitle={parameterSubTitle(
                      supportsFrequencyPenalty,
                      Locale.Settings.FrequencyPenalty.SubTitle,
                      isGemini3Model(props.modelConfig.model)
                        ? "Gemini 3 使用官方默认采样，发送时自动忽略"
                        : undefined,
                    )}
                  >
                    <InputRange
                      className={styles["model-config-range"]}
                      aria={Locale.Settings.FrequencyPenalty.Title}
                      value={props.modelConfig.frequency_penalty?.toFixed(1)}
                      min="-2"
                      max="2"
                      step="0.1"
                      disabled={parameterDisabled(supportsFrequencyPenalty)}
                      onChange={(e) => {
                        props.updateConfig(
                          (config) =>
                            (config.frequency_penalty =
                              ModalConfigValidator.frequency_penalty(
                                e.currentTarget.valueAsNumber,
                              )),
                        );
                      }}
                    ></InputRange>
                  </ListItem>
                )}

              {(!isNonConversational || showAllParameters) && (
                <>
                  {showToggleParameters && (
                    <ListItem
                      title={Locale.Settings.InjectSystemPrompts.Title}
                      subTitle={parameterSubTitle(
                        supportsConversationParameters,
                        Locale.Settings.InjectSystemPrompts.SubTitle,
                      )}
                    >
                      <input
                        aria-label={Locale.Settings.InjectSystemPrompts.Title}
                        className={styles["model-config-control"]}
                        type="checkbox"
                        checked={props.modelConfig.enableInjectSystemPrompts}
                        disabled={parameterDisabled(
                          supportsConversationParameters,
                        )}
                        onChange={(e) =>
                          props.updateConfig(
                            (config) =>
                              (config.enableInjectSystemPrompts =
                                e.currentTarget.checked),
                          )
                        }
                      ></input>
                    </ListItem>
                  )}

                  {showInputParameters && (
                    <ListItem
                      title={Locale.Settings.InputTemplate.Title}
                      subTitle={parameterSubTitle(
                        supportsConversationParameters,
                        Locale.Settings.InputTemplate.SubTitle,
                      )}
                    >
                      <input
                        aria-label={Locale.Settings.InputTemplate.Title}
                        className={styles["model-config-control"]}
                        type="text"
                        value={props.modelConfig.template}
                        disabled={parameterDisabled(
                          supportsConversationParameters,
                        )}
                        onChange={(e) =>
                          props.updateConfig(
                            (config) =>
                              (config.template = e.currentTarget.value),
                          )
                        }
                      ></input>
                    </ListItem>
                  )}
                </>
              )}
            </>
          )}
          {(!isNonConversational || showAllParameters) && (
            <>
              {showInputParameters && (
                <ListItem
                  title={Locale.Settings.HistoryCount.Title}
                  subTitle={parameterSubTitle(
                    supportsConversationParameters,
                    Locale.Settings.HistoryCount.SubTitle,
                  )}
                >
                  <InputRange
                    className={styles["model-config-range"]}
                    aria={Locale.Settings.HistoryCount.Title}
                    title={props.modelConfig.historyMessageCount.toString()}
                    value={props.modelConfig.historyMessageCount}
                    min="0"
                    max="64"
                    step="1"
                    disabled={parameterDisabled(supportsConversationParameters)}
                    onChange={(e) =>
                      props.updateConfig(
                        (config) =>
                          (config.historyMessageCount = e.target.valueAsNumber),
                      )
                    }
                  ></InputRange>
                </ListItem>
              )}

              {showInputParameters && (
                <ListItem
                  title={Locale.Settings.CompressThreshold.Title}
                  subTitle={parameterSubTitle(
                    supportsConversationParameters,
                    Locale.Settings.CompressThreshold.SubTitle,
                  )}
                >
                  <input
                    aria-label={Locale.Settings.CompressThreshold.Title}
                    className={styles["model-config-control"]}
                    type="number"
                    min={500}
                    max={200000}
                    value={props.modelConfig.compressMessageLengthThreshold}
                    disabled={parameterDisabled(supportsConversationParameters)}
                    onChange={(e) =>
                      props.updateConfig(
                        (config) =>
                          (config.compressMessageLengthThreshold =
                            e.currentTarget.valueAsNumber),
                      )
                    }
                  ></input>
                </ListItem>
              )}
              {showToggleParameters && (
                <ListItem
                  title={Locale.Memory.Title}
                  subTitle={parameterSubTitle(
                    supportsConversationParameters,
                    Locale.Memory.Send,
                  )}
                >
                  <input
                    aria-label={Locale.Memory.Title}
                    className={styles["model-config-control"]}
                    type="checkbox"
                    checked={props.modelConfig.sendMemory}
                    disabled={parameterDisabled(supportsConversationParameters)}
                    onChange={(e) =>
                      props.updateConfig(
                        (config) =>
                          (config.sendMemory = e.currentTarget.checked),
                      )
                    }
                  ></input>
                </ListItem>
              )}
            </>
          )}
        </div>
      )}
      {showModelItems && (!isNonConversational || showAllParameters) && (
        <ListItem
          title={Locale.Settings.CompressModel.Title}
          subTitle={Locale.Settings.CompressModel.SubTitle}
        >
          <input
            aria-label={Locale.Settings.CompressModel.Title}
            className={`${styles["select-compress-model"]} ${styles["model-config-control"]}`}
            type="text"
            value={`${props.modelConfig.model}（跟随当前对话）`}
            disabled
            readOnly
          />
        </ListItem>
      )}
    </>
  );
}
