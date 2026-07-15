/* eslint-disable @next/next/no-img-element */
import styles from "./ui-lib.module.scss";
import CloseIcon from "../icons/close.svg";
import EyeIcon from "../icons/eye.svg";
import EyeOffIcon from "../icons/eye-off.svg";
import DownIcon from "../icons/down.svg";
import ConfirmIcon from "../icons/confirm.svg";
import CancelIcon from "../icons/cancel.svg";
import MaxIcon from "../icons/max.svg";
import MinIcon from "../icons/min.svg";
import BotIconDefault from "../icons/llm-icons/default.svg";

import Locale from "../locales";
import { getProviderIcon } from "../config/provider-icons";

import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import React, {
  CSSProperties,
  HTMLProps,
  MouseEvent,
  useEffect,
  useDeferredValue,
  useMemo,
  useState,
  useCallback,
  useRef,
  startTransition,
} from "react";
import { IconButton } from "./button";
import { Avatar } from "./emoji";
import { LoadingView } from "./loading-view";
import clsx from "clsx";
import { compareModelsForDisplay } from "../utils/model-published-at";
import { compareProviderDisplayNames } from "../utils/model-series-order";
import { isPerfFeatureEnabled, logPerfSummary, nowMs } from "../utils/perf";
import { getModelVendorGroupName } from "../utils/model-vendor-normalize";

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
  searchText?: string;
  group?: string;
  order?: number;
  publishedAt?: number;
  publishedAtSource?: string;
  catalogRank?: number;
  remoteRank?: number;
  remoteRankSource?: string;
  sortKey?: string;
  rightAction?: {
    text: string;
    onClick: (value: T) => void;
  };
  meta?: SelectorItemMeta;
};

const SELECTOR_PREFERRED_GROUP_ORDER = [
  "OpenAI",
  "Anthropic",
  "Google",
  "DeepSeek",
  "xAI",
  "AihubMix",
  "Alibaba",
  "ByteDance",
  "Zhipu",
  "Cohere",
  "Mistral",
  "Meta",
  "Microsoft",
  "01.AI",
  "Moonshot",
  "StepFun",
  "NVIDIA",
  "MiniMax",
  "Perplexity",
  "Baichuan",
  "Tencent",
  "Baidu",
  "Ideogram",
  "Jina AI",
  "Stability",
  "FLUX",
  "Meituan",
  "InclusionAI",
  "BAAI",
  "Xiaomi",
  "Other",
] as const;

export function getGroupFilterLabel(group: string) {
  const normalized = group.trim().toLowerCase();
  if (normalized === "__default__") return "__default__";
  if (normalized === "all") return "全部模型商";
  if (["已添加", "added"].includes(normalized)) return "Added";
  if (["自定义模型", "custom models", "custom"].includes(normalized)) {
    return "CUSTOM";
  }
  return getModelVendorGroupName(group);
}

