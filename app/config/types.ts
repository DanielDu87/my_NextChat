export type BuildConfig = {
  version: string;
  commitDate: string;
  commitHash: string;
  buildMode: string;
  isApp: boolean;
  template: string;
  enableGoogleFonts: boolean;
  githubBaseUrl: string;
  githubApiBaseUrl: string;
  githubRawBaseUrl: string;
  enableShareGpt: boolean;
  shareGptUrl: string;
  mcpMarketUrl: string;
  enableEdgeTts: boolean;
  edgeTtsVoicesUrl: string;
  edgeTtsWssUrl: string;
};
