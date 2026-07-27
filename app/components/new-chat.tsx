import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { startNewChat } from "../utils/new-chat";

/**
 * /new-chat 只作为外链 / 书签 / 切换用户后的兜底入口。
 * 应用内的「新建聊天」按钮直接调 startNewChat，不再经过本路由，
 * 否则会多一次 Chat 卸载 → 重新挂载，看起来像整页刷新。
 */
export function NewChat() {
  const navigate = useNavigate();

  useEffect(() => {
    startNewChat(navigate, { replace: true });
  }, [navigate]);

  return null;
}
