import tauriConfig from "../../src-tauri/tauri.conf.json";
import { DEFAULT_INPUT_TEMPLATE } from "../constant";

export type BuildConfig = {
  version: string;
  commitDate: string;
  commitHash: string;
  buildMode: string;
  isApp: boolean;
  template: string;
};

let cachedBuildConfig: BuildConfig | undefined;

function getCommitInfo() {
  const commitDateEnv =
    process.env.BUILD_COMMIT_DATE ?? process.env.NEXT_PUBLIC_BUILD_COMMIT_DATE;
  const commitHashEnv =
    process.env.BUILD_COMMIT_HASH ?? process.env.NEXT_PUBLIC_BUILD_COMMIT_HASH;

  if (commitDateEnv || commitHashEnv) {
    return {
      commitDate: commitDateEnv ?? "unknown",
      commitHash: commitHashEnv ?? "unknown",
    };
  }

  if (process.env.NODE_ENV === "development") {
    return {
      commitDate: "unknown",
      commitHash: "unknown",
    };
  }

  try {
    const childProcess = require("child_process");
    const commitDate: string = childProcess
      .execSync('git log -1 --format="%at000" --date=unix')
      .toString()
      .trim();
    const commitHash: string = childProcess
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
  const version = "v" + tauriConfig.package.version;

  cachedBuildConfig = {
    version,
    ...getCommitInfo(),
    buildMode,
    isApp,
    template: process.env.DEFAULT_INPUT_TEMPLATE ?? DEFAULT_INPUT_TEMPLATE,
  };

  return cachedBuildConfig;
};
