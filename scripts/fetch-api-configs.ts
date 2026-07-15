/**
 * 从数据库读取 API 配置并查询模型
 */

import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";

// 数据库配置
const pool = new Pool({
  host: "postgres-ssh-tunnel",
  port: 5432,
  database: "nextchat",
  user: "nextchat",
  password: "w2ks55P34yTDDanB",
  max: 1,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
});

interface ApiProfile {
  id: string;
  name: string;
  provider: string;
  base_url: string;
  api_key?: string;
  state?: any;
}

async function main() {
  console.log("🚀 正在从数据库读取 API 配置...\n");

  const desktopPath = path.join(process.env.HOME || "", "Desktop", "API模型导出");
  if (!fs.existsSync(desktopPath)) {
    fs.mkdirSync(desktopPath, { recursive: true });
  }

  try {
    // 查询 app_settings 表获取 access-control 配置
    const result = await pool.query(`
      SELECT store_key, payload_json
      FROM app_settings
      WHERE store_key = 'access-control'
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log("❌ 未找到 access-control 配置");
      return;
    }

    const payload = result.rows[0].payload_json;
    const accessState = typeof payload === 'string' ? JSON.parse(payload) : payload;

    const profiles = accessState?.apiProfiles || [];
    console.log(`📋 找到 ${profiles.length} 个 API 配置\n`);

    // 过滤有效的配置（需要有 baseUrl 和 apiKey）
    const validProfiles = profiles.filter((p: any) =>
      p.id && p.name && p.baseUrl && (p.apiKey || p.modelFetchApiKey || Object.values(p.apiKeyGroups || {}).some(Boolean))
    );

    console.log(`✅ 有效配置: ${validProfiles.length} 个\n`);

    // 输出配置列表
    for (const p of validProfiles) {
      const maskedKey = p.apiKey
        ? `${p.apiKey.substring(0, 8)}...`
        : p.modelFetchApiKey
        ? `${p.modelFetchApiKey.substring(0, 8)}...`
        : "多Key";
      console.log(`  - ${p.name} (${p.provider}): ${p.baseUrl} [${maskedKey}]`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("配置文件已生成！");
    console.log("=".repeat(60));

    // 生成配置代码
    const configCode = validProfiles.map((p: any) => {
      const apiKey = p.apiKey || p.modelFetchApiKey || "";
      const groups = p.apiKeyGroups ? JSON.stringify(p.apiKeyGroups) : undefined;

      return `  {
    name: "${p.name}",
    provider: "${p.provider}",
    baseUrl: "${p.baseUrl}",
    apiKey: "${apiKey}"${groups ? `,
    apiKeyGroups: ${groups}` : ''}
  }`;
    }).join(',\n\n');

    const fullCode = `/**
 * API 配置列表 - 从数据库自动生成
 * 生成时间: ${new Date().toLocaleString("zh-CN")}
 */

const API_CONFIGS: Array<{
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  apiKeyGroups?: Record<string, string>;
}> = [
${configCode}
];

export default API_CONFIGS;`;

    const outputPath = path.join(desktopPath, "api-configs.ts");
    fs.writeFileSync(outputPath, fullCode, "utf-8");
    console.log(`📄 配置文件已保存到: ${outputPath}`);

  } catch (error) {
    console.error("❌ 错误:", error instanceof Error ? error.message : String(error));
  } finally {
    await pool.end();
  }
}

main();
