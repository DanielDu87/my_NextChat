import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import { pgQuery } from "./postgres";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
let hasWarnedSecretFallback = false;

function getFallbackSecretSource() {
  const fallback =
    process.env.DATABASE_URL ||
    process.env.PGPASSWORD ||
    [
      process.env.PGHOST,
      process.env.PGPORT,
      process.env.PGDATABASE,
      process.env.PGUSER,
    ]
      .filter(Boolean)
      .join(":");

  if (!fallback) {
    throw new Error(
      "[SyncSecrets] 缺少 APP_SECRET / NEXTAUTH_SECRET / NEXTCHAT_SYNC_SECRET，且无法从数据库配置派生加密密钥",
    );
  }

  if (!hasWarnedSecretFallback) {
    hasWarnedSecretFallback = true;
    console.warn(
      "[SyncSecrets] 未配置 APP_SECRET / NEXTAUTH_SECRET / NEXTCHAT_SYNC_SECRET，已回退为基于数据库配置的派生密钥；建议尽快显式配置 APP_SECRET",
    );
  }

  return fallback;
}

function getSecretMaterial() {
  const secret =
    process.env.APP_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.NEXTCHAT_SYNC_SECRET ||
    getFallbackSecretSource();

  return createHash("sha256").update(secret).digest();
}

export function encryptSyncSecretPayload(payload: unknown) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, getSecretMaterial(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decryptSecretPayload(ciphertext: string) {
  const input = Buffer.from(ciphertext, "base64");
  const iv = input.subarray(0, IV_LENGTH);
  const authTag = input.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = input.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    getSecretMaterial(),
    iv,
  );
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext);
}

export async function setEncryptedSyncSecret(params: {
  userId: string;
  secretKey: string;
  payload: unknown;
}) {
  await pgQuery(
    `insert into sync_secrets (user_id, secret_key, encrypted_payload)
     values ($1, $2, $3)
     on conflict (user_id, secret_key) do update set
       encrypted_payload = excluded.encrypted_payload,
       updated_at = now()`,
    [params.userId, params.secretKey, encryptSyncSecretPayload(params.payload)],
  );
}

export async function getEncryptedSyncSecret<T = unknown>(params: {
  userId: string;
  secretKey: string;
}) {
  const result = await pgQuery<{ encrypted_payload: string }>(
    `select encrypted_payload
     from sync_secrets
     where user_id = $1 and secret_key = $2
     limit 1`,
    [params.userId, params.secretKey],
  );

  const value = result.rows[0]?.encrypted_payload;
  if (!value) {
    return null;
  }

  return decryptSecretPayload(value) as T;
}
