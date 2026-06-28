import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Path } from "../constant";
import {
  createNewChatWithSyncedModel,
  isCurrentFreshDefaultChat,
} from "../utils/new-chat";

export function NewChat() {
  const navigate = useNavigate();

  useEffect(() => {
    let disposed = false;

    if (isCurrentFreshDefaultChat()) {
      navigate(Path.Chat, { replace: true });
      return;
    }

    void createNewChatWithSyncedModel().finally(() => {
      if (!disposed) {
        navigate(Path.Chat, { replace: true });
      }
    });

    return () => {
      disposed = true;
    };
  }, [navigate]);

  return null;
}
