/* eslint-disable @next/next/no-img-element */
import styles from "./ui-lib.module.scss";
import LoadingIcon from "../icons/three-dots.svg";
import CloseIcon from "../icons/close.svg";
import EyeIcon from "../icons/eye.svg";
import EyeOffIcon from "../icons/eye-off.svg";
import DownIcon from "../icons/down.svg";
import ConfirmIcon from "../icons/confirm.svg";
import CancelIcon from "../icons/cancel.svg";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";
import BotIconOpenAI from "../icons/llm-icons/openai.svg";

import Locale from "../locales";
import { PROVIDER_ICONS } from "../config/provider-icons";

import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import React, {
  CSSProperties,
  HTMLProps,
  MouseEvent,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { IconButton } from "./button";
import { Avatar } from "./emoji";
import clsx from "clsx";
import { comparePublishedAt } from "../utils/model-published-at";

type SelectorItemMeta = {
  category?: string;
  categorySource?: 0 | 1;
  type?: string;
  types?: string[];
  features?: string[];
  capabilities?: string[];
  categories?: string[];
  vendorName?: string;
};

type SelectorItemBase<T> = {
  title: string;
  subTitle?: string;
  value: T;
  disable?: boolean;
  group?: string;
  order?: number;
  publishedAt?: number;
  sortKey?: string;
  rightAction?: {
    text: string;
    onClick: (value: T) => void;
  };
  meta?: SelectorItemMeta;
};

export function compareSelectorItems<T>(
  left: SelectorItemBase<T>,
  right: SelectorItemBase<T>,
) {
  const normalizedText = (item: SelectorItemBase<T>) =>
    [item.sortKey, item.title, String(item.value)].join(" ").toLowerCase();
  const isAihubMixGroup = (item: SelectorItemBase<T>) =>
    String(item.group || "")
      .trim()
      .toLowerCase() === "aihubmix";
  const isAihubMixRouter = (item: SelectorItemBase<T>) =>
    normalizedText(item).includes("aihubmix-router");
  const isOpenAIGroup = (item: SelectorItemBase<T>) =>
    ["openai", "gpt"].includes(
      String(item.group || "")
        .trim()
        .toLowerCase(),
    );
  const isDeprioritizedOpenAIModel = (item: SelectorItemBase<T>) =>
    ["gpt-audio-1.5", "gpt-audio-mini", "gpt-audio", "gpt-5.4-pro"].some(
      (name) => normalizedText(item).includes(name),
    );

  if (isAihubMixGroup(left) && isAihubMixGroup(right)) {
    const leftIsRouter = isAihubMixRouter(left);
    const rightIsRouter = isAihubMixRouter(right);

    if (leftIsRouter !== rightIsRouter) {
      return leftIsRouter ? -1 : 1;
    }
  }

  if (isOpenAIGroup(left) && isOpenAIGroup(right)) {
    const leftIsDeprioritized = isDeprioritizedOpenAIModel(left);
    const rightIsDeprioritized = isDeprioritizedOpenAIModel(right);

    if (leftIsDeprioritized !== rightIsDeprioritized) {
      return leftIsDeprioritized ? 1 : -1;
    }
  }

  return comparePublishedAt(
    {
      name: left.sortKey || left.title,
      publishedAt: left.publishedAt,
      order: left.order,
    },
    {
      name: right.sortKey || right.title,
      publishedAt: right.publishedAt,
      order: right.order,
    },
  );
}

export function Popover(props: {
  children: JSX.Element;
  content: JSX.Element;
  open?: boolean;
  onClose?: () => void;
}) {
  return (
    <div className={styles.popover}>
      {props.children}
      {props.open && (
        <div className={styles["popover-mask"]} onClick={props.onClose}></div>
      )}
      {props.open && (
        <div className={styles["popover-content"]}>{props.content}</div>
      )}
    </div>
  );
}

export function Card(props: { children: JSX.Element[]; className?: string }) {
  return (
    <div className={clsx(styles.card, props.className)}>{props.children}</div>
  );
}

export function ListItem(props: {
  title?: string | JSX.Element;
  subTitle?: string | JSX.Element;
  children?: JSX.Element | JSX.Element[] | null | undefined;
  icon?: JSX.Element;
  className?: string;
  onClick?: (e: MouseEvent) => void;
  vertical?: boolean;
}) {
  return (
    <div
      className={clsx(
        styles["list-item"],
        {
          [styles["vertical"]]: props.vertical,
        },
        props.className,
      )}
      onClick={props.onClick}
    >
      <div className={styles["list-header"]}>
        {props.icon && <div className={styles["list-icon"]}>{props.icon}</div>}
        <div className={styles["list-item-title"]}>
          <div>{props.title}</div>
          {props.subTitle && (
            <div className={styles["list-item-sub-title"]}>
              {props.subTitle}
            </div>
          )}
        </div>
      </div>
      {props.children}
    </div>
  );
}

export function List(props: {
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={clsx(styles.list, props.className)} id={props.id}>
      {props.children}
    </div>
  );
}

export function Loading() {
  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <LoadingIcon />
    </div>
  );
}

