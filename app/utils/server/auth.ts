import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { ensureSyncStorageSchema, pgQuery } from "./postgres";

const AUTH_SESSION_COOKIE_NAME = "nextchat_auth_session";
const EFFECTIVE_USER_COOKIE_NAME = "nextchat_effective_user";
const AUTH_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_ADMIN_USERNAME =
  process.env.NEXTCHAT_ADMIN_USERNAME?.trim() || "admin";

/**
 * 解析默认 admin 密码。生产环境必须显式设置 NEXTCHAT_ADMIN_PASSWORD；
 * 仅在 NODE_ENV !== "production" 且未配置时回退到强生成的临时密码（不会持久化到 DB），
 * 并打印强警告。这是为了避免 dev/seed 流程被强制打断，但生产部署必须配齐。
 */
function resolveAdminPassword() {
  const password = process.env.NEXTCHAT_ADMIN_PASSWORD?.trim();
  if (password) {
    if (password === "admin123" || password.length < 8) {
      throw new Error(
        "[Auth] NEXTCHAT_ADMIN_PASSWORD 过于简单（少于 8 位或等于默认弱口令），拒绝 seed 默认管理员。请设置更复杂的强密码后重启。",
      );
    }
    return password;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[Auth] 生产环境必须显式设置 NEXTCHAT_ADMIN_PASSWORD（至少 8 位强密码），禁止回退到默认口令。",
    );
  }
  // 开发环境：生成一次性临时密码并强警告，不持久化弱默认值
  const generated = `dev-${randomBytes(8).toString("hex")}`;
  console.warn(
    "[Auth] ⚠️ NEXTCHAT_ADMIN_PASSWORD 未配置；dev 环境已生成一次性临时 admin 密码（仅本次进程有效，请尽快显式设置）。",
  );
  return generated;
}
const AUTH_BYPASS_ENABLED =
  process.env.NEXTCHAT_DISABLE_AUTH === "1" ||
  process.env.NEXTCHAT_DISABLE_AUTH === "true";
const LOCAL_AUTH_BYPASS_USERNAME =
  process.env.NEXTCHAT_LOCAL_BYPASS_USER?.trim() || "ccc";
const LOCAL_AUTH_BYPASS_USER: AuthUser = {
  // 必须是合法 UUID（末段 12 个 hex 字符），否则 `where id = $1::uuid` 会抛
  // `invalid input syntax for type uuid` 触发 500。0x0c = 12（hex "c" 替换为 "0c"）
  id: "00000000-0000-0000-0000-000000000c0c",
  externalId: normalizeExternalId(LOCAL_AUTH_BYPASS_USERNAME),
  username: LOCAL_AUTH_BYPASS_USERNAME,
  displayName: LOCAL_AUTH_BYPASS_USERNAME,
  role: "user",
  isActive: true,
  lastChatAt: null,
};

export function isAuthBypassEnabled() {
  return AUTH_BYPASS_ENABLED;
}

declare global {
  var __nextchatAuthSchemaReady: Promise<void> | undefined;
  var __nextchatAuthSchemaVersion: string | undefined;
}

const AUTH_SCHEMA_VERSION = "2026-06-11-auth-last-chat";

export type AuthRole = "admin" | "user";

export type AuthUser = {
  id: string;
  externalId: string;
  username: string;
  displayName: string;
  role: AuthRole;
  isActive: boolean;
  lastChatAt: string | null;
};

export type AuthContext = {
  actor: AuthUser;
  effective: AuthUser;
  isImpersonating: boolean;
  readOnly: boolean;
};

type AuthSource =
  | Request
  | NextRequest
  | Headers
  | {
      headers?: Headers;
    }
  | null
  | undefined;

type AuthCookieValues = {
  sessionToken?: string | null;
  effectiveUserId?: string | null;
};

type AuthUserRow = {
  id: string;
  external_id: string | null;
  username: string | null;
  display_name: string | null;
  role: string | null;
  is_active: boolean | null;
  last_chat_at: string | null;
};

type SessionRow = AuthUserRow & {
  expires_at: string;
};

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

