import styles from "./sd-panel.module.scss";
import React from "react";
import { Select } from "@/app/components/ui-lib";
import Locale from "@/app/locales";
import { useSdStore } from "@/app/store/sd";
import clsx from "clsx";

export const params = [
  {
    name: Locale.SdPanel.Prompt,
    value: "prompt",
    type: "textarea",
    placeholder: Locale.SdPanel.PleaseInput(Locale.SdPanel.Prompt),
    required: true,
    rows: 6,
    help: "描述主体、画面细节、风格、镜头和光线。",
  },
  {
    name: Locale.SdPanel.ModelVersion,
    value: "model",
    type: "select",
    default: "sd3-medium",
    support: ["sd3"],
    options: [
      { name: "SD3 Medium", value: "sd3-medium" },
      { name: "SD3 Large", value: "sd3-large" },
      { name: "SD3 Large Turbo", value: "sd3-large-turbo" },
    ],
  },
  {
    name: Locale.SdPanel.NegativePrompt,
    value: "negative_prompt",
    type: "textarea",
    placeholder: Locale.SdPanel.PleaseInput(Locale.SdPanel.NegativePrompt),
    rows: 3,
    help: "写入不希望出现在画面中的元素。",
  },
  {
    name: Locale.SdPanel.AspectRatio,
    value: "aspect_ratio",
    type: "select",
    default: "1:1",
    help: "控制生成图片的画面比例。",
    options: [
      { name: "1:1", value: "1:1" },
      { name: "16:9", value: "16:9" },
      { name: "21:9", value: "21:9" },
      { name: "2:3", value: "2:3" },
      { name: "3:2", value: "3:2" },
      { name: "4:5", value: "4:5" },
      { name: "5:4", value: "5:4" },
      { name: "9:16", value: "9:16" },
      { name: "9:21", value: "9:21" },
    ],
  },
  {
    name: Locale.SdPanel.ImageStyle,
    value: "style",
    type: "select",
    default: "3d-model",
    support: ["core"],
    help: "为 Stable Image Core 添加预设视觉风格。",
    options: [
      { name: Locale.SdPanel.Styles.D3Model, value: "3d-model" },
      { name: Locale.SdPanel.Styles.AnalogFilm, value: "analog-film" },
      { name: Locale.SdPanel.Styles.Anime, value: "anime" },
      { name: Locale.SdPanel.Styles.Cinematic, value: "cinematic" },
      { name: Locale.SdPanel.Styles.ComicBook, value: "comic-book" },
      { name: Locale.SdPanel.Styles.DigitalArt, value: "digital-art" },
      { name: Locale.SdPanel.Styles.Enhance, value: "enhance" },
      { name: Locale.SdPanel.Styles.FantasyArt, value: "fantasy-art" },
      { name: Locale.SdPanel.Styles.Isometric, value: "isometric" },
      { name: Locale.SdPanel.Styles.LineArt, value: "line-art" },
      { name: Locale.SdPanel.Styles.LowPoly, value: "low-poly" },
      {
        name: Locale.SdPanel.Styles.ModelingCompound,
        value: "modeling-compound",
      },
      { name: Locale.SdPanel.Styles.NeonPunk, value: "neon-punk" },
      { name: Locale.SdPanel.Styles.Origami, value: "origami" },
      { name: Locale.SdPanel.Styles.Photographic, value: "photographic" },
      { name: Locale.SdPanel.Styles.PixelArt, value: "pixel-art" },
      { name: Locale.SdPanel.Styles.TileTexture, value: "tile-texture" },
    ],
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
    name: Locale.SdPanel.OutFormat,
    value: "output_format",
    type: "select",
    default: "png",
    help: "选择生成图片的保存格式。",
    options: [
      { name: "PNG", value: "png" },
      { name: "JPEG", value: "jpeg" },
      { name: "WebP", value: "webp" },
    ],
  },
];

const sdCommonParams = (model: string, data: any) => {
  return params.filter((item) => {
    return !(item.support && !item.support.includes(model));
  });
};

export const models = [
  {
    name: "Stable Image Ultra",
    value: "ultra",
    description: "高质量成片",
    params: (data: any) => sdCommonParams("ultra", data),
  },
  {
    name: "Stable Image Core",
    value: "core",
    description: "速度与质量均衡",
    params: (data: any) => sdCommonParams("core", data),
  },
  {
    name: "Stable Diffusion 3",
    value: "sd3",
    description: "可选 SD3 版本",
    params: (data: any) => {
      return sdCommonParams("sd3", data).filter((item) => {
        return !(
          data.model === "sd3-large-turbo" && item.value == "negative_prompt"
        );
      });
    },
  },
];

