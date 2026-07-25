// 共享「打开文件预览弹窗」入口。chat.tsx 与 markdown.tsx 都通过这个 hook
// 弹出同一个 FilePreviewContent，互斥逻辑（同一文件不重复打开、上一个弹窗
// 自动关闭）放在模块级 ref 上，跨调用方生效。
import { useCallback, useRef } from "react";
import clsx from "clsx";
import { showModal, showTopNotice } from "../components/ui-lib";
import chatStyles from "../components/chat.module.scss";
import { ChatMessageAttachedFile } from "../store/chat";
import {
  FilePreviewContent,
  getPreviewFileKind,
  isDocxPreviewFile,
} from "../components/file-preview";

// 模块级 ref：跨 React 实例共享同一个「当前打开的预览」状态，避免
// chat.tsx 和 markdown.tsx 同时各自开一个弹窗。
const activeFilePreviewCloseRef: { current: (() => void) | null } = {
  current: null,
};
const activeFilePreviewKeyRef: { current: string } = { current: "" };

function closeActivePreview() {
  activeFilePreviewCloseRef.current?.();
  activeFilePreviewCloseRef.current = null;
  activeFilePreviewKeyRef.current = "";
}

export function useFilePreview() {
  // 每次 hook 调用都拿到当前 ref，但写操作直接落到模块级 ref 上。
  const closeRef = useRef(activeFilePreviewCloseRef);

  const openFilePreview = useCallback((file: ChatMessageAttachedFile) => {
    const previewUrl = String(
      file.localPreviewUrl || file.previewUrl || "",
    ).trim();
    if (!previewUrl) {
      showTopNotice("该文件暂时无法预览");
      return;
    }

    const previewKey = `${file.id}|${previewUrl}|${file.name}|${file.type}`;
    if (activeFilePreviewKeyRef.current === previewKey) {
      return;
    }

    closeActivePreview();
    activeFilePreviewKeyRef.current = previewKey;
    const previewFileKind = getPreviewFileKind(file);

    const closeModalRef = { current: null as (() => void) | null };
    const closeModal = showModal({
      title: file.name || "文件预览",
      hideHeader: true,
      hideCloseButton: true,
      defaultMax: false,
      className: clsx(chatStyles["file-preview-modal"], {
        [chatStyles["file-preview-modal-office"]]:
          previewFileKind === "spreadsheet",
        [chatStyles["file-preview-modal-document"]]:
          previewFileKind === "document" && isDocxPreviewFile(file),
      }),
      contentClassName: clsx(chatStyles["file-preview-modal-content"], {
        [chatStyles["file-preview-modal-content-office"]]:
          previewFileKind === "spreadsheet" ||
          (previewFileKind === "document" && isDocxPreviewFile(file)),
      }),
      onClose: () => {
        activeFilePreviewCloseRef.current = null;
        activeFilePreviewKeyRef.current = "";
      },
      children: (
        <FilePreviewContent
          file={{ ...file, previewUrl }}
          onClose={() => closeModalRef.current?.()}
        />
      ),
    });
    closeModalRef.current = closeModal;
    closeRef.current.current = closeModal;
    activeFilePreviewCloseRef.current = closeModal;
  }, []);

  return { openFilePreview };
}