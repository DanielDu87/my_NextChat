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

import Locale from "../locales";

import { createRoot } from "react-dom/client";
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
import { ModelType } from "../store";

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
  children?: JSX.Element | JSX.Element[];
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

export function List(props: { children: React.ReactNode; id?: string }) {
  return (
    <div className={styles.list} id={props.id}>
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
  isSmall?: boolean;
  footer?: React.ReactNode;
  onClose?: () => void;
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
          <div
            className={styles["modal-header-action"]}
            onClick={() => setMax(!isMax)}
          >
            {isMax ? <MinIcon /> : <MaxIcon />}
          </div>
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
  const [visible, setVisible] = useState(false);
  function changeVisibility() {
    setVisible(!visible);
  }

  return (
    <div className={"password-input-container"}>
      <IconButton
        aria={props.aria}
        icon={visible ? <EyeIcon /> : <EyeOffIcon />}
        onClick={changeVisibility}
        className={"password-eye"}
      />
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={"password-input"}
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
  items: Array<{
    title: string;
    subTitle?: string;
    value: T;
    disable?: boolean;
    group?: string;
    order?: number;
    rightAction?: {
      text: string;
      onClick: (value: T) => void;
    };
    meta?: {
      type?: string;
      types?: string[];
      features?: string[];
      capabilities?: string[];
      vendorName?: string;
    };
  }>;
  defaultSelectedValue?: T[] | T;
  onSelection?: (selection: T[]) => void;
  onClose?: () => void;
  multiple?: boolean;
  showSearch?: boolean;
  showGroupFilter?: boolean;
  quickFilters?: Array<{
    key: string;
    label: string;
    match: (item: {
      title: string;
      subTitle?: string;
      value: T;
      disable?: boolean;
      group?: string;
      order?: number;
      rightAction?: {
        text: string;
        onClick: (value: T) => void;
      };
      meta?: {
        type?: string;
        types?: string[];
        features?: string[];
        capabilities?: string[];
        vendorName?: string;
      };
    }) => boolean;
  }>;
  extraGroups?: string[];
  defaultGroup?: string;
  title?: React.ReactNode;
  headerHint?: React.ReactNode;
  footer?:
    | React.ReactNode
    | ((ctx: { selectedGroup: string }) => React.ReactNode);
  centerContent?: boolean;
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
  const groupFilterButtonRef = useRef<HTMLButtonElement>(null);
  const initialViewportScrollYRef = useRef(0);

  useEffect(() => {
    initialViewportScrollYRef.current = window.scrollY;
  }, []);

  const preferredGroupOrder = [
    "OpenAI",
    "DeepSeek",
    "Google",
    "Anthropic",
    "xAI",
    "ByteDance",
    "Qwen",
    "Moonshot",
    "Tencent",
    "Zhipu",
    "Minimax",
    "Microsoft",
    "Other",
  ];

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

    return [
      ...preferredGroupOrder.filter((group) => mergedGroups.includes(group)),
      ...mergedGroups.filter((group) => !preferredGroupOrder.includes(group)),
    ];
  })();
  const groupFilterOptions = ["All", ...availableGroups];
  const getGroupFilterLabel = (group: string) =>
    group === "All" ? "全部模型商" : group;
  const localGroupIconMap: Record<string, string> = {
    aihubmix: "/provider-icons/aihubmix.ico",
    cohere: "/provider-icons/cohere.ico",
    microsoft: "/provider-icons/microsoft.ico",
    minimax: "/provider-icons/minimax.ico",
    perplexity: "/provider-icons/perplexity.ico",
    stability: "/provider-icons/stability.webp",
    xiaomi: "/provider-icons/xiaomi.svg",
    alibaba: "/provider-icons/alibaba.svg",
    iflytek: "/provider-icons/iflytek.svg",
    "01.ai": "/provider-icons/lingyi.svg",
    stepfun: "/provider-icons/stepfun.svg",
  };
  const currentSelectedItem = props.items.find((item) =>
    selectedValues.includes(item.value),
  );
  const getCustomModelProvider = () => {
    const selectedValue = currentSelectedItem?.value;
    if (typeof selectedValue === "string") {
      const [, providerName] = selectedValue.split("@");
      if (providerName) return providerName.toLowerCase();
    }
    return "openai";
  };
  const iconBackedGroups = new Set([
    "openai",
    "google",
    "anthropic",
    "deepseek",
    "meta",
    "mistral",
    "moonshot",
    "tencent",
    "zhipu",
    "qwen",
    "baidu",
    "grok",
    "xai",
    "bytedance",
  ]);
  const getGroupBadgeText = (group: string) => {
    if (group === "自定义模型") return "自";
    if (/^[\u4e00-\u9fa5]/.test(group)) return group.slice(0, 2);
    const compact = group.replace(/[^a-zA-Z0-9]/g, "");
    return compact.slice(0, 1).toUpperCase() || group.slice(0, 1);
  };
  const renderGroupFilterIcon = (group: string) => {
    if (group === "All") return null;
    if (group === "自定义模型") {
      return <Avatar model={getCustomModelProvider() as ModelType} />;
    }
    if (group === "Other") {
      return <Avatar model={"openai" as ModelType} />;
    }
    const normalized = group.toLowerCase();
    const localIcon = localGroupIconMap[normalized];
    if (localIcon) {
      return (
        <img
          className={styles["selector-group-filter-icon-image"]}
          src={localIcon}
          alt={`${group} icon`}
        />
      );
    }
    if (iconBackedGroups.has(normalized)) {
      return <Avatar model={normalized as ModelType} />;
    }
    return (
      <span className={styles["selector-group-filter-fallback-icon"]}>
        {getGroupBadgeText(group)}
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

    const publishedModelSeries: Record<
      string,
      Array<{ pattern: RegExp; publishedAt: number }>
    > = {
      OpenAI: [
        { pattern: /\bgpt-5\b/i, publishedAt: 20250807 },
        { pattern: /\bgpt-4\.1\b/i, publishedAt: 20250414 },
        { pattern: /\bo4-mini\b/i, publishedAt: 20250416 },
        { pattern: /\bo3\b/i, publishedAt: 20250416 },
        { pattern: /\bgpt-4o\b/i, publishedAt: 20240513 },
        { pattern: /\bgpt-4o-mini\b/i, publishedAt: 20240718 },
        { pattern: /\bo1\b/i, publishedAt: 20240912 },
      ],
      Google: [
        { pattern: /\bgemini-3(?:$|[^.\d])/i, publishedAt: 20251118 },
        { pattern: /\bgemini-3-(?:pro|flash)\b/i, publishedAt: 20251118 },
        { pattern: /\bgemini-2\.5-flash-image\b/i, publishedAt: 20251002 },
        { pattern: /\bgemini-2\.5-flash-lite\b/i, publishedAt: 20250722 },
        {
          pattern: /\bgemini-2\.5-pro-preview-05-06\b/i,
          publishedAt: 20250506,
        },
        {
          pattern: /\bgemini-2\.5-pro-preview-03-25\b/i,
          publishedAt: 20250325,
        },
        { pattern: /\bgemini-2\.5-pro\b/i, publishedAt: 20250617 },
        {
          pattern: /\bgemini-2\.5-flash-preview-04-17\b/i,
          publishedAt: 20250417,
        },
        { pattern: /\bgemini-2\.5-flash\b/i, publishedAt: 20250617 },
        { pattern: /\bgemini-2\.0-flash-lite\b/i, publishedAt: 20250225 },
        { pattern: /\bgemini-2\.0-flash\b/i, publishedAt: 20250205 },
        { pattern: /\bgemini-1\.5-pro\b/i, publishedAt: 20240215 },
        { pattern: /\bgemini-1\.5-flash\b/i, publishedAt: 20240514 },
      ],
      Anthropic: [
        { pattern: /\bclaude-sonnet-4\b/i, publishedAt: 20250522 },
        { pattern: /\bclaude-opus-4\b/i, publishedAt: 20250522 },
        { pattern: /\bclaude-3\.7-sonnet\b/i, publishedAt: 20250224 },
        { pattern: /\bclaude-3\.5-sonnet\b/i, publishedAt: 20240620 },
        { pattern: /\bclaude-3\.5-haiku\b/i, publishedAt: 20241022 },
      ],
      Grok: [
        { pattern: /\bgrok-3\b/i, publishedAt: 20250217 },
        { pattern: /\bgrok-2\b/i, publishedAt: 20240813 },
      ],
      DeepSeek: [
        { pattern: /\bdeepseek-v3\.2-exp\b/i, publishedAt: 20250929 },
        { pattern: /\bdeepseek-v3\.2\b/i, publishedAt: 20251201 },
        { pattern: /\bdeepseek-v3\.1-terminus\b/i, publishedAt: 20250922 },
        { pattern: /\bdeepseek-v3\.1\b/i, publishedAt: 20250821 },
        { pattern: /\bdeepseek-r1-0528\b/i, publishedAt: 20250528 },
        { pattern: /\bdeepseek-v3-0324\b/i, publishedAt: 20250324 },
        { pattern: /\bdeepseek-r1\b/i, publishedAt: 20250120 },
        { pattern: /\bdeepseek-v3\b/i, publishedAt: 20241226 },
        { pattern: /\bdeepseek-reasoner\b/i, publishedAt: 20250528 },
        { pattern: /\bdeepseek-chat\b/i, publishedAt: 20250821 },
      ],
      ByteDance: [
        { pattern: /\bdoubao-1\.5\b/i, publishedAt: 20250122 },
        { pattern: /\bseed-oss\b/i, publishedAt: 20250115 },
        { pattern: /\bdoubao\b/i, publishedAt: 20240515 },
      ],
      Qwen: [
        { pattern: /\bqwen3\b/i, publishedAt: 20250429 },
        { pattern: /\bqwq-32b\b/i, publishedAt: 20250306 },
        { pattern: /\bqwen2\.5\b/i, publishedAt: 20240919 },
        { pattern: /\bqwen2\b/i, publishedAt: 20240607 },
      ],
      Moonshot: [
        { pattern: /\bkimi-k2\b/i, publishedAt: 20250711 },
        { pattern: /\bkimi\b/i, publishedAt: 20240318 },
        { pattern: /\bmoonshot\b/i, publishedAt: 20240318 },
      ],
      Baidu: [
        { pattern: /\bernie-4\.5\b/i, publishedAt: 20250316 },
        { pattern: /\bernie-4\.0\b/i, publishedAt: 20231017 },
        { pattern: /\bernie\b/i, publishedAt: 20231017 },
      ],
    };

    const getPublishedAt = (groupKey: string, title: string) => {
      const rules = publishedModelSeries[groupKey];
      if (!rules) return 0;
      const matched = rules.find((rule) => rule.pattern.test(title));
      return matched?.publishedAt ?? 0;
    };

    const getEffectivePublishedAt = (groupKey: string, title: string) => {
      const curatedPublishedAt = getPublishedAt(groupKey, title);
      if (curatedPublishedAt > 0) {
        return curatedPublishedAt;
      }

      const normalized = title.toLowerCase();
      const releaseDateMatch = normalized.match(
        /20\d{2}[-_.]?(0[1-9]|1[0-2])[-_.]?([0-2]\d|3[01])/,
      );
      return releaseDateMatch
        ? Number(releaseDateMatch[0].replace(/[-_.]/g, ""))
        : 0;
    };

    const getSortTokens = (text: string) => {
      const normalized = text.toLowerCase();
      const dateMatch = normalized.match(
        /20\d{2}[-_.]?(0[1-9]|1[0-2])[-_.]?([0-2]\d|3[01])/,
      );
      const versionMatches = Array.from(
        normalized.matchAll(/\d+(?:\.\d+)+|\d{2,4}/g),
      ).map((match) => match[0]);
      const previewBoost =
        normalized.includes("latest") ||
        normalized.includes("preview") ||
        normalized.includes("pro") ||
        normalized.includes("sonnet") ||
        normalized.includes("opus")
          ? 1
          : 0;

      return {
        date: dateMatch ? Number(dateMatch[0].replace(/[-_.]/g, "")) : 0,
        versions: versionMatches.map((value) =>
          value.split(".").map((part) => Number(part)),
        ),
        previewBoost,
        normalized,
      };
    };

    const compareVersionLists = (left: number[][], right: number[][]) => {
      const maxLength = Math.max(left.length, right.length);
      for (let i = 0; i < maxLength; i += 1) {
        const leftParts = left[i] ?? [];
        const rightParts = right[i] ?? [];
        const maxParts = Math.max(leftParts.length, rightParts.length);
        for (let j = 0; j < maxParts; j += 1) {
          const diff = (rightParts[j] ?? -1) - (leftParts[j] ?? -1);
          if (diff !== 0) return diff;
        }
      }
      return 0;
    };

    const getPrimaryVersion = (versions: number[][]) => {
      if (versions.length === 0) return [];

      const semanticVersions = versions.filter((parts) => parts.length > 1);
      const candidates =
        semanticVersions.length > 0 ? semanticVersions : versions;

      return candidates.reduce((best, current) => {
        const maxParts = Math.max(best.length, current.length);
        for (let i = 0; i < maxParts; i += 1) {
          const diff = (current[i] ?? -1) - (best[i] ?? -1);
          if (diff > 0) return current;
          if (diff < 0) return best;
        }
        return best;
      }, candidates[0]);
    };

    const comparePrimaryVersion = (left: number[], right: number[]) => {
      const maxLength = Math.max(left.length, right.length);
      for (let i = 0; i < maxLength; i += 1) {
        const diff = (right[i] ?? -1) - (left[i] ?? -1);
        if (diff !== 0) return diff;
      }
      return 0;
    };

    const sortedGroupOrder = [
      ...availableGroups.filter((groupKey) => buckets.has(groupKey)),
      ...groupOrder.filter((groupKey) => !availableGroups.includes(groupKey)),
    ];

    sortedGroupOrder.forEach((groupKey) => {
      const items = (buckets.get(groupKey) ?? []).slice().sort((a, b) => {
        const left = getSortTokens(a.title);
        const right = getSortTokens(b.title);
        const leftPublishedAt = getEffectivePublishedAt(groupKey, a.title);
        const rightPublishedAt = getEffectivePublishedAt(groupKey, b.title);
        const primaryVersionDiff = comparePrimaryVersion(
          getPrimaryVersion(left.versions),
          getPrimaryVersion(right.versions),
        );

        // 优先尊重上游/API 原始顺序，很多供应商本身就是按最新在前返回的。
        const leftOrder = a.order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = b.order ?? Number.MAX_SAFE_INTEGER;
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }

        // API 顺序不足以区分时，再按已知/可解析发布时间兜底。
        if (leftPublishedAt > 0 || rightPublishedAt > 0) {
          const publishedDiff = rightPublishedAt - leftPublishedAt;
          if (publishedDiff !== 0) {
            return publishedDiff;
          }
        }

        if (primaryVersionDiff !== 0) {
          return primaryVersionDiff;
        }

        if (right.date !== left.date) {
          return right.date - left.date;
        }

        const versionDiff = compareVersionLists(left.versions, right.versions);
        if (versionDiff !== 0) {
          return versionDiff;
        }

        if (right.previewBoost !== left.previewBoost) {
          return right.previewBoost - left.previewBoost;
        }

        return a.title.localeCompare(b.title, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
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

  console.log(
    "[Selector] items:",
    props.items.length,
    "filtered:",
    filteredItems.length,
    "searchText:",
    searchText,
  );

  return (
    <div className={styles["selector"]} onClick={() => props.onClose?.()}>
      <div
        className={clsx(styles["selector-content"], {
          [styles["selector-content-centered"]]: props.centerContent,
        })}
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
          <div className={styles["selector-group-filter-wrap"]}>
            <button
              type="button"
              ref={groupFilterButtonRef}
              className={clsx(styles["selector-group-filter"], {
                [styles["selector-group-filter-open"]]: isGroupFilterOpen,
              })}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setIsGroupFilterOpen((prev) => !prev)}
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
                        setIsGroupFilterOpen(false);
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
          <div className={styles["selector-search-wrap"]}>
            <input
              type="text"
              className={styles["selector-search"]}
              placeholder="搜索模型..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
        )}
        {props.quickFilters &&
          props.quickFilters.length > 0 &&
          !isGroupFilterOpen && (
            <div className={styles["selector-quick-filters"]}>
              <button
                type="button"
                className={clsx(styles["selector-quick-filter"], {
                  [styles["selector-quick-filter-active"]]:
                    selectedQuickFilter === "all",
                })}
                onClick={() => setSelectedQuickFilter("all")}
              >
                全部
              </button>
              {props.quickFilters.map((filter) => (
                <button
                  type="button"
                  key={filter.key}
                  className={clsx(styles["selector-quick-filter"], {
                    [styles["selector-quick-filter-active"]]:
                      selectedQuickFilter === filter.key,
                  })}
                  onClick={() => setSelectedQuickFilter(filter.key)}
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
          <List id="selector-list">
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
                  })}
                  key={entry.key}
                  title={item.title}
                  subTitle={item.subTitle}
                  icon={<Avatar model={(item.group || item.value) as string} />}
                  onClick={(e) => {
                    if (item.disable) {
                      e.stopPropagation();
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
