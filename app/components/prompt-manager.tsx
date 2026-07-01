import { useState, useMemo, useEffect, useRef } from "react";
import { IconButton } from "./button";
import {
  List,
  ListItem,
  Modal,
  showToast,
  showConfirm,
  showTopNotice,
} from "./ui-lib";
import CloseIcon from "../icons/close.svg";
import AddIcon from "../icons/add.svg";
import ConfirmIcon from "../icons/confirm.svg";
import TrashIcon from "../icons/trash.svg";
import EyeIcon from "../icons/eye.svg";
import { useNavigate } from "react-router-dom";
import { usePromptStore, type Prompt } from "../store/prompt";
import { Path, StoreKey } from "../constant";
import { LoadingView } from "./loading-view";
import styles from "./prompt-manager.module.scss";

type PromptModalMode = "create" | "edit";
const MIN_PROMPT_LOADING_DURATION_MS = 700;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getHighlightedText(text: string, keyword: string) {
  const trimmedKeyword = keyword.trim();
  if (!trimmedKeyword) return text;

  const pattern = new RegExp(`(${escapeRegExp(trimmedKeyword)})`, "gi");
  return text.split(pattern).map((part, index) =>
    part.toLowerCase() === trimmedKeyword.toLowerCase() ? (
      <mark key={`${part}-${index}`} className={styles.searchHighlight}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function getContentPreview(content: string, keyword: string, maxLength = 120) {
  const trimmedKeyword = keyword.trim();
  if (!trimmedKeyword) {
    return content.length > maxLength
      ? `${content.slice(0, maxLength)}...`
      : content;
  }

  const lowerContent = content.toLowerCase();
  const lowerKeyword = trimmedKeyword.toLowerCase();
  const hitIndex = lowerContent.indexOf(lowerKeyword);
  if (hitIndex < 0) {
    return content.length > maxLength
      ? `${content.slice(0, maxLength)}...`
      : content;
  }

  const sideLength = Math.max(
    20,
    Math.floor((maxLength - trimmedKeyword.length) / 2),
  );
  const start = Math.max(0, hitIndex - sideLength);
  const end = Math.min(
    content.length,
    hitIndex + trimmedKeyword.length + sideLength,
  );
  return `${start > 0 ? "..." : ""}${content.slice(start, end)}${
    end < content.length ? "..." : ""
  }`;
}

export function PromptManagerPage() {
  const navigate = useNavigate();
  const promptStore = usePromptStore();

  const [searchText, setSearchText] = useState("");
  const [editingPromptId, setEditingPromptId] = useState<string | undefined>();
  const [editingPrompt, setEditingPrompt] = useState<{
    title: string;
    content: string;
  }>({ title: "", content: "" });
  const [promptModalMode, setPromptModalMode] =
    useState<PromptModalMode>("create");
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  const [isLoadingPrompts, setIsLoadingPrompts] = useState(true);
  const promptSyncingRef = useRef(false);
  const promptSyncTaskCountRef = useRef(0);

  useEffect(() => {
    const abortController = new AbortController();

    const loadPromptsFromDatabase = async () => {
      const loadingStartedAt = Date.now();
      let loadSucceeded = false;
      showTopNotice("正在从数据库读取提示词...");
      try {
        const { useSyncStore } = await import("../store/sync");
        await useSyncStore.getState().sync([StoreKey.Prompt], {
          force: true,
          isolateQueue: true,
          downloadOnlyRegular: true,
          silentSummary: true,
          abortSignal: abortController.signal,
        });
        loadSucceeded = true;
      } catch (error) {
        if (abortController.signal.aborted) return;
        console.error("[PromptManager] 从数据库读取提示词失败:", error);
        showTopNotice("从数据库读取提示词失败，已保留本地数据");
        showToast("提示词读取失败，请检查数据库连接");
      } finally {
        const remainingLoadingTime = Math.max(
          0,
          MIN_PROMPT_LOADING_DURATION_MS - (Date.now() - loadingStartedAt),
        );
        if (remainingLoadingTime > 0) {
          await new Promise((resolve) =>
            window.setTimeout(resolve, remainingLoadingTime),
          );
        }
        if (!abortController.signal.aborted) {
          setIsLoadingPrompts(false);
          if (loadSucceeded) {
            showTopNotice("提示词已从数据库更新");
          }
        }
      }
    };

    void loadPromptsFromDatabase();
    return () => abortController.abort();
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!promptSyncingRef.current) return;

      console.warn("[PromptManager] ⚠️ 页面刷新或关闭时提示词仍在同步中");
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const userPrompts = useMemo(() => {
    const all = promptStore.getUserPrompts();
    if (searchText.length === 0) return all;
    return promptStore.search(searchText);
  }, [promptStore, searchText]);

  const allPrompts = userPrompts;

  const openCreateModal = () => {
    setEditingPromptId(undefined);
    setEditingPrompt({ title: "", content: "" });
    setPromptModalMode("create");
    setIsPromptModalOpen(true);
  };

  const openEditModal = (prompt: Prompt) => {
    setEditingPromptId(prompt.id);
    setEditingPrompt({ title: prompt.title, content: prompt.content });
    setPromptModalMode("edit");
    setIsPromptModalOpen(true);
  };

  const syncPromptsToDatabase = async (successMessage: string) => {
    promptSyncTaskCountRef.current += 1;
    promptSyncingRef.current = true;

    showTopNotice("提示词同步中，请稍候...");
    console.log("===== 💾 提示词保存并同步 =====");
    console.log("[PromptManager] 🚀 开始同步提示词到 PostgreSQL...");
    try {
      const { useSyncStore } = await import("../store/sync");
      await useSyncStore.getState().sync([StoreKey.Prompt], {
        force: true,
        isolateQueue: true,
        silentSummary: true,
      });
      console.log("[PromptManager] ✅ 提示词同步完成");
      console.log("===== ✅ 提示词保存并同步完成 =====");
      showTopNotice(successMessage);
    } catch (error) {
      console.error("[PromptManager] 提示词同步失败:", error);
      showTopNotice("提示词同步失败，请稍后重试");
      showToast("提示词同步失败，请检查数据库连接");
    } finally {
      promptSyncTaskCountRef.current = Math.max(
        0,
        promptSyncTaskCountRef.current - 1,
      );
      if (promptSyncTaskCountRef.current === 0) {
        promptSyncingRef.current = false;
      }
    }
  };

  const closePromptManagerPage = async () => {
    if (promptSyncingRef.current) {
      console.warn("[PromptManager] ⚠️ 关闭页面时提示词仍在同步中");
      const confirmed = await showConfirm(
        "提示词正在同步中，离开页面可能导致同步未完成。确定要离开吗？",
      );
      if (!confirmed) return;
    }

    navigate(Path.Chat);
  };

  const savePrompt = async () => {
    if (!editingPrompt.title.trim()) {
      showToast("请输入提示词标题");
      return;
    }
    if (!editingPrompt.content.trim()) {
      showToast("请输入提示词内容");
      return;
    }

    if (editingPromptId) {
      promptStore.updatePrompt(editingPromptId, (p) => {
        p.title = editingPrompt.title;
        p.content = editingPrompt.content;
      });
      showToast("提示词已更新");
      void syncPromptsToDatabase("提示词同步成功");
    } else {
      promptStore.add({
        id: "",
        title: editingPrompt.title,
        content: editingPrompt.content,
        isUser: true,
        createdAt: Date.now(),
      });
      showToast("提示词已添加");
      void syncPromptsToDatabase("提示词同步成功");
    }

    setEditingPromptId(undefined);
    setIsPromptModalOpen(false);
  };

  const deletePrompt = async (prompt: Prompt) => {
    const confirmed = await showConfirm("确定要删除这个提示词吗？");
    if (!confirmed) return;

    promptStore.remove(prompt.id);
    showToast("提示词已删除");
    void syncPromptsToDatabase("提示词同步成功");
  };

  const closeModal = () => {
    setEditingPromptId(undefined);
    setIsPromptModalOpen(false);
  };

  const totalPromptCount = allPrompts.length;
  const promptModalTitle =
    promptModalMode === "edit" ? "查看并编辑提示词" : "添加提示词";

  const renderPromptRow = (prompt: Prompt) => (
    <div key={prompt.id} className={styles.promptRow}>
      <div className={`${styles.promptCell} ${styles.promptColTitle}`}>
        <div className={styles.promptCellLabel}>标题</div>
        <button
          type="button"
          className={styles.promptTitleButton}
          onClick={() => openEditModal(prompt)}
        >
          {getHighlightedText(prompt.title, searchText)}
        </button>
      </div>
      <div className={`${styles.promptCell} ${styles.promptColContent}`}>
        <div className={styles.promptCellLabel}>内容</div>
        <div className={styles.promptContent}>
          {getHighlightedText(
            getContentPreview(prompt.content, searchText),
            searchText,
          )}
        </div>
      </div>
      <div className={`${styles.promptCell} ${styles.promptColActions}`}>
        <div className={styles.promptCellLabel}>操作</div>
        <div className={styles.actions}>
          <IconButton
            icon={<EyeIcon />}
            text="查看并编辑"
            bordered
            onClick={() => openEditModal(prompt)}
          />
          <IconButton
            icon={<TrashIcon className={styles.profileDeleteIcon} />}
            text="删除"
            type="danger"
            bordered
            className={styles.dangerButton}
            onClick={() => deletePrompt(prompt)}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className={styles.page} data-top-notice-anchor="true">
      <div className="window-header" data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">提示词管理</div>
          <div className="window-header-sub-title">
            统一管理、查看并编辑和删除提示词
          </div>
        </div>
        <div className="window-actions">
          <div className="window-action-button">
            <IconButton
              aria="关闭"
              icon={<CloseIcon />}
              close
              onClick={closePromptManagerPage}
              bordered
            />
          </div>
        </div>
      </div>

      <div className={styles.content}>
        {isLoadingPrompts ? (
          <div
            className={styles.promptLoading}
            aria-label="正在从数据库读取提示词"
          >
            <LoadingView size="splash" className="no-dark" />
            <div className={styles.promptLoadingText}>
              正在加载最新提示词...
            </div>
          </div>
        ) : (
          <List className={styles.promptList}>
            <ListItem
              title="当前状态"
              subTitle={`当前共 ${totalPromptCount} 条提示词`}
            />

            <ListItem
              title="搜索和管理"
              subTitle="你可以搜索、查看并编辑、删除提示词"
              vertical
              className={styles.toolbarItem}
            >
              <div className={styles.searchBar}>
                <input
                  type="text"
                  placeholder="搜索提示词..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className={styles.searchInput}
                />
                <IconButton
                  icon={<AddIcon />}
                  text="新增提示词"
                  bordered
                  className={styles.addPromptButton}
                  onClick={openCreateModal}
                />
              </div>
            </ListItem>

            <ListItem
              title={`提示词列表 (${allPrompts.length})`}
              subTitle="提示词已合并展示，点击标题可查看完整内容"
              className={styles.sectionHeader}
            />

            {allPrompts.length === 0 ? (
              <ListItem
                title={
                  <div className={styles.emptyState}>
                    <span className={styles.emptyIcon}>✦</span>
                    <span>
                      {searchText.trim() ? "未搜索到相关提示词" : "暂无提示词"}
                    </span>
                  </div>
                }
                subTitle={
                  searchText.trim()
                    ? "请尝试更换关键词或清空搜索条件"
                    : "点击上方按钮添加提示词"
                }
                className={styles.emptyItem}
              />
            ) : (
              <div className={styles.promptTable}>
                <div className={styles.promptTableHeader}>
                  <div className={styles.promptColTitle}>标题</div>
                  <div className={styles.promptColContent}>内容</div>
                  <div className={styles.promptColActions}>操作</div>
                </div>
                {allPrompts.map((prompt) => renderPromptRow(prompt))}
              </div>
            )}
          </List>
        )}
      </div>

      {isPromptModalOpen && (
        <div className="modal-mask" onClick={closeModal}>
          <div onClick={(e) => e.stopPropagation()}>
            <Modal title={promptModalTitle} onClose={closeModal}>
              <div className={styles.modalContent}>
                <div className={styles.formItem}>
                  <label>标题</label>
                  <input
                    type="text"
                    value={editingPrompt.title}
                    onChange={(e) =>
                      setEditingPrompt({
                        ...editingPrompt,
                        title: e.target.value,
                      })
                    }
                    placeholder="输入提示词标题"
                    className={styles.input}
                  />
                </div>
                <div className={styles.formItem}>
                  <label>内容</label>
                  <textarea
                    value={editingPrompt.content}
                    onChange={(e) =>
                      setEditingPrompt({
                        ...editingPrompt,
                        content: e.target.value,
                      })
                    }
                    placeholder="输入提示词内容"
                    className={styles.textarea}
                    rows={8}
                  />
                </div>
                <div className={styles.modalActions}>
                  <IconButton
                    icon={<CloseIcon />}
                    text="取消"
                    bordered
                    onClick={closeModal}
                  />
                  <IconButton
                    icon={<ConfirmIcon />}
                    text={promptModalMode === "edit" ? "保存" : "添加"}
                    type="primary"
                    onClick={savePrompt}
                  />
                </div>
              </div>
            </Modal>
          </div>
        </div>
      )}
    </div>
  );
}
