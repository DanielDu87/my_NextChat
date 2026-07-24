import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "@/app/config/server";
import { DEFAULT_BROWSER_USER_AGENT } from "./user-agent";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";

// 进程内缓存：用户配置的 baseURL -> 自动适配后实际可用的 baseURL。
// 例如把 https://openrouter.ai 自适应成 https://openrouter.ai/api/v1。
// 仅在响应被识别为 text/html 时才会写入；命中后下次同 baseURL 直接走适配后的地址。
const globalBaseUrlAdaptCache = new Map<string, string>();

function looksLikeHtmlResponse(res: Response) {
  const contentType = String(
    res.headers.get("content-type") || "",
  ).toLowerCase();
  return contentType.includes("text/html");
}

function buildBaseUrlCandidates(
  baseUrl: string,
  subpath: string,
): Array<{ baseUrl: string; subpath: string; reason: string }> {
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, "");
  // path 中可能含 v1/、api/、api/v1/ 前缀，适配时把这段挪到 baseURL 上
  const strippedSubpath = subpath
    .replace(/^v1\//, "")
    .replace(/^api\/v1\//, "")
    .replace(/^api\//, "");

  const candidates: Array<{
    baseUrl: string;
    subpath: string;
    reason: string;
  }> = [];
  const seen = new Set<string>();
  const push = (b: string, s: string, reason: string) => {
    const key = `${b}::${s}`;
    if (!seen.has(key) && b && s) {
      seen.add(key);
      candidates.push({ baseUrl: b, subpath: s, reason });
    }
  };

  // 1) 给 baseURL 追加常见 API 前缀，同时把 path 里多余的 v1 段剥掉
  for (const apiPrefix of ["/api/v1", "/api", "/v1"]) {
    push(
      `${trimmedBaseUrl}${apiPrefix}`,
      strippedSubpath,
      `baseURL+${apiPrefix}`,
    );
  }
  // 2) 如果 baseURL 已经包含某个前缀，尝试剥掉它再走原 path
  for (const apiPrefix of ["/api/v1", "/api", "/v1"]) {
    if (trimmedBaseUrl.toLowerCase().endsWith(apiPrefix)) {
      const stripped = trimmedBaseUrl
        .slice(0, trimmedBaseUrl.length - apiPrefix.length)
        .replace(/\/+$/, "");
      if (stripped) push(stripped, subpath, `strip ${apiPrefix}`);
    }
  }
  return candidates;
}

function isContainerRuntime() {
  try {
    return fs.existsSync("/.dockerenv");
  } catch {
    return false;
  }
}

function decodeLinuxGatewayHex(gatewayHex: string) {
  if (!/^[0-9A-Fa-f]{8}$/.test(gatewayHex)) return "";
  const octets: number[] = [];
  for (let i = 0; i < 8; i += 2) {
    octets.push(Number.parseInt(gatewayHex.slice(i, i + 2), 16));
  }
  return octets.reverse().join(".");
}

function getContainerDefaultGateway() {
  if (!isContainerRuntime()) return "";

  try {
    const routeText = fs.readFileSync("/proc/net/route", "utf8");
    const lines = routeText.trim().split("\n").slice(1);
    for (const line of lines) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 3) continue;
      const destination = columns[1];
      const gateway = columns[2];
      if (destination === "00000000") {
        return decodeLinuxGatewayHex(gateway);
      }
    }
  } catch {
    // 忽略读取失败，继续走后续兜底逻辑
  }

  return "";
}

function normalizeLoopbackUrlForContainer(fetchUrl: string) {
  try {
    const url = new URL(fetchUrl);
    if (
      isContainerRuntime() &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) {
      url.hostname = getContainerDefaultGateway() || "host.docker.internal";
    }
    return url.toString();
  } catch {
    return fetchUrl;
  }
}

function shouldUseNativeRequest(fetchUrl: string, method: string) {
  if (!["GET", "HEAD"].includes(method.toUpperCase())) return false;

  try {
    const hostname = new URL(normalizeLoopbackUrlForContainer(fetchUrl))
      .hostname;
    return [
      "aihubmix.com",
      "www.aihubmix.com",
      "api.inferera.com",
      "toapis.com",
      "www.toapis.com",
      "cn.gptapi.asia",
      "gptapi.asia",
      "api.ocoolai.com",
      "one.ocoolai.com",
      "ocoolai.com",
      "one.ooo.cool",
    ].includes(hostname);
  } catch {
    return false;
  }
}

