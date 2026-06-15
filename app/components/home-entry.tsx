"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getCurrentHashPath } from "../utils/startup-sync-scope";
import { prepareRouteEntryForSync } from "../utils/route-sync-entry";

const Home = dynamic(() => import("./home"), {
  ssr: false,
  loading: () => <div suppressHydrationWarning />,
});

function normalizeLegacyDrawHash() {
  if (typeof window === "undefined") return false;

  if (window.location.hash === "#/sd") {
    window.history.replaceState(null, "", "#/draw");
    return true;
  }

  if (
    window.location.hash === "#/sd/history" ||
    window.location.hash === "#/sd-new"
  ) {
    window.history.replaceState(null, "", "#/draw/history");
    return true;
  }

  return false;
}

export default function HomeEntry() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    normalizeLegacyDrawHash();
    prepareRouteEntryForSync(getCurrentHashPath(), {
      source: "route-guard",
    });
    setReady(true);
  }, []);

  if (!ready) {
    normalizeLegacyDrawHash();
    return <div suppressHydrationWarning />;
  }

  return <Home />;
}
