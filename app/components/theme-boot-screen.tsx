"use client";

import { useEffect } from "react";

const BOOT_SCREEN_FALLBACK_DELAY_MS = 6000;

export function ThemeBootScreen(props: { id: string }) {
  useEffect(() => {
    const bootScreen = document.getElementById(props.id);
    if (!bootScreen) return;

    let removed = false;
    let fallbackTimer: number | undefined;

    const removeBootScreen = () => {
      if (removed) return;
      removed = true;
      bootScreen.remove();
    };

    const removeAfterPaint = () => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(removeBootScreen);
      });
    };

    window.addEventListener("nextchat:theme-ready", removeAfterPaint, {
      once: true,
    });

    if (document.readyState === "complete") {
      fallbackTimer = window.setTimeout(
        removeAfterPaint,
        BOOT_SCREEN_FALLBACK_DELAY_MS,
      );
    } else {
      window.addEventListener(
        "load",
        () => {
          fallbackTimer = window.setTimeout(
            removeAfterPaint,
            BOOT_SCREEN_FALLBACK_DELAY_MS,
          );
        },
        { once: true },
      );
    }

    return () => {
      window.removeEventListener("nextchat:theme-ready", removeAfterPaint);
      if (fallbackTimer !== undefined) {
        window.clearTimeout(fallbackTimer);
      }
      removeBootScreen();
    };
  }, [props.id]);

  return null;
}
