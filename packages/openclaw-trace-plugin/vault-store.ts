import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { decryptUtf8, encryptUtf8, getVaultKeyFromEnv } from "./vault-crypto.js";

export type VaultEntry = {
  id: string;
  type: string;
  /** AES-GCM 密文（iv+tag+payload）的 base64，解密后为 UTF-8 原文 */
  ciphertextB64: string;
  createdAtMs: number;
};

/**
 * 本地强加密 Vault：单文件 JSON，整文件加密存储（适合中小规模 token）。
 * 热路径仅调用 `put`/`get` 时同步读写，生产环境可换为按 session 分片。
 */
export class EncryptedVaultStore {
  private readonly filePath: string;
  private key: Buffer;
  private cache: Map<string, VaultEntry> | null = null;

  constructor(vaultDir: string) {
    this.filePath = path.join(vaultDir, "vault.enc.json");
    this.key = getVaultKeyFromEnv();
  }

  private load(): Map<string, VaultEntry> {
    if (this.cache) {
      return this.cache;
    }
    if (!fs.existsSync(this.filePath)) {
      this.cache = new Map();
      return this.cache;
    }
    try {
      const raw = fs.readFileSync(this.filePath);
      const json = decryptUtf8(raw, this.key);
      const arr = JSON.parse(json) as VaultEntry[];
      this.cache = new Map(arr.map((e) => [e.id, e]));
    } catch {
      this.cache = new Map();
    }
    return this.cache!;
  }

  private flush(): void {
    const m = this.load();
    const arr = [...m.values()];
    const payload = JSON.stringify(arr);
    const enc = encryptUtf8(payload, this.key);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, enc, { mode: 0o600 });
  }

  putPlaintext(type: string, plaintext: string): string {
    const id = `PII_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const inner = encryptUtf8(plaintext, this.key);
    const entry: VaultEntry = {
      id,
      type,
      ciphertextB64: inner.toString("base64"),
      createdAtMs: Date.now(),
    };
    const m = this.load();
    m.set(id, entry);
    this.flush();
    return `[CRABAGENT_${id}]`;
  }

  /** 揭示明文（专业版能力；调用方需鉴权） */
  reveal(id: string): string | undefined {
    const m = this.load();
    const e = m.get(id);
    if (!e) {
      return undefined;
    }
    try {
      const buf = Buffer.from(e.ciphertextB64, "base64");
      return decryptUtf8(buf, this.key);
    } catch {
      return undefined;
    }
  }
}
