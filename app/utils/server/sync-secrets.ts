import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import { pgQuery } from "./postgres";

type QueryFn = (text: string, params?: unknown[]) => Promise<unknown>;

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
// 注意：未来需要支持加密格式升级时，应在 base64 编码前添加 4-6 byte 的 magic/version
// 字节，并在 decrypt 中先校验；当前为不破坏现有加密数据，先保持向后兼容。

function concatUint8Arrays(arrays: readonly Uint8Array[]) {
  const output = new Uint8Array(
    arrays.reduce((total, chunk) => total + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of arrays) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function getSecretMaterial() {
  // 强制要求显式配置 APP_SECRET，禁止回退到 DATABASE_URL / PGPASSWORD 等数据库连接信息，
  // 否则任何能读 .env 文件（包括备份 dump）的人都能复算密钥，所有 sync_secrets 加密的
  // management key 等敏感数据等同于明文存储。
  const secret =
    process.env.APP_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.NEXTCHAT_SYNC_SECRET;

  if (!secret) {
    throw new Error(
      "[SyncSecrets] 必须显式配置 APP_SECRET（或 NEXTAUTH_SECRET / NEXTCHAT_SYNC_SECRET）后才能加解密 sync_secrets 数据；拒绝回退到数据库连接信息作为密钥派生源",
    );
  }

  return Uint8Array.from(createHash("sha256").update(secret).digest());
}

export function encryptSyncSecretPayload(payload: unknown) {
  const iv = Uint8Array.from(randomBytes(IV_LENGTH));
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, getSecretMaterial(), iv);
  const encrypted = concatUint8Arrays([
    Uint8Array.from(cipher.update(JSON.stringify(payload), "utf8")),
    Uint8Array.from(cipher.final()),
  ]);
  const authTag = Uint8Array.from(cipher.getAuthTag());

  return Buffer.from(concatUint8Arrays([iv, authTag, encrypted])).toString(
    "base64",
  );
}

export function decryptSyncSecretPayload(ciphertext: string) {
  const input = Uint8Array.from(Buffer.from(ciphertext, "base64"));
  const iv = input.subarray(0, IV_LENGTH);
  const authTag = input.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = input.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(
    ENCRYPTION_ALGORITHM,
    getSecretMaterial(),
    iv,
  );
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.from(
    concatUint8Arrays([
      Uint8Array.from(decipher.update(encrypted)),
      Uint8Array.from(decipher.final()),
    ]),
  ).toString("utf8");
  return JSON.parse(plaintext);
}

export async function setEncryptedSyncSecret(
  params: {
    userId: string;
    secretKey: string;
    payload: unknown;
  },
  query?: QueryFn,
) {
  const runQuery = query ?? pgQuery;
  await runQuery(
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

  try {
    return decryptSyncSecretPayload(value) as T;
  } catch (error) {
    console.error(
      `[SyncSecrets] 解密失败，已忽略 secretKey=${params.secretKey} userId=${params.userId}`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export async function deleteEncryptedSyncSecret(params: {
  userId: string;
  secretKey: string;
}) {
  await pgQuery(
    `delete from sync_secrets where user_id = $1 and secret_key = $2`,
    [params.userId, params.secretKey],
  );
}