export function ControlParamItem(props: {
  title: string;
  subTitle?: string;
  help?: string;
  required?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx(styles["ctrl-param-item"], props.className)}>
      <div className={styles["ctrl-param-item-header"]}>
        <div className={styles["ctrl-param-item-title"]}>
          <div>
            {props.title}
            {props.required && <span style={{ color: "red" }}>*</span>}
          </div>
          {props.help && (
            <span className={styles["ctrl-param-help"]} title={props.help}>
              ?
            </span>
          )}
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
}) {
  return (
    <>
      {props.columns?.map((item) => {
        let element: null | JSX.Element;
        switch (item.type) {
          case "textarea":
            element = (
              <ControlParamItem
                title={item.name}
                subTitle={item.sub}
                help={item.help}
                required={item.required}
              >
                <textarea
                  rows={item.rows || 3}
                  placeholder={item.placeholder}
                  onChange={(e) => {
                    props.onChange(item.value, e.currentTarget.value);
                  }}
                  value={props.data[item.value] ?? ""}
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
              >
                <Select
                  className={styles["draw-select"]}
                  aria-label={item.name}
                  value={props.data[item.value] ?? item.default ?? ""}
                  onChange={(e) => {
                    props.onChange(item.value, e.currentTarget.value);
                  }}
                >
                  {item.options.map((opt: any) => {
                    return (
                      <option value={opt.value} key={opt.value}>
                        {opt.name}
                      </option>
                    );
                  })}
                </Select>
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
              >
                <input
                  aria-label={item.name}
                  type="number"
                  min={item.min}
                  max={item.max}
                  value={props.data[item.value] ?? item.default ?? 0}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    props.onChange(
                      item.value,
                      value === "" ? "" : parseInt(value, 10),
                    );
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
              >
                <input
                  aria-label={item.name}
                  type="text"
                  value={props.data[item.value] ?? ""}
                  onChange={(e) => {
                    props.onChange(item.value, e.currentTarget.value);
                  }}
                />
              </ControlParamItem>
            );
        }
        return <div key={item.value}>{element}</div>;
      })}
    </>
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

export const getParams = (model: any, params: any) => {
  return models.find((m) => m.value === model.value)?.params(params) || [];
};

const paramGroups = [
  {
    title: "提示词",
    fields: ["prompt", "negative_prompt"],
  },
  {
    title: "图像设置",
    fields: ["aspect_ratio", "style", "model"],
  },
  {
    title: "高级设置",
    fields: ["seed", "output_format"],
  },
];

export function SdPanel() {
  const sdStore = useSdStore();
  const currentModel = sdStore.currentModel;
  const setCurrentModel = sdStore.setCurrentModel;
  const params = sdStore.currentParams;
  const setParams = sdStore.setCurrentParams;

  const handleValueChange = (field: string, val: any) => {
    setParams({
      ...params,
      [field]: val,
    });
  };
  const handleModelChange = (model: any) => {
    setCurrentModel(model);
    setParams(getModelParamBasicData(model.params({}), params));
  };

  return (
    <div className={styles["draw-panel"]}>
      <section className={styles["draw-panel-section"]}>
        <div className={styles["draw-panel-section-title"]}>
          {Locale.SdPanel.AIModel}
        </div>
        <div className={styles["ai-models"]}>
          {models.map((item) => {
            return (
              <button
                type="button"
                key={item.value}
                className={clsx(styles["ai-model-option"], {
                  [styles["ai-model-option-active"]]:
                    currentModel.value === item.value,
                })}
                onClick={() => handleModelChange(item)}
              >
                <span className={styles["ai-model-name"]}>{item.name}</span>
                <span className={styles["ai-model-desc"]}>
                  {item.description}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {paramGroups.map((group) => {
        const columns = (getParams?.(currentModel, params) as any[]).filter(
          (item) => group.fields.includes(item.value),
        );

        if (columns.length === 0) return null;

        return (
          <section className={styles["draw-panel-section"]} key={group.title}>
            <div className={styles["draw-panel-section-title"]}>
              {group.title}
            </div>
            <ControlParam
              columns={columns}
              data={params}
              onChange={handleValueChange}
            />
          </section>
        );
      })}
    </div>
  );
}
