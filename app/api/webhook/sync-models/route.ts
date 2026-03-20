import { NextRequest, NextResponse } from "next/server";
import { refreshConfiguredProviderModels } from "@/app/utils/server/provider-model-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * 自动同步模型数据的 Webhook API
 * 访问此 URL 即可触发所有平台模型的同步更新
 * 无需任何参数或授权，适合服务器定时任务调用
 */
export async function GET(request: NextRequest) {
  try {
    console.log("[Webhook] 🔄 开始触发模型同步和更新...");
    console.log(
      "[Webhook] 📍 请求来源:",
      request.headers.get("user-agent") || "unknown",
    );

    // 调用模型刷新逻辑
    const result = await refreshConfiguredProviderModels("webhook");

    console.log("[Webhook] ✅ 模型同步完成");
    console.log("[Webhook] 📊 同步结果:");
    console.log(`[Webhook] - 模型总数: ${result.modelCount} 个`);
    console.log(`[Webhook] - 平台数量: ${result.profileCount} 个`);
    result.providers?.forEach((p: any) => {
      console.log(`[Webhook] - ${p.profileName}: ${p.fetchedCount} 个模型`);
    });

    return NextResponse.json(
      {
        success: true,
        message: "模型同步完成",
        modelCount: result.modelCount,
        profileCount: result.profileCount,
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (error) {
    console.error("[Webhook] ❌ 同步失败:", error);
    return NextResponse.json(
      {
        success: false,
        message: "同步失败",
        error: error instanceof Error ? error.message : "unknown_error",
      },
      { status: 500 },
    );
  }
}

// POST 也支持，与 GET 行为一致
export async function POST(request: NextRequest) {
  return GET(request);
}