interface ModalProps {
  title: string;
  children?: any;
  actions?: React.ReactNode[];
  defaultMax?: boolean;
  hideMaxToggle?: boolean;
  isSmall?: boolean;
  footer?: React.ReactNode;
  onClose?: () => void;
  className?: string;
}
export function Modal(props: ModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        props.onClose?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isMax, setMax] = useState(!!props.defaultMax);

  return (
    <div
      className={clsx(
        styles["modal-container"],
        {
          [styles["modal-container-max"]]: isMax,
          [styles["modal-container-small"]]: props.isSmall,
        },
        props.className,
      )}
    >
      <div className={styles["modal-header"]}>
        <div className={styles["modal-title"]}>{props.title}</div>

        <div className={styles["modal-header-actions"]}>
          {!props.hideMaxToggle && (
            <div
              className={styles["modal-header-action"]}
              onClick={() => setMax(!isMax)}
            >
              {isMax ? <MinIcon /> : <MaxIcon />}
            </div>
          )}
          <div
            className={styles["modal-header-action"]}
            onClick={props.onClose}
          >
            <CloseIcon />
          </div>
        </div>
      </div>

      <div className={styles["modal-content"]}>{props.children}</div>

      <div className={styles["modal-footer"]}>
        {props.footer}
        <div className={styles["modal-actions"]}>
          {props.actions?.map((action, i) => (
            <div key={i} className={styles["modal-action"]}>
              {action}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function showModal(props: ModalProps) {
  const div = document.createElement("div");
  div.className = "modal-mask";
  document.body.appendChild(div);

  const root = createRoot(div);
  const closeModal = () => {
    props.onClose?.();
    root.unmount();
    div.remove();
  };

  div.onclick = (e) => {
    if (e.target === div) {
      closeModal();
    }
  };

  root.render(<Modal {...props} onClose={closeModal}></Modal>);
}

export type ToastProps = {
  content: string;
  action?: {
    text: string;
    onClick: () => void;
  };
  onClose?: () => void;
};

export function Toast(props: ToastProps) {
  return (
    <div className={styles["toast-container"]}>
      <div className={styles["toast-content"]}>
        <span>{props.content}</span>
        {props.action && (
          <button
            onClick={() => {
              props.action?.onClick?.();
              props.onClose?.();
            }}
            className={styles["toast-action"]}
          >
            {props.action.text}
          </button>
        )}
      </div>
    </div>
  );
}

export function showToast(
  content: string,
  action?: ToastProps["action"],
  delay = 3000,
) {
  const div = document.createElement("div");
  div.className = styles.show;
  document.body.appendChild(div);

  const root = createRoot(div);
  const close = () => {
    div.classList.add(styles.hide);

    setTimeout(() => {
      root.unmount();
      div.remove();
    }, 300);
  };

  setTimeout(() => {
    close();
  }, delay);

  root.render(<Toast content={content} action={action} onClose={close} />);
}

export type InputProps = React.HTMLProps<HTMLTextAreaElement> & {
  autoHeight?: boolean;
  rows?: number;
};

export function Input(props: InputProps) {
  return (
    <textarea
      {...props}
      className={clsx(styles["input"], props.className)}
    ></textarea>
  );
}

export function PasswordInput(
  props: HTMLProps<HTMLInputElement> & { aria?: string },
) {
  const { aria, className, ...inputProps } = props;
  const [visible, setVisible] = useState(false);
  function changeVisibility() {
    setVisible(!visible);
  }

  return (
    <div className={"password-input-container"}>
      <IconButton
        aria={aria}
        icon={visible ? <EyeIcon /> : <EyeOffIcon />}
        onClick={changeVisibility}
        className={"password-eye"}
      />
      <input
        {...inputProps}
        type={visible ? "text" : "password"}
        className={clsx("password-input", className)}
      />
    </div>
  );
}

export function Select(
  props: React.DetailedHTMLProps<
    React.SelectHTMLAttributes<HTMLSelectElement> & {
      align?: "left" | "center";
    },
    HTMLSelectElement
  >,
) {
  const { className, children, align, ...otherProps } = props;
  return (
    <div
      className={clsx(
        styles["select-with-icon"],
        {
          [styles["left-align-option"]]: align === "left",
        },
        className,
      )}
    >
      <select className={styles["select-with-icon-select"]} {...otherProps}>
        {children}
      </select>
      <DownIcon className={styles["select-with-icon-icon"]} />
    </div>
  );
}

export function showConfirm(content: any) {
  const div = document.createElement("div");
  div.className = "modal-mask modal-mask-small";
  document.body.appendChild(div);

  const root = createRoot(div);
  const closeModal = () => {
    root.unmount();
    div.remove();
  };

  return new Promise<boolean>((resolve) => {
    root.render(
      <Modal
        title={Locale.UI.Confirm}
        isSmall={true}
        actions={[
          <IconButton
            key="cancel"
            text={Locale.UI.Cancel}
            onClick={() => {
              resolve(false);
              closeModal();
            }}
            icon={<CancelIcon />}
            tabIndex={0}
            bordered
            shadow
          ></IconButton>,
          <IconButton
            key="confirm"
            text={Locale.UI.Confirm}
            type="primary"
            onClick={() => {
              resolve(true);
              closeModal();
            }}
            icon={<ConfirmIcon />}
            tabIndex={0}
            autoFocus
            bordered
            shadow
          ></IconButton>,
        ]}
        onClose={closeModal}
      >
        {content}
      </Modal>,
    );
  });
}

function PromptInput(props: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  submitOnEnter?: boolean;
  onSubmit?: (value: string) => void;
}) {
  const [input, setInput] = useState(props.value);
  const onInput = (value: string) => {
    props.onChange(value);
    setInput(value);
  };

  return (
    <textarea
      className={styles["modal-input"]}
      autoFocus
      value={input}
      onInput={(e) => onInput(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (
          props.submitOnEnter &&
          e.key === "Enter" &&
          !e.shiftKey &&
          !e.nativeEvent.isComposing
        ) {
          e.preventDefault();
          props.onSubmit?.(input);
        }
      }}
      rows={props.rows ?? 3}
    ></textarea>
  );
}

export function showPrompt(
  content: any,
  value = "",
  rows = 3,
  options?: {
    isSmall?: boolean;
    submitOnEnter?: boolean;
  },
) {
  const div = document.createElement("div");
  div.className = "modal-mask";
  document.body.appendChild(div);

  const root = createRoot(div);
  const closeModal = () => {
    root.unmount();
    div.remove();
  };

  return new Promise<string>((resolve) => {
    let userInput = value;

    root.render(
      <Modal
        title={content}
        isSmall={options?.isSmall}
        actions={[
          <IconButton
            key="cancel"
            text={Locale.UI.Cancel}
            onClick={() => {
              closeModal();
            }}
            icon={<CancelIcon />}
            bordered
            shadow
            tabIndex={0}
          ></IconButton>,
          <IconButton
            key="confirm"
            text={Locale.UI.Confirm}
            type="primary"
            onClick={() => {
              resolve(userInput);
              closeModal();
            }}
            icon={<ConfirmIcon />}
            bordered
            shadow
            tabIndex={0}
          ></IconButton>,
        ]}
        onClose={closeModal}
      >
        <PromptInput
          onChange={(val) => (userInput = val)}
          value={value}
          rows={rows}
          submitOnEnter={options?.submitOnEnter}
          onSubmit={(value) => {
            resolve(value);
            closeModal();
          }}
        ></PromptInput>
      </Modal>,
    );
  });
}

export function showImageModal(
  img: string,
  defaultMax?: boolean,
  style?: CSSProperties,
  boxStyle?: CSSProperties,
) {
  showModal({
    title: Locale.Export.Image.Modal,
    defaultMax: defaultMax,
    children: (
      <div style={{ display: "flex", justifyContent: "center", ...boxStyle }}>
        <img
          src={img}
          alt="preview"
          style={
            style ?? {
              maxWidth: "100%",
            }
          }
        ></img>
      </div>
    ),
  });
}

export function Selector<T>(props: {
  items: Array<SelectorItemBase<T>>;
  defaultSelectedValue?: T[] | T;
  onSelection?: (selection: T[]) => void;
  onClose?: () => void;
  multiple?: boolean;
  showSearch?: boolean;
  showGroupFilter?: boolean;
  quickFilters?: Array<{
    key: string;
    label: string;
    match: (item: SelectorItemBase<T>) => boolean;
  }>;
  extraGroups?: string[];
  defaultGroup?: string;
  title?: React.ReactNode;
  className?: string;
  dataAutoModelEnabled?: boolean;
  headerHint?: React.ReactNode;
  filterControlsDisabled?: boolean;
  onFilterControlsDisabledClick?: () => void;
  groupFilterDisabled?: boolean;
  onGroupFilterDisabledClick?: () => void;
  footer?:
    | React.ReactNode
    | ((ctx: { selectedGroup: string }) => React.ReactNode);
  centerContent?: boolean;
  resetKey?: number | string;
  onDisabledItemClick?: () => void;
  groupFilterAction?:
    | React.ReactNode
    | ((ctx: {
        buttonClassName: string;
        menuClassName: string;
        optionClassName: string;
        optionActiveClassName: string;
        optionLeadingClassName: string;
        iconFrameClassName: string;
        iconImageClassName: string;
      }) => React.ReactNode);
}) {
  const [selectedValues, setSelectedValues] = useState<T[]>(
    Array.isArray(props.defaultSelectedValue)
      ? props.defaultSelectedValue
      : props.defaultSelectedValue !== undefined
      ? [props.defaultSelectedValue]
      : [],
  );
  const [searchText, setSearchText] = useState("");
  const [selectedGroup, setSelectedGroup] = useState(
    props.defaultGroup ?? "All",
  );
  const [selectedQuickFilter, setSelectedQuickFilter] = useState("all");
  const [isGroupFilterOpen, setIsGroupFilterOpen] = useState(false);
  const groupFilterWrapRef = useRef<HTMLDivElement>(null);
  const groupFilterButtonRef = useRef<HTMLButtonElement>(null);
  const initialViewportScrollYRef = useRef(0);
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    initialViewportScrollYRef.current = window.scrollY;
  }, []);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    setIsGroupFilterOpen(false);
  }, [props.resetKey]);

  // 常用供应商优先顺序（来自 model-config.tsx）
  // 其余按照 aihubmix API 的 developer_id 分类顺序
  const preferredGroupOrder = [
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
    "Other",
  ];
  const normalizeGroupForOrder = (group: string) => {
    switch (group) {
      case "GPT":
        return "OpenAI";
      case "Claude":
        return "Anthropic";
      case "Gemini":
        return "Google";
      case "Grok":
        return "xAI";
      case "千问":
      case "Qwen":
      case "阿里巴巴":
        return "Alibaba";
      case "豆包":
      case "字节跳动":
        return "ByteDance";
      case "智谱":
        return "Zhipu";
      case "万物":
        return "01.AI";
      case "Kimi":
        return "Moonshot";
      case "海螺":
        return "Minimax";
      case "混元":
        return "Tencent";
      case "文心":
        return "Baidu";
      case "讯飞星火":
        return "iFlytek";
      default:
        return group;
    }
  };

  const handleSelection = (e: MouseEvent, value: T) => {
    if (props.multiple) {
      e.stopPropagation();
      const newSelectedValues = selectedValues.includes(value)
        ? selectedValues.filter((v) => v !== value)
        : [...selectedValues, value];
      setSelectedValues(newSelectedValues);
      props.onSelection?.(newSelectedValues);
    } else {
      setSelectedValues([value]);
      props.onSelection?.([value]);
      props.onClose?.();
    }
  };

  const availableGroups = (() => {
    const groups = Array.from(
      new Set(props.items.map((item) => item.group?.trim()).filter(Boolean)),
    ) as string[];
    const mergedGroups = Array.from(
      new Set([...groups, ...(props.extraGroups ?? [])]),
    );

    // 按规范化名称去重，当多个原始名称规范化为同一个时，只保留第一个
    const deduplicatedGroups: string[] = [];
    const seenNormalized = new Set<string>();

    for (const group of mergedGroups) {
      const normalized = normalizeGroupForOrder(group);
      if (!seenNormalized.has(normalized)) {
        seenNormalized.add(normalized);
        deduplicatedGroups.push(group);
      }
    }

    const orderedCanonicalGroups = new Set(
      deduplicatedGroups.map((group) => normalizeGroupForOrder(group)),
    );

    return [
      ...preferredGroupOrder.flatMap((group) =>
        orderedCanonicalGroups.has(group)
          ? deduplicatedGroups.filter(
              (candidate) => normalizeGroupForOrder(candidate) === group,
            )
          : [],
      ),
      ...deduplicatedGroups.filter(
        (group) => !preferredGroupOrder.includes(normalizeGroupForOrder(group)),
      ),
    ];
  })();
  const groupFilterOptions = ["All", ...availableGroups];
  const getGroupFilterLabel = (group: string) => {
    if (group === "All") return "全部模型商";
    if (group === "AihubMix") return "AihubMix";
    if (group === "OpenAI" || group === "GPT") return "OpenAI";
    if (group === "Anthropic" || group === "Claude") return "Claude";
    if (group === "Google" || group === "Gemini") return "Gemini";
    if (group === "xAI" || group === "Grok") return "Grok";
    if (group === "Alibaba" || group === "阿里巴巴" || group === "Qwen")
      return "千问";
    if (group === "ByteDance" || group === "字节跳动") return "豆包";
    if (group === "Tencent") return "Hunyuan";
    if (group === "Baidu") return "Ernie";
    if (group === "Zhipu") return "智谱";
    if (group === "Minimax") return "Minimax";
    if (group === "Moonshot") return "Kimi";
    if (group === "01.AI") return "零一万物";
    if (group === "iFlytek") return "讯飞星火";
    return group;
  };
  // 使用统一的供应商图标配置
  const localGroupIconMap = PROVIDER_ICONS;
  const getGroupBadgeText = (group: string) => {
    if (group === "自定义模型") return "自";
    if (/^[\u4e00-\u9fa5]/.test(group)) return group.slice(0, 2);
    const compact = group.replace(/[^a-zA-Z0-9]/g, "");
    return compact.slice(0, 1).toUpperCase() || group.slice(0, 1);
  };
  const renderGroupFilterIcon = (group: string) => {
    if (group === "All") return null;
    if (group === "自定义模型") {
      return (
        <span className={styles["selector-group-filter-icon-custom-wrap"]}>
          <BotIconOpenAI
            className={clsx(
              styles["selector-group-filter-icon-image"],
              styles["selector-group-filter-icon-image-custom"],
            )}
          />
        </span>
      );
    }
    if (group === "Other") {
      return (
        <span className={styles["selector-group-filter-icon-frame"]}>
          <img
            className={styles["selector-group-filter-icon-image"]}
            src="/provider-icons/openai.png"
            alt="Other icon"
          />
        </span>
      );
    }
    const normalized = group.toLowerCase();
    const localIcon = localGroupIconMap[normalized];
    if (localIcon) {
      return (
        <span className={styles["selector-group-filter-icon-frame"]}>
          <img
            className={styles["selector-group-filter-icon-image"]}
            src={localIcon}
            alt={`${group} icon`}
          />
        </span>
      );
    }
    return (
      <span className={styles["selector-group-filter-icon-frame"]}>
        <span className={styles["selector-group-filter-fallback-icon"]}>
          {getGroupBadgeText(group)}
        </span>
      </span>
    );
  };
  const stabilizeSelectorPosition = () => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: initialViewportScrollYRef.current });
      document.getElementById("selector-list")?.scrollTo({ top: 0 });
      groupFilterButtonRef.current?.focus({ preventScroll: true });
    });
  };

  const filteredItems = props.items.filter((item) => {
    const quickFilter = props.quickFilters?.find(
      (filter) => filter.key === selectedQuickFilter,
    );
    const matchGroup =
      !props.showGroupFilter ||
      selectedGroup === "All" ||
      (item.group?.trim() || "__default__") === selectedGroup;
    const matchQuickFilter = !quickFilter || quickFilter.match(item);
    const matchSearch =
      !searchText.trim() ||
      item.title.toLowerCase().includes(searchText.toLowerCase());
    return matchGroup && matchQuickFilter && matchSearch;
  });

  const groupedItems = (() => {
    const buckets = new Map<string, typeof filteredItems>();
    const groupOrder: string[] = [];
    const entries: Array<
      | { type: "group"; key: string; label: string; count: number }
      | {
          type: "item";
          key: string;
          item: (typeof filteredItems)[number];
        }
    > = [];

    filteredItems.forEach((item) => {
      const groupKey = item.group?.trim() || "__default__";
      if (!buckets.has(groupKey)) {
        buckets.set(groupKey, []);
        groupOrder.push(groupKey);
      }
      buckets.get(groupKey)!.push(item);
    });

    const sortedGroupOrder = [
      ...availableGroups.filter((groupKey) => buckets.has(groupKey)),
      ...groupOrder.filter((groupKey) => !availableGroups.includes(groupKey)),
    ];

    sortedGroupOrder.forEach((groupKey) => {
      const items = (buckets.get(groupKey) ?? [])
        .slice()
        .sort(compareSelectorItems);
      const groupLabel = groupKey === "__default__" ? "" : groupKey;

      if (groupLabel) {
        entries.push({
          type: "group",
          key: groupKey,
          label: groupLabel,
          count: items.length,
        });
      }

      items.forEach((item, index) => {
        entries.push({
          type: "item",
          key: `${groupKey}-${String(item.value)}-${index}`,
          item,
        });
      });
    });

    return entries;
  })();

  const selectorNode = (
    <div
      className={clsx(styles["selector"], props.className)}
      data-selector-container="true"
      data-auto-model-enabled={props.dataAutoModelEnabled ? "true" : undefined}
      onClick={() => props.onClose?.()}
    >
      <div
        className={clsx(styles["selector-content"], {
          [styles["selector-content-centered"]]: props.centerContent,
        })}
        data-selector-content="true"
        onClick={(e) => e.stopPropagation()}
      >
        {props.title ? (
          <div className={styles["selector-title"]}>{props.title}</div>
        ) : null}
        {props.headerHint ? (
          <div className={styles["selector-header-hint"]}>
            {props.headerHint}
          </div>
        ) : null}
        {props.showGroupFilter && (
          <div
            ref={groupFilterWrapRef}
            data-selector-group-filter-root="true"
            className={styles["selector-group-filter-wrap"]}
          >
            {props.groupFilterAction ? (
              <div className={styles["selector-group-filter-extra"]}>
                {typeof props.groupFilterAction === "function"
                  ? props.groupFilterAction({
                      buttonClassName: styles["selector-group-filter"],
                      menuClassName: styles["selector-group-filter-menu"],
                      optionClassName: styles["selector-group-filter-option"],
                      optionActiveClassName:
                        styles["selector-group-filter-option-active"],
                      optionLeadingClassName:
                        styles["selector-group-filter-option-leading"],
                      iconFrameClassName:
                        styles["selector-group-filter-icon-frame"],
                      iconImageClassName:
                        styles["selector-group-filter-icon-image"],
                    })
                  : props.groupFilterAction}
              </div>
            ) : null}
            <button
              type="button"
              ref={groupFilterButtonRef}
              className={clsx(
                styles["selector-group-filter"],
                {
                  [styles["selector-group-filter-open"]]: isGroupFilterOpen,
                },
                (props.groupFilterDisabled || props.filterControlsDisabled) &&
                  styles["selector-control-disabled"],
              )}
              aria-disabled={
                props.groupFilterDisabled || props.filterControlsDisabled
              }
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (props.groupFilterDisabled || props.filterControlsDisabled) {
                  (
                    props.onGroupFilterDisabledClick ??
                    props.onFilterControlsDisabledClick
                  )?.();
                  return;
                }
                setIsGroupFilterOpen((prev) => !prev);
              }}
            >
              {selectedGroup !== "All" ? (
                <span className={styles["selector-group-filter-leading"]}>
                  {renderGroupFilterIcon(selectedGroup)}
                </span>
              ) : null}
              <span>{getGroupFilterLabel(selectedGroup)}</span>
              <DownIcon />
            </button>
            {isGroupFilterOpen && (
              <div className={styles["selector-group-filter-menu"]}>
                {groupFilterOptions.map((group) => {
                  const active = selectedGroup === group;
                  return (
                    <button
                      type="button"
                      key={group}
                      className={clsx(styles["selector-group-filter-option"], {
                        [styles["selector-group-filter-option-active"]]: active,
                      })}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSelectedGroup(group);
                        stabilizeSelectorPosition();
                      }}
                    >
                      {group !== "All" ? (
                        <span
                          className={
                            styles["selector-group-filter-option-leading"]
                          }
                        >
                          {renderGroupFilterIcon(group)}
                        </span>
                      ) : null}
                      <span>{getGroupFilterLabel(group)}</span>
                      {active ? <ConfirmIcon /> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {props.showSearch && !isGroupFilterOpen && (
          <div
            className={clsx(
              styles["selector-search-wrap"],
              props.filterControlsDisabled &&
                styles["selector-control-disabled"],
            )}
            onClick={() => {
              if (props.filterControlsDisabled) {
                props.onFilterControlsDisabledClick?.();
              }
            }}
          >
            <input
              type="text"
              className={styles["selector-search"]}
              placeholder="搜索模型..."
              value={searchText}
              disabled={props.filterControlsDisabled}
              onChange={(e) => {
                if (props.filterControlsDisabled) {
                  props.onFilterControlsDisabledClick?.();
                  return;
                }
                setSearchText(e.target.value);
              }}
            />
          </div>
        )}
        {props.quickFilters &&
          props.quickFilters.length > 0 &&
          !isGroupFilterOpen && (
            <div className={styles["selector-quick-filters"]}>
              <button
                type="button"
                className={clsx(
                  styles["selector-quick-filter"],
                  {
                    [styles["selector-quick-filter-active"]]:
                      selectedQuickFilter === "all",
                  },
                  props.filterControlsDisabled &&
                    styles["selector-control-disabled"],
                )}
                onClick={() => {
                  if (props.filterControlsDisabled) {
                    props.onFilterControlsDisabledClick?.();
                    return;
                  }
                  setSelectedQuickFilter("all");
                }}
              >
                全部
              </button>
              {props.quickFilters.map((filter) => (
                <button
                  type="button"
                  key={filter.key}
                  className={clsx(
                    styles["selector-quick-filter"],
                    {
                      [styles["selector-quick-filter-active"]]:
                        selectedQuickFilter === filter.key,
                    },
                    props.filterControlsDisabled &&
                      styles["selector-control-disabled"],
                  )}
                  onClick={() => {
                    if (props.filterControlsDisabled) {
                      props.onFilterControlsDisabledClick?.();
                      return;
                    }
                    setSelectedQuickFilter(filter.key);
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          )}
        {!isGroupFilterOpen && filteredItems.length === 0 ? (
          <div className={styles["selector-empty"]}>
            <div className={styles["selector-empty-icon"]}>🔍</div>
            <div className={styles["selector-empty-text"]}>
              没有找到匹配的模型
            </div>
          </div>
        ) : !isGroupFilterOpen ? (
          <List
            id="selector-list"
            className={
              props.filterControlsDisabled
                ? styles["selector-list-disabled"]
                : undefined
            }
          >
            {groupedItems.map((entry) => {
              if (entry.type === "group") {
                return (
                  <div className={styles["selector-group"]} key={entry.key}>
                    <span className={styles["selector-group-label"]}>
                      {entry.label}
                    </span>
                    <span className={styles["selector-group-count"]}>
                      共 {entry.count} 个
                    </span>
                  </div>
                );
              }

              const { item } = entry;
              const selected = selectedValues.includes(item.value);

              return (
                <ListItem
                  className={clsx(styles["selector-item"], {
                    [styles["selector-item-disabled"]]: item.disable,
                    [styles["selector-item-active"]]: selected,
                  })}
                  key={entry.key}
                  title={item.title}
                  subTitle={item.subTitle}
                  icon={<Avatar model={(item.group || item.value) as string} />}
                  onClick={(e) => {
                    if (item.disable) {
                      e.stopPropagation();
                      props.onDisabledItemClick?.();
                    } else {
                      handleSelection(e, item.value);
                    }
                  }}
                >
                  <div className={styles["selector-item-actions"]}>
                    {selected ? (
                      <div className={styles["selector-item-selected"]}>
                        <ConfirmIcon />
                      </div>
                    ) : null}
                    {item.rightAction ? (
                      <button
                        type="button"
                        className={styles["selector-item-action"]}
                        onClick={(e) => {
                          e.stopPropagation();
                          item.rightAction?.onClick(item.value);
                        }}
                      >
                        {item.rightAction.text}
                      </button>
                    ) : null}
                  </div>
                </ListItem>
              );
            })}
          </List>
        ) : null}
        {typeof props.footer === "function"
          ? props.footer({ selectedGroup })
          : props.footer}
      </div>
    </div>
  );

  if (!portalReady) {
    return null;
  }

  return createPortal(selectorNode, document.body);
}
export function FullScreen(props: any) {
  const { children, right = 10, top = 10, ...rest } = props;
  const ref = useRef<HTMLDivElement>();
  const [fullScreen, setFullScreen] = useState(false);
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      ref.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);
  useEffect(() => {
    const handleScreenChange = (e: any) => {
      if (e.target === ref.current) {
        setFullScreen(!!document.fullscreenElement);
      }
    };
    document.addEventListener("fullscreenchange", handleScreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleScreenChange);
    };
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }} {...rest}>
      <div style={{ position: "absolute", right, top }}>
        <IconButton
          icon={fullScreen ? <MinIcon /> : <MaxIcon />}
          onClick={toggleFullscreen}
          bordered
        />
      </div>
      {children}
    </div>
  );
}
