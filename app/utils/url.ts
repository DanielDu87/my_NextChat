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

// API 配置允许填写完整的对话端点（而不只是服务根地址）。这类地址必须直接
// 使用，避免客户端把 `chat/completions` 等路径再次拼接到末尾。
export function isExplicitChatEndpointUrl(baseUrl: string) {
  const pathname = String(baseUrl || "")
    .trim()
    .split(/[?#]/, 1)[0]
    .replace(/\/+$/, "")
    .toLowerCase();

  return /\/(?:chat\/completions|responses|messages|completions|generatecontent|streamgeneratecontent|generation)$/.test(
    pathname,
  );
}

export function joinChatUrl(baseUrl: string, path: string) {
  const normalizedBaseUrl = String(baseUrl || "").trim();
  return isExplicitChatEndpointUrl(normalizedBaseUrl)
    ? normalizedBaseUrl
    : joinUrlPath(normalizedBaseUrl, path);
}

export function normalizeProviderBaseUrl(baseUrl: string) {
  const trimmed = String(baseUrl || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/\/+$/g, "");
}