async function nativeRequest(
  fetchUrl: string,
  method: string,
  headers: Headers,
): Promise<Response> {
  const url = new URL(fetchUrl);
  const client = url.protocol === "https:" ? https : http;

  const upstream = await new Promise<{
    statusCode: number;
    statusMessage: string;
    headers: http.IncomingHttpHeaders;
    body: ArrayBuffer;
  }>((resolve, reject) => {
    const req = client.request(
      url,
      {
        method,
        headers: Object.fromEntries(headers.entries()),
      },
      (res) => {
        const chunks: Uint8Array[] = [];
        res.on("data", (chunk) =>
          chunks.push(
            Uint8Array.from(
              Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
            ),
          ),
        );
        res.on("end", () => {
          const body = new Uint8Array(
            chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
          );
          let offset = 0;
          for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.byteLength;
          }
          resolve({
            statusCode: res.statusCode || 502,
            statusMessage: res.statusMessage || "Bad Gateway",
            headers: res.headers,
            body: body.buffer,
          });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(20_000, () => {
      req.destroy(new Error("native_request_timeout"));
    });
    req.end();
  });

  const responseHeaders = new Headers();
  Object.entries(upstream.headers).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => responseHeaders.append(key, item));
    } else if (typeof value === "string") {
      responseHeaders.set(key, value);
    }
  });

  return new Response(upstream.body, {
    status: upstream.statusCode,
    statusText: upstream.statusMessage,
    headers: responseHeaders,
  });
}

type BaseUrlAdaptationOutcome = {
  response: Response;
  resolvedBaseUrl: string;
  adapted: boolean;
};

/**
 * 发起上游请求，并在响应被识别为 HTML（即上游把请求当成了网站路径）时，
 * 自动尝试给 baseURL 加 /api/v1、/api、/v1 等常见前缀，同时把 path 中
 * 多余的 v1/ 段剥掉再次尝试。命中后把成功的 baseURL 缓存到进程内 Map。
 */