// 异步 scrypt 在 libuv 线程池中执行，避免登录请求阻塞事件循环。
function scryptAsync(password: string, salt: string, keylen: number) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keylen, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password: string, salt?: string) {
  const resolvedSalt = salt ?? randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, resolvedSalt, 64)).toString(
    "hex",
  );
  return `${resolvedSalt}:${derived}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHash] = String(storedHash || "").split(":");
  if (!salt || !expectedHash) {
    return false;
  }

  const derived = Uint8Array.from(await scryptAsync(password, salt, 64));
  const expected = Uint8Array.from(Buffer.from(expectedHash, "hex"));
  if (derived.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(derived, expected);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeExternalId(username: string) {
  return `user:${username.trim().toLowerCase()}`;
}

function buildAuthUser(row: AuthUserRow): AuthUser {
  return {
    id: row.id,
    externalId: String(row.external_id || ""),
    username: String(row.username || ""),
    displayName: String(row.display_name || row.username || ""),
    role: row.role === "admin" ? "admin" : "user",
    isActive: row.is_active !== false,
    lastChatAt: row.last_chat_at ?? null,
  };
}

function getHeadersFromSource(source?: AuthSource) {
  if (!source) {
    return new Headers();
  }

  if (source instanceof Headers) {
    return source;
  }

  if ("headers" in source && source.headers) {
    return source.headers;
  }

  return new Headers();
}

function parseCookieHeader(cookieHeader?: string | null) {
  const entries = String(cookieHeader || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const cookieMap = new Map<string, string>();

  entries.forEach((entry) => {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      return;
    }

    const key = entry.slice(0, separatorIndex).trim();
    const value = entry.slice(separatorIndex + 1).trim();
    try {
      cookieMap.set(key, decodeURIComponent(value));
    } catch {
      // 畸形 cookie 值按缺失处理，避免整个请求 500
    }
  });

  return cookieMap;
}

function getCookieValuesFromSource(source?: AuthSource): AuthCookieValues {
  const headers = getHeadersFromSource(source);
  const cookieMap = parseCookieHeader(headers.get("cookie"));

  return {
    sessionToken: cookieMap.get(AUTH_SESSION_COOKIE_NAME) || "",
    effectiveUserId: cookieMap.get(EFFECTIVE_USER_COOKIE_NAME) || "",
  };
}

async function getUserById(userId: string) {
  if (!userId) {
    return null;
  }

  const result = await pgQuery<AuthUserRow>(
    `select
       id::text as id,
       external_id,
       username,
       display_name,
       role,
       is_active,
       last_chat_at::text as last_chat_at
     from app_users
     where id = $1::uuid
       and username is not null
     limit 1`,
    [userId],
  );

  const row = result.rows[0];
  return row ? buildAuthUser(row) : null;
}

async function getSessionUser(sessionToken: string) {
  if (!sessionToken) {
    return null;
  }

  const result = await pgQuery<SessionRow>(
    `select
       u.id::text as id,
       u.external_id,
       u.username,
       u.display_name,
       u.role,
        u.is_active,
        u.last_chat_at::text as last_chat_at,
        s.expires_at::text as expires_at
     from auth_sessions s
     join app_users u on u.id = s.user_id
     where s.session_token_hash = $1
       and s.expires_at > now()
     limit 1`,
    [hashToken(sessionToken)],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  if (!row.username || row.is_active === false) {
    return null;
  }

  await pgQuery(
    `update auth_sessions
     set last_seen_at = now(),
         updated_at = now()
     where session_token_hash = $1`,
    [hashToken(sessionToken)],
  ).catch(() => {});

  return buildAuthUser(row);
}

async function ensureDefaultAdminSeeded() {
  const countResult = await pgQuery<{ count: string }>(
    `select count(*)::text as count
     from app_users
     where username is not null`,
  );
  const userCount = Number(countResult.rows[0]?.count || "0");

  if (userCount > 0) {
    return;
  }

  const normalizedUsername = DEFAULT_ADMIN_USERNAME.toLowerCase();
  await pgQuery(
    `insert into app_users (
       external_id,
       username,
       password_hash,
       display_name,
       role,
       is_active
     ) values (
       $1,
       $2,
       $3,
       $4,
       'admin',
       true
     )
     on conflict do nothing`,
    [
      normalizeExternalId(normalizedUsername),
      normalizedUsername,
      await hashPassword(resolveAdminPassword()),
      "管理员",
    ],
  );
}

export async function ensureAuthSchemaAndSeed() {
  if (globalThis.__nextchatAuthSchemaVersion !== AUTH_SCHEMA_VERSION) {
    globalThis.__nextchatAuthSchemaReady = undefined;
  }

  if (!globalThis.__nextchatAuthSchemaReady) {
    globalThis.__nextchatAuthSchemaReady = (async () => {
      await ensureSyncStorageSchema();

      await pgQuery(`
        alter table app_users
        add column if not exists username text
      `);
      await pgQuery(`
        alter table app_users
        add column if not exists password_hash text
      `);
      await pgQuery(`
        alter table app_users
        add column if not exists role text not null default 'user'
      `);
      await pgQuery(`
        alter table app_users
        add column if not exists last_chat_at timestamptz
      `);
      await pgQuery(`
        create unique index if not exists idx_app_users_username_unique
        on app_users(lower(username))
        where username is not null
      `);
      await pgQuery(`
        create table if not exists auth_sessions (
          id uuid primary key default generate_uuid_v4(),
          user_id uuid not null references app_users(id) on delete cascade,
          session_token_hash text not null unique,
          expires_at timestamptz not null,
          last_seen_at timestamptz not null default now(),
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
      await pgQuery(`
        create index if not exists idx_auth_sessions_user_id
        on auth_sessions(user_id)
      `);
      await pgQuery(`
        create index if not exists idx_auth_sessions_expires_at
        on auth_sessions(expires_at)
      `);
      await pgQuery(`
        create or replace trigger trg_auth_sessions_updated_at
        before update on auth_sessions
        for each row execute function set_updated_at()
      `);
      await pgQuery(`
        delete from auth_sessions
        where expires_at <= now()
      `);
      globalThis.__nextchatAuthSchemaVersion = AUTH_SCHEMA_VERSION;
    })().catch((error) => {
      globalThis.__nextchatAuthSchemaReady = undefined;
      globalThis.__nextchatAuthSchemaVersion = undefined;
      throw error;
    });
  }

  await globalThis.__nextchatAuthSchemaReady;
  await ensureDefaultAdminSeeded();
}

