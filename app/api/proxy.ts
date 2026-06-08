import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "@/app/config/server";
import { DEFAULT_BROWSER_USER_AGENT } from "./user-agent";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";

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
      "toapis.com",
      "www.toapis.com",
      "cn.gptapi.asia",
      "gptapi.asia",
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

  // YutoAPI 和 Ocoolai pricing 接口特殊处理
  const isPricingApi =
    subpath === "v1/pricing" &&
    (baseUrl?.includes("gptapi.asia") ||
      baseUrl?.includes("toapis.com") ||
      baseUrl?.includes("ocoolai.com") ||
      baseUrl?.includes("ooo.cool"));

  const fetchUrl = isPricingApi
    ? `${baseUrl}/api/pricing`
    : `${baseUrl}/${subpath}${
        req.nextUrl.searchParams.toString()
          ? "?" + req.nextUrl.searchParams.toString()
          : ""
      }`;
  const normalizedFetchUrl = normalizeLoopbackUrlForContainer(fetchUrl);

  // 调试日志
  console.log(`[Proxy Route] 📤 代理请求:`, {
    subpath,
    baseUrl,
    isPricingApi,
    fetchUrl,
    normalizedFetchUrl,
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
        item[0].indexOf("x-") > -1 ||
        item[0].indexOf("sec-") > -1 ||
        skipHeaders.includes(item[0])
      ) {
        return false;
      }
      return true;
    }),
  );

  // 调试日志：检查是否有 Authorization header
  console.log(`[Proxy Route] 🔑 Authorization header:`, {
    hasAuth: req.headers.has("authorization"),
    authPrefix: req.headers.get("authorization")?.substring(0, 20) + "...",
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
    const res = shouldUseNativeRequest(normalizedFetchUrl, req.method)
      ? await nativeRequest(normalizedFetchUrl, req.method, headers)
      : await fetch(normalizedFetchUrl, fetchOptions);
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
    console.error("[Proxy Route] ❌ 代理请求失败:", {
      fetchUrl,
      normalizedFetchUrl,
      method: req.method,
      message: error instanceof Error ? error.message : String(error),
      error,
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
