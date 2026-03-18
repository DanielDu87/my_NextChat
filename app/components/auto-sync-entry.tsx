"use client";

import dynamic from "next/dynamic";

const AutoSync = dynamic(() => import("./auto-sync"), {
  ssr: false,
});

export default function AutoSyncEntry() {
  return <AutoSync />;
}