export function getAuthSessionCookieName() {
  return AUTH_SESSION_COOKIE_NAME;
}

export function getEffectiveUserCookieName() {
  return EFFECTIVE_USER_COOKIE_NAME;
}

export function getAuthSessionMaxAgeSeconds() {
  return AUTH_SESSION_MAX_AGE_SECONDS;
}

export function getEffectiveUserCookieMaxAgeSeconds() {
  return AUTH_SESSION_MAX_AGE_SECONDS;
}

export async function authenticateUser(username: string, password: string) {
  await ensureAuthSchemaAndSeed();

  const normalizedUsername = String(username || "")
    .trim()
    .toLowerCase();
  if (!normalizedUsername || !password) {
    return null;
  }

  const result = await pgQuery<
    AuthUserRow & {
      password_hash: string | null;
    }
  >(
    `select
       id::text as id,
       external_id,
       username,
        password_hash,
        display_name,
        role,
        is_active,
        last_chat_at::text as last_chat_at
      from app_users
     where lower(username) = $1
     limit 1`,
    [normalizedUsername],
  );
  const row = result.rows[0];

  if (!row?.password_hash || row.is_active === false) {
    return null;
  }

  if (!(await verifyPassword(password, row.password_hash))) {
    return null;
  }

  return buildAuthUser(row);
}

export async function createAuthSession(userId: string) {
  await ensureAuthSchemaAndSeed();

  const token = randomBytes(32).toString("hex");
  await pgQuery(
    `insert into auth_sessions (
       user_id,
       session_token_hash,
       expires_at
     ) values (
       $1::uuid,
       $2,
       now() + ($3 || ' seconds')::interval
     )`,
    [userId, hashToken(token), String(AUTH_SESSION_MAX_AGE_SECONDS)],
  );

  return token;
}

export async function revokeAuthSession(sessionToken?: string | null) {
  if (!sessionToken) {
    return;
  }

  await ensureAuthSchemaAndSeed();
  await pgQuery(
    `delete from auth_sessions
     where session_token_hash = $1`,
    [hashToken(sessionToken)],
  );
}

export async function getAuthContextFromCookies(values: AuthCookieValues) {
  if (AUTH_BYPASS_ENABLED) {
    let effectiveUser = LOCAL_AUTH_BYPASS_USER;
    const targetUserId = String(values.effectiveUserId || "").trim();
    if (targetUserId && targetUserId !== LOCAL_AUTH_BYPASS_USER.id) {
      const targetUser = await getUserById(targetUserId).catch(() => null);
      if (targetUser?.isActive) {
        effectiveUser = targetUser;
      }
    }

    return {
      actor: LOCAL_AUTH_BYPASS_USER,
      effective: effectiveUser,
      isImpersonating: LOCAL_AUTH_BYPASS_USER.id !== effectiveUser.id,
      readOnly: false,
    } satisfies AuthContext;
  }

  const sessionToken = String(values.sessionToken || "").trim();
  if (!sessionToken) {
    return null;
  }

  await ensureAuthSchemaAndSeed();

  const actor = await getSessionUser(sessionToken);
  if (!actor) {
    return null;
  }

  let effective = actor;
  const targetUserId = String(values.effectiveUserId || "").trim();
  // 切换用户 cookie 只对管理员生效：普通用户自行伪造 cookie 不能冒充他人。
  // 非法 UUID 等查询失败按未切换处理，避免所有接口 500。
  if (actor.role === "admin" && targetUserId && targetUserId !== actor.id) {
    const targetUser = await getUserById(targetUserId).catch(() => null);
    if (targetUser?.isActive) {
      effective = targetUser;
    }
  }

  return {
    actor,
    effective,
    isImpersonating: actor.id !== effective.id,
    readOnly: false,
  } satisfies AuthContext;
}

