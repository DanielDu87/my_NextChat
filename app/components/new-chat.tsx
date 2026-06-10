import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Path } from "../constant";
import { useChatStore } from "../store";

export function NewChat() {
  const newSession = useChatStore((state) => state.newSession);
  const navigate = useNavigate();

  useEffect(() => {
    newSession();
    navigate(Path.Chat, { replace: true });
  }, [navigate, newSession]);

  return null;
}
