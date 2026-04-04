const AIHUBMIX_APP_CODE = "NVIO0436";

export function isAiHubMixUrl(baseUrl?: string) {
  if (!baseUrl) return false;

  try {
    return new URL(baseUrl).hostname === "aihubmix.com";
  } catch {
    return false;
  }
}

export function appendAihubmixHeaders(
  headers: Record<string, string>,
  baseUrl?: string,
) {
  if (isAiHubMixUrl(baseUrl)) {
    headers["APP-Code"] = AIHUBMIX_APP_CODE;
  }

  return headers;
}

export { AIHUBMIX_APP_CODE };
