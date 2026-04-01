import DeleteIcon from "../icons/delete.svg";

import styles from "./home.module.scss";

import {
  selectChatSessionById,
  useChatIndexStore,
  useChatStore,
} from "../store";

import Locale from "../locales";
import { useLocation, useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { MaskAvatar } from "./mask";
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

const VIRTUAL_LIST_THRESHOLD = 80;
const VIRTUAL_OVERSCAN = 6;
const NORMAL_ITEM_HEIGHT = 84;
const FILTERED_ITEM_HEIGHT = 108;
const NARROW_ITEM_HEIGHT = 50;
const PERF_DEBUG_KEY = "nextchat_perf_debug";
const SNIPPET_CONTEXT_LENGTH = 18;

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
  narrow?: boolean;
  avatar: string;
  model: string;
}) {
  const draggableRef = useRef<HTMLDivElement | null>(null);
  const { pathname: currentPath } = useLocation();

  useEffect(() => {
    if (props.selected && draggableRef.current) {
      draggableRef.current.scrollIntoView({
        block: "center",
      });
    }
  }, [props.selected]);

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
      })}
      onClick={props.onClick}
      ref={(element) => {
        draggableRef.current = element;
      }}
      title={`${props.title}\n${Locale.ChatItem.ChatItemCount(props.count)}`}
    >
      {props.narrow ? (
        <div className={styles["chat-item-narrow"]}>
          <div className={clsx(styles["chat-item-avatar"], "no-dark")}>
            <MaskAvatar avatar={props.avatar} model={props.model} />
          </div>
          <div className={styles["chat-item-narrow-count"]}>{props.count}</div>
        </div>
      ) : (
        <>
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
        </>
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

export function ChatList(props: { narrow?: boolean }) {
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
  const deferredFilterText = useDeferredValue(filterText.trim().toLowerCase());
  const loadingMoreTimerRef = useRef<number | null>(null);
  const hasMoreSessions =
    orderedSessionIds.length < allOrderedSessionIds.length;

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
              .filter((item) => item.session.id !== pinnedSession.id),
          ]
        : summaryList.map((session) => ({
            session,
          })),
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

  const itemHeight = props.narrow
    ? NARROW_ITEM_HEIGHT
    : deferredFilterText
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
    if (!shouldVirtualize || !listRef.current) {
      return;
    }

    const displayedIndex = filteredSessions.findIndex(
      (item) => item.session.id === currentSessionId,
    );

    if (displayedIndex < 0) {
      return;
    }

    const itemTop = displayedIndex * itemHeight;
    const itemBottom = itemTop + itemHeight;
    const currentTop = listRef.current.scrollTop;
    const currentBottom = currentTop + listRef.current.clientHeight;

    if (itemTop >= currentTop && itemBottom <= currentBottom) {
      return;
    }

    listRef.current.scrollTo({
      top: Math.max(0, itemTop - listRef.current.clientHeight / 2 + itemHeight),
    });
  }, [currentSessionId, filteredSessions, itemHeight, shouldVirtualize]);

  useEffect(() => {
    return () => {
      if (loadingMoreTimerRef.current) {
        window.clearTimeout(loadingMoreTimerRef.current);
      }
    };
  }, []);

  const onDeleteSession = async (sessionId: string) => {
    if (
      (!props.narrow && !isMobileScreen) ||
      (await showConfirm(Locale.Home.DeleteChat))
    ) {
      const originalIndex = orderedSessionIds.findIndex(
        (id) => id === sessionId,
      );
      if (originalIndex >= 0) {
        useChatStore.getState().deleteSession(originalIndex);
      }
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
      narrow: Boolean(props.narrow),
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
    props.narrow,
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
                navigate(`/chat/${item.id}`);
                selectChatSessionById(item.id);
              }}
              onDelete={() => void onDeleteSession(item.id)}
              narrow={props.narrow}
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
                    navigate(`/chat/${item.id}`);
                    selectChatSessionById(item.id);
                  }}
                  onDelete={() => void onDeleteSession(item.id)}
                  narrow={props.narrow}
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
      {!props.narrow && (
        <div className={styles["chat-list-filter-card"]}>
          <input
            type="text"
            className={styles["chat-list-filter-input"]}
            placeholder={Locale.SearchChat.Page.Search}
            value={filterText}
            onChange={(e) => setFilterText(e.currentTarget.value)}
          />
        </div>
      )}
      {filteredSessions.length === 0 ? (
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
                <span>向下滚动以加载更多对话</span>
              ) : (
                <span>已加载全部对话</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
