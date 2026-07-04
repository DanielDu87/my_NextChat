import { DEFAULT_INPUT_TEMPLATE } from "../constant";
import type { BuildConfig } from "./types";

let cachedBuildConfig: BuildConfig | undefined;

function getVersion() {
  try {
    const fs = require("fs");
    const path = require("path");
    const tauriConfigPath = path.join(
      process.cwd(),
      "src-tauri",
      "tauri.conf.json",
    );

    if (fs.existsSync(tauriConfigPath)) {
      const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, "utf8"));
      const tauriVersion = tauriConfig?.package?.version;

      if (tauriVersion) {
        return `v${tauriVersion}`;
      }
    }
  } catch (e) {
    console.warn("[Build Config] Failed to read tauri.conf.json.");
  }

  try {
    const packageJson = require("../../package.json");
    if (packageJson?.version) {
      return `v${packageJson.version}`;
    }
  } catch (e) {
    console.warn("[Build Config] Failed to read package.json version.");
  }

  return "unknown";
}

function getCommitInfo() {
  const normalizeBuildValue = (value?: string) => {
    const normalized = value?.trim();
    return normalized && normalized.toLowerCase() !== "unknown"
      ? normalized
      : undefined;
  };
  const commitDateEnv = normalizeBuildValue(
    process.env.BUILD_COMMIT_DATE ?? process.env.NEXT_PUBLIC_BUILD_COMMIT_DATE,
  );
  const commitHashEnv = normalizeBuildValue(
    process.env.BUILD_COMMIT_HASH ?? process.env.NEXT_PUBLIC_BUILD_COMMIT_HASH,
  );

  try {
    const childProcess = require("child_process");
    const commitDate: string =
      commitDateEnv ??
      childProcess
        .execSync('git log -1 --format="%at000" --date=unix')
        .toString()
        .trim();
    const commitHash: string =
      commitHashEnv ??
      childProcess
        .execSync('git log --pretty=format:"%H" -n 1')
        .toString()
        .trim();

    return { commitDate, commitHash };
  } catch (e) {
    console.error("[Build Config] No git or not from git repo.");
    return {
      commitDate: "unknown",
      commitHash: "unknown",
    };
  }
}

export const getBuildConfig = () => {
  if (typeof process === "undefined") {
    throw Error(
      "[Server Config] you are importing a nodejs-only module outside of nodejs",
    );
  }

  if (cachedBuildConfig) {
    return cachedBuildConfig;
  }

  const buildMode = process.env.BUILD_MODE ?? "standalone";
  const isApp = !!process.env.BUILD_APP;
  const enableMcp = process.env.ENABLE_MCP === "true";
  const enableGoogleFonts = process.env.ENABLE_GOOGLE_FONTS === "true";
  const githubBaseUrl = process.env.GITHUB_BASE_URL ?? "https://github.com";
  const githubApiBaseUrl =
    process.env.GITHUB_API_BASE_URL ?? "https://api.github.com";
  const githubRawBaseUrl =
    process.env.GITHUB_RAW_BASE_URL ?? "https://raw.githubusercontent.com";
  const enableShareGpt = process.env.ENABLE_SHAREGPT === "true";
  const shareGptUrl = process.env.SHAREGPT_URL ?? "";
  const mcpMarketUrl = process.env.MCP_MARKET_URL ?? "";
  const enableEdgeTts = process.env.ENABLE_EDGE_TTS === "true";
  const edgeTtsVoicesUrl = process.env.EDGE_TTS_VOICES_URL ?? "";
  const edgeTtsWssUrl = process.env.EDGE_TTS_WSS_URL ?? "";
  const version = getVersion();

  cachedBuildConfig = {
    version,
    ...getCommitInfo(),
    buildMode,
    isApp,
    enableMcp,
    template: process.env.DEFAULT_INPUT_TEMPLATE ?? DEFAULT_INPUT_TEMPLATE,
    enableGoogleFonts,
    githubBaseUrl,
    githubApiBaseUrl,
    githubRawBaseUrl,
    enableShareGpt,
    shareGptUrl,
    mcpMarketUrl,
    enableEdgeTts,
    edgeTtsVoicesUrl,
    edgeTtsWssUrl,
  };

  return cachedBuildConfig;
};
