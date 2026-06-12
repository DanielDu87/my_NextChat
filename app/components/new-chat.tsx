import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { createNewChatWithSyncedModel } from "../utils/new-chat";

export function NewChat() {
  const navigate = useNavigate();

  useEffect(() => {
    let disposed = false;

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
