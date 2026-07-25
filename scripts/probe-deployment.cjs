#!/usr/bin/env node
// 入仓运维探针：读取仓库内 deployment_metadata 最新行
// 用于宝塔 DockerSite 部署后 §8 标准验证；运行时复用仓库的 pg 依赖与 PG* 环境变量。
//
// 用法（容器内）：
//   docker exec nextchat node scripts/probe-deployment.cjs            # 默认查询 1 行
//   docker exec nextchat node scripts/probe-deployment.cjs --limit 5 # 查询最近 5 行
//   LIMIT=3 docker exec nextchat node scripts/probe-deployment.cjs   # 兼容环境变量

const LIMIT = (() => {
  const envLimit = Number(process.env.LIMIT || 0);
  const argvIndex = process.argv.indexOf("--limit");
  const argvLimit = argvIndex >= 0 ? Number(process.argv[argvIndex + 1]) : 0;
  const v = envLimit || argvLimit || 1;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 1;
})();

if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER) {
  console.error(
    "ERR 缺少 PGHOST/PGDATABASE/PGUSER 环境变量，请在容器内执行或使用 --env-file 注入",
  );
  process.exit(2);
}

const { Client } = require("pg");

(async () => {
  const c = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
  });
  try {
    await c.connect();
    const tbl = await c.query(
      "select table_schema from information_schema.tables where table_name=$1",
      ["deployment_metadata"],
    );
    if (!tbl.rows[0]) {
      console.error(
        "ERR 未找到 deployment_metadata 表，请确认 sync-baota-dockersite-container-id.sh 已运行",
      );
      process.exit(2);
    }
    const schema = tbl.rows[0].table_schema;
    const res = await c.query(
      `select * from ${schema}.deployment_metadata order by deployed_at desc limit $1`,
      [LIMIT],
    );
    console.log(
      JSON.stringify(
        {
          schema,
          limit: LIMIT,
          rows: res.rows,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.error("ERR", e.code || "?", e.message);
    process.exit(2);
  } finally {
    await c.end();
  }
})();
