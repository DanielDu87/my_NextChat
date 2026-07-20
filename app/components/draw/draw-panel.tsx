import styles from "./draw-panel.module.scss";
import React from "react";
import { createRoot } from "react-dom/client";
import { IconButton } from "@/app/components/button";
import { Modal, showToast } from "@/app/components/ui-lib";
import { AddModelSelector } from "@/app/components/add-model-modal";
import Locale from "@/app/locales";
import { useDrawStore } from "@/app/store/draw";
import { useAccessStore, useAppConfig } from "@/app/store";
import { useMobileScreen } from "@/app/utils";
import EditIcon from "@/app/icons/edit.svg";
import DownIcon from "@/app/icons/down.svg";
import clsx from "clsx";
import { ServiceProvider } from "@/app/constant";
import {
  DRAW_GENERATION_PARAM_DEFINITIONS,
  getDrawParamDefault,
  getDrawParamOptions,
  getDrawParamRange,
  isDrawParamSupported,
  sanitizeDrawParams,
  type DrawSelectOption,
} from "@/app/utils/draw-model-params";

export const DEFAULT_DRAW_MODELS = [
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
  "gemini-2.5-flash-image",
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
  "dall-e-3",
  "dall-e-2",
  "qwen-image-2.0-pro-2026-04-22",
  "qwen-image-2.0",
  "qwen-image-2.0-pro",
  "qwen-image",
  "qwen-image-max",
  "qwen-image-plus",
  "wan2.7-image-pro",
  "wan2.7-image",
  "wan2.6-t2i",
  "wan2.5-t2i-preview",
  "wan2.2-t2i-plus",
  "wan2.2-t2i-flash",
  "wanx2.1-t2i-plus",
  "wanx2.1-t2i-turbo",
  "wanx2.0-t2i-turbo",
  "wanx-v1",
  "glm-image",
  "cogview-4-250304",
  "cogview-4",
  "cogview-3-flash",
  "doubao-seedream-5-0-lite-260128",
  "doubao-seedream-5-0-260128",
  "doubao-seedream-4-5-251128",
  "doubao-seedream-4-0-250828",
  "doubao-seedream-3-0-t2i-250415",
  "imagen-4.0-ultra-generate-001",
  "imagen-4.0-generate-001",
  "imagen-4.0-fast-generate-001",
  "flux-2-flex",
  "flux-2-pro",
  "flux-kontext-pro",
  "flux-kontext-max",
  "ideogram-v4",
  "ideogram-v3",
  "V3",
  "irag-1.0",
];

const DRAW_MODEL_DISPLAY_NAMES: Record<string, string> = {
  "gemini-2.5-flash-image": "gemini-2.5-flash-image（NanoBanana）",
  "gemini-3.1-flash-image": "gemini-3.1-flash-image（NanoBanana2）",
  "gemini-3-pro-image": "gemini-3-pro-image（NanoBananaPro）",
};

function getDrawModelDisplayName(model: string) {
  return DRAW_MODEL_DISPLAY_NAMES[model] || model;
}

function shouldShrinkDrawSelectText(name: string, value?: string) {
  return name.length > 32 || (value ? name !== value : false);
}

const modelOptions = DEFAULT_DRAW_MODELS.map((model) => ({
  name: getDrawModelDisplayName(model),
  value: model,
}));

export function makeDrawModel(value: string) {
  return {
    name: value,
    value,
    description: "手动模型",
    params: () => drawCommonParams(),
  };
}

export const params = [
  {
    name: Locale.DrawPanel.Prompt,
    value: "prompt",
    type: "textarea",
    placeholder: Locale.DrawPanel.PleaseInput(Locale.DrawPanel.Prompt),
    required: true,
    rows: 6,
    sub: "描述主体、画面细节、风格、镜头和光线。",
  },
  {
    name: Locale.DrawPanel.ModelVersion,
    value: "model",
    type: "select",
    default: DEFAULT_DRAW_MODELS[0],
    options: modelOptions,
  },
  ...DRAW_GENERATION_PARAM_DEFINITIONS,
];

const drawCommonParams = () => params;

