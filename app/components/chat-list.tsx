import DeleteIcon from "../icons/delete.svg";
import CheckIcon from "../icons/check.svg";
import CloseIcon from "../icons/close.svg";

import styles from "./home.module.scss";

import {
  selectChatSessionById,
  useChatIndexStore,
  useChatStore,
} from "../store";

import Locale from "../locales";
import { useLocation, useNavigate } from "react-router-dom";
import { Path } from "../constant";
import {
  useRef,
  useEffect,
  useMemo,
  useState,
  memo,
  ComponentProps,
  useDeferredValue,
  useCallback,
  ReactNode,
} from "react";
import { showConfirm } from "./ui-lib";
import { formatChinaDateTime, useMobileScreen } from "../utils";
import clsx from "clsx";
import { ChatSessionSummary, DEFAULT_TOPIC } from "../store/chat";
import {
  AUTO_SYNC_CHANNEL_NAME,
  STARTUP_CHAT_SYNC_STATUS_KEY,
  STARTUP_CHAT_SYNC_STATUS_MESSAGE_TYPE,
  StartupChatSyncStatus,
} from "../utils/sync-tab-coordination";

const VIRTUAL_LIST_THRESHOLD = 80;
const VIRTUAL_OVERSCAN = 6;
const NORMAL_ITEM_HEIGHT = 84;
const FILTERED_ITEM_HEIGHT = 108;
const PERF_DEBUG_KEY = "nextchat_perf_debug";
const SNIPPET_CONTEXT_LENGTH = 18;
const STARTUP_CHAT_SYNC_WAIT_MS = 30_000;
export const OPEN_CHAT_LIST_MULTI_DELETE_EVENT =
  "nextchat:open-chat-list-multi-delete";
export const CHAT_LIST_SCROLL_TO_TOP_EVENT = "nextchat:chat-list-scroll-top";

type FilterMatchMeta = {
  preview?: string;
};

type DisplayedSession = {
  session: ChatSessionSummary;
};

type FilteredSession = DisplayedSession & FilterMatchMeta;

function isPinnedNewChat(session: { topic: string; messageCount: number }) {
  return session.topic === DEFAULT_TOPIC && session.messageCount === 0;
}

function isPerfDebugEnabled() {
  try {
    return (
      typeof window !== "undefined" &&
      window.localStorage.getItem(PERF_DEBUG_KEY) === "1"
    );
  } catch {
    return false;
  }
}

