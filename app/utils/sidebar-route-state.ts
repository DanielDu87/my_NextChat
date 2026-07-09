import { Path } from "../constant";

export function normalizeSidebarPathname(pathname: string) {
  const rawPath = String(pathname || "");
  const hashPath = rawPath.includes("#")
    ? rawPath.split("#").pop() || rawPath
    : rawPath;
  const cleanPath = (hashPath || rawPath).split("?")[0].replace(/^#/, "");
  const normalized =
    cleanPath.length > 1 ? cleanPath.replace(/\/+$/, "") : cleanPath;
  return normalized || Path.Home;
}

export function isSidebarRestrictedPagePath(pathname: string) {
  const normalizedPathname = normalizeSidebarPathname(pathname);
  return (
    normalizedPathname === Path.ChatBackups ||
    normalizedPathname === Path.LegacyChatBackups ||
    normalizedPathname === Path.ApiConfig ||
    normalizedPathname === Path.LegacyApiConfig ||
    normalizedPathname === Path.ProviderBalances ||
    normalizedPathname === Path.LegacyProviderBalances ||
    normalizedPathname === Path.ApiConfigBackups ||
    normalizedPathname === Path.LegacyApiConfigBackups ||
    normalizedPathname === Path.Plugins ||
    normalizedPathname === Path.PromptManager
  );
}

export const isBackupPagePath = isSidebarRestrictedPagePath;

export function isChatSessionRoutePath(pathname: string) {
  const normalizedPathname = normalizeSidebarPathname(pathname);
  return (
    normalizedPathname.startsWith(`${Path.Chat}/`) &&
    !isSidebarRestrictedPagePath(normalizedPathname) &&
    /^\/chat\/[^/]+$/.test(normalizedPathname)
  );
}

export function isChatPagePath(pathname: string) {
  const normalizedPathname = normalizeSidebarPathname(pathname);
  return (
    normalizedPathname === Path.Home ||
    normalizedPathname === Path.Chat ||
    normalizedPathname === Path.NewChat ||
    isChatSessionRoutePath(normalizedPathname)
  );
}

export function getSidebarRouteState(pathname: string) {
  const normalizedPathname = normalizeSidebarPathname(pathname);
  const isSidebarRestrictedPage =
    isSidebarRestrictedPagePath(normalizedPathname);
  const isChatPage = isChatPagePath(normalizedPathname);

  return {
    pathname: normalizedPathname,
    isBackupPage: isSidebarRestrictedPage,
    isSidebarRestrictedPage,
    isChatPage,
    disableChatList: !isChatPage,
    disableHeaderActions: isSidebarRestrictedPage,
    disableBottomActions: !isChatPage && !isSidebarRestrictedPage,
    disableDeleteAction: !isChatPage,
  };
}
