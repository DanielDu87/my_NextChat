import type { BuildConfig } from "./types";

export function getClientConfig() {
  if (typeof document !== "undefined") {
    // client side
    return JSON.parse(queryMeta("config") || "{}") as BuildConfig;
  }
}

function queryMeta(key: string, defaultValue?: string): string {
  let ret: string;
  if (document) {
    const meta = document.head.querySelector(
      `meta[name='${key}']`,
    ) as HTMLMetaElement;
    ret = meta?.content ?? "";
  } else {
    ret = defaultValue ?? "";
  }

  return ret;
}
