import webpack from "webpack";

const mode = process.env.BUILD_MODE ?? "standalone";
const isDev = process.env.NODE_ENV === "development";
const useWatchPolling = process.env.WATCHPACK_POLLING === "true";
const watchPollingInterval = Number(
  process.env.WATCHPACK_POLLING_INTERVAL || 1000,
);
const enableGoogleFonts = process.env.ENABLE_GOOGLE_FONTS === "true";
const githubApiBaseUrl = (
  process.env.GITHUB_API_BASE_URL || "https://api.github.com"
).replace(/\/+$/, "");
const githubRawBaseUrl = (
  process.env.GITHUB_RAW_BASE_URL || "https://raw.githubusercontent.com"
).replace(/\/+$/, "");
const shareGptUrl = (process.env.SHAREGPT_URL || "").replace(/\/+$/, "");
const mcpMarketUrl = (process.env.MCP_MARKET_URL || "").replace(/\/+$/, "");
console.log("[Next] build mode", mode);

const disableChunk = !!process.env.DISABLE_CHUNK || mode === "export";
console.log("[Next] build with chunk: ", !disableChunk);

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack(config, { dev }) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });

    if (disableChunk) {
      config.plugins.push(
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
      );
    }

    config.resolve.fallback = {
      child_process: false,
      bufferutil: false,
      "utf-8-validate": false,
    };

    if (dev) {
      config.watchOptions = {
        ...(useWatchPolling ? { poll: watchPollingInterval } : {}),
        aggregateTimeout: useWatchPolling ? 100 : 300,
        ignored: ["**/.git/**", "**/.next/**", "**/node_modules/**"],
      };
    }

    return config;
  },
  output: isDev ? undefined : mode,
  images: {
    unoptimized: mode === "export",
  },
  experimental: {
    instrumentationHook: true,
    ...(!isDev ? { forceSwcTransforms: true } : {}),
  },
};

const CorsHeaders = [
  { key: "Access-Control-Allow-Credentials", value: "true" },
  { key: "Access-Control-Allow-Origin", value: "*" },
  {
    key: "Access-Control-Allow-Methods",
    value: "*",
  },
  {
    key: "Access-Control-Allow-Headers",
    value: "*",
  },
  {
    key: "Access-Control-Max-Age",
    value: "86400",
  },
];

if (mode !== "export") {
  nextConfig.headers = async () => {
    return [
      {
        source: "/api/:path*",
        headers: CorsHeaders,
      },
      {
        // WebDAV 代理的 CORS 头
        source: "/api/webdav/:path*",
        headers: CorsHeaders,
      },
    ];
  };

  nextConfig.rewrites = async () => {
    const ret = [
      // adjust for previous version directly using "/api/proxy/" as proxy base route
      // {
      //   source: "/api/proxy/v1/:path*",
      //   destination: "https://api.openai.com/v1/:path*",
      // },
      {
        // https://{resource_name}.openai.azure.com/openai/deployments/{deploy_name}/chat/completions
        source:
          "/api/proxy/azure/:resource_name/deployments/:deploy_name/:path*",
        destination:
          "https://:resource_name.openai.azure.com/openai/deployments/:deploy_name/:path*",
      },
      {
        source: "/api/proxy/google/:path*",
        destination: "https://generativelanguage.googleapis.com/:path*",
      },
      {
        source: "/api/proxy/openai/:path*",
        destination: "https://api.openai.com/:path*",
      },
      {
        source: "/api/proxy/anthropic/:path*",
        destination: "https://api.anthropic.com/:path*",
      },
      {
        source: "/api/github/:path*",
        destination: `${githubApiBaseUrl}/:path*`,
      },
      {
        source: "/api/github-raw/:path*",
        destination: `${githubRawBaseUrl}/:path*`,
      },
      {
        source: "/api/proxy/alibaba/:path*",
        destination: "https://dashscope.aliyuncs.com/api/:path*",
      },
      {
        // WebDAV 代理配置
        source: "/api/webdav/:path*",
        destination: "https://webdav.dyxcloud.com/:path*",
      },
    ];

    if (enableGoogleFonts) {
      ret.push({
        source: "/google-fonts/:path*",
        destination: "https://fonts.googleapis.com/:path*",
      });
    }

    if (shareGptUrl) {
      ret.push({
        source: "/sharegpt",
        destination: shareGptUrl,
      });
    }

    if (mcpMarketUrl) {
      ret.push({
        source: "/mcp-market-api/:path*",
        destination: `${mcpMarketUrl}/:path*`,
      });
    }

    return {
      beforeFiles: ret,
    };
  };
}

export default nextConfig;
