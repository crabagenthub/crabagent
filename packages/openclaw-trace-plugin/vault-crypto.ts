import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

function loadOrDeriveKey(masterHexOrPath: string): Buffer {
  const t = masterHexOrPath.trim();
  if (/^[0-9a-fA-F]{64}$/.test(t)) {
    return Buffer.from(t, "hex");
  }
  if (t.length >= 32) {
    return scryptSync(t, "crabagent-vault-salt", KEY_LEN);
  }
  return scryptSync(t || "dev-insecure", "crabagent-vault-salt", KEY_LEN);
}

/** 从环境变量 `CRABAGENT_VAULT_KEY`（64 hex 或任意 passphrase）派生 32 字节密钥。 */
export function getVaultKeyFromEnv(): Buffer {
  const env = process.env.CRABAGENT_VAULT_KEY?.trim();
  return loadOrDeriveKey(env ?? "");
}

export function encryptUtf8(plain: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decryptUtf8(blob: Buffer, key: Buffer): string {
  if (blob.length < IV_LEN + TAG_LEN) {
    throw new Error("vault: ciphertext too short");
  }
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
