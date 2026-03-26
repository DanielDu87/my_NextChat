import { ServiceProvider } from "@/app/constant";
import { ModelConfig } from "../store";

import Locale from "../locales";
import { InputRange } from "./input-range";
import { ListItem, Select } from "./ui-lib";
import { useAllModels } from "../utils/hooks";
import { groupBy } from "lodash-es";
import styles from "./model-config.module.scss";
import { getModelProvider } from "../utils/model";
import { SUMMARIZE_MODEL } from "../constant";
import { ModalConfigValidator } from "../store/config";
import {
  getCapabilityHint,
  getModelParameterSupport,
  isNonConversationalCapability,
  sanitizeModelConfigForCapability,
} from "../client/model-parameter-rules";

export function ModelConfigList(props: {
  modelConfig: ModelConfig;
  updateConfig: (updater: (config: ModelConfig) => void) => void;
}) {
  const allModels = useAllModels();

  // 按供应商分组，如果没有供应商信息则按 provider 分组
  const groupModels = groupBy(
    allModels.filter((v) => v.available),
    (model) => {
      // 优先使用 vendor.name 分组
      if (model.vendor?.name) {
        return model.vendor.name;
      }
      // 降级使用 provider.providerName 分组
      return model.provider?.providerName || "Unknown";
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

  const value = `${props.modelConfig.model}@${props.modelConfig?.providerName}`;
  const parameterSupport = getModelParameterSupport(props.modelConfig.model);
  const supportsTemperature = parameterSupport.temperature;
  const supportsTopP = parameterSupport.top_p;
  const supportsPresencePenalty = parameterSupport.presence_penalty;
  const supportsFrequencyPenalty = parameterSupport.frequency_penalty;
  const supportsMaxTokens = parameterSupport.max_tokens;
  const usesMaxCompletionTokens = parameterSupport.max_completion_tokens;
  const supportsWebSearchToggle = parameterSupport.web_search;
  const isReasoningModel = parameterSupport.reasoning;
  const isClaudeModel = parameterSupport.anthropic_beta;
  const supportsStructuredOutput = parameterSupport.structured_output;
  const isGenerationCapability =
    parameterSupport.capability === "image" ||
    parameterSupport.capability === "video";
  const isNonConversational = isNonConversationalCapability(
    parameterSupport.capability,
  );
  const capabilityHint = getCapabilityHint(parameterSupport.capability);
  return (
    <>
      <ListItem title={Locale.Settings.Model}>
        <Select
          aria-label={Locale.Settings.Model}
          value={value}
          align="left"
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
          {sortedGroupNames.map((vendorName, index) => (
            <optgroup label={vendorName} key={index}>
              {groupModels[vendorName]
                .sort((a, b) => a.sorted - b.sorted)
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
      {supportsTemperature && (
        <ListItem
          title={Locale.Settings.Temperature.Title}
          subTitle={Locale.Settings.Temperature.SubTitle}
        >
          <InputRange
            aria={Locale.Settings.Temperature.Title}
            value={props.modelConfig.temperature?.toFixed(1)}
            min="0"
            max="1"
            step="0.1"
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
      {supportsTopP && (
        <ListItem
          title={Locale.Settings.TopP.Title}
          subTitle={Locale.Settings.TopP.SubTitle}
        >
          <InputRange
            aria={Locale.Settings.TopP.Title}
            value={(props.modelConfig.top_p ?? 1).toFixed(1)}
            min="0"
            max="1"
            step="0.1"
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
      {supportsMaxTokens && (
        <ListItem
          title={Locale.Settings.MaxTokens.Title}
          subTitle={
            usesMaxCompletionTokens
              ? "该模型实际按 max_completion_tokens 生效"
              : Locale.Settings.MaxTokens.SubTitle
          }
        >
          <input
            aria-label={Locale.Settings.MaxTokens.Title}
            type="number"
            min={1024}
            max={512000}
            value={props.modelConfig.max_tokens}
            onChange={(e) =>
              props.updateConfig(
                (config) =>
                  (config.max_tokens = ModalConfigValidator.max_tokens(
                    e.currentTarget.valueAsNumber,
                  )),
              )
            }
          ></input>
        </ListItem>
      )}
      {supportsWebSearchToggle && (
        <>
          <ListItem
            title="联网搜索"
            subTitle="为支持的模型启用 web_search_options"
          >
            <input
              aria-label="联网搜索"
              type="checkbox"
              checked={props.modelConfig.webSearch ?? false}
              onChange={(e) =>
                props.updateConfig(
                  (config) => (config.webSearch = e.currentTarget.checked),
                )
              }
            ></input>
          </ListItem>
          <ListItem title="搜索上下文" subTitle="可选：low / medium / high">
            <input
              aria-label="搜索上下文"
              type="text"
              value={props.modelConfig.webSearchContextSize ?? ""}
              onChange={(e) =>
                props.updateConfig(
                  (config) =>
                    (config.webSearchContextSize = e.currentTarget.value),
                )
              }
            />
          </ListItem>
        </>
      )}
      {isReasoningModel && (
        <>
          <ListItem
            title="推理强度"
            subTitle="可选：minimal / low / medium / high"
          >
            <input
              aria-label="推理强度"
              type="text"
              value={props.modelConfig.reasoningEffort ?? ""}
              onChange={(e) =>
                props.updateConfig(
                  (config) => (config.reasoningEffort = e.currentTarget.value),
                )
              }
            />
          </ListItem>
          <ListItem
            title="推理 Token"
            subTitle="可选：映射 reasoning.max_tokens 或 thinking budget"
          >
            <input
              aria-label="推理 Token"
              type="number"
              min={0}
              max={512000}
              value={props.modelConfig.reasoningMaxTokens ?? 0}
              onChange={(e) =>
                props.updateConfig(
                  (config) =>
                    (config.reasoningMaxTokens =
                      e.currentTarget.valueAsNumber || 0),
                )
              }
            />
          </ListItem>
          <ListItem
            title="展示思考"
            subTitle="为支持的模型启用 includeThoughts / reasoning 输出"
          >
            <input
              aria-label="展示思考"
              type="checkbox"
              checked={props.modelConfig.includeThoughts ?? false}
              onChange={(e) =>
                props.updateConfig(
                  (config) =>
                    (config.includeThoughts = e.currentTarget.checked),
                )
              }
            ></input>
          </ListItem>
        </>
      )}
      {isClaudeModel && (
        <ListItem
          title="Anthropic Beta"
          subTitle="可选：透传 anthropic-beta 请求头，多个值用逗号分隔"
        >
          <input
            aria-label="Anthropic Beta"
            type="text"
            value={props.modelConfig.anthropicBeta ?? ""}
            onChange={(e) =>
              props.updateConfig(
                (config) => (config.anthropicBeta = e.currentTarget.value),
              )
            }
          />
        </ListItem>
      )}
      {parameterSupport.media_resolution && (
        <ListItem title="媒体分辨率" subTitle="可选：low / medium / high">
          <input
            aria-label="媒体分辨率"
            type="text"
            value={props.modelConfig.mediaResolution ?? ""}
            onChange={(e) =>
              props.updateConfig(
                (config) => (config.mediaResolution = e.currentTarget.value),
              )
            }
          />
        </ListItem>
      )}
      {supportsStructuredOutput && (
        <>
          <ListItem
            title="结构化输出"
            subTitle="启用 response_format=json_schema"
          >
            <input
              aria-label="结构化输出"
              type="checkbox"
              checked={props.modelConfig.structuredOutput ?? false}
              onChange={(e) =>
                props.updateConfig(
                  (config) =>
                    (config.structuredOutput = e.currentTarget.checked),
                )
              }
            ></input>
          </ListItem>
          {props.modelConfig.structuredOutput && (
            <ListItem
              title="JSON Schema"
              subTitle="填入 schema 字符串，按 json_schema 透传"
            >
              <input
                aria-label="JSON Schema"
                type="text"
                value={props.modelConfig.jsonSchema ?? ""}
                onChange={(e) =>
                  props.updateConfig(
                    (config) => (config.jsonSchema = e.currentTarget.value),
                  )
                }
              />
            </ListItem>
          )}
        </>
      )}
      {isNonConversational && capabilityHint && (
        <ListItem title="能力说明" subTitle={capabilityHint} />
      )}

      {props.modelConfig?.providerName == ServiceProvider.Google &&
      !supportsPresencePenalty &&
      !supportsFrequencyPenalty ? null : (
        <>
          {supportsPresencePenalty && (
            <ListItem
              title={Locale.Settings.PresencePenalty.Title}
              subTitle={Locale.Settings.PresencePenalty.SubTitle}
            >
              <InputRange
                aria={Locale.Settings.PresencePenalty.Title}
                value={props.modelConfig.presence_penalty?.toFixed(1)}
                min="-2"
                max="2"
                step="0.1"
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

          {supportsFrequencyPenalty && (
            <ListItem
              title={Locale.Settings.FrequencyPenalty.Title}
              subTitle={Locale.Settings.FrequencyPenalty.SubTitle}
            >
              <InputRange
                aria={Locale.Settings.FrequencyPenalty.Title}
                value={props.modelConfig.frequency_penalty?.toFixed(1)}
                min="-2"
                max="2"
                step="0.1"
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

          {!isNonConversational && (
            <>
              <ListItem
                title={Locale.Settings.InjectSystemPrompts.Title}
                subTitle={Locale.Settings.InjectSystemPrompts.SubTitle}
              >
                <input
                  aria-label={Locale.Settings.InjectSystemPrompts.Title}
                  type="checkbox"
                  checked={props.modelConfig.enableInjectSystemPrompts}
                  onChange={(e) =>
                    props.updateConfig(
                      (config) =>
                        (config.enableInjectSystemPrompts =
                          e.currentTarget.checked),
                    )
                  }
                ></input>
              </ListItem>

              <ListItem
                title={Locale.Settings.InputTemplate.Title}
                subTitle={Locale.Settings.InputTemplate.SubTitle}
              >
                <input
                  aria-label={Locale.Settings.InputTemplate.Title}
                  type="text"
                  value={props.modelConfig.template}
                  onChange={(e) =>
                    props.updateConfig(
                      (config) => (config.template = e.currentTarget.value),
                    )
                  }
                ></input>
              </ListItem>
            </>
          )}
        </>
      )}
      {!isNonConversational && (
        <>
          <ListItem
            title={Locale.Settings.HistoryCount.Title}
            subTitle={Locale.Settings.HistoryCount.SubTitle}
          >
            <InputRange
              aria={Locale.Settings.HistoryCount.Title}
              title={props.modelConfig.historyMessageCount.toString()}
              value={props.modelConfig.historyMessageCount}
              min="0"
              max="64"
              step="1"
              onChange={(e) =>
                props.updateConfig(
                  (config) =>
                    (config.historyMessageCount = e.target.valueAsNumber),
                )
              }
            ></InputRange>
          </ListItem>

          <ListItem
            title={Locale.Settings.CompressThreshold.Title}
            subTitle={Locale.Settings.CompressThreshold.SubTitle}
          >
            <input
              aria-label={Locale.Settings.CompressThreshold.Title}
              type="number"
              min={500}
              max={4000}
              value={props.modelConfig.compressMessageLengthThreshold}
              onChange={(e) =>
                props.updateConfig(
                  (config) =>
                    (config.compressMessageLengthThreshold =
                      e.currentTarget.valueAsNumber),
                )
              }
            ></input>
          </ListItem>
          <ListItem title={Locale.Memory.Title} subTitle={Locale.Memory.Send}>
            <input
              aria-label={Locale.Memory.Title}
              type="checkbox"
              checked={props.modelConfig.sendMemory}
              onChange={(e) =>
                props.updateConfig(
                  (config) => (config.sendMemory = e.currentTarget.checked),
                )
              }
            ></input>
          </ListItem>
          <ListItem
            title={Locale.Settings.CompressModel.Title}
            subTitle={Locale.Settings.CompressModel.SubTitle}
          >
            <input
              aria-label={Locale.Settings.CompressModel.Title}
              className={styles["select-compress-model"]}
              type="text"
              value={`${SUMMARIZE_MODEL}（固定为当前供应商，若缺失则回退 AihubMix）`}
              disabled
              readOnly
            />
          </ListItem>
        </>
      )}
    </>
  );
}
