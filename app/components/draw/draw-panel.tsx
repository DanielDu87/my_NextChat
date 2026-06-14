import styles from "./draw-panel.module.scss";
import React from "react";
import { createRoot } from "react-dom/client";
import { IconButton } from "@/app/components/button";
import { Modal, showToast } from "@/app/components/ui-lib";
import Locale from "@/app/locales";
import { useDrawStore } from "@/app/store/draw";
import { useAccessStore } from "@/app/store";
import EditIcon from "@/app/icons/edit.svg";
import DownIcon from "@/app/icons/down.svg";
import clsx from "clsx";
import { ServiceProvider } from "@/app/constant";
import {
  DRAW_ASPECT_RATIO_OPTIONS,
  DRAW_DALLE_STYLE_OPTIONS,
  DRAW_DOUBAO_OPTIMIZE_PROMPT_MODE_OPTIONS,
  DRAW_RESPONSE_FORMAT_OPTIONS,
  DRAW_GEMINI_THINKING_LEVEL_OPTIONS,
  DRAW_GPT_IMAGE_QUALITY_OPTIONS,
  DRAW_IDEOGRAM_MAGIC_PROMPT_OPTIONS,
  DRAW_IDEOGRAM_V3_STYLE_TYPE_OPTIONS,
  DRAW_OUTPUT_FORMAT_OPTIONS,
  DRAW_RENDERING_SPEED_OPTIONS,
  DRAW_RESOLUTION_OPTIONS,
  DRAW_OPENAI_BACKGROUND_OPTIONS,
  DRAW_PERSON_GENERATION_OPTIONS,
  DRAW_STABILITY_STYLE_PRESET_OPTIONS,
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

const modelOptions = DEFAULT_DRAW_MODELS.map((model) => ({
  name: model,
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
  {
    name: Locale.DrawPanel.NegativePrompt,
    value: "negative_prompt",
    type: "textarea",
    placeholder: Locale.DrawPanel.PleaseInput(Locale.DrawPanel.NegativePrompt),
    rows: 3,
    sub: "写入不希望出现在画面中的元素。",
  },
  {
    name: Locale.DrawPanel.AspectRatio,
    value: "aspect_ratio",
    type: "select",
    default: "1:1",
    help: "控制生成图片的画面比例（Flux/Ideogram 等模型使用）。",
    options: DRAW_ASPECT_RATIO_OPTIONS,
  },
  {
    name: "图像尺寸",
    value: "image_size",
    type: "select",
    default: "1024x1024",
    help: "选择生成图片的宽高尺寸。",
    options: [
      { name: "1024 x 1024", value: "1024x1024" },
      { name: "1024 x 1536", value: "1024x1536" },
      { name: "1536 x 1024", value: "1536x1024" },
      { name: "768 x 1344", value: "768x1344" },
      { name: "1344 x 768", value: "1344x768" },
      { name: "512 x 512", value: "512x512" },
    ],
  },
  {
    name: "图像质量",
    value: "quality",
    type: "select",
    default: "auto",
    help: "控制生成质量，质量越高通常耗时或成本越高。",
    options: [
      ...DRAW_GPT_IMAGE_QUALITY_OPTIONS,
      { name: "标准", value: "standard" },
      { name: "高清", value: "hd" },
    ],
  },
  {
    name: "图片风格",
    value: "style",
    type: "select",
    default: "vivid",
    help: "DALL-E 3 支持的风格参数。",
    options: DRAW_DALLE_STYLE_OPTIONS,
  },
  {
    name: "分辨率",
    value: "resolution",
    type: "select",
    default: "2K",
    help: "选择模型生成时使用的分辨率档位。",
    options: DRAW_RESOLUTION_OPTIONS,
  },
  {
    name: "背景",
    value: "background",
    type: "select",
    default: "auto",
    help: "GPT-Image 支持的背景参数。",
    options: DRAW_OPENAI_BACKGROUND_OPTIONS,
  },
  {
    name: "输出压缩",
    value: "output_compression",
    type: "number",
    default: 100,
    min: 0,
    max: 100,
    help: "GPT-Image 在 JPEG/WebP 输出时支持的压缩质量。",
  },
  {
    name: "人物生成",
    value: "person_generation",
    type: "select",
    default: "allow_adult",
    help: "Imagen 支持的人物生成策略。",
    options: DRAW_PERSON_GENERATION_OPTIONS,
  },
  {
    name: "Seed",
    value: "seed",
    type: "number",
    default: 0,
    min: 0,
    max: 4294967294,
    help: "相同 Seed 更容易复现接近的构图；0 表示自动。",
  },
  {
    name: "思考模式",
    value: "thinking_mode",
    type: "select",
    default: "true",
    help: "Wan2.7 系列支持思考模式，提升生成质量但增加耗时。",
    options: [
      { name: "开启", value: "true" },
      { name: "关闭", value: "false" },
    ],
  },
  {
    name: "思考级别",
    value: "thinking_level",
    type: "select",
    default: "minimal",
    help: "Gemini 3.1 Flash Image（Nano Banana 2）支持，high 用于复杂构图但更慢。",
    options: DRAW_GEMINI_THINKING_LEVEL_OPTIONS,
  },
  {
    name: "提示词智能改写",
    value: "prompt_extend",
    type: "select",
    default: "true",
    help: "Qwen-Image、Wan2.6 支持提示词智能改写。",
    options: [
      { name: "开启", value: "true" },
      { name: "关闭", value: "false" },
    ],
  },
  {
    name: "提示词增强",
    value: "magic_prompt",
    type: "select",
    default: "AUTO",
    help: "Ideogram V3 提示词增强，AUTO 由模型自动判断。",
    options: DRAW_IDEOGRAM_MAGIC_PROMPT_OPTIONS,
  },
  {
    name: "水印",
    value: "watermark",
    type: "select",
    default: "false",
    help: "是否在生成的图片中添加水印。",
    options: [
      { name: "关闭", value: "false" },
      { name: "开启", value: "true" },
    ],
  },
  {
    name: "安全审核容忍度",
    value: "safety_tolerance",
    type: "number",
    default: 2,
    min: 0,
    max: 6,
    help: "Flux 模型安全审核宽松度，0 最严格，6 最宽松。",
  },
  {
    name: "提示词增强",
    value: "prompt_upsampling",
    type: "select",
    default: "false",
    help: "Flux-1.1-pro 是否对提示词进行增强优化。",
    options: [
      { name: "关闭", value: "false" },
      { name: "开启", value: "true" },
    ],
  },
  {
    name: "中文翻译",
    value: "enable_translation",
    type: "select",
    default: "true",
    help: "FluxAPI Kontext 是否启用中文提示词自动翻译。",
    options: [
      { name: "开启", value: "true" },
      { name: "关闭", value: "false" },
    ],
  },
  {
    name: "生成数量",
    value: "n",
    type: "number",
    default: 1,
    min: 1,
    max: 10,
    help: "一次生成图片数量（部分模型支持）。",
  },
  {
    name: "渲染速度/质量",
    value: "rendering_speed",
    type: "select",
    default: "DEFAULT",
    help: "Ideogram V3 渲染质量偏好。",
    options: DRAW_RENDERING_SPEED_OPTIONS,
  },
  {
    name: "保真度",
    value: "input_fidelity",
    type: "select",
    default: "low",
    help: "GPT-Image 保真度，图生图模式下不支持。",
    options: [
      { name: "低", value: "low" },
      { name: "高", value: "high" },
    ],
  },
  {
    name: "内容审核",
    value: "moderation",
    type: "select",
    default: "auto",
    help: "GPT-Image 内容审核严格程度。",
    options: [
      { name: "标准", value: "auto" },
      { name: "宽松", value: "low" },
    ],
  },
  {
    name: Locale.DrawPanel.OutFormat,
    value: "output_format",
    type: "select",
    default: "png",
    help: "选择生成图片的保存格式。",
    options: DRAW_OUTPUT_FORMAT_OPTIONS,
  },
  {
    name: "返回格式",
    value: "response_format",
    type: "select",
    default: "url",
    help: "豆包 Seedream 支持 URL 或 Base64 JSON 返回。",
    options: DRAW_RESPONSE_FORMAT_OPTIONS,
  },
  {
    name: "指导系数",
    value: "guidance_scale",
    type: "number",
    default: 2.5,
    min: 1,
    max: 10,
    float: true,
    help: "豆包 Seedream 3.0 t2i 支持，范围 1-10。",
  },
  {
    name: "提示词优化模式",
    value: "optimize_prompt_mode",
    type: "select",
    default: "standard",
    help: "豆包 Seedream 4.0/4.5/5.0 lite 支持的提示词优化模式。",
    options: DRAW_DOUBAO_OPTIMIZE_PROMPT_MODE_OPTIONS,
  },
  {
    name: "联网搜索",
    value: "web_search",
    type: "select",
    default: "false",
    help: "豆包 Seedream 5.0 lite 支持的 web_search 工具。",
    options: [
      { name: "关闭", value: "false" },
      { name: "开启", value: "true" },
    ],
  },
  {
    name: "风格预设",
    value: "style_preset",
    type: "select",
    default: "",
    help: "Stability 图片生成支持的风格预设。",
    options: DRAW_STABILITY_STYLE_PRESET_OPTIONS,
  },
  {
    name: "风格类型",
    value: "style_type",
    type: "select",
    default: "AUTO",
    help: "Ideogram V3 官方风格类型。",
    options: DRAW_IDEOGRAM_V3_STYLE_TYPE_OPTIONS,
  },
];

const drawCommonParams = () => params;

export const models = DEFAULT_DRAW_MODELS.map(makeDrawModel);

function DrawSelect(props: {
  ariaLabel: string;
  value: string;
  options: DrawSelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const selectId = React.useId();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const selectedOption =
    props.options.find((option) => option.value === props.value) ||
    props.options[0];
  const displayName = props.disabled
    ? ""
    : selectedOption?.name || props.value || "";

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

  const commitValue = (value: string) => {
    if (props.disabled) return;
    props.onChange(value);
    setOpen(false);
  };

  return (
    <div
      className={clsx(styles["draw-select"], {
        [styles["draw-select-open"]]: open,
        [styles["draw-select-disabled"]]: props.disabled,
      })}
      ref={rootRef}
    >
      <button
        aria-controls={open ? selectId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={props.ariaLabel}
        aria-disabled={props.disabled}
        className={styles["draw-select-button"]}
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
        <span>{displayName}</span>
        <DownIcon className={styles["draw-select-icon"]} />
      </button>
      {open && !props.disabled && (
        <div
          className={styles["draw-select-menu"]}
          id={selectId}
          role="listbox"
        >
          {props.options.map((option) => {
            const selected = option.value === props.value;
            return (
              <button
                aria-selected={selected}
                className={clsx(styles["draw-select-option"], {
                  [styles["draw-select-option-active"]]: selected,
                })}
                key={option.value}
                onClick={() => commitValue(option.value)}
                role="option"
                type="button"
              >
                <span className={styles["draw-select-check"]} />
                <span>{option.name}</span>
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
          : props.data[item.value] ??
            getDrawParamDefault(
              currentModel,
              item.value,
              item.default,
              props.provider,
            ) ??
            "";
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
              bordered
              shadow
              onClick={() => closeModal(null)}
            />,
            <IconButton
              key="confirm"
              text={Locale.UI.Confirm}
              type="primary"
              bordered
              shadow
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

  const providerOptions = React.useMemo(() => {
    return (accessStore.apiProfiles || [])
      .filter(isDrawProviderProfile)
      .map((profile) => ({
        name: String(profile.name || "").trim(),
        value: String(profile.id || "").trim(),
      }))
      .filter((profile) => profile.name && profile.value);
  }, [accessStore.apiProfiles]);

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
  };

  const handleProviderChange = (provider: string) => {
    setSelectedProvider(provider);
    const profile = (accessStore.apiProfiles || []).find(
      (item) => String(item?.id || "").trim() === provider,
    );
    setParams(
      sanitizeDrawParams(
        currentModel.value,
        currentParams,
        String(profile?.provider || ""),
      ),
    );
  };

  const handleEditModels = async () => {
    const result = await showDrawModelEditor({
      models: drawModels,
    });
    if (!result) return;

    setModels(result.models);
    // 当前模型被删时回退到列表首项，否则保持用户选择
    if (currentModel.value && !result.models.includes(currentModel.value)) {
      applyModel(result.models[0], {
        ...currentParams,
        model: result.models[0],
      });
    }
  };

  React.useEffect(() => {
    if (
      providerOptions.length > 0 &&
      !providerOptions.some((item) => item.value === selectedProvider)
    ) {
      setSelectedProvider(providerOptions[0].value);
      return;
    }

    if (providerOptions.length === 0 && selectedProvider !== "") {
      setSelectedProvider("");
    }
  }, [providerOptions, selectedProvider, setSelectedProvider]);

  return (
    <div className={styles["draw-panel"]}>
      <section className={styles["draw-panel-section"]}>
        <div className={styles["draw-panel-section-title-row"]}>
          <div className={styles["draw-panel-section-title"]}>
            {Locale.DrawPanel.ModelVersion}
          </div>
          <IconButton
            icon={<EditIcon />}
            text="编辑"
            bordered
            className={styles["draw-model-edit-button"]}
            onClick={handleEditModels}
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
              onChange={handleProviderChange}
            />
          </ControlParamItem>
          <ControlParamItem title="模型" className={styles["draw-model-field"]}>
            <DrawSelect
              ariaLabel="模型"
              value={currentModel.value}
              options={filteredDrawModels.map((model) => ({
                name: model,
                value: model,
              }))}
              onChange={(value) => handleValueChange("model", value)}
            />
          </ControlParamItem>
        </div>
      </section>

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
        <div className={styles["draw-panel-section-title"]}>请求日志</div>
        <ControlParamItem
          title="发送请求"
          subTitle="显示最近一次发送的 URL 和参数。"
          className={styles["draw-log-item"]}
        >
          <textarea
            className={styles["draw-log-textarea"]}
            rows={6}
            readOnly
            value={drawStore.lastRequestLog || ""}
            placeholder="发送请求后会显示在这里"
          />
        </ControlParamItem>
        <ControlParamItem
          title="返回内容"
          subTitle="显示最近一次接口返回的原始文本内容。"
          className={styles["draw-log-item"]}
        >
          <textarea
            className={styles["draw-log-textarea"]}
            rows={8}
            readOnly
            value={drawStore.lastResponseLog || ""}
            placeholder="收到返回后会显示在这里"
          />
        </ControlParamItem>
      </section>
    </div>
  );
}