export async function getAuthContext(source?: AuthSource) {
  return getAuthContextFromCookies(getCookieValuesFromSource(source));
}

export async function requireAuthContext(source?: AuthSource) {
  const context = await getAuthContext(source);
  if (!context) {
    throw new AuthError("unauthorized", 401);
  }

  return context;
}

export async function requireAdminContext(source?: AuthSource) {
  const context = await requireAuthContext(source);
  if (context.actor.role !== "admin") {
    throw new AuthError("forbidden", 403);
  }

  return context;
}

export async function requireWritableAuthContext(source?: AuthSource) {
  const context = await requireAuthContext(source);
  if (context.readOnly) {
    throw new AuthError("admin_readonly_mode", 403);
  }

  return context;
}

export async function listManagedUsers() {
  await ensureAuthSchemaAndSeed();

  const result = await pgQuery<
    AuthUserRow & {
      created_at: string | null;
      conversation_count: string;
      last_conversation_at: string | null;
      drawing_count: string;
    }
  >(
    `select
       u.id::text as id,
       u.external_id,
       u.username,
       u.display_name,
       u.role,
       u.is_active,
        u.last_chat_at::text as last_chat_at,
        u.created_at::text as created_at,
       coalesce(c.conversation_count, 0)::text as conversation_count,
       c.last_conversation_at::text as last_conversation_at,
       coalesce(d.drawing_count, 0)::text as drawing_count
     from app_users u
     left join (
       select
         user_id,
         count(*) as conversation_count,
         max(updated_at) as last_conversation_at
       from conversations
       where is_deleted = false
       group by user_id
     ) c on c.user_id = u.id
     left join (
       select
         user_id,
         count(*) as drawing_count
       from user_draw_images
       group by user_id
     ) d on d.user_id = u.id
     where u.username is not null
     order by lower(u.username) asc`,
  );

  return result.rows.map((row) => ({
    ...buildAuthUser(row),
    createdAt: row.created_at,
    conversationCount: parseInt(row.conversation_count, 10) || 0,
    lastConversationAt: row.last_conversation_at,
    drawingCount: parseInt(row.drawing_count, 10) || 0,
  }));
}

async function initializeUserSettings(userId: string) {
  const templateResult = await pgQuery<{
    chat_settings: any;
    plugin_settings: any;
    security_settings: any;
    extra_settings: any;
  }>(
    `select
       chat_settings,
       plugin_settings,
       security_settings,
       extra_settings
     from app_settings
     where user_id = (
       select id from app_users
       where role = 'admin'
       order by created_at
       limit 1
     )
     limit 1`,
  );

  const template = templateResult.rows[0];
  if (!template) {
    await pgQuery(
      `insert into app_settings (
         user_id,
         chat_settings,
         plugin_settings,
         security_settings,
         extra_settings
       ) values (
         $1::uuid,
         '{}'::jsonb,
         '{}'::jsonb,
         '{}'::jsonb,
         '{}'::jsonb
       )
       on conflict (user_id) do nothing`,
      [userId],
    );
    return;
  }

  await pgQuery(
    `insert into app_settings (
       user_id,
       chat_settings,
       plugin_settings,
       security_settings,
       extra_settings
     ) values (
       $1::uuid,
       $2::jsonb,
       $3::jsonb,
       $4::jsonb,
       $5::jsonb
     )
     on conflict (user_id) do nothing`,
    [
      userId,
      template.chat_settings || {},
      template.plugin_settings || {},
      template.security_settings || {},
      template.extra_settings || {},
    ],
  );
}