async function fetchWithBaseUrlAdaptation(opts: {
  baseUrl: string;
  subpath: string;
  queryString: string;
  req: NextRequest;
  fetchOptions: RequestInit;
  shouldUseNative: boolean;
  headers: Headers;
}): Promise<BaseUrlAdaptationOutcome> {
  const {
    baseUrl,
    subpath,
    queryString,
    req,
    fetchOptions,
    shouldUseNative,
    headers,
  } = opts;

  const buildUrl = (b: string, s: string) =>
    `${b}/${s}${queryString ? "?" + queryString : ""}`;

  const doFetch = async (url: string) => {
    const normalized = normalizeLoopbackUrlForContainer(url);
    if (shouldUseNative) {
      return nativeRequest(normalized, req.method, headers);
    }
    return fetch(normalized, { ...fetchOptions, signal: req.signal });
  };

  const consumeBody = async (res: Response) => {
    try {
      await res.text();
    } catch {
      // 某些场景 body 已读完或流被中断，忽略即可
    }
  };

  // 0. 命中缓存：上次已成功适配过该 baseURL，直接走适配后的地址
  const cachedAdapted = globalBaseUrlAdaptCache.get(baseUrl);
  if (cachedAdapted && cachedAdapted !== baseUrl) {
    try {
      const cachedRes = await doFetch(buildUrl(cachedAdapted, subpath));
      if (!looksLikeHtmlResponse(cachedRes)) {
        return {
          response: cachedRes,
          resolvedBaseUrl: cachedAdapted,
          adapted: true,
        };
      }
      await consumeBody(cachedRes);
      // 缓存命中但又返回 HTML，视为上游变动，清掉缓存回退到探测流程
      globalBaseUrlAdaptCache.delete(baseUrl);
    } catch {
      globalBaseUrlAdaptCache.delete(baseUrl);
    }
  }

  // 1. 用原始 baseURL 先试一次
  let res: Response;
  try {
    res = await doFetch(buildUrl(baseUrl, subpath));
  } catch (error) {
    // 原始请求直接抛错（如 DNS 失败、连接拒绝），让上层按 proxy_fetch_failed 处理
    throw error;
  }

  // 5xx HTML 通常是反向代理的真实错误页，不能当成 baseURL 填错后重复 POST。
  // 保留原始响应也能让调用方看到上游的具体故障，而不是适配失败的二次错误。
  if (!looksLikeHtmlResponse(res) || res.status >= 500) {
    return { response: res, resolvedBaseUrl: baseUrl, adapted: false };
  }

  // 2. 检测到 HTML 响应，开始自适应探测
  await consumeBody(res);
  console.log("[Proxy Route] 检测到上游返回 HTML，自动尝试适配 baseURL", {
    baseUrl,
    subpath,
    status: res.status,
  });

  const candidates = buildBaseUrlCandidates(baseUrl, subpath);
  for (const candidate of candidates) {
    if (req.signal.aborted) break;
    try {
      const candidateRes = await doFetch(
        buildUrl(candidate.baseUrl, candidate.subpath),
      );
      if (!looksLikeHtmlResponse(candidateRes)) {
        console.log("[Proxy Route] ✨ 自动适配 baseURL 成功", {
          original: { baseUrl, subpath },
          resolved: candidate,
          status: candidateRes.status,
          contentType: candidateRes.headers.get("content-type") || "",
        });
        globalBaseUrlAdaptCache.set(baseUrl, candidate.baseUrl);
        return {
          response: candidateRes,
          resolvedBaseUrl: candidate.baseUrl,
          adapted: true,
        };
      }
      await consumeBody(candidateRes);
    } catch (error) {
      console.warn("[Proxy Route] baseURL 候选请求失败", {
        candidate,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // 3. 所有候选都返回 HTML，返回 502 + 明确错误信息
  console.warn("[Proxy Route] ❌ baseURL 自适配全部失败", {
    baseUrl,
    subpath,
    triedCount: candidates.length,
  });
  return {
    response: new Response(
      JSON.stringify({
        error: "proxy_baseurl_adaptation_failed",
        message:
          "上游对所有候选 baseURL 都返回了 HTML（看起来是网站页面而不是 API），请检查 API 配置页中填写的「基础地址」是否正确。",
        originalBaseUrl: baseUrl,
        subpath,
        tried: candidates.map((c) => ({
          baseUrl: c.baseUrl,
          subpath: c.subpath,
          reason: c.reason,
        })),
      }),
      {
        status: 502,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    ),
    resolvedBaseUrl: baseUrl,
    adapted: false,
  };
}

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  console.log("[Proxy Route] params ", params);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }
  const serverConfig = getServerSideConfig();

  // remove path params from searchParams
  req.nextUrl.searchParams.delete("path");
  req.nextUrl.searchParams.delete("provider");

  const subpath = params.path.join("/");
  const baseUrl = req.headers.get("x-base-url");
  const normalizedBaseUrl = baseUrl?.replace(/\/+$/, "");

  // YutoAPI 和 Ocoolai pricing 接口特殊处理
  const isPricingApi =
    ["pricing", "api/pricing", "v1/pricing"].includes(subpath) &&
    (baseUrl?.includes("gptapi.asia") ||
      baseUrl?.includes("toapis.com") ||
      baseUrl?.includes("ocoolai.com") ||
      baseUrl?.includes("ooo.cool"));

  const fetchUrl = isPricingApi
    ? `${normalizedBaseUrl}/api/pricing`
    : `${normalizedBaseUrl}/${subpath}${
        req.nextUrl.searchParams.toString()
          ? "?" + req.nextUrl.searchParams.toString()
          : ""
      }`;
  const normalizedFetchUrl = normalizeLoopbackUrlForContainer(fetchUrl);

  // URL 可能携带查询参数凭据；日志只保留不会泄露配置的请求元数据。
  console.log("[Proxy Route] 📤 代理请求", {
    subpath,
    isPricingApi,
    method: req.method,
  });

  const skipHeaders = [
    "connection",
    "host",
    "origin",
    "referer",
    "cookie",
    "content-length",
    "accept-encoding",
  ];

  // Pricing API 不需要 Authorization header
  if (isPricingApi) {
    skipHeaders.push("authorization");
  }

  const headers = new Headers(
    Array.from(req.headers.entries()).filter((item) => {
      if (
        (item[0].indexOf("x-") > -1 &&
          !["x-api-key", "x-goog-api-key"].includes(item[0].toLowerCase())) ||
        item[0].indexOf("sec-") > -1 ||
        skipHeaders.includes(item[0])
      ) {
        return false;
      }
      return true;
    }),
  );

  // 仅记录认证头是否存在，绝不记录 token 或其前缀。
  console.log(`[Proxy Route] 🔑 Authorization header:`, {
    hasAuth: req.headers.has("authorization"),
    hasXApiKey: req.headers.has("x-api-key"),
    hasApiKey: req.headers.has("api-key"),
    hasGoogleApiKey: req.headers.has("x-goog-api-key"),
  });
  // if dalle3 use openai api key
  if (baseUrl?.includes("api.openai.com")) {
    if (!serverConfig.apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 },
      );
    }
    headers.set("Authorization", `Bearer ${serverConfig.apiKey}`);
  }
  headers.set("User-Agent", DEFAULT_BROWSER_USER_AGENT);

  const controller = new AbortController();
  const shouldSendBody = !["GET", "HEAD"].includes(req.method.toUpperCase());
  const fetchOptions: RequestInit = {
    headers,
    method: req.method,
    // to fix #2485: https://stackoverflow.com/questions/55920957/cloudflare-worker-typeerror-one-time-use-body
    redirect: "manual",
    signal: controller.signal,
  };

  if (shouldSendBody) {
    fetchOptions.body = req.body;
    // @ts-ignore Node.js/undici 在流式请求体下需要 duplex
    fetchOptions.duplex = "half";
  }

  const timeoutId = setTimeout(
    () => {
      controller.abort();
    },
    10 * 60 * 1000,
  );

  try {
    // 当上游不是 pricing API 时，自动适配 baseURL：
    // 检测到 HTML 响应时尝试 /api/v1 等常见前缀并缓存命中结果。
    const adaptationResult = isPricingApi
      ? {
          response: shouldUseNativeRequest(normalizedFetchUrl, req.method)
            ? await nativeRequest(normalizedFetchUrl, req.method, headers)
            : await fetch(normalizedFetchUrl, fetchOptions),
          resolvedBaseUrl: normalizedBaseUrl || "",
          adapted: false,
        }
      : await fetchWithBaseUrlAdaptation({
          baseUrl: normalizedBaseUrl || "",
          subpath,
          queryString: req.nextUrl.searchParams.toString(),
          req,
          fetchOptions,
          shouldUseNative: shouldUseNativeRequest(
            normalizedFetchUrl,
            req.method,
          ),
          headers,
        });
    const res = adaptationResult.response;
    if (adaptationResult.adapted) {
      console.log("[Proxy Route] 🔁 本次请求走的是自适应后的 baseURL", {
        originalBaseUrl: normalizedBaseUrl,
        resolvedBaseUrl: adaptationResult.resolvedBaseUrl,
        subpath,
      });
    }
    // to prevent browser prompt for credentials
    const newHeaders = new Headers(res.headers);
    newHeaders.delete("www-authenticate");
    // to disable nginx buffering
    newHeaders.set("X-Accel-Buffering", "no");

    // The latest version of the OpenAI API forced the content-encoding to be "br" in json response
    // So if the streaming is disabled, we need to remove the content-encoding header
    // Because Vercel uses gzip to compress the response, if we don't remove the content-encoding header
    // The browser will try to decode the response with brotli and fail
    newHeaders.delete("content-encoding");
    newHeaders.delete("content-length");

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: newHeaders,
    });
  } catch (error) {
    console.warn("[Proxy Route] ⚠️ 代理请求失败:", {
      subpath,
      method: req.method,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        error: "proxy_fetch_failed",
        message: error instanceof Error ? error.message : "unknown_error",
        fetchUrl,
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
