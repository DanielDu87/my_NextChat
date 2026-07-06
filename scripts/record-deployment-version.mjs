#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pg = require("pg");
const { Pool } = pg;

function requiredBuildValue(name) {
  const value = String(process.env[name] || "").trim();
  if (!value || value.toLowerCase() === "unknown") {
    throw new Error(`${name} 缺失，拒绝记录无法追溯的部署版本`);
  }
  return value;
}

const commitHash = requiredBuildValue("BUILD_COMMIT_HASH");
const commitDate = requiredBuildValue("BUILD_COMMIT_DATE");
const branch = String(process.env.BUILD_GIT_BRANCH || "main").trim() || "main";
const image = String(
  process.env.NEXTCHAT_IMAGE || "nextchat-baota:latest",
).trim();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.DATABASE_URL ? undefined : process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.DATABASE_URL ? undefined : process.env.PGDATABASE,
  user: process.env.DATABASE_URL ? undefined : process.env.PGUSER,
  password: process.env.DATABASE_URL ? undefined : process.env.PGPASSWORD,
  ssl: ["1", "true", "yes", "on", "require"].includes(
    String(process.env.PGSSL || process.env.PGSSLMODE || "").toLowerCase(),
  )
    ? { rejectUnauthorized: false }
    : undefined,
});

try {
  await pool.query(`
    create table if not exists deployment_metadata (
      commit_hash text primary key,
      commit_date bigint not null,
      git_branch text not null,
      image_name text not null,
      deployed_at timestamptz not null default now()
    )
  `);
  const result = await pool.query(
    `insert into deployment_metadata (
       commit_hash, commit_date, git_branch, image_name, deployed_at
     ) values ($1, $2, $3, $4, now())
     on conflict (commit_hash) do update set
       commit_date = excluded.commit_date,
       git_branch = excluded.git_branch,
       image_name = excluded.image_name,
       deployed_at = excluded.deployed_at
     returning commit_hash, deployed_at`,
    [commitHash, Number(commitDate), branch, image],
  );
  console.log("[Deploy] 部署版本已写入 PostgreSQL", {
    commitHash: result.rows[0].commit_hash,
    deployedAt: result.rows[0].deployed_at,
    branch,
    image,
  });
} finally {
  await pool.end();
}
