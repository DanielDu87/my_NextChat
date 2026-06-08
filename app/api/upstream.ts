import dns from "node:dns";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";

function isContainerRuntime() {
  try {
    return fs.existsSync("/.dockerenv");
  } catch {
    return false;
  }
}

function normalizeLoopbackUrlForContainer(fetchUrl: string) {
  try {
    const url = new URL(fetchUrl);
    if (
      isContainerRuntime() &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    ) {
      url.hostname = "host.docker.internal";
    }
    return url.toString();
  } catch {
    return fetchUrl;
  }
}

async function resolveHostname(hostname: string, dnsServers?: string[]) {
  if (!dnsServers?.length) return undefined;
  const resolver = new dns.promises.Resolver();
  resolver.setServers(dnsServers);
  const addresses = await resolver.resolve4(hostname);
  if (!addresses.length) {
    throw Object.assign(new Error(`dns_lookup_empty:${hostname}`), {
      code: "ENOTFOUND",
    });
  }
  return addresses;
}

export async function requestUpstream(
  fetchUrl: string,
  options?: {
    method?: string;
    headers?: Headers | Record<string, string>;
    timeoutMs?: number;
    dnsServers?: string[];
  },
): Promise<Response> {
  const normalizedFetchUrl = normalizeLoopbackUrlForContainer(fetchUrl);
  const url = new URL(normalizedFetchUrl);
  const client = url.protocol === "https:" ? https : http;
  const method = options?.method || "GET";
  const timeoutMs = options?.timeoutMs ?? 20_000;
  const resolvedAddresses = await resolveHostname(
    url.hostname,
    options?.dnsServers,
  );
  const requestHeaders =
    options?.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : options?.headers || {};

  if (resolvedAddresses?.length) {
    requestHeaders.Host = url.host;
  }
  const candidateHostnames = resolvedAddresses?.length
    ? resolvedAddresses
    : [url.hostname];

  let lastError: unknown;
  let upstream:
    | {
        statusCode: number;
        statusMessage: string;
        headers: http.IncomingHttpHeaders;
        body: ArrayBuffer;
      }
    | undefined;

  for (const candidateHostname of candidateHostnames) {
    try {
      upstream = await new Promise<{
        statusCode: number;
        statusMessage: string;
        headers: http.IncomingHttpHeaders;
        body: ArrayBuffer;
      }>((resolve, reject) => {
        const req = client.request(
          {
            protocol: url.protocol,
            hostname: candidateHostname,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: `${url.pathname}${url.search}`,
            method,
            headers: requestHeaders,
            servername: url.hostname,
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
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error("native_request_timeout"));
        });
        req.end();
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!upstream) {
    throw lastError instanceof Error
      ? lastError
      : new Error("upstream_request_failed");
  }

  const responseHeaders = new Headers();
  Object.entries(upstream.headers).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => responseHeaders.append(key, item));
    } else if (typeof value === "string") {
      responseHeaders.set(key, value);
    }
  });

  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("www-authenticate");
  responseHeaders.set("X-Accel-Buffering", "no");

  return new Response(upstream.body, {
    status: upstream.statusCode,
    statusText: upstream.statusMessage,
    headers: responseHeaders,
  });
}
