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
import {
  getCapabilityHint,
  getModelParameterSupport,
  isNonConversationalCapability,
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

  // 按供应商名称排序（把常用供应商放前面）
  const sortedGroupNames = Object.keys(groupModels).sort((a, b) => {
    const vendorOrder = [
      "OpenAI",
      "Anthropic",
      "Google",
      "DeepSeek",
      "xAI",
      "Alibaba",
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
              const support = getModelParameterSupport(model);
              if (isNonConversationalCapability(support.capability)) {
                config.enableInjectSystemPrompts = false;
                config.sendMemory = false;
                config.historyMessageCount = 0;
              }
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
