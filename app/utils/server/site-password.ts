import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { ensureSyncStorageSchema, pgQuery } from "./postgres";

const SITE_PASSWORD_KEY = "site-password";
const SITE_ACCESS_COOKIE_NAME = "nextchat_site_unlock";
const SITE_ACCESS_MAX_AGE_SECONDS = 60 * 24 * 60 * 60;

declare global {
  var __nextchatSitePasswordReady: Promise<void> | undefined;
}

function hashPassword(password: string, salt?: string) {
  const resolvedSalt = salt ?? randomBytes(16).toString("hex");
  const derived = scryptSync(password, resolvedSalt, 64).toString("hex");
  return `${resolvedSalt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHash] = String(storedHash || "").split(":");
  if (!salt || !expectedHash) {
    return false;
  }

  const derived = Uint8Array.from(scryptSync(password, salt, 64));
  const expected = Uint8Array.from(Buffer.from(expectedHash, "hex"));

  if (derived.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(derived, expected);
}

function signCookiePayload(expiresAt: number, passwordHash: string) {
  return createHmac("sha256", passwordHash)
    .update(String(expiresAt))
    .digest("hex");
}

export function getSiteAccessCookieName() {
  return SITE_ACCESS_COOKIE_NAME;
}

export function getSiteAccessMaxAgeSeconds() {
  return SITE_ACCESS_MAX_AGE_SECONDS;
}

export async function ensureSitePasswordConfigured(password: string) {
  if (!globalThis.__nextchatSitePasswordReady) {
    globalThis.__nextchatSitePasswordReady = (async () => {
      await ensureSyncStorageSchema();
      await pgQuery(`
        create table if not exists site_access_settings (
          setting_key text primary key,
          password_hash text not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `);
      const existing = await pgQuery<{ password_hash: string }>(
        `select password_hash
         from site_access_settings
         where setting_key = $1
         limit 1`,
        [SITE_PASSWORD_KEY],
      );
      const existingHash = existing.rows[0]?.password_hash ?? "";

      if (existingHash && verifyPassword(password, existingHash)) {
        return;
      }

      await pgQuery(
        `insert into site_access_settings (
           setting_key,
           password_hash
         ) values (
           $1,
           $2
         )
         on conflict (setting_key) do update set
           password_hash = excluded.password_hash,
           updated_at = now()`,
        [SITE_PASSWORD_KEY, hashPassword(password)],
      );
    })().catch((error) => {
      globalThis.__nextchatSitePasswordReady = undefined;
      throw error;
    });
  }

  await globalThis.__nextchatSitePasswordReady;
}

export async function getSitePasswordHash() {
  await ensureSyncStorageSchema();
  const result = await pgQuery<{ password_hash: string }>(
    `select password_hash
     from site_access_settings
     where setting_key = $1
     limit 1`,
    [SITE_PASSWORD_KEY],
  );

  return result.rows[0]?.password_hash ?? "";
}

export async function verifySitePassword(password: string) {
  const passwordHash = await getSitePasswordHash();
  if (!passwordHash) {
    return false;
  }

  return verifyPassword(password, passwordHash);
}

export async function createSiteAccessCookieValue() {
  const passwordHash = await getSitePasswordHash();
  if (!passwordHash) {
    throw new Error("[SitePassword] 站点口令未配置");
  }

  const expiresAt = Date.now() + SITE_ACCESS_MAX_AGE_SECONDS * 1000;
  const signature = signCookiePayload(expiresAt, passwordHash);
  return `${expiresAt}.${signature}`;
}

export async function verifySiteAccessCookie(cookieValue?: string) {
  const rawValue = String(cookieValue || "").trim();
  if (!rawValue) {
    return false;
  }

  const [expiresAtText, signature] = rawValue.split(".");
  const expiresAt = Number(expiresAtText);

  if (!Number.isFinite(expiresAt) || !signature || expiresAt <= Date.now()) {
    return false;
  }

  const passwordHash = await getSitePasswordHash();
  if (!passwordHash) {
    return false;
  }

  const expectedSignature = signCookiePayload(expiresAt, passwordHash);
  if (signature.length !== expectedSignature.length) {
    return false;
  }

  return timingSafeEqual(
    Uint8Array.from(Buffer.from(signature)),
    Uint8Array.from(Buffer.from(expectedSignature)),
  );
}