export function compareSelectorItems<T>(
  left: SelectorItemBase<T>,
  right: SelectorItemBase<T>,
) {
  return compareModelsForDisplay(
    {
      name: left.sortKey || left.title,
      catalogRank: left.catalogRank,
      remoteRank: left.remoteRank,
      remoteRankSource: left.remoteRankSource,
      order: left.order,
    },
    {
      name: right.sortKey || right.title,
      catalogRank: right.catalogRank,
      remoteRank: right.remoteRank,
      remoteRankSource: right.remoteRankSource,
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
  onPointerMove?: React.PointerEventHandler<HTMLDivElement>;
  vertical?: boolean;
}) {
  return (
    <div
      className={clsx(
        "nextchat-list-item",
        styles["list-item"],
        {
          [styles["vertical"]]: props.vertical,
        },
        props.className,
      )}
      onClick={props.onClick}
      onPointerMove={props.onPointerMove}
    >
      <div className={clsx("nextchat-list-header", styles["list-header"])}>
        {props.icon && (
          <div className={clsx("nextchat-list-icon", styles["list-icon"])}>
            {props.icon}
          </div>
        )}
        <div
          className={clsx(
            "nextchat-list-item-title",
            styles["list-item-title"],
          )}
        >
          <div>{props.title}</div>
          {props.subTitle && (
            <div
              className={clsx(
                "nextchat-list-item-sub-title",
                styles["list-item-sub-title"],
              )}
            >
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
  style?: CSSProperties;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
  listRef?: React.Ref<HTMLDivElement>;
  stickyHeader?: React.ReactNode;
}) {
  return (
    <div
      className={clsx("nextchat-list", styles.list, props.className)}
      id={props.id}
      onScroll={props.onScroll}
      ref={props.listRef}
      style={props.style}
    >
      {props.stickyHeader}
      {props.children}
    </div>
  );
}

export function Loading() {
  return <LoadingView fullscreen />;
}

interface ModalProps {
  title: string;
  children?: any;
  actions?: React.ReactNode[];
  leftActions?: React.ReactNode[];
  defaultMax?: boolean;
  hideMaxToggle?: boolean;
  hideCloseButton?: boolean;
  isSmall?: boolean;
  footer?: React.ReactNode;
  onClose?: () => void;
  className?: string;
}
export function Modal(props: ModalProps) {
  const closeTouchHandledRef = useRef(false);

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

  return (
    <div
      className={clsx(
        styles["modal-container"],
        {
          [styles["modal-container-small"]]: props.isSmall,
        },
        props.className,
      )}
    >
      <div className={styles["modal-header"]}>
        <div className={styles["modal-title"]}>{props.title}</div>

        <div className={styles["modal-header-actions"]}>
          {!props.hideCloseButton && (
            <button
              type="button"
              aria-label={Locale.UI.Close}
              data-close-button="true"
              className="nextchat-close-button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (closeTouchHandledRef.current) {
                  closeTouchHandledRef.current = false;
                  return;
                }
                props.onClose?.();
              }}
              onTouchStart={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onTouchEnd={(event) => {
                event.preventDefault();
                event.stopPropagation();
                closeTouchHandledRef.current = true;
                props.onClose?.();
              }}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>

      <div className={clsx(styles["modal-content"], "modal-content")}>
        {props.children}
      </div>

      <div className={clsx(styles["modal-footer"], "modal-footer")}>
        {props.footer}
        {props.leftActions && props.leftActions.length > 0 && (
          <div
            className={clsx(
              styles["modal-actions"],
              styles["modal-actions-left"],
            )}
          >
            {props.leftActions.map((action, i) => (
              <div
                key={i}
                className={clsx(styles["modal-action"], "modal-footer-action")}
              >
                {action}
              </div>
            ))}
          </div>
        )}
        {props.actions && props.actions.length > 0 && (
          <div
            className={clsx(styles["modal-actions"], "modal-footer-actions")}
          >
            {props.actions.map((action, i) => (
              <div
                key={i}
                className={clsx(styles["modal-action"], "modal-footer-action")}
              >
                {action}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function showModal(props: ModalProps) {
  const div = document.createElement("div");
  div.className = "modal-mask";
  document.body.appendChild(div);

  const root = createRoot(div);
  let closed = false;
  const closeModal = () => {
    if (closed) {
      return;
    }
    closed = true;
    props.onClose?.();
    root.unmount();
    div.classList.add("modal-mask-closing");
    window.setTimeout(() => div.remove(), 280);
  };

  div.onclick = (e) => {
    if (e.target === div) {
      closeModal();
    }
  };

  root.render(<Modal {...props} onClose={closeModal}></Modal>);
  return closeModal;
}

export type ToastProps = {
  content: string;
  action?: {
    text: string;
    onClick: () => void;
  };
  onClose?: () => void;
};

type TopNoticeProps = {
  content: string;
  style?: CSSProperties;
  variant?: "default" | "error";
};

let globalTopNoticeDiv: HTMLDivElement | null = null;
let globalTopNoticeRoot: ReturnType<typeof createRoot> | null = null;
let globalTopNoticeCloseTimer: number | null = null;
let globalTopNoticeCleanupTimer: number | null = null;
let globalTopNoticeReplaceTimer: number | null = null;

export function NoticePill(props: {
  content?: React.ReactNode;
  children?: React.ReactNode;
  action?: ToastProps["action"];
  onClose?: () => void;
  variant?: "default" | "error";
}) {
  return (
    <div
      className={`${styles["notice-pill"]}${
        props.variant === "error" ? ` ${styles["notice-pill-error"]}` : ""
      }`}
    >
      <span className={styles["notice-pill-content"]}>
        {props.children ?? props.content}
      </span>
      {props.action && (
        <button
          onClick={() => {
            props.action?.onClick?.();
            props.onClose?.();
          }}
          className={styles["notice-pill-action"]}
        >
          {props.action.text}
        </button>
      )}
    </div>
  );
}

export function TopNotice(props: TopNoticeProps) {
  return (
    <div className={styles["top-notice-host"]} style={props.style}>
      <NoticePill content={props.content} variant={props.variant} />
    </div>
  );
}

export function hideTopNotice() {
  if (typeof window === "undefined") return;

  if (globalTopNoticeCloseTimer !== null) {
    window.clearTimeout(globalTopNoticeCloseTimer);
    globalTopNoticeCloseTimer = null;
  }
  if (globalTopNoticeCleanupTimer !== null) {
    window.clearTimeout(globalTopNoticeCleanupTimer);
    globalTopNoticeCleanupTimer = null;
  }
  if (globalTopNoticeReplaceTimer !== null) {
    window.clearTimeout(globalTopNoticeReplaceTimer);
    globalTopNoticeReplaceTimer = null;
  }

  if (!globalTopNoticeDiv || !globalTopNoticeRoot) return;
  globalTopNoticeRoot.render(<></>);
  globalTopNoticeDiv.className = "";
}

export function showTopNotice(content: string, delay = 2200) {
  showTopNoticeWithVariant(content, "default", delay);
}

export function showTopNoticeError(content: string, delay = 4000) {
  showTopNoticeWithVariant(content, "error", delay);
}

function showTopNoticeWithVariant(
  content: string,
  variant: "default" | "error",
  delay: number,
) {
  if (typeof document === "undefined") return;

  let hostStyle: CSSProperties | undefined;
  const anchor = document.querySelector(
    '[data-top-notice-anchor="true"]',
  ) as HTMLElement | null;
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    hostStyle = {
      left: `${Math.round(rect.left)}px`,
      width: `${Math.round(rect.width)}px`,
    };
  }

  if (!globalTopNoticeDiv) {
    globalTopNoticeDiv = document.createElement("div");
    document.body.appendChild(globalTopNoticeDiv);
    globalTopNoticeRoot = createRoot(globalTopNoticeDiv);
  }

  if (!globalTopNoticeRoot || !globalTopNoticeDiv) return;

  const shouldAnimateReplacement = Boolean(globalTopNoticeDiv.className);

  if (globalTopNoticeCloseTimer !== null) {
    window.clearTimeout(globalTopNoticeCloseTimer);
    globalTopNoticeCloseTimer = null;
  }
  if (globalTopNoticeCleanupTimer !== null) {
    window.clearTimeout(globalTopNoticeCleanupTimer);
    globalTopNoticeCleanupTimer = null;
  }
  if (globalTopNoticeReplaceTimer !== null) {
    window.clearTimeout(globalTopNoticeReplaceTimer);
    globalTopNoticeReplaceTimer = null;
  }

  const renderNotice = () => {
    if (!globalTopNoticeDiv || !globalTopNoticeRoot) return;
    globalTopNoticeDiv.className = `${styles["top-notice-show"]}`;
    globalTopNoticeRoot.render(
      <TopNotice content={content} style={hostStyle} variant={variant} />,
    );

    globalTopNoticeCloseTimer = window.setTimeout(() => {
      if (!globalTopNoticeDiv || !globalTopNoticeRoot) return;
      globalTopNoticeDiv.className = `${styles["top-notice-hide"]}`;
      globalTopNoticeCleanupTimer = window.setTimeout(() => {
        globalTopNoticeRoot?.render(<></>);
        if (globalTopNoticeDiv) {
          globalTopNoticeDiv.className = "";
        }
        globalTopNoticeCleanupTimer = null;
      }, 220);
      globalTopNoticeCloseTimer = null;
    }, delay);
  };

  if (shouldAnimateReplacement) {
    globalTopNoticeDiv.className = `${styles["top-notice-hide"]}`;
    globalTopNoticeReplaceTimer = window.setTimeout(() => {
      globalTopNoticeReplaceTimer = null;
      renderNotice();
    }, 220);
    return;
  }

  renderNotice();
}

export function Toast(props: ToastProps) {
  return (
    <div className={styles["toast-container"]}>
      <NoticePill
        content={props.content}
        action={props.action}
        onClose={props.onClose}
      />
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
      <input
        {...inputProps}
        type={visible ? "text" : "password"}
        className={clsx("password-input", className)}
      />
      <button
        type="button"
        aria-label={aria}
        onClick={changeVisibility}
        tabIndex={-1}
        className={clsx("clickable", "password-eye", "nextchat-default-button")}
      >
        {visible ? <EyeIcon /> : <EyeOffIcon />}
      </button>
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

type ShowConfirmOptions = {
  title?: string;
  cancelText?: string;
  confirmText?: string;
  hideCloseButton?: boolean;
};

export function showConfirm(content: any, options?: ShowConfirmOptions) {
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
        title={options?.title ?? Locale.UI.Confirm}
        isSmall={true}
        hideCloseButton={options?.hideCloseButton}
        actions={[
          <IconButton
            key="cancel"
            text={options?.cancelText ?? Locale.UI.Cancel}
            onClick={() => {
              resolve(false);
              closeModal();
            }}
            icon={<CancelIcon />}
            tabIndex={0}
          ></IconButton>,
          <IconButton
            key="confirm"
            text={options?.confirmText ?? Locale.UI.Confirm}
            type="primary"
            onClick={() => {
              resolve(true);
              closeModal();
            }}
            icon={<ConfirmIcon />}
            tabIndex={0}
            autoFocus
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

function ImageModalContent(props: {
  img: string;
  style?: CSSProperties;
  boxStyle?: CSSProperties;
  onImageSrcUpdater?: (updateSrc: (src: string) => void) => void;
}) {
  const { img, style, boxStyle, onImageSrcUpdater } = props;
  const [currentImg, setCurrentImg] = useState(img);

  useEffect(() => {
    onImageSrcUpdater?.(setCurrentImg);
  }, [onImageSrcUpdater]);

  return (
    <div
      className="image-preview-box"
      style={{ display: "flex", justifyContent: "center", ...boxStyle }}
    >
      <img
        src={currentImg}
        alt="preview"
        style={
          style ?? {
            maxWidth: "100%",
          }
        }
      ></img>
    </div>
  );
}

export function showImageModal(
  img: string,
  defaultMax?: boolean,
  style?: CSSProperties,
  boxStyle?: CSSProperties,
  options?: {
    onImageSrcUpdater?: (updateSrc: (src: string) => void) => void;
  },
) {
  showModal({
    title: Locale.Export.Image.Modal,
    defaultMax: defaultMax,
    className: "image-preview-modal",
    children: (
      <ImageModalContent
        img={img}
        style={style}
        boxStyle={boxStyle}
        onImageSrcUpdater={options?.onImageSrcUpdater}
      />
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
  hiddenGroupFilterOptions?: string[];
  defaultGroup?: string;
  title?: React.ReactNode;
  className?: string;
  headerHint?: React.ReactNode;
  filterControlsDisabled?: boolean;
  onFilterControlsDisabledClick?: () => void;
  groupFilterDisabled?: boolean;
  onGroupFilterDisabledClick?: () => void;
  onGroupChange?: (group: string) => void;
  footer?:
    | React.ReactNode
    | ((ctx: { selectedGroup: string }) => React.ReactNode);
  centerContent?: boolean;
  resetKey?: number | string;
  onDisabledItemClick?: () => void;
  itemsArePreSorted?: boolean;
  sortGroupsAlphabetically?: boolean;
  searchDebounceMs?: number;
  enableVirtualization?: boolean;
  virtualizationThreshold?: number;
  estimatedItemHeight?: number;
  estimatedGroupHeight?: number;
  perfScope?: string;
  perfStartedAt?: number;
  disableOpenAnimation?: boolean;
  disableHoverAnimation?: boolean;
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
  const [searchInput, setSearchInput] = useState("");
  const [searchText, setSearchText] = useState("");
  const [selectedGroup, setSelectedGroup] = useState(
    props.defaultGroup ?? "All",
  );
  const [selectedQuickFilter, setSelectedQuickFilter] = useState("all");
  const [isGroupFilterOpen, setIsGroupFilterOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(520);
  const groupFilterWrapRef = useRef<HTMLDivElement>(null);
  const groupFilterButtonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const initialViewportScrollYRef = useRef(0);
  const [portalReady, setPortalReady] = useState(false);
  const renderCommitCountRef = useRef(0);
  const searchStartedAtRef = useRef(0);

  renderCommitCountRef.current += 1;

  useEffect(() => {
    initialViewportScrollYRef.current = window.scrollY;
  }, []);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    setIsGroupFilterOpen(false);
    setSearchInput("");
    setSearchText("");
    setSelectedQuickFilter("all");
    setSelectedValues(
      Array.isArray(props.defaultSelectedValue)
        ? props.defaultSelectedValue
        : props.defaultSelectedValue !== undefined
        ? [props.defaultSelectedValue]
        : [],
    );
    const defaultGroup = props.defaultGroup ?? "All";
    setSelectedGroup(
      defaultGroup === "All" ? "All" : getGroupFilterLabel(defaultGroup),
    );
    setScrollTop(0);
  }, [
    props.defaultGroup,
    props.defaultSelectedValue,
    props.resetKey,
    props.sortGroupsAlphabetically,
  ]);

  useEffect(() => {
    const debounceDelay = props.searchDebounceMs ?? 120;
    const timer = window.setTimeout(() => {
      startTransition(() => {
        setSearchText(searchInput);
      });
    }, debounceDelay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [props.searchDebounceMs, searchInput]);

  useEffect(() => {
    let frameId = 0;

    const updateViewportHeight = () => {
      setViewportHeight(listRef.current?.clientHeight ?? 520);
    };

    const handleResize = () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        updateViewportHeight();
      });
    };

    updateViewportHeight();
    window.addEventListener("resize", handleResize);

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!props.perfScope || props.perfStartedAt === undefined) {
      return;
    }

    logPerfSummary(props.perfScope, {
      selectorOpenDurationMs: Number(
        (nowMs() - props.perfStartedAt).toFixed(2),
      ),
      itemCount: props.items.length,
    });
  }, [props.items.length, props.perfScope, props.perfStartedAt]);

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
      case "Doubao":
        return "ByteDance";
      case "智谱":
      case "Zhipu AI":
      case "Z.ai":
        return "Zhipu";
      case "万物":
        return "01.AI";
      case "Kimi":
        return "Moonshot";
      case "海螺":
      case "Minimax":
        return "MiniMax";
      case "混元":
      case "Hunyuan":
      case "Tencent Hunyuan":
        return "Tencent";
      case "文心":
      case "ERNIE":
        return "Baidu";
      case "讯飞星火":
      case "iFLYTEK Spark":
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

  const installPointerGuard = () => {
    if (typeof document === "undefined") return;

    const guard = document.createElement("div");
    guard.setAttribute("data-selector-pointer-guard", "true");
    Object.assign(guard.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      background: "transparent",
      pointerEvents: "auto",
      touchAction: "none",
      WebkitTapHighlightColor: "transparent",
    });

    const stopEvent = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    [
      "pointerdown",
      "pointerup",
      "touchstart",
      "touchend",
      "mousedown",
      "mouseup",
      "click",
    ].forEach((eventName) =>
      guard.addEventListener(eventName, stopEvent, true),
    );

    document.body.appendChild(guard);
    window.setTimeout(() => {
      guard.remove();
    }, 650);
  };

  const closeSelectorFromMask = () => {
    installPointerGuard();
    props.onClose?.();
  };

  const availableGroups = useMemo(() => {
    const groups = Array.from(
      new Set(
        props.items
          .map((item) => item.group?.trim())
          .filter(Boolean)
          .map((group) => getGroupFilterLabel(group as string)),
      ),
    ) as string[];
    const mergedGroups = Array.from(
      new Set([
        ...groups,
        ...(props.extraGroups ?? []).map((group) => getGroupFilterLabel(group)),
      ]),
    );

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

    const preferredOrder = [
      ...SELECTOR_PREFERRED_GROUP_ORDER.flatMap((group) =>
        orderedCanonicalGroups.has(group)
          ? deduplicatedGroups.filter(
              (candidate) => normalizeGroupForOrder(candidate) === group,
            )
          : [],
      ),
      ...deduplicatedGroups.filter(
        (group) =>
          !SELECTOR_PREFERRED_GROUP_ORDER.includes(
            normalizeGroupForOrder(
              group,
            ) as (typeof SELECTOR_PREFERRED_GROUP_ORDER)[number],
          ),
      ),
    ];
    return props.sortGroupsAlphabetically
      ? deduplicatedGroups
          .slice()
          .sort((left, right) =>
            compareProviderDisplayNames(
              getGroupFilterLabel(left),
              getGroupFilterLabel(right),
            ),
          )
      : preferredOrder;
  }, [props.extraGroups, props.items, props.sortGroupsAlphabetically]);
  const hiddenGroupFilterOptions = useMemo(
    () =>
      new Set(
        (props.hiddenGroupFilterOptions ?? [])
          .map((group) => group.trim().toLowerCase())
          .filter(Boolean),
      ),
    [props.hiddenGroupFilterOptions],
  );
  const groupFilterOptions = ["All", ...availableGroups].filter((group) => {
    if (group === "All") return true;
    return !hiddenGroupFilterOptions.has(group.trim().toLowerCase());
  });
  const isCustomModelGroup = (group: string) =>
    [
      "自定义模型",
      "Custom Models",
      "Custom",
      "CUSTOM",
      "已添加",
      "Other",
    ].includes(group);
  const getGroupBadgeText = (group: string) => {
    if (group === "自定义模型" || group === "Custom Models") return "C";
    if (/^[\u4e00-\u9fa5]/.test(group)) return group.slice(0, 2);
    const compact = group.replace(/[^a-zA-Z0-9]/g, "");
    return compact.slice(0, 1).toUpperCase() || group.slice(0, 1);
  };
  const renderDefaultGroupIcon = () => (
    <span
      className={clsx(
        "nextchat-selector-menu-icon-frame",
        styles["selector-group-filter-icon-custom-wrap"],
      )}
    >
      <BotIconDefault
        className={clsx(
          "nextchat-selector-menu-icon-image",
          styles["selector-group-filter-icon-image"],
          styles["selector-group-filter-icon-image-custom"],
        )}
      />
    </span>
  );
  const renderGroupFilterIcon = (group: string) => {
    if (group === "All") return null;
    if (isCustomModelGroup(group)) {
      return renderDefaultGroupIcon();
    }
    const normalized = group.toLowerCase();
    const localIcon = getProviderIcon(normalized);
    const shouldFillIconFrame = [
      "stepfun",
      "stepfun ai",
      "stepfun al",
      "suno",
    ].includes(normalized);
    if (localIcon) {
      return (
        <span
          className={clsx(
            "nextchat-selector-menu-icon-frame",
            styles["selector-group-filter-icon-frame"],
          )}
        >
          <img
            className={clsx(
              "nextchat-selector-menu-icon-image",
              styles["selector-group-filter-icon-image"],
              shouldFillIconFrame &&
                styles["selector-group-filter-icon-image-fill"],
            )}
            src={localIcon}
            alt={`${group} icon`}
          />
        </span>
      );
    }
    return renderDefaultGroupIcon();
  };
  const renderSelectorItemIcon = (item: SelectorItemBase<T>) => {
    const rawGroup = item.group?.trim();
    if (!rawGroup) {
      return <Avatar model={String(item.value)} />;
    }

    const visibleGroup = getGroupFilterLabel(rawGroup);
    if (isCustomModelGroup(rawGroup) || isCustomModelGroup(visibleGroup)) {
      return renderGroupFilterIcon("Custom Models") ?? undefined;
    }
    if (
      ["stepfun", "stepfun ai", "stepfun al", "suno"].includes(
        visibleGroup.toLowerCase(),
      )
    ) {
      return renderGroupFilterIcon(visibleGroup) ?? undefined;
    }
    if (getProviderIcon(visibleGroup)) {
      return <Avatar model={visibleGroup} />;
    }

    return renderDefaultGroupIcon();
  };
  const stabilizeSelectorPosition = () => {
    requestAnimationFrame(() => {
      window.scrollTo({ top: initialViewportScrollYRef.current });
      document.getElementById("selector-list")?.scrollTo({ top: 0 });
      groupFilterButtonRef.current?.focus({ preventScroll: true });
    });
  };

  const deferredSearchText = useDeferredValue(searchText.trim().toLowerCase());
  const filteredItems = useMemo(() => {
    const quickFilter = props.quickFilters?.find(
      (filter) => filter.key === selectedQuickFilter,
    );

    return props.items.filter((item) => {
      const matchGroup =
        !props.showGroupFilter ||
        selectedGroup === "All" ||
        getGroupFilterLabel(item.group?.trim() || "__default__") ===
          selectedGroup;
      const matchQuickFilter = !quickFilter || quickFilter.match(item);
      const matchSearch =
        !deferredSearchText ||
        (item.searchText || item.title || String(item.value))
          .toLowerCase()
          .includes(deferredSearchText);
      return matchGroup && matchQuickFilter && matchSearch;
    });
  }, [
    deferredSearchText,
    props.items,
    props.quickFilters,
    props.showGroupFilter,
    selectedGroup,
    selectedQuickFilter,
  ]);

  const groupedItems = useMemo(() => {
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
      const rawGroupKey = item.group?.trim() || "__default__";
      const groupKey = getGroupFilterLabel(rawGroupKey);
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
      const items = props.itemsArePreSorted
        ? (buckets.get(groupKey) ?? []).slice()
        : (buckets.get(groupKey) ?? []).slice().sort(compareSelectorItems);
      const groupLabel = groupKey === "__default__" ? "" : groupKey;

      if (groupLabel) {
        entries.push({
          type: "group",
          key: groupKey,
          label: getGroupFilterLabel(groupLabel),
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
  }, [availableGroups, filteredItems, props.itemsArePreSorted]);

  const selectorVirtualizationEnabled =
    props.enableVirtualization !== false &&
    isPerfFeatureEnabled("PERF_ENABLE_MODEL_SELECTOR_VIRTUAL_LIST");
  const virtualizationThreshold = props.virtualizationThreshold ?? 80;
  const shouldVirtualize =
    selectorVirtualizationEnabled &&
    groupedItems.length >= virtualizationThreshold;
  const estimatedGroupHeight = props.estimatedGroupHeight ?? 48;
  const estimatedItemHeight = props.estimatedItemHeight ?? 52;
  const virtualRows = useMemo(() => {
    let top = 0;
    const rows = groupedItems.map((entry) => {
      const height =
        entry.type === "group" ? estimatedGroupHeight : estimatedItemHeight;
      const row = {
        entry,
        top,
        height,
      };
      top += height;
      return row;
    });

    return {
      rows,
      totalHeight: top,
    };
  }, [estimatedGroupHeight, estimatedItemHeight, groupedItems]);

  const overscanPx = estimatedItemHeight * 6;
  const visibleVirtualRows = useMemo(() => {
    if (!shouldVirtualize) {
      return virtualRows.rows;
    }

    const minTop = Math.max(0, scrollTop - overscanPx);
    const maxTop = scrollTop + viewportHeight + overscanPx;

    return virtualRows.rows.filter((row) => {
      const rowBottom = row.top + row.height;
      return rowBottom >= minTop && row.top <= maxTop;
    });
  }, [
    overscanPx,
    scrollTop,
    shouldVirtualize,
    viewportHeight,
    virtualRows.rows,
  ]);

  // 计算当前可见的分组头（sticky header）
  const visibleGroupHeader = useMemo(() => {
    if (!shouldVirtualize) {
      return null;
    }
    // 找到滚动位置上方最近的分组行，即最后一个 top <= scrollTop 的 group row
    let currentGroup: (typeof virtualRows.rows)[number] | null = null;
    let firstGroup: (typeof virtualRows.rows)[number] | null = null;

    for (const row of virtualRows.rows) {
      if (row.entry.type === "group") {
        firstGroup ??= row;
        if (row.top <= scrollTop) {
          currentGroup = row;
        } else {
          break;
        }
      }
    }

    // 滚回列表起点时，仍保留第一个标题，不能让固定标题层消失。
    return currentGroup ?? firstGroup;
  }, [shouldVirtualize, scrollTop, virtualRows]);

  useEffect(() => {
    if (searchStartedAtRef.current <= 0 || !props.perfScope) {
      return;
    }

    logPerfSummary(props.perfScope, {
      searchInputToCommitDurationMs: Number(
        (nowMs() - searchStartedAtRef.current).toFixed(2),
      ),
      filteredCount: filteredItems.length,
      renderedRowCount: shouldVirtualize
        ? visibleVirtualRows.length
        : groupedItems.length,
      renderCommitCount: renderCommitCountRef.current,
    });
    searchStartedAtRef.current = 0;
  }, [
    filteredItems.length,
    groupedItems.length,
    props.perfScope,
    shouldVirtualize,
    visibleVirtualRows.length,
  ]);

  useEffect(() => {
    if (!props.perfScope) {
      return;
    }

    logPerfSummary(props.perfScope, {
      modelCount: props.items.length,
      filteredCount: filteredItems.length,
      renderedRowCount: shouldVirtualize
        ? visibleVirtualRows.length
        : groupedItems.length,
      renderCommitCount: renderCommitCountRef.current,
      virtualized: shouldVirtualize,
    });
  }, [
    filteredItems.length,
    groupedItems.length,
    props.items.length,
    props.perfScope,
    shouldVirtualize,
    visibleVirtualRows.length,
  ]);

  const selectorNode = (
    <div
      className={clsx(
        "nextchat-selector",
        props.disableHoverAnimation && "nextchat-no-hover-motion",
        styles["selector"],
        props.disableOpenAnimation && styles["selector-fast-open"],
        props.className,
      )}
      data-selector-container="true"
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onTouchStart={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        e.stopPropagation();
        closeSelectorFromMask();
      }}
    >
      <div
        className={clsx(
          styles["selector-content"],
          {
            [styles["selector-content-centered"]]: props.centerContent,
          },
          "nextchat-selector-content",
        )}
        data-selector-content="true"
        onClick={(e) => e.stopPropagation()}
      >
        {props.title ? (
          <div
            className={clsx(
              "nextchat-selector-title",
              styles["selector-title"],
            )}
            style={
              shouldVirtualize
                ? ({
                    "--selector-virtual-group-height": `${estimatedGroupHeight}px`,
                  } as CSSProperties)
                : undefined
            }
          >
            {props.title}
          </div>
        ) : null}
        {props.headerHint ? (
          <div
            className={clsx(
              "nextchat-selector-header",
              styles["selector-header-hint"],
            )}
          >
            {props.headerHint}
          </div>
        ) : null}
        {props.showGroupFilter && (
          <div
            ref={groupFilterWrapRef}
            data-selector-group-filter-root="true"
            className={clsx(
              "nextchat-selector-toolbar",
              styles["selector-group-filter-wrap"],
            )}
          >
            <button
              type="button"
              ref={groupFilterButtonRef}
              className={clsx(
                "nextchat-default-button",
                "nextchat-no-hover-motion",
                "nextchat-selector-group-filter",
                styles["selector-group-filter"],
                isGroupFilterOpen && "nextchat-selector-group-filter-open",
                {
                  [styles["selector-group-filter-open"]]: isGroupFilterOpen,
                },
                (props.groupFilterDisabled || props.filterControlsDisabled) &&
                  "nextchat-selector-control-disabled",
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
                setIsGroupFilterOpen(!isGroupFilterOpen);
              }}
            >
              {selectedGroup !== "All" ? (
                <span
                  className={clsx(
                    "nextchat-selector-menu-option-leading",
                    styles["selector-group-filter-leading"],
                  )}
                >
                  {renderGroupFilterIcon(selectedGroup)}
                </span>
              ) : null}
              <span>{getGroupFilterLabel(selectedGroup)}</span>
              <DownIcon />
            </button>
            {isGroupFilterOpen && (
              <div
                className={clsx(
                  "nextchat-selector-menu",
                  styles["selector-group-filter-menu"],
                )}
              >
                {groupFilterOptions.map((group) => {
                  const active = selectedGroup === group;
                  return (
                    <button
                      type="button"
                      key={group}
                      className={clsx(
                        "nextchat-menu-option",
                        "nextchat-menu-option-bordered",
                        "nextchat-no-hover-motion",
                        "nextchat-selector-menu-option",
                        styles["selector-group-filter-option"],
                        active && "nextchat-menu-option-active",
                        active && "nextchat-selector-menu-option-active",
                        active && styles["selector-group-filter-option-active"],
                      )}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSelectedGroup(group);
                        props.onGroupChange?.(group);
                        setIsGroupFilterOpen(false);
                        stabilizeSelectorPosition();
                      }}
                    >
                      {group !== "All" ? (
                        <span
                          className={clsx(
                            "nextchat-selector-menu-option-leading",
                            styles["selector-group-filter-option-leading"],
                          )}
                        >
                          {renderGroupFilterIcon(group)}
                        </span>
                      ) : null}
                      <span>{getGroupFilterLabel(group)}</span>
                      {active ? (
                        <ConfirmIcon className="nextchat-model-selector-check" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
            {props.groupFilterAction && !isGroupFilterOpen ? (
              <div
                className={clsx(
                  "nextchat-selector-toolbar-action",
                  styles["selector-group-filter-extra"],
                )}
                data-selector-group-filter-action="true"
              >
                {typeof props.groupFilterAction === "function"
                  ? props.groupFilterAction({
                      buttonClassName: clsx(
                        "nextchat-default-button",
                        "nextchat-no-hover-motion",
                        "nextchat-selector-group-filter",
                        styles["selector-group-filter"],
                      ),
                      menuClassName: clsx(
                        "nextchat-selector-menu",
                        styles["selector-group-filter-menu"],
                      ),
                      optionClassName: clsx(
                        "nextchat-menu-option",
                        "nextchat-menu-option-bordered",
                        "nextchat-no-hover-motion",
                        "nextchat-selector-menu-option",
                        styles["selector-group-filter-option"],
                      ),
                      optionActiveClassName: clsx(
                        "nextchat-menu-option-active",
                        "nextchat-selector-menu-option-active",
                        styles["selector-group-filter-option-active"],
                      ),
                      optionLeadingClassName: clsx(
                        "nextchat-selector-menu-option-leading",
                        styles["selector-group-filter-option-leading"],
                      ),
                      iconFrameClassName: clsx(
                        "nextchat-selector-menu-icon-frame",
                        styles["selector-group-filter-icon-frame"],
                      ),
                      iconImageClassName: clsx(
                        "nextchat-selector-menu-icon-image",
                        styles["selector-group-filter-icon-image"],
                      ),
                    })
                  : props.groupFilterAction}
              </div>
            ) : null}
          </div>
        )}
        {props.showSearch && !isGroupFilterOpen && (
          <div
            data-selector-search="true"
            className={clsx(
              "nextchat-selector-search-surface",
              styles["selector-search-wrap"],
              props.filterControlsDisabled &&
                "nextchat-selector-control-disabled",
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
              className={clsx(
                "nextchat-input-control",
                "nextchat-no-hover-motion",
                "nextchat-selector-search-input",
                styles["selector-search"],
              )}
              placeholder="搜索模型..."
              value={searchInput}
              disabled={props.filterControlsDisabled}
              onChange={(e) => {
                if (props.filterControlsDisabled) {
                  props.onFilterControlsDisabledClick?.();
                  return;
                }
                searchStartedAtRef.current = nowMs();
                setSearchInput(e.target.value);
              }}
            />
          </div>
        )}
        {props.quickFilters &&
          props.quickFilters.length > 0 &&
          !isGroupFilterOpen && (
            <div
              className={clsx(
                "nextchat-selector-quick-filters",
                styles["selector-quick-filters"],
              )}
            >
              <button
                type="button"
                className={clsx(
                  "nextchat-default-button",
                  "nextchat-no-hover-motion",
                  "nextchat-selector-quick-filter",
                  styles["selector-quick-filter"],
                  {
                    [styles["selector-quick-filter-active"]]:
                      selectedQuickFilter === "all",
                  },
                  selectedQuickFilter === "all" &&
                    "nextchat-selector-quick-filter-active",
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
                    "nextchat-default-button",
                    "nextchat-no-hover-motion",
                    "nextchat-selector-quick-filter",
                    styles["selector-quick-filter"],
                    {
                      [styles["selector-quick-filter-active"]]:
                        selectedQuickFilter === filter.key,
                    },
                    selectedQuickFilter === filter.key &&
                      "nextchat-selector-quick-filter-active",
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
          <div
            className={clsx(
              "nextchat-input-surface",
              "nextchat-input-surface-readonly",
              "nextchat-selector-empty",
              styles["selector-empty"],
            )}
            data-selector-empty="true"
          >
            <div className={styles["selector-empty-icon"]}>🔍</div>
            <div className={styles["selector-empty-text"]}>
              没有找到匹配的模型
            </div>
          </div>
        ) : !isGroupFilterOpen ? (
          <List
            id="selector-list"
            className={clsx(
              "nextchat-selector-list",
              props.filterControlsDisabled && "nextchat-selector-list-disabled",
              props.filterControlsDisabled && styles["selector-list-disabled"],
            )}
            listRef={listRef}
            onScroll={(event) => {
              if (!shouldVirtualize) {
                return;
              }
              setScrollTop(event.currentTarget.scrollTop);
            }}
            stickyHeader={
              shouldVirtualize && visibleGroupHeader?.entry.type === "group" ? (
                <div
                  className={clsx(
                    "nextchat-selector-sticky-header",
                    styles["list-sticky-header"],
                  )}
                >
                  <span
                    className={clsx(
                      "nextchat-selector-sticky-header-label",
                      styles["list-sticky-header-label"],
                    )}
                  >
                    {visibleGroupHeader.entry.label}
                  </span>
                  <span
                    className={clsx(
                      "nextchat-selector-sticky-header-count",
                      styles["list-sticky-header-count"],
                    )}
                  >
                    共 {visibleGroupHeader.entry.count} 个
                  </span>
                </div>
              ) : undefined
            }
          >
            {!shouldVirtualize ? (
              groupedItems.map((entry) => {
                if (entry.type === "group") {
                  return (
                    <div
                      className={clsx(
                        "nextchat-selector-group",
                        styles["selector-group"],
                      )}
                      data-selector-group="true"
                      key={entry.key}
                    >
                      <span
                        className={clsx(
                          "nextchat-selector-group-label",
                          styles["selector-group-label"],
                        )}
                      >
                        {entry.label}
                      </span>
                      <span
                        className={clsx(
                          "nextchat-selector-group-count",
                          styles["selector-group-count"],
                        )}
                      >
                        共 {entry.count} 个
                      </span>
                    </div>
                  );
                }

                const { item } = entry;
                const selected = selectedValues.includes(item.value);

                return (
                  <ListItem
                    className={clsx(
                      "nextchat-selector-list-item",
                      styles["selector-item"],
                      item.disable && "nextchat-selector-list-item-disabled",
                      item.disable && styles["selector-item-disabled"],
                      selected && "nextchat-selector-list-item-active",
                      selected && styles["selector-item-active"],
                    )}
                    key={entry.key}
                    title={item.title}
                    subTitle={item.subTitle}
                    icon={renderSelectorItemIcon(item)}
                    onClick={(e) => {
                      if (item.disable) {
                        e.stopPropagation();
                        props.onDisabledItemClick?.();
                      } else {
                        handleSelection(e, item.value);
                      }
                    }}
                  >
                    <div
                      className={clsx(
                        "nextchat-selector-item-actions",
                        styles["selector-item-actions"],
                      )}
                    >
                      <div
                        className={clsx(
                          "nextchat-selector-item-selected",
                          styles["selector-item-selected"],
                          !selected &&
                            !item.disable &&
                            "nextchat-selector-item-selected-hidden",
                          !selected &&
                            !item.disable &&
                            styles["selector-item-selected-hidden"],
                        )}
                        style={{ color: "var(--primary)" }}
                      >
                        <ConfirmIcon
                          className="nextchat-model-selector-check"
                          style={{
                            color: "var(--primary)",
                            stroke: "var(--primary)",
                            filter: "none",
                          }}
                        />
                      </div>
                      {item.rightAction ? (
                        <button
                          type="button"
                          className={clsx(
                            "nextchat-danger-button",
                            "nextchat-no-hover-motion",
                            "nextchat-selector-item-action",
                            styles["selector-item-action"],
                          )}
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
              })
            ) : (
              <div
                className={clsx(
                  "nextchat-selector-virtual-spacer",
                  styles["selector-virtual-spacer"],
                )}
                style={{ height: virtualRows.totalHeight }}
              >
                {visibleVirtualRows
                  .filter(
                    (
                      row,
                    ): row is (typeof virtualRows.rows)[number] & {
                      entry: {
                        type: "group";
                        key: string;
                        label: string;
                        count: number;
                      };
                    } => row.entry.type === "group",
                  )
                  .map(({ entry, top, height }) => (
                    <div
                      className={clsx(
                        "nextchat-selector-virtual-row",
                        styles["selector-virtual-row"],
                        "nextchat-selector-group",
                        styles["selector-group"],
                      )}
                      data-selector-group="true"
                      key={entry.key}
                      style={{ height, transform: `translateY(${top}px)` }}
                    >
                      <span
                        className={clsx(
                          "nextchat-selector-group-label",
                          styles["selector-group-label"],
                        )}
                      >
                        {entry.label}
                      </span>
                      <span
                        className={clsx(
                          "nextchat-selector-group-count",
                          styles["selector-group-count"],
                        )}
                      >
                        共 {entry.count} 个
                      </span>
                    </div>
                  ))}
                {visibleVirtualRows
                  .filter(
                    (
                      row,
                    ): row is (typeof virtualRows.rows)[number] & {
                      entry: { type: "item" };
                    } => row.entry.type === "item",
                  )
                  .map(({ entry, top, height }) => {
                    const { item } = entry;
                    const selected = selectedValues.includes(item.value);

                    return (
                      <div
                        className={clsx(
                          "nextchat-selector-virtual-row",
                          styles["selector-virtual-row"],
                        )}
                        key={entry.key}
                        style={{ height, transform: `translateY(${top}px)` }}
                      >
                        <ListItem
                          className={clsx(
                            "nextchat-selector-list-item",
                            styles["selector-item"],
                            item.disable &&
                              "nextchat-selector-list-item-disabled",
                            item.disable && styles["selector-item-disabled"],
                            selected && "nextchat-selector-list-item-active",
                            selected && styles["selector-item-active"],
                          )}
                          title={item.title}
                          subTitle={item.subTitle}
                          icon={renderSelectorItemIcon(item)}
                          onClick={(e) => {
                            if (item.disable) {
                              e.stopPropagation();
                              props.onDisabledItemClick?.();
                            } else {
                              handleSelection(e, item.value);
                            }
                          }}
                        >
                          <div
                            className={clsx(
                              "nextchat-selector-item-actions",
                              styles["selector-item-actions"],
                            )}
                          >
                            {selected || item.disable ? (
                              <div
                                className={clsx(
                                  "nextchat-selector-item-selected",
                                  styles["selector-item-selected"],
                                )}
                                style={{ color: "var(--primary)" }}
                              >
                                <ConfirmIcon
                                  className="nextchat-model-selector-check"
                                  style={{
                                    color: "var(--primary)",
                                    stroke: "var(--primary)",
                                    filter: "none",
                                  }}
                                />
                              </div>
                            ) : null}
                            {item.rightAction ? (
                              <button
                                type="button"
                                className={clsx(
                                  "nextchat-danger-button",
                                  "nextchat-no-hover-motion",
                                  "nextchat-selector-item-action",
                                  styles["selector-item-action"],
                                )}
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
                      </div>
                    );
                  })}
              </div>
            )}
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
        />
      </div>
      {children}
    </div>
  );
}
