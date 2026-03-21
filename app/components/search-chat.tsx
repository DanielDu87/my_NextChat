import {
  useState,
  useRef,
  useCallback,
  useDeferredValue,
  useMemo,
  useEffect,
  startTransition,
  ReactNode,
} from "react";
import { ErrorBoundary } from "./error";
import styles from "./mask.module.scss";
import { useNavigate } from "react-router-dom";
import { IconButton } from "./button";
import CloseIcon from "../icons/close.svg";
import EyeIcon from "../icons/eye.svg";
import Locale from "../locales";
import { Path } from "../constant";

import { useChatStore } from "../store";

type Item = {
  id: number;
  name: string;
  content: string;
};

const MAX_RESULTS = 200;
const MAX_SNIPPETS_PER_SESSION = 3;
const SNIPPET_CONTEXT_LENGTH = 35;

export function SearchChatPage() {
  const navigate = useNavigate();

  const chatStore = useChatStore();

  const sessions = chatStore.sessions;
  const selectSession = chatStore.selectSession;

  const [searchResults, setSearchResults] = useState<Item[]>([]);
  const [searchText, setSearchText] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchCacheRef = useRef<
    Map<
      string,
      {
        signature: string;
        corpus: string;
      }
    >
  >(new Map());
  const deferredSearchText = useDeferredValue(searchText.trim());

  const indexedSessions = useMemo(
    () =>
      sessions.map((session, index) => ({
        id: session.id,
        index,
        topic: session.topic,
        topicLower: session.topic.toLowerCase(),
        lastUpdate: Number(session.lastUpdate || 0),
        messageCount: session.messages.length,
      })),
    [sessions],
  );

  const getSessionCorpus = useCallback(
    (sessionIndex: number) => {
      const session = sessions[sessionIndex];
      if (!session) {
        return "";
      }

      const signature = `${session.lastUpdate}:${session.messages.length}`;
      const cached = searchCacheRef.current.get(session.id);
      if (cached?.signature === signature) {
        return cached.corpus;
      }

      const corpus = session.messages
        .map((message) =>
          typeof message.content === "string"
            ? message.content.toLowerCase()
            : "",
        )
        .filter(Boolean)
        .join("\n");

      searchCacheRef.current.set(session.id, {
        signature,
        corpus,
      });

      return corpus;
    },
    [sessions],
  );

  const buildSessionSnippets = useCallback(
    (sessionIndex: number, lowerCaseText: string) => {
      const session = sessions[sessionIndex];
      if (!session) {
        return [];
      }

      const snippets: string[] = [];

      for (const message of session.messages) {
        const content =
          typeof message.content === "string" ? message.content : "";
        if (!content) {
          continue;
        }

        const lowerCaseContent = content.toLowerCase();
        let pos = lowerCaseContent.indexOf(lowerCaseText);

        while (pos !== -1 && snippets.length < MAX_SNIPPETS_PER_SESSION) {
          const start = Math.max(0, pos - SNIPPET_CONTEXT_LENGTH);
          const end = Math.min(
            content.length,
            pos + lowerCaseText.length + SNIPPET_CONTEXT_LENGTH,
          );
          snippets.push(content.substring(start, end));
          pos = lowerCaseContent.indexOf(
            lowerCaseText,
            pos + lowerCaseText.length,
          );
        }

        if (snippets.length >= MAX_SNIPPETS_PER_SESSION) {
          break;
        }
      }

      return snippets;
    },
    [sessions],
  );

  const doSearch = useCallback(
    (text: string) => {
      const lowerCaseText = text.toLowerCase();
      const results: Array<Item & { score: number; lastUpdate: number }> = [];

      indexedSessions.forEach((entry) => {
        const topicMatched = entry.topicLower.includes(lowerCaseText);
        const corpus = getSessionCorpus(entry.index);
        const contentMatched = corpus.includes(lowerCaseText);

        if (!topicMatched && !contentMatched) {
          return;
        }

        const snippets = buildSessionSnippets(entry.index, lowerCaseText);
        const score =
          (topicMatched ? 1000 : 0) +
          snippets.length * 100 +
          Math.min(entry.messageCount, 100);

        results.push({
          id: entry.index,
          name: entry.topic,
          content: snippets.join("... ") || entry.topic,
          score,
          lastUpdate: entry.lastUpdate,
        });
      });

      results.sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }

        return b.lastUpdate - a.lastUpdate;
      });

      return results
        .slice(0, MAX_RESULTS)
        .map(({ score, lastUpdate, ...item }) => item);
    },
    [buildSessionSnippets, getSessionCorpus, indexedSessions],
  );

  const renderHighlightedText = useCallback(
    (text: string): ReactNode => {
      const keyword = deferredSearchText.trim();
      if (!keyword) {
        return text;
      }

      const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const segments = text.split(new RegExp(`(${escapedKeyword})`, "gi"));

      return segments.map((segment, index) =>
        segment.toLowerCase() === keyword.toLowerCase() ? (
          <mark
            key={`${segment}-${index}`}
            className={styles["search-highlight"]}
          >
            {segment}
          </mark>
        ) : (
          <span key={`${segment}-${index}`}>{segment}</span>
        ),
      );
    },
    [deferredSearchText],
  );

  useEffect(() => {
    if (!deferredSearchText) {
      startTransition(() => setSearchResults([]));
      return;
    }

    const nextResults = doSearch(deferredSearchText);
    startTransition(() => setSearchResults(nextResults));
  }, [deferredSearchText, doSearch]);

  return (
    <ErrorBoundary>
      <div className={styles["mask-page"]}>
        {/* header */}
        <div className="window-header">
          <div className="window-header-title">
            <div className="window-header-main-title">
              {Locale.SearchChat.Page.Title}
            </div>
            <div className="window-header-submai-title">
              {Locale.SearchChat.Page.SubTitle(searchResults.length)}
            </div>
          </div>

          <div className="window-actions">
            <div className="window-action-button">
              <IconButton
                icon={<CloseIcon />}
                bordered
                onClick={() => navigate(-1)}
              />
            </div>
          </div>
        </div>

        <div className={styles["mask-page-body"]}>
          <div className={styles["mask-filter"]}>
            {/**搜索输入框 */}
            <input
              type="text"
              className={styles["search-bar"]}
              placeholder={Locale.SearchChat.Page.Search}
              autoFocus
              ref={searchInputRef}
              value={searchText}
              onChange={(e) => setSearchText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const nextSearchText = e.currentTarget.value.trim();
                  if (nextSearchText.length > 0) {
                    const result = doSearch(nextSearchText);
                    startTransition(() => setSearchResults(result));
                  }
                }
              }}
            />
          </div>

          <div>
            {searchResults.map((item) => (
              <div
                className={styles["mask-item"]}
                key={item.id}
                onClick={() => {
                  navigate(Path.Chat);
                  selectSession(item.id);
                }}
                style={{ cursor: "pointer" }}
              >
                {/** 搜索匹配的文本 */}
                <div className={styles["mask-header"]}>
                  <div className={styles["mask-title"]}>
                    <div className={styles["mask-name"]}>
                      {renderHighlightedText(item.name)}
                    </div>
                    <div className={styles["mask-info"]}>
                      {renderHighlightedText(item.content.slice(0, 70))}
                    </div>
                  </div>
                </div>
                {/** 操作按钮 */}
                <div className={styles["mask-actions"]}>
                  <IconButton
                    icon={<EyeIcon />}
                    text={Locale.SearchChat.Item.View}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
