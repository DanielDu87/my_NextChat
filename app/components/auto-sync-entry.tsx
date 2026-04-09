"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const AutoSync = dynamic(() => import("./auto-sync"), {
  ssr: false,
});

export default function AutoSyncEntry() {
  const [shouldMount, setShouldMount] = useState(false);

  useEffect(() => {
    let timer = 0;
    const mount = () => {
      timer = window.setTimeout(() => {
        setShouldMount(true);
      }, 800);
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      (
        window as typeof window & {
          requestIdleCallback: (
            callback: () => void,
            options?: { timeout?: number },
          ) => number;
        }
      ).requestIdleCallback(mount, { timeout: 1200 });
    } else {
      mount();
    }

    return () => {
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  return shouldMount ? <AutoSync /> : null;
}