export const models = DEFAULT_DRAW_MODELS.map(makeDrawModel);

export function DrawSelect(props: {
  ariaLabel: string;
  value: string;
  options: DrawSelectOption[];
  disabled?: boolean;
  openOnHover?: boolean;
  shrinkLongText?: boolean;
  onChange: (value: string) => void;
}) {
  const selectId = React.useId();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const hoverCloseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [open, setOpen] = React.useState(false);
  const isMobileScreen = useMobileScreen();
  const selectedOption =
    props.options.find((option) => option.value === props.value) ||
    props.options[0];
  const displayName = props.disabled
    ? ""
    : selectedOption?.name || props.value || "";
  const shouldShrinkDisplayName =
    props.shrinkLongText &&
    shouldShrinkDrawSelectText(displayName, selectedOption?.value);

  const clearHoverCloseTimer = () => {
    if (!hoverCloseTimerRef.current) return;
    clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = null;
  };

  const openSelectOnHover = () => {
    if (props.disabled || !props.openOnHover || isMobileScreen) return;
    clearHoverCloseTimer();
    setOpen(true);
  };

  const closeSelectAfterHover = () => {
    if (!props.openOnHover || isMobileScreen) return;
    clearHoverCloseTimer();
    hoverCloseTimerRef.current = setTimeout(() => {
      setOpen(false);
    }, 120);
  };

  React.useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  React.useEffect(() => {
    return () => clearHoverCloseTimer();
  }, []);

  const commitValue = (value: string) => {
    if (props.disabled) return;
    props.onChange(value);
    setOpen(false);
  };

  return (
    <div
      className={clsx("nextchat-select", {
        "nextchat-select-open": open,
        "nextchat-select-disabled": props.disabled,
      })}
      ref={rootRef}
      onMouseEnter={openSelectOnHover}
      onMouseLeave={closeSelectAfterHover}
    >
      <button
        aria-controls={open ? selectId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={props.ariaLabel}
        aria-disabled={props.disabled}
        className="nextchat-select-trigger nextchat-control-surface"
        disabled={props.disabled}
        onClick={() => {
          if (props.disabled) return;
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (props.disabled) return;
          if (event.key === "Escape") {
            setOpen(false);
          }
          if (event.key === "ArrowDown" || event.key === "Enter") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        type="button"
      >
        <span
          className={clsx("nextchat-select-text", {
            "nextchat-select-text-shrink": shouldShrinkDisplayName,
          })}
        >
          {displayName}
        </span>
        <DownIcon className="nextchat-select-icon" />
      </button>
      {open && !props.disabled && (
        <div
          className="nextchat-select-menu"
          id={selectId}
          role="listbox"
          onMouseEnter={openSelectOnHover}
          onMouseLeave={closeSelectAfterHover}
        >
          {props.options.map((option) => {
            const selected = option.value === props.value;
            const shouldShrinkOptionName =
              props.shrinkLongText &&
              shouldShrinkDrawSelectText(option.name, option.value);
            return (
              <button
                aria-selected={selected}
                className={clsx("nextchat-select-option", {
                  "nextchat-select-option-active": selected,
                })}
                key={option.value}
                onClick={() => commitValue(option.value)}
                role="option"
                type="button"
              >
                <span className="nextchat-select-check" />
                <span
                  className={clsx("nextchat-select-option-text", {
                    "nextchat-select-text-shrink": shouldShrinkOptionName,
                  })}
                >
                  {option.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ControlParamItem(props: {
  title: string;
  subTitle?: string;
  help?: string;
  required?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(styles["ctrl-param-item"], props.className, {
        [styles["ctrl-param-item-disabled"]]: props.disabled,
      })}
    >
      <div className={styles["ctrl-param-item-header"]}>
        <div className={styles["ctrl-param-item-title"]}>
          <div>{props.title}</div>
        </div>
      </div>
      {props.children}
      {props.subTitle && (
        <div className={styles["ctrl-param-item-sub-title"]}>
          {props.subTitle}
        </div>
      )}
    </div>
  );
}

export function ControlParam(props: {
  columns: any[];
  data: any;
  onChange: (field: string, val: any) => void;
  modelOptions?: string[];
  model?: string;
  provider?: string;
  showGroupTitles?: boolean;
}) {
  const getParamTypeOrder = (type: string) => {
    if (type === "select") return 0;
    if (["text", "textarea", "number"].includes(type)) return 1;
    return 0;
  };
  const compactFields = new Set([
    "n",
    "seed",
    "guidance_scale",
    "safety_tolerance",
    "output_compression",
  ]);

  const currentModel = props.model || props.data?.model || "";
  const outputFormat = String(props.data?.output_format || "");

  // 判断单个参数是否禁用：模型不支持，或 output_compression 在非 jpeg/webp 时条件禁用。
  const isItemDisabled = (value: string) => {
    if (!isDrawParamSupported(currentModel, value, props.provider)) return true;
    if (
      value === "output_compression" &&
      !["jpeg", "webp"].includes(outputFormat)
    ) {
      return true;
    }
    return false;
  };

  // 切换模型后，当前模型支持的参数排在上方，禁用的（含条件禁用）下沉到底部，但不隐藏。
  const sortedColumns = React.useMemo(() => {
    const columns = props.columns || [];
    return columns
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const aDisabled = isItemDisabled(a.item.value);
        const bDisabled = isItemDisabled(b.item.value);
        if (aDisabled !== bDisabled) return aDisabled ? 1 : -1;
        const aTypeOrder = getParamTypeOrder(a.item.type);
        const bTypeOrder = getParamTypeOrder(b.item.type);
        if (aTypeOrder !== bTypeOrder) return aTypeOrder - bTypeOrder;
        return a.index - b.index;
      })
      .map((entry) => entry.item);
    // isItemDisabled 仅依赖 currentModel/provider/outputFormat，均已在依赖列表中
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.columns, currentModel, props.provider, outputFormat]);

  return (
    <div className={styles["draw-param-grid"]}>
      {sortedColumns.map((item, index) => {
        let element: null | JSX.Element;
        const disabled = isItemDisabled(item.value);
        const baseOptions =
          item.value === "model" && props.modelOptions
            ? props.modelOptions.map((model) => ({ name: model, value: model }))
            : item.options || [];
        const options = getDrawParamOptions(
          currentModel,
          item.value,
          baseOptions,
          props.provider,
        );
        const value = disabled
          ? ""
          : (props.data[item.value] ??
            getDrawParamDefault(
              currentModel,
              item.value,
              item.default,
              props.provider,
            ) ??
            "");
        const numberRange =
          item.type === "number"
            ? getDrawParamRange(
                currentModel,
                item.value,
                {
                  min: item.min,
                  max: item.max,
                  float: item.float,
                },
                props.provider,
              )
            : {};
        const numberMin =
          typeof numberRange.min === "number" ? numberRange.min : item.min;
        const numberMax =
          typeof numberRange.max === "number" ? numberRange.max : item.max;
        const isFloatNumber =
          typeof numberRange.float === "boolean"
            ? numberRange.float
            : Boolean(item.float);
        const handleChange = (value: unknown) => {
          if (disabled) return;
          props.onChange(item.value, value);
        };
        switch (item.type) {
          case "textarea":
            element = (
              <ControlParamItem
                title={item.name}
                subTitle={item.sub}
                help={item.help}
                required={item.required}
                disabled={disabled}
              >
                <textarea
                  className={clsx("nextchat-input-control", {
                    [styles["draw-prompt-textarea"]]: item.value === "prompt",
                  })}
                  disabled={disabled}
                  rows={item.rows || 3}
                  placeholder={disabled ? "" : item.placeholder}
                  onChange={(e) => {
                    handleChange(e.currentTarget.value);
                  }}
                  value={value as string}
                ></textarea>
              </ControlParamItem>
            );
            break;
          case "select":
            element = (
              <ControlParamItem
                title={item.name}
                subTitle={item.sub}
                help={item.help}
                required={item.required}
                disabled={disabled}
              >
                <DrawSelect
                  ariaLabel={item.name}
                  value={String(value ?? "")}
                  options={options.map((opt: any) => ({
                    name: String(opt.name),
                    value: String(opt.value),
                  }))}
                  disabled={disabled}
                  onChange={(value) => handleChange(value)}
                />
              </ControlParamItem>
            );
            break;
          case "number":
            element = (
              <ControlParamItem
                title={item.name}
                subTitle={item.sub}
                help={item.help}
                required={item.required}
                disabled={disabled}
              >
                <input
                  className="nextchat-input-control"
                  aria-label={item.name}
                  disabled={disabled}
                  type="text"
                  inputMode={isFloatNumber ? "decimal" : "numeric"}
                  pattern={isFloatNumber ? "-?[0-9]*([.][0-9]*)?" : "-?[0-9]*"}
                  value={value as string | number}
                  onChange={(e) => {
                    if (disabled) return;
                    const value = e.currentTarget.value;
                    if (value === "") {
                      props.onChange(item.value, "");
                      return;
                    }
                    const numberPattern = isFloatNumber
                      ? /^-?\d*(?:\.\d*)?$/
                      : /^-?\d*$/;
                    if (!numberPattern.test(value)) {
                      return;
                    }
                    if (["-", ".", "-."].includes(value)) {
                      props.onChange(item.value, value);
                      return;
                    }

                    const nextValue = isFloatNumber
                      ? Number(value)
                      : parseInt(value, 10);
                    if (!Number.isFinite(nextValue)) {
                      return;
                    }
                    if (
                      typeof numberMin === "number" &&
                      nextValue < numberMin
                    ) {
                      props.onChange(item.value, numberMin);
                      return;
                    }
                    if (
                      typeof numberMax === "number" &&
                      nextValue > numberMax
                    ) {
                      props.onChange(item.value, numberMax);
                      return;
                    }

                    props.onChange(item.value, nextValue);
                  }}
                  onBlur={() => {
                    if (disabled) return;
                    const currentValue = props.data[item.value];
                    if (currentValue === "" || currentValue === undefined) {
                      props.onChange(
                        item.value,
                        numberMin ?? item.default ?? 1,
                      );
                    }
                  }}
                />
              </ControlParamItem>
            );
            break;
          default:
            element = (
              <ControlParamItem
                title={item.name}
                subTitle={item.sub}
                help={item.help}
                required={item.required}
                disabled={disabled}
              >
                <input
                  className="nextchat-input-control"
                  aria-label={item.name}
                  disabled={disabled}
                  type="text"
                  value={value as string}
                  onChange={(e) => {
                    handleChange(e.currentTarget.value);
                  }}
                />
              </ControlParamItem>
            );
        }
        const prevDisabled =
          index > 0 ? isItemDisabled(sortedColumns[index - 1].value) : null;
        const showGroupTitle =
          props.showGroupTitles !== false &&
          (index === 0 || prevDisabled !== disabled);
        return (
          <React.Fragment key={item.value}>
            {showGroupTitle && (
              <div className={styles["draw-param-group-title"]}>
                {disabled ? "不可用参数" : "可用参数"}
              </div>
            )}
            <div
              className={clsx({
                [styles["draw-param-grid-item-full"]]:
                  item.type !== "select" && !compactFields.has(item.value),
              })}
            >
              {element}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export const getModelParamBasicData = (
  columns: any[],
  data: any,
  clearText?: boolean,
) => {
  const newParams: any = {};
  columns.forEach((item: any) => {
    if (clearText && ["text", "textarea", "number"].includes(item.type)) {
      newParams[item.value] = item.default || "";
    } else {
      // @ts-ignore
      newParams[item.value] = data[item.value] || item.default || "";
    }
  });
  return newParams;
};

export const getParams = (_model?: any, _data?: any) => drawCommonParams();

function isDrawProviderProfile(profile: {
  id?: string;
  provider?: ServiceProvider;
  name?: string;
  apiKey?: string;
}) {
  const hasApiKey = Boolean(String(profile.apiKey || "").trim());
  const hasName = Boolean(String(profile.name || "").trim());
  return hasApiKey && hasName && profile.provider !== undefined;
}

function normalizeDrawModels(text: string) {
  return Array.from(
    new Set(
      text
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function buildDrawModelEditorResult(modelsInput: string) {
  const normalizedModels = normalizeDrawModels(modelsInput);
  if (normalizedModels.length === 0) return null;
  return { models: normalizedModels };
}

function showDrawModelEditor(initialState: { models: string[] }) {
  const div = document.createElement("div");
  div.className = "modal-mask";
  document.body.appendChild(div);

  const root = createRoot(div);

  return new Promise<{ models: string[] } | null>((resolve) => {
    const closeModal = (result: { models: string[] } | null) => {
      resolve(result);
      root.unmount();
      div.remove();
    };

    function DrawModelEditorModal() {
      const [modelsInput, setModelsInput] = React.useState(
        initialState.models.join("\n"),
      );

      const handleConfirm = () => {
        const result = buildDrawModelEditorResult(modelsInput);
        if (!result) {
          showToast("请至少输入一个模型");
          return;
        }
        closeModal(result);
      };

      return (
        <Modal
          title="编辑 AI 模型"
          isSmall
          className={styles["draw-model-editor-modal"]}
          onClose={() => closeModal(null)}
          actions={[
            <IconButton
              key="cancel"
              text={Locale.UI.Cancel}
              onClick={() => closeModal(null)}
            />,
            <IconButton
              key="confirm"
              text={Locale.UI.Confirm}
              type="primary"
              onClick={handleConfirm}
            />,
          ]}
        >
          <div className={styles["draw-model-editor"]}>
            <ControlParamItem
              title="模型列表"
              subTitle="每行一个模型，自动去重；列表首项为默认选中。"
            >
              <textarea
                className="nextchat-input-control"
                rows={Math.max(8, initialState.models.length)}
                value={modelsInput}
                placeholder="每行输入一个模型"
                onChange={(e) => setModelsInput(e.currentTarget.value)}
              />
            </ControlParamItem>
          </div>
        </Modal>
      );
    }

    div.onclick = (e) => {
      if (e.target === div) {
        closeModal(null);
      }
    };

    root.render(<DrawModelEditorModal />);
  });
}

const paramGroups = [
  {
    title: "提示词",
    fields: ["prompt", "negative_prompt"],
  },
  {
    title: "图像设置",
    fields: [
      "aspect_ratio",
      "image_size",
      "quality",
      "style",
      "output_format",
      "response_format",
      "background",
      "output_compression",
      "resolution",
      "person_generation",
      "model",
      "n",
    ],
  },
  {
    title: "模型参数",
    fields: [
      "seed",
      "guidance_scale",
      "thinking_mode",
      "thinking_level",
      "prompt_extend",
      "magic_prompt",
      "optimize_prompt_mode",
      "web_search",
      "watermark",
      "safety_tolerance",
      "prompt_upsampling",
      "enable_translation",
      "rendering_speed",
      "input_fidelity",
      "moderation",
      "style_preset",
      "style_type",
    ],
  },
];

export function DrawPanel() {
  const drawStore = useDrawStore();
  const accessStore = useAccessStore();
  const globalGenerationParams = useAppConfig(
    (state) => state.modelConfig.generationParams,
  );
  const [showModelManager, setShowModelManager] = React.useState(false);
  const currentModel = drawStore.currentModel;
  const setCurrentModel = drawStore.setCurrentModel;
  const drawModels = drawStore.models?.length
    ? drawStore.models
    : DEFAULT_DRAW_MODELS;
  const setModels = drawStore.setModels;
  const currentParams = drawStore.currentParams;
  const setParams = drawStore.setCurrentParams;
  const selectedProvider = drawStore.selectedProvider;
  const setSelectedProvider = drawStore.setSelectedProvider;
  const hasHydrated = Boolean((drawStore as any)._hasHydrated);
  const didClearPromptOnOpenRef = React.useRef(false);
  const rawProviderModels = (drawStore as any).providerModels;
  const providerModelsMap = React.useMemo(
    () => (rawProviderModels || {}) as Record<string, string[]>,
    [rawProviderModels],
  );
  const drawProfiles = React.useMemo(() => {
    return (accessStore.apiProfiles || []).filter(isDrawProviderProfile);
  }, [accessStore.apiProfiles]);

  const providerOptions = React.useMemo(() => {
    return drawProfiles
      .map((profile) => ({
        name: String(profile.name || "").trim(),
        value: String(profile.id || "").trim(),
      }))
      .filter((profile) => profile.name && profile.value);
  }, [drawProfiles]);

  const selectedProviderType = React.useMemo(() => {
    const profile = (accessStore.apiProfiles || []).find(
      (item) => String(item?.id || "").trim() === selectedProvider,
    );
    return String(profile?.provider || "");
  }, [accessStore.apiProfiles, selectedProvider]);

  const filteredDrawModels = React.useMemo(() => {
    const nextModels = drawModels;

    if (currentModel.value && !nextModels.includes(currentModel.value)) {
      return [currentModel.value, ...nextModels];
    }

    return nextModels;
  }, [currentModel.value, drawModels]);

  const applyModel = React.useCallback(
    (modelValue: string, nextParams = currentParams) => {
      const normalizedModel = modelValue.trim();
      if (!normalizedModel) return;
      setCurrentModel(makeDrawModel(normalizedModel));
      setParams(
        sanitizeDrawParams(
          normalizedModel,
          {
            ...getModelParamBasicData(drawCommonParams(), nextParams),
            model: normalizedModel,
          },
          selectedProviderType,
        ),
      );
    },
    [currentParams, selectedProviderType, setCurrentModel, setParams],
  );

  const handleValueChange = (field: string, val: any) => {
    const nextParams = {
      ...currentParams,
      [field]: val,
    };
    if (field === "model") {
      applyModel(val, nextParams);
      return;
    }
    setParams(nextParams);
    const generationDefinition = DRAW_GENERATION_PARAM_DEFINITIONS.find(
      (item) => item.value === field,
    );
    if (generationDefinition) {
      useAppConfig.getState().update((config) => {
        config.modelConfig.generationParams = {
          ...(config.modelConfig.generationParams ?? {}),
          [generationDefinition.value]: val,
        };
        if (
          generationDefinition.value === "image_size" ||
          generationDefinition.value === "resolution"
        ) {
          config.modelConfig.size = val;
        } else if (generationDefinition.value === "quality") {
          config.modelConfig.quality = val;
        } else if (generationDefinition.value === "style") {
          config.modelConfig.style = val;
        }
      });
    }
  };

  const handleProviderChange = React.useCallback(
    (provider: string) => {
      setSelectedProvider(provider);
      const latestDrawState = useDrawStore.getState() as any;
      const nextModelValue = String(
        latestDrawState.currentModel?.value || currentModel.value || "",
      );
      const profile = (accessStore.apiProfiles || []).find(
        (item) => String(item?.id || "").trim() === provider,
      );
      setParams(
        sanitizeDrawParams(
          nextModelValue,
          {
            ...currentParams,
            model: nextModelValue,
          },
          String(profile?.provider || ""),
        ),
      );
    },
    [
      accessStore.apiProfiles,
      currentModel.value,
      currentParams,
      setParams,
      setSelectedProvider,
    ],
  );

  const drawManagedModelKeys = React.useMemo(() => {
    return Object.entries(providerModelsMap).flatMap(([providerId, models]) =>
      (models || [])
        .filter(Boolean)
        .map((model) => `${String(model).trim()}@${String(providerId).trim()}`),
    );
  }, [providerModelsMap]);

  const handleAddDrawModels = React.useCallback(
    (keys: string[]) => {
      const modelsByProvider = new Map<string, string[]>();
      keys.forEach((key) => {
        const normalizedKey = String(key || "")
          .trim()
          .replace(/^[+-]/, "");
        const atIdx = normalizedKey.lastIndexOf("@");
        if (atIdx <= 0) return;
        const modelName = normalizedKey.substring(0, atIdx).trim();
        const providerId = normalizedKey.substring(atIdx + 1).trim();
        if (!modelName || !providerId) return;
        const existing = modelsByProvider.get(providerId) || [];
        existing.push(modelName);
        modelsByProvider.set(providerId, existing);
      });

      modelsByProvider.forEach((modelNames, providerId) => {
        const existingModels = providerModelsMap[providerId] || [];
        const nextModels = Array.from(
          new Set([...existingModels, ...modelNames]),
        );
        setModels(nextModels, providerId);
      });
    },
    [providerModelsMap, setModels],
  );

  const handleRemoveDrawModels = React.useCallback(
    (keys: string[]) => {
      const removedByProvider = new Map<string, Set<string>>();
      keys.forEach((key) => {
        const normalizedKey = String(key || "")
          .trim()
          .replace(/^[+-]/, "");
        const atIdx = normalizedKey.lastIndexOf("@");
        if (atIdx <= 0) return;
        const modelName = normalizedKey.substring(0, atIdx).trim();
        const providerId = normalizedKey.substring(atIdx + 1).trim();
        if (!modelName || !providerId) return;
        if (!removedByProvider.has(providerId)) {
          removedByProvider.set(providerId, new Set<string>());
        }
        removedByProvider.get(providerId)!.add(modelName);
      });

      removedByProvider.forEach((removedModels, providerId) => {
        const existingModels = providerModelsMap[providerId] || [];
        const nextModels = existingModels.filter(
          (model) => !removedModels.has(String(model).trim()),
        );
        setModels(nextModels, providerId);

        if (
          providerId === selectedProvider &&
          removedModels.has(currentModel.value)
        ) {
          const fallbackModel = nextModels[0] || DEFAULT_DRAW_MODELS[0];
          applyModel(fallbackModel, {
            ...currentParams,
            model: fallbackModel,
          });
        }
      });
    },
    [
      applyModel,
      currentModel.value,
      currentParams,
      providerModelsMap,
      selectedProvider,
      setModels,
    ],
  );

  const handleEditModels = () => {
    setShowModelManager(true);
  };

  React.useEffect(() => {
    if (!hasHydrated || didClearPromptOnOpenRef.current) return;
    didClearPromptOnOpenRef.current = true;

    const latestParams = useDrawStore.getState().currentParams || {};
    if (latestParams.prompt) {
      setParams({
        ...latestParams,
        prompt: "",
      });
    }
  }, [hasHydrated, setParams]);

  React.useEffect(() => {
    if (!hasHydrated || !globalGenerationParams) return;
    const hasSavedGenerationValue = Object.values(globalGenerationParams).some(
      (value) => value !== undefined && value !== null && value !== "",
    );
    if (!hasSavedGenerationValue) return;

    const nextParams = sanitizeDrawParams(
      currentModel.value,
      {
        ...currentParams,
        ...globalGenerationParams,
        model: currentModel.value,
      },
      selectedProviderType,
    );
    const isSame = DRAW_GENERATION_PARAM_DEFINITIONS.every(
      (definition) =>
        currentParams[definition.value] === nextParams[definition.value],
    );
    if (!isSame) {
      setParams(nextParams);
    }
  }, [
    currentModel.value,
    currentParams,
    globalGenerationParams,
    hasHydrated,
    selectedProviderType,
    setParams,
  ]);

  React.useEffect(() => {
    if (
      providerOptions.length > 0 &&
      !providerOptions.some((item) => item.value === selectedProvider)
    ) {
      handleProviderChange(providerOptions[0].value);
      return;
    }

    if (providerOptions.length === 0 && selectedProvider !== "") {
      setSelectedProvider("");
    }
  }, [
    handleProviderChange,
    providerOptions,
    selectedProvider,
    setSelectedProvider,
  ]);

  const hasRequestLog = Boolean(drawStore.lastRequestLog);
  const hasResponseLog = Boolean(drawStore.lastResponseLog);

  return (
    <div className={styles["draw-panel"]}>
      <section className={styles["draw-panel-section"]}>
        <div className={styles["draw-panel-section-title-row"]}>
          <div
            className={clsx(
              styles["ctrl-param-item-title"],
              styles["draw-panel-section-label"],
            )}
          >
            {Locale.DrawPanel.ModelVersion}
          </div>
          <IconButton
            icon={<EditIcon />}
            text="编辑"
            className={styles["draw-model-edit-action"]}
            onClick={handleEditModels}
            aria="编辑模型"
          />
        </div>
        <div className={styles["draw-model-picker-stack"]}>
          <ControlParamItem
            title="模型供应商"
            className={styles["draw-provider-item"]}
          >
            <DrawSelect
              ariaLabel="模型供应商"
              value={selectedProvider}
              options={providerOptions}
              openOnHover
              onChange={handleProviderChange}
            />
          </ControlParamItem>
          <ControlParamItem title="模型" className={styles["draw-model-field"]}>
            <DrawSelect
              ariaLabel="模型"
              value={currentModel.value}
              shrinkLongText
              openOnHover
              options={filteredDrawModels.map((model) => ({
                name: getDrawModelDisplayName(model),
                value: model,
              }))}
              onChange={(value) => handleValueChange("model", value)}
            />
          </ControlParamItem>
        </div>
      </section>
      {showModelManager && selectedProvider && (
        <AddModelSelector
          onClose={() => setShowModelManager(false)}
          profiles={drawProfiles as any}
          initialProviderId={selectedProvider}
          providerIdResolver={(profile) => String(profile.id || "")}
          managedModelKeys={drawManagedModelKeys}
          onAddModels={handleAddDrawModels}
          onRemoveModel={handleRemoveDrawModels}
        />
      )}

      {(() => {
        const allParams = getParams();
        // 提示词组（画面提示/否定提示）不显示分区标题
        const promptGroup = paramGroups.find((group) =>
          group.fields.includes("prompt"),
        );
        const promptColumns = promptGroup
          ? allParams.filter(
              (item) =>
                item.value !== "model" &&
                promptGroup.fields.includes(item.value),
            )
          : [];
        // 其余组（图像设置/模型参数）合并，统一按可用/不可用分区
        const otherColumns = paramGroups
          .filter((group) => group !== promptGroup)
          .flatMap((group) =>
            allParams.filter(
              (item) =>
                item.value !== "model" && group.fields.includes(item.value),
            ),
          );

        return (
          <>
            {promptColumns.length > 0 && (
              <section className={styles["draw-panel-section"]}>
                <ControlParam
                  columns={promptColumns}
                  data={currentParams}
                  onChange={handleValueChange}
                  model={currentModel.value}
                  provider={selectedProviderType}
                  showGroupTitles={false}
                />
              </section>
            )}
            {otherColumns.length > 0 && (
              <section className={styles["draw-panel-section"]}>
                <ControlParam
                  columns={otherColumns}
                  data={currentParams}
                  onChange={handleValueChange}
                  model={currentModel.value}
                  provider={selectedProviderType}
                />
              </section>
            )}
          </>
        );
      })()}

      <section className={styles["draw-panel-section"]}>
        <div
          className={clsx(
            styles["ctrl-param-item-title"],
            styles["draw-panel-section-label"],
          )}
        >
          请求日志
        </div>
        <ControlParamItem
          title="发送请求"
          subTitle="显示最近一次发送的 URL 和参数。"
          className={styles["draw-log-item"]}
        >
          <pre
            className={clsx(
              "nextchat-input-surface",
              "nextchat-input-surface-readonly",
              styles["draw-log-textarea"],
              !hasRequestLog && styles["draw-log-textarea-empty"],
            )}
            aria-label="发送请求"
          >
            {hasRequestLog
              ? drawStore.lastRequestLog
              : "发送请求后会显示在这里"}
          </pre>
        </ControlParamItem>
        <ControlParamItem
          title="返回内容"
          subTitle="显示最近一次接口返回的原始文本内容。"
          className={styles["draw-log-item"]}
        >
          <pre
            className={clsx(
              "nextchat-input-surface",
              "nextchat-input-surface-readonly",
              styles["draw-log-textarea"],
              !hasResponseLog && styles["draw-log-textarea-empty"],
            )}
            aria-label="返回内容"
          >
            {hasResponseLog
              ? drawStore.lastResponseLog
              : "收到返回后会显示在这里"}
          </pre>
        </ControlParamItem>
      </section>
    </div>
  );
}