const ChatItemCard = memo(function ChatItemCard(props: {
  onClick?: () => void;
  onDelete?: () => void;
  title: string;
  keyword?: string;
  preview?: string;
  count: number;
  time: string;
  selected: boolean;
  multiDeleteMode?: boolean;
  multiDeleteSelected?: boolean;
  avatar: string;
  model: string;
}) {
  const { pathname: currentPath } = useLocation();

  const renderHighlightedText = useCallback(
    (text: string): ReactNode => {
      const keyword = props.keyword?.trim();
      if (!keyword) {
        return text;
      }

      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const segments = text.split(new RegExp(`(${escapedKeyword})`, "gi"));

      return segments.map((segment, index) =>
        segment.toLowerCase() === keyword.toLowerCase() ? (
          <mark
            key={`${segment}-${index}`}
            className={styles["chat-item-highlight"]}
          >
            {segment}
          </mark>
        ) : (
          <span key={`${segment}-${index}`}>{segment}</span>
        ),
      );
    },
    [props.keyword],
  );

  return (
    <div
      className={clsx(styles["chat-item"], {
        [styles["chat-item-selected"]]:
          props.selected &&
          (currentPath === Path.Chat ||
            currentPath === Path.Home ||
            currentPath.startsWith(Path.Chat + "/")),
        [styles["chat-item-multi-delete"]]: props.multiDeleteMode,
        [styles["chat-item-multi-delete-selected"]]:
          props.multiDeleteMode && props.multiDeleteSelected,
      })}
      onClick={props.onClick}
      title={`${props.title}\n${Locale.ChatItem.ChatItemCount(props.count)}`}
    >
      <div className={styles["chat-item-title"]}>
        {renderHighlightedText(props.title)}
      </div>
      {props.preview && (
        <div className={styles["chat-item-preview"]}>
          {renderHighlightedText(props.preview)}
        </div>
      )}
      <div className={styles["chat-item-info"]}>
        <div className={styles["chat-item-count"]}>
          {Locale.ChatItem.ChatItemCount(props.count)}
        </div>
        <div className={styles["chat-item-date"]}>{props.time}</div>
      </div>

      {props.multiDeleteMode && (
        <div className={styles["chat-item-check"]}>
          {props.multiDeleteSelected && <CheckIcon />}
        </div>
      )}

      <div
        className={styles["chat-item-delete"]}
        onClickCapture={(e) => {
          props.onDelete?.();
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <DeleteIcon />
      </div>
    </div>
  );
});

function StaticChatItem(props: ComponentProps<typeof ChatItemCard>) {
  return <ChatItemCard {...props} />;
}

export function ChatList() {
  const {
    orderedSessionIds,
    allOrderedSessionIds,
    sessionSummaries,
    currentSessionId,
    initialized,
    loadMore,
  } = useChatIndexStore();
  const navigate = useNavigate();
  const isMobileScreen = useMobileScreen();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [filterText, setFilterText] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialEmptyListGuard, setInitialEmptyListGuard] = useState(true);
  const [multiDeleteMode, setMultiDeleteMode] = useState(false);
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<string[]>([]);
  const [startupChatSyncStatus, setStartupChatSyncStatus] =
    useState<StartupChatSyncStatus | null>(null);
  const chatStoreHydrated = useChatStore((state) =>
    Boolean((state as any)._hasHydrated),
  );
  const deferredFilterText = useDeferredValue(filterText.trim().toLowerCase());
  const loadingMoreTimerRef = useRef<number | null>(null);
  const hasMoreSessions =
    orderedSessionIds.length < allOrderedSessionIds.length;

  const toggleDeleteSelection = useCallback((sessionId: string) => {
    setSelectedDeleteIds((ids) =>
      ids.includes(sessionId)
        ? ids.filter((id) => id !== sessionId)
        : [...ids, sessionId],
    );
  }, []);

  const enterMultiDeleteMode = useCallback((sessionId?: string) => {
    setMultiDeleteMode(true);
    if (sessionId) {
      setSelectedDeleteIds((ids) =>
        ids.includes(sessionId) ? ids : [...ids, sessionId],
      );
    }
  }, []);

  const exitMultiDeleteMode = useCallback(() => {
    setMultiDeleteMode(false);
    setSelectedDeleteIds([]);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setInitialEmptyListGuard(false);
    }, 2500);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const scrollToTop = () => {
      listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    };

    window.addEventListener(CHAT_LIST_SCROLL_TO_TOP_EVENT, scrollToTop);
    return () =>
      window.removeEventListener(CHAT_LIST_SCROLL_TO_TOP_EVENT, scrollToTop);
  }, []);

  useEffect(() => {
    const readStatus = () => {
      try {
        const raw = window.localStorage.getItem(STARTUP_CHAT_SYNC_STATUS_KEY);
        if (!raw) {
          return;
        }

        const parsed = JSON.parse(raw) as StartupChatSyncStatus;
        if (
          parsed &&
          ["syncing", "done", "error"].includes(parsed.status) &&
          Number.isFinite(parsed.updatedAt)
        ) {
          setStartupChatSyncStatus(parsed);
        }
      } catch {}
    };

    readStatus();

    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(AUTO_SYNC_CHANNEL_NAME)
        : null;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== STARTUP_CHAT_SYNC_STATUS_MESSAGE_TYPE) {
        return;
      }

      setStartupChatSyncStatus({
        status: event.data.status,
        updatedAt: event.data.updatedAt,
      });
    };
    channel?.addEventListener("message", onMessage);

    return () => {
      channel?.removeEventListener("message", onMessage);
      channel?.close();
    };
  }, []);

  useEffect(() => {
    const listener = () => enterMultiDeleteMode(currentSessionId);
    window.addEventListener(OPEN_CHAT_LIST_MULTI_DELETE_EVENT, listener);

    return () => {
      window.removeEventListener(OPEN_CHAT_LIST_MULTI_DELETE_EVENT, listener);
    };
  }, [currentSessionId, enterMultiDeleteMode]);

  useEffect(() => {
    if (!isMobileScreen && multiDeleteMode) {
      exitMultiDeleteMode();
    }
  }, [exitMultiDeleteMode, isMobileScreen, multiDeleteMode]);

  const triggerLoadMore = useCallback(() => {
    if (!hasMoreSessions) {
      return;
    }

    setLoadingMore(true);
    loadMore();

    if (loadingMoreTimerRef.current) {
      window.clearTimeout(loadingMoreTimerRef.current);
    }

    loadingMoreTimerRef.current = window.setTimeout(() => {
      setLoadingMore(false);
      loadingMoreTimerRef.current = null;
    }, 420);
  }, [hasMoreSessions, loadMore]);

  const buildMatchedPreview = useCallback(
    (session: ChatSessionSummary, lowerCaseText: string) => {
      const content = session.searchText || "";
      if (!content || !lowerCaseText) {
        return "";
      }

      const matchIndex = content.indexOf(lowerCaseText);
      if (matchIndex === -1) {
        return "";
      }

      const start = Math.max(0, matchIndex - SNIPPET_CONTEXT_LENGTH);
      const end = Math.min(
        content.length,
        matchIndex + lowerCaseText.length + SNIPPET_CONTEXT_LENGTH,
      );

      return `${start > 0 ? "..." : ""}${content.slice(start, end).trim()}${
        end < content.length ? "..." : ""
      }`;
    },
    [],
  );

  const summaryList = useMemo(
    () =>
      orderedSessionIds
        .map((sessionId) => sessionSummaries[sessionId])
        .filter(Boolean),
    [orderedSessionIds, sessionSummaries],
  );
  const totalChatCount = useMemo(
    () =>
      Object.values(sessionSummaries).filter(
        (session) => session && session.messageCount > 0,
      ).length,
    [sessionSummaries],
  );
  const isChatListLoading =
    !initialized ||
    (!chatStoreHydrated &&
      totalChatCount === 0 &&
      allOrderedSessionIds.length === 0) ||
    (initialEmptyListGuard && totalChatCount === 0) ||
    (totalChatCount === 0 &&
      (!startupChatSyncStatus || startupChatSyncStatus.status === "syncing") &&
      Date.now() -
        (startupChatSyncStatus?.updatedAt ?? performance.timeOrigin) <
        STARTUP_CHAT_SYNC_WAIT_MS);
  const pinnedSession = summaryList.find(isPinnedNewChat);
  const displayedSessions = useMemo<DisplayedSession[]>(
    () =>
      pinnedSession
        ? [
            {
              session: pinnedSession,
            },
            ...summaryList
              .map((session) => ({
                session,
              }))
              .filter((item) => item.session.id !== pinnedSession.id)
              .filter((item) => item.session.messageCount > 0),
          ]
        : summaryList
            .map((session) => ({
              session,
            }))
            .filter((item) => item.session.messageCount > 0),
    [pinnedSession, summaryList],
  );
  const filteredSessions = useMemo<FilteredSession[]>(() => {
    if (!deferredFilterText) {
      return displayedSessions;
    }

    return displayedSessions.reduce<FilteredSession[]>((result, entry) => {
      const { session } = entry;
      const topic = session.topic.toLowerCase();
      const content = session.searchText || "";
      const topicMatched = topic.includes(deferredFilterText);
      const contentMatched = content.includes(deferredFilterText);

      if (!topicMatched && !contentMatched) {
        return result;
      }

      result.push({
        ...entry,
        preview: contentMatched
          ? buildMatchedPreview(session, deferredFilterText)
          : undefined,
      });

      return result;
    }, []);
  }, [deferredFilterText, displayedSessions, buildMatchedPreview]);

  const filteredSessionIdSet = useMemo(
    () => new Set(filteredSessions.map((item) => item.session.id)),
    [filteredSessions],
  );

  useEffect(() => {
    setSelectedDeleteIds((ids) => {
      const nextIds = ids.filter((id) => filteredSessionIdSet.has(id));
      if (nextIds.length === ids.length) {
        return ids;
      }
      return nextIds;
    });
  }, [filteredSessionIdSet]);

  const itemHeight = deferredFilterText
    ? FILTERED_ITEM_HEIGHT
    : NORMAL_ITEM_HEIGHT;
  const shouldVirtualize = filteredSessions.length > VIRTUAL_LIST_THRESHOLD;

  useEffect(() => {
    if (!shouldVirtualize || !listRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const nextHeight = entries[0]?.contentRect.height ?? 0;
      setViewportHeight(nextHeight);
    });

    observer.observe(listRef.current);
    setViewportHeight(listRef.current.clientHeight);

    return () => observer.disconnect();
  }, [shouldVirtualize]);

  useEffect(() => {
    return () => {
      if (loadingMoreTimerRef.current) {
        window.clearTimeout(loadingMoreTimerRef.current);
      }
    };
  }, []);

  const onDeleteSession = async (sessionId: string) => {
    if (isMobileScreen) {
      enterMultiDeleteMode(sessionId);
      return;
    }

    if (!isMobileScreen || (await showConfirm(Locale.Home.DeleteChat))) {
      useChatStore.getState().deleteSessionById(sessionId);
    }
  };

  const onConfirmMultiDelete = async () => {
    if (selectedDeleteIds.length === 0) {
      return;
    }

    if (await showConfirm(Locale.Home.DeleteChat)) {
      useChatStore.getState().deleteSessionsByIds(selectedDeleteIds);
      exitMultiDeleteMode();
    }
  };

  const renderScrollContainer = useCallback(
    (
      content: ReactNode,
      onScroll?: (event: React.UIEvent<HTMLDivElement>) => void,
    ) => (
      <div
        className={styles["chat-list-scroll"]}
        ref={listRef}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
          onScroll?.(event);
          if (
            event.currentTarget.scrollTop + event.currentTarget.clientHeight >=
            event.currentTarget.scrollHeight - itemHeight * 2
          ) {
            triggerLoadMore();
          }
        }}
      >
        {content}
      </div>
    ),
    [itemHeight, triggerLoadMore],
  );

  const totalHeight = filteredSessions.length * itemHeight;
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / itemHeight) - VIRTUAL_OVERSCAN,
  );
  const visibleCount = Math.ceil((viewportHeight || itemHeight) / itemHeight);
  const endIndex = Math.min(
    filteredSessions.length,
    startIndex + visibleCount + VIRTUAL_OVERSCAN * 2,
  );
  const visibleSessions = filteredSessions.slice(startIndex, endIndex);

  useEffect(() => {
    if (!isPerfDebugEnabled()) {
      return;
    }

    console.info("[Perf][ChatList]", {
      totalSessions: displayedSessions.length,
      availableSessions: allOrderedSessionIds.length,
      filteredSessions: filteredSessions.length,
      currentSessionId,
      virtualized: shouldVirtualize,
      renderedCount: shouldVirtualize
        ? visibleSessions.length
        : filteredSessions.length,
      viewportHeight,
      scrollTop,
      startIndex: shouldVirtualize ? startIndex : 0,
      endIndex: shouldVirtualize ? endIndex : filteredSessions.length,
    });
  }, [
    displayedSessions.length,
    allOrderedSessionIds.length,
    endIndex,
    filteredSessions.length,
    scrollTop,
    shouldVirtualize,
    startIndex,
    viewportHeight,
    visibleSessions.length,
    currentSessionId,
  ]);

  if (!initialized) {
    return <div className={styles["chat-list-panel"]} />;
  }

  const listContent = !shouldVirtualize
    ? renderScrollContainer(
        <div className={styles["chat-list"]}>
          {filteredSessions.map(({ session: item, preview }) => (
            <StaticChatItem
              key={item.id}
              title={item.topic}
              keyword={filterText.trim()}
              preview={preview}
              time={formatChinaDateTime(item.displayTime)}
              count={item.messageCount}
              selected={item.id === currentSessionId}
              onClick={() => {
                if (multiDeleteMode) {
                  toggleDeleteSelection(item.id);
                  return;
                }
                navigate(`/chat/${item.id}`);
                selectChatSessionById(item.id);
              }}
              onDelete={() => void onDeleteSession(item.id)}
              multiDeleteMode={multiDeleteMode}
              multiDeleteSelected={selectedDeleteIds.includes(item.id)}
              avatar={item.avatar}
              model={item.model}
            />
          ))}
        </div>,
      )
    : renderScrollContainer(
        <div
          className={styles["chat-list-virtual"]}
          style={{ height: totalHeight }}
        >
          {visibleSessions.map(({ session: item, preview }, offset) => {
            const listIndex = startIndex + offset;
            return (
              <div
                key={item.id}
                className={styles["chat-list-virtual-row"]}
                style={{
                  height: itemHeight,
                  transform: `translateY(${listIndex * itemHeight}px)`,
                }}
              >
                <StaticChatItem
                  title={item.topic}
                  keyword={filterText.trim()}
                  preview={preview}
                  time={formatChinaDateTime(item.displayTime)}
                  count={item.messageCount}
                  selected={item.id === currentSessionId}
                  onClick={() => {
                    if (multiDeleteMode) {
                      toggleDeleteSelection(item.id);
                      return;
                    }
                    navigate(`/chat/${item.id}`);
                    selectChatSessionById(item.id);
                  }}
                  onDelete={() => void onDeleteSession(item.id)}
                  multiDeleteMode={multiDeleteMode}
                  multiDeleteSelected={selectedDeleteIds.includes(item.id)}
                  avatar={item.avatar}
                  model={item.model}
                />
              </div>
            );
          })}
        </div>,
      );

  return (
    <div className={styles["chat-list-panel"]}>
      {multiDeleteMode && (
        <div className={styles["chat-list-delete-bar"]}>
          <button type="button" onClick={exitMultiDeleteMode}>
            <CloseIcon />
            取消
          </button>
          <button
            type="button"
            disabled={selectedDeleteIds.length === 0}
            onClick={() => void onConfirmMultiDelete()}
          >
            <DeleteIcon />
            删除 {selectedDeleteIds.length}
          </button>
        </div>
      )}
      <div className={styles["chat-list-filter-card"]}>
        <input
          type="text"
          className={styles["chat-list-filter-input"]}
          placeholder={Locale.SearchChat.Page.Search}
          value={filterText}
          onChange={(e) => setFilterText(e.currentTarget.value)}
        />
      </div>
      {isChatListLoading ? (
        <div className={styles["chat-list-load-more-indicator"]}>
          <span className={styles["chat-list-load-more-dots"]}>
            <i />
            <i />
            <i />
          </span>
          <span>正在加载全部对话...</span>
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className={styles["chat-list-empty"]}>没有匹配的会话</div>
      ) : (
        <>
          {listContent}
          {!deferredFilterText && (
            <div className={styles["chat-list-load-more-indicator"]}>
              {loadingMore ? (
                <>
                  <span className={styles["chat-list-load-more-dots"]}>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>正在加载更多对话</span>
                </>
              ) : hasMoreSessions ? (
                <span>向下滚动以加载更多对话，共 {totalChatCount} 个</span>
              ) : (
                <span>已加载全部对话，共 {totalChatCount} 个</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
