import { type OpenAIListModelResponse } from "@/app/client/platforms/openai";
import { getServerSideConfig } from "@/app/config/server";
import { ModelProvider, OpenaiPath } from "@/app/constant";
import { prettyObject } from "@/app/utils/format";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "./auth";
import { requestOpenai } from "./common";

const ALLOWED_PATH = new Set(Object.values(OpenaiPath));

function containsCjk(text: string) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
}

async function validateVeoVideoRequest(req: NextRequest, subpath: string) {
  if (req.method !== "POST" || subpath !== OpenaiPath.VideoPath) {
    return null;
  }

  try {
    const payload = await req.clone().json();
    const model = String(payload?.model || "")
      .trim()
      .toLowerCase();
    const prompt = String(payload?.prompt || "").trim();

    if (!model.includes("veo")) {
      return null;
    }

    if (!prompt) {
      return NextResponse.json(
        {
          error: true,
          message: "Veo 视频提示词不能为空。",
        },
        { status: 400 },
      );
    }

    if (containsCjk(prompt)) {
      return NextResponse.json(
        {
          error: true,
          message:
            "Veo 系列当前只接受英文提示词。检测到请求中仍包含中文，请刷新页面后改用英文提示词重试。",
        },
        { status: 400 },
      );
    }
  } catch {
    return null;
  }

  return null;
}

function getModels(remoteModelRes: OpenAIListModelResponse) {
  const config = getServerSideConfig();

  if (config.disableGPT4) {
    remoteModelRes.data = remoteModelRes.data.filter(
      (m) =>
        !(
          m.id.startsWith("gpt-4") ||
          m.id.startsWith("chatgpt-4o") ||
          m.id.startsWith("o1") ||
          m.id.startsWith("o3")
        ) || m.id.startsWith("gpt-4o-mini"),
    );
  }

  return remoteModelRes;
}

export async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  console.log("[OpenAI Route] params ", params);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const subpath = params.path.join("/");

  if (!ALLOWED_PATH.has(subpath)) {
    console.log("[OpenAI Route] forbidden path ", subpath);
    return NextResponse.json(
      {
        error: true,
        msg: "you are not allowed to request " + subpath,
      },
      {
        status: 403,
      },
    );
  }

  const authResult = auth(req, ModelProvider.GPT);
  if (authResult.error) {
    return NextResponse.json(authResult, {
      status: 401,
    });
  }

  try {
    const veoValidationResponse = await validateVeoVideoRequest(req, subpath);
    if (veoValidationResponse) {
      return veoValidationResponse;
    }

    const response = await requestOpenai(req);

    // list models
    if (subpath === OpenaiPath.ListModelPath && response.status === 200) {
      const resJson = (await response.json()) as OpenAIListModelResponse;
      const availableModels = getModels(resJson);
      return NextResponse.json(availableModels, {
        status: response.status,
      });
    }

    return response;
  } catch (e) {
    console.error("[OpenAI] ", e);
    return NextResponse.json(prettyObject(e));
  }
}
