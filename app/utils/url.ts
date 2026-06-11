export function normalizeUrlPathPart(part: string) {
  return String(part || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
}

export function joinUrlPath(baseUrl: string, path: string) {
  const normalizedBaseUrl = String(baseUrl || "")
    .trim()
    .replace(/\/+$/g, "");
  const normalizedPath = normalizeUrlPathPart(path);
  if (!normalizedBaseUrl) return normalizedPath;
  if (!normalizedPath) return normalizedBaseUrl;

  const baseSegments = normalizedBaseUrl.split("/");
  const pathSegments = normalizedPath.split("/").filter(Boolean);

  while (
    baseSegments.length > 0 &&
    pathSegments.length > 0 &&
    baseSegments[baseSegments.length - 1].toLowerCase() ===
      pathSegments[0].toLowerCase()
  ) {
    pathSegments.shift();
  }

  return [normalizedBaseUrl, ...pathSegments].join("/");
}

export function normalizeProviderBaseUrl(baseUrl: string) {
  const trimmed = String(baseUrl || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/g, "");
}