export async function createManagedUser(params: {
  username: string;
  password: string;
  displayName?: string;
  role?: AuthRole;
}) {
  await ensureAuthSchemaAndSeed();

  const username = String(params.username || "")
    .trim()
    .toLowerCase();
  const password = String(params.password || "");
  const displayName =
    String(params.displayName || "").trim() || username || "新用户";
  const role = params.role === "admin" ? "admin" : "user";

  if (!username) {
    throw new AuthError("missing_username", 400);
  }
  if (!password) {
    throw new AuthError("missing_password", 400);
  }

  const existing = await pgQuery<{ id: string }>(
    `select id::text as id
     from app_users
     where lower(username) = $1
     limit 1`,
    [username],
  );
  if (existing.rows[0]?.id) {
    throw new AuthError("username_already_exists", 409);
  }

  const result = await pgQuery<AuthUserRow>(
    `insert into app_users (
       external_id,
       username,
       password_hash,
       display_name,
       role,
       is_active
     ) values (
       $1,
       $2,
       $3,
       $4,
       $5,
       true
     )
      returning
        id::text as id,
        external_id,
        username,
        display_name,
        role,
        is_active,
        last_chat_at::text as last_chat_at`,
    [
      normalizeExternalId(username),
      username,
      await hashPassword(password),
      displayName,
      role,
    ],
  );

  const newUser = buildAuthUser(result.rows[0]);

  await initializeUserSettings(newUser.id);

  return newUser;
}

export async function deleteManagedUser(params: {
  actorUserId: string;
  userId: string;
}) {
  await ensureAuthSchemaAndSeed();

  const actorUserId = String(params.actorUserId || "").trim();
  const userId = String(params.userId || "").trim();

  if (!userId) {
    throw new AuthError("missing_user_id", 400);
  }

  if (actorUserId && actorUserId === userId) {
    throw new AuthError("cannot_delete_self", 400);
  }

  const targetResult = await pgQuery<AuthUserRow>(
    `select
       id::text as id,
       external_id,
       username,
       display_name,
        role,
        is_active,
        last_chat_at::text as last_chat_at
      from app_users
      where id = $1::uuid
        and username is not null
      limit 1`,
    [userId],
  );

  const targetRow = targetResult.rows[0];
  if (!targetRow) {
    throw new AuthError("target_user_not_found", 404);
  }

  if (targetRow.role === "admin") {
    throw new AuthError("cannot_delete_admin", 400);
  }

  // 显式删除用户的所有聊天记录（conversations 级联删除 messages）
  await pgQuery(`delete from conversations where user_id = $1::uuid`, [userId]);

  await pgQuery(
    `delete from app_users
     where id = $1::uuid`,
    [userId],
  );

  return buildAuthUser(targetRow);
}

export async function updateManagedUser(params: {
  userId: string;
  username?: string;
  displayName?: string;
  password?: string;
}) {
  await ensureAuthSchemaAndSeed();

  const userId = String(params.userId || "").trim();
  if (!userId) {
    throw new AuthError("missing_user_id", 400);
  }

  const username = String(params.username || "")
    .trim()
    .toLowerCase();
  const displayName = String(params.displayName || "").trim();
  const password = String(params.password || "");

  const sets: string[] = [];
  const values: string[] = [];
  let idx = 0;

  if (username) {
    const existing = await pgQuery<{ id: string }>(
      `select id::text as id
       from app_users
       where lower(username) = $1 and id <> $2::uuid
       limit 1`,
      [username, userId],
    );
    if (existing.rows[0]?.id) {
      throw new AuthError("username_already_exists", 409);
    }

    idx++;
    sets.push(`username = $${idx}`);
    values.push(username);
    idx++;
    sets.push(`external_id = $${idx}`);
    values.push(normalizeExternalId(username));
  }

  if (displayName) {
    idx++;
    sets.push(`display_name = $${idx}`);
    values.push(displayName);
  }

  if (password) {
    idx++;
    sets.push(`password_hash = $${idx}`);
    values.push(await hashPassword(password));
  }

  if (sets.length === 0) {
    throw new AuthError("nothing_to_update", 400);
  }

  idx++;
  values.push(userId);

  const result = await pgQuery<AuthUserRow>(
    `update app_users
        set ${sets.join(", ")}
      where id = $${idx}::uuid
       returning
         id::text as id,
         external_id,
         username,
         display_name,
         role,
         is_active,
         last_chat_at::text as last_chat_at`,
    values,
  );

  if (!result.rows[0]) {
    throw new AuthError("target_user_not_found", 404);
  }

  return buildAuthUser(result.rows[0]);
}

export async function resolveSyncUserContext(source?: AuthSource) {
  const context = await requireAuthContext(source);

  return {
    actorUserId: context.actor.id,
    actorExternalUserId: context.actor.externalId,
    effectiveUserId: context.effective.id,
    effectiveExternalUserId: context.effective.externalId,
    role: context.actor.role,
    readOnly: context.readOnly,
    isImpersonating: context.isImpersonating,
  };
}
