import { NextRequest, NextResponse } from "next/server";
import { STORAGE_KEY, internalAllowedWebDavEndpoints } from "../../../constant";
import { getServerSideConfig } from "@/app/config/server";

const config = getServerSideConfig();

const mergedAllowedWebDavEndpoints = [
  ...internalAllowedWebDavEndpoints,
  ...config.allowedWebDavEndpoints,
].filter((domain) => Boolean(domain.trim()));

const normalizeUrl = (url: string) => {
  try {
    return new URL(url);
  } catch (err) {
    return null;
  }
};

// 允许的文件名（分文件存储）
const ALLOWED_FILES = [
  "chat.json",
  "access.json",
  "config.json",
  "mask.json",
  "prompt.json",
  "backup.json", // 旧的单文件，用于迁移和清理
];

async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }
  const folder = STORAGE_KEY;

  const requestUrl = new URL(req.url);
  let endpoint = requestUrl.searchParams.get("endpoint");
  let proxy_method = requestUrl.searchParams.get("proxy_method") || req.method;

  // Validate the endpoint to prevent potential SSRF attacks
  if (
    !endpoint ||
    !mergedAllowedWebDavEndpoints.some((allowedEndpoint) => {
      const normalizedAllowedEndpoint = normalizeUrl(allowedEndpoint);
      const normalizedEndpoint = normalizeUrl(endpoint as string);

      return (
        normalizedEndpoint &&
        normalizedEndpoint.hostname === normalizedAllowedEndpoint?.hostname &&
        normalizedEndpoint.pathname.startsWith(
          normalizedAllowedEndpoint.pathname,
        )
      );
    })
  ) {
    return NextResponse.json(
      {
        error: true,
        msg: "Invalid endpoint",
      },
      {
        status: 400,
      },
    );
  }

  if (!endpoint?.endsWith("/")) {
    endpoint += "/";
  }

  const endpointPath = params.path.join("/");
  const targetPath = `${endpoint}${endpointPath}`;

  // only allow MKCOL, GET, PUT, DELETE
  const allowedMethods = ["MKCOL", "GET", "PUT", "DELETE"];
  if (!allowedMethods.includes(proxy_method)) {
    return NextResponse.json(
      {
        error: true,
        msg: "Method not allowed: " + proxy_method,
      },
      {
        status: 403,
      },
    );
  }

  // for MKCOL request, only allow request ${folder}
  if (proxy_method === "MKCOL" && !targetPath.endsWith(folder)) {
    return NextResponse.json(
      {
        error: true,
        msg: "you are not allowed to request " + targetPath,
      },
      {
        status: 403,
      },
    );
  }

  // 检查文件名是否在允许列表中
  const fileName = endpointPath.split("/").pop();
  const isAllowedFile = ALLOWED_FILES.includes(fileName || "");

  if (
    !isAllowedFile &&
    (proxy_method === "GET" ||
      proxy_method === "PUT" ||
      proxy_method === "DELETE")
  ) {
    return NextResponse.json(
      {
        error: true,
        msg: "File not allowed: " + fileName,
      },
      {
        status: 403,
      },
    );
  }

  const targetUrl = targetPath;

  const method = proxy_method || req.method;
  const shouldNotHaveBody = ["get", "head"].includes(
    method?.toLowerCase() ?? "",
  );

  const fetchOptions: RequestInit = {
    headers: {
      authorization: req.headers.get("authorization") ?? "",
    },
    body: shouldNotHaveBody ? null : req.body,
    redirect: "manual",
    method,
    // @ts-ignore
    duplex: "half",
  };

  let fetchResult;

  try {
    fetchResult = await fetch(targetUrl, fetchOptions);
  } finally {
    console.log(
      "[Any Proxy]",
      targetUrl,
      {
        method: method,
      },
      {
        status: fetchResult?.status,
        statusText: fetchResult?.statusText,
      },
    );
  }

  return fetchResult;
}

export const PUT = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;

export const runtime = "edge";
