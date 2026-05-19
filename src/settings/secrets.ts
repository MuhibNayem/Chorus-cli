/**
 * Encrypted secrets store for Chorus API keys.
 *
 * Uses the same AES-256-GCM scheme as mcp/auth.ts so users have one key
 * to back up. Key file: ~/.chorus/.mcp-key (owner-only, 0o600).
 * Ciphertext file: ~/.chorus/api-keys.enc (owner-only, 0o600).
 *
 * Resolution order for every key:
 *   1. process.env (highest — set in shell or launchd plist)
 *   2. ~/.chorus/api-keys.enc
 *   3. settings.json apiKeys section (migration source, read-once)
 */

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { ChorusApiKeys } from "./storage.js";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

function chorusDir(): string {
  return path.join(process.env.CHORUS_HOME_DIR ?? process.env.HOME ?? process.cwd(), ".chorus");
}

function keyFile(): string {
  return path.join(chorusDir(), ".mcp-key");
}

function encFile(): string {
  return path.join(chorusDir(), "api-keys.enc");
}

function getOrCreateKey(): Buffer {
  const kf = keyFile();
  try {
    const existing = fs.readFileSync(kf);
    if (existing.length === KEY_LENGTH) return existing;
  } catch { /* not yet created */ }

  const key = randomBytes(KEY_LENGTH);
  fs.mkdirSync(path.dirname(kf), { recursive: true });
  fs.writeFileSync(kf, key, { mode: 0o600 });
  return key;
}

function encrypt(plaintext: string): string {
  const key = getOrCreateKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ciphertext.toString("base64"),
  });
}

function decrypt(blob: string): string {
  const { iv, tag, ct } = JSON.parse(blob) as { iv: string; tag: string; ct: string };
  const key = getOrCreateKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ct, "base64")),
    decipher.final(),
  ]).toString("utf-8");
}

let cache: ChorusApiKeys | null = null;

export function loadEncryptedApiKeys(): ChorusApiKeys {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(encFile(), "utf-8");
    cache = JSON.parse(decrypt(raw)) as ChorusApiKeys;
    return cache;
  } catch {
    return {};
  }
}

export function saveEncryptedApiKeys(keys: ChorusApiKeys): void {
  const ef = encFile();
  fs.mkdirSync(path.dirname(ef), { recursive: true });
  const tmp = `${ef}.tmp`;
  fs.writeFileSync(tmp, encrypt(JSON.stringify(keys, null, 2)), { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tmp, ef);
  try { fs.chmodSync(ef, 0o600); } catch { /* best effort */ }
  cache = keys;
}

export function clearSecretsCache(): void {
  cache = null;
}

/**
 * Migrate plaintext apiKeys from settings.json into the encrypted store.
 * Called once; after migration the plaintext section is blanked.
 */
export function migrateFromPlaintext(plaintextKeys: ChorusApiKeys): void {
  if (!plaintextKeys || Object.keys(plaintextKeys).length === 0) return;
  // Only migrate if the enc file doesn't exist yet (first-run migration).
  try { fs.accessSync(encFile()); return; } catch { /* not created yet — proceed */ }
  saveEncryptedApiKeys(plaintextKeys);
}
