"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getCurrentHashPath } from "../utils/startup-sync-scope";
import { prepareRouteEntryForSync } from "../utils/route-sync-entry";

const Home = dynamic(() => import("./home"), {
  ssr: false,
  loading: () => <div suppressHydrationWarning />,
});

function normalizeLegacyHashRoute() {
  if (typeof window === "undefined") return false;

  const hash = window.location.hash;
  if (!hash.startsWith("#/")) {
    return false;
  }

  const hashPathWithQuery = hash.slice(1);
  const [hashPath, hashQuery = ""] = hashPathWithQuery.split("?");
  const nextPath =
    hashPath === "/sd"
      ? "/draw"
      : hashPath === "/sd/history" || hashPath === "/sd-new"
      ? "/draw/history"
      : hashPath;
  const nextSearch = hashQuery ? `?${hashQuery}` : window.location.search;

  window.history.replaceState(null, "", `${nextPath}${nextSearch}`);
  return true;
}

function normalizeLegacyDrawPath() {
  if (typeof window === "undefined") return false;

  if (window.location.pathname === "/sd") {
    window.history.replaceState(null, "", "/draw");
    return true;
  }

  if (
    window.location.pathname === "/sd/history" ||
    window.location.pathname === "/sd-new"
  ) {
    window.history.replaceState(null, "", "/draw/history");
    return true;
  }

  return false;
}

export default function HomeEntry() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    normalizeLegacyHashRoute() || normalizeLegacyDrawPath();
    prepareRouteEntryForSync(getCurrentHashPath(), {
      source: "route-guard",
    });
    setReady(true);
  }, []);

  if (!ready) {
    normalizeLegacyHashRoute() || normalizeLegacyDrawPath();
    return <div suppressHydrationWarning />;
  }

  return <Home />;
}
