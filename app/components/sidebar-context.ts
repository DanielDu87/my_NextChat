import { createContext, useContext } from "react";

export const SidebarContext = createContext<{
  visible: boolean;
  toggle: () => void;
  close: () => void;
}>({ visible: false, toggle: () => {}, close: () => {} });

export function useSidebarContext() {
  return useContext(SidebarContext);
}
