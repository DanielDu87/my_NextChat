import DeleteIcon from "../icons/delete.svg";

import styles from "./home.module.scss";
import {
  DragDropContext,
  Droppable,
  Draggable,
  OnDragEndResponder,
} from "@hello-pangea/dnd";

import { useChatStore } from "../store";

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
} from "react";
import { showConfirm } from "./ui-lib";
import { useMobileScreen } from "../utils";
import clsx from "clsx";
import { ChatSessionSummary, DEFAULT_TOPIC } from "../store/chat";
import { shallow } from "zustand/shallow";

const VIRTUAL_LIST_THRESHOLD = 80;
const VIRTUAL_OVERSCAN = 6;
const NORMAL_ITEM_HEIGHT = 84;
const NARROW_ITEM_HEIGHT = 50;
const PERF_DEBUG_KEY = "nextchat_perf_debug";

type DisplayedSession = {
  session: ChatSessionSummary;
  originalIndex: number;
  pinned: boolean;
};

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
  count: number;
  time: string;
  selected: boolean;
  narrow?: boolean;
  avatar: string;
  model: string;
  draggableRef?: (element: HTMLDivElement | null) => void;
  draggableProps?: any;
  dragHandleProps?: any;
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

  return (
    <div
      className={clsx(styles["chat-item"], {
        [styles["chat-item-selected"]]:
          props.selected &&
          (currentPath === Path.Chat || currentPath === Path.Home),
      })}
      onClick={props.onClick}
      ref={(element) => {
        draggableRef.current = element;
        props.draggableRef?.(element);
      }}
      {...props.draggableProps}
      {...props.dragHandleProps}
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
          <div className={styles["chat-item-title"]}>{props.title}</div>
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

function DraggableChatItem(
  props: {
    id: string;
    index: number;
  } & ComponentProps<typeof ChatItemCard>,
) {
  const { id, index, ...rest } = props;

  return (
    <Draggable draggableId={id} index={index}>
      {(provided) => (
        <ChatItemCard
          {...rest}
          draggableRef={provided.innerRef}
          draggableProps={provided.draggableProps}
          dragHandleProps={provided.dragHandleProps}
        />
      )}
    </Draggable>
  );
}

function StaticChatItem(props: ComponentProps<typeof ChatItemCard>) {
  return <ChatItemCard {...props} />;
}

export function ChatList(props: { narrow?: boolean }) {
  const [sessionSummaries, selectedIndex, selectSession, moveSession] =
    useChatStore(
      (state) => [
        state.sessionSummaries,
        state.currentSessionIndex,
        state.selectSession,
        state.moveSession,
      ],
      shallow,
    );
  const chatStore = useChatStore();
  const navigate = useNavigate();
  const isMobileScreen = useMobileScreen();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

  const pinnedSession = sessionSummaries.find(isPinnedNewChat);
  const displayedSessions = useMemo<DisplayedSession[]>(
    () =>
      pinnedSession
        ? [
            {
              session: pinnedSession,
              originalIndex: sessionSummaries.findIndex(
                (item) => item.id === pinnedSession.id,
              ),
              pinned: true,
            },
            ...sessionSummaries
              .map((session, index) => ({
                session,
                originalIndex: index,
                pinned: false,
              }))
              .filter((item) => item.session.id !== pinnedSession.id),
          ]
        : sessionSummaries.map((session, index) => ({
            session,
            originalIndex: index,
            pinned: false,
          })),
    [pinnedSession, sessionSummaries],
  );

  const itemHeight = props.narrow ? NARROW_ITEM_HEIGHT : NORMAL_ITEM_HEIGHT;
  const shouldVirtualize = displayedSessions.length > VIRTUAL_LIST_THRESHOLD;

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

    const displayedIndex = displayedSessions.findIndex(
      (item) => item.originalIndex === selectedIndex,
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
  }, [displayedSessions, itemHeight, selectedIndex, shouldVirtualize]);

  const onDeleteSession = async (originalIndex: number) => {
    if (
      (!props.narrow && !isMobileScreen) ||
      (await showConfirm(Locale.Home.DeleteChat))
    ) {
      chatStore.deleteSession(originalIndex);
    }
  };

  const onDragEnd: OnDragEndResponder = (result) => {
    const { destination, source } = result;
    if (!destination) {
      return;
    }

    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }

    const sourceItem = displayedSessions[source.index];
    const destinationItem = displayedSessions[destination.index];

    if (
      !sourceItem ||
      !destinationItem ||
      sourceItem.pinned ||
      destinationItem.pinned
    ) {
      return;
    }

    moveSession(sourceItem.originalIndex, destinationItem.originalIndex);
  };

  const totalHeight = displayedSessions.length * itemHeight;
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / itemHeight) - VIRTUAL_OVERSCAN,
  );
  const visibleCount = Math.ceil((viewportHeight || itemHeight) / itemHeight);
  const endIndex = Math.min(
    displayedSessions.length,
    startIndex + visibleCount + VIRTUAL_OVERSCAN * 2,
  );
  const visibleSessions = displayedSessions.slice(startIndex, endIndex);

  useEffect(() => {
    if (!isPerfDebugEnabled()) {
      return;
    }

    console.info("[Perf][ChatList]", {
      totalSessions: displayedSessions.length,
      selectedIndex,
      narrow: Boolean(props.narrow),
      virtualized: shouldVirtualize,
      renderedCount: shouldVirtualize
        ? visibleSessions.length
        : displayedSessions.length,
      viewportHeight,
      scrollTop,
      startIndex: shouldVirtualize ? startIndex : 0,
      endIndex: shouldVirtualize ? endIndex : displayedSessions.length,
    });
  }, [
    displayedSessions.length,
    endIndex,
    props.narrow,
    scrollTop,
    selectedIndex,
    shouldVirtualize,
    startIndex,
    viewportHeight,
    visibleSessions.length,
  ]);

  if (!shouldVirtualize) {
    return (
      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="chat-list">
          {(provided) => (
            <div
              className={styles["chat-list"]}
              ref={provided.innerRef}
              {...provided.droppableProps}
            >
              {displayedSessions.map(({ session: item, originalIndex }, i) => (
                <DraggableChatItem
                  key={item.id}
                  id={item.id}
                  index={i}
                  title={item.topic}
                  time={new Date(item.displayTime).toLocaleString()}
                  count={item.messageCount}
                  selected={originalIndex === selectedIndex}
                  onClick={() => {
                    navigate(Path.Chat);
                    selectSession(originalIndex);
                  }}
                  onDelete={() => void onDeleteSession(originalIndex)}
                  narrow={props.narrow}
                  avatar={item.avatar}
                  model={item.model}
                />
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    );
  }

  return (
    <div
      className={styles["chat-list-scroll"]}
      ref={listRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        className={styles["chat-list-virtual"]}
        style={{ height: totalHeight }}
      >
        {visibleSessions.map(({ session: item, originalIndex }, offset) => {
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
                time={new Date(item.displayTime).toLocaleString()}
                count={item.messageCount}
                selected={originalIndex === selectedIndex}
                onClick={() => {
                  navigate(Path.Chat);
                  selectSession(originalIndex);
                }}
                onDelete={() => void onDeleteSession(originalIndex)}
                narrow={props.narrow}
                avatar={item.avatar}
                model={item.model}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
