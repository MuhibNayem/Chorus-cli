import { describe, it, expect } from "vitest";

// Test the secret file detection logic (extracted from App.tsx)
const SECRET_PATTERNS = [/\.env(\.|$)/i, /credentials/i, /secret/i, /\.pem$/i, /\.key$/i, /\.pfx$/i, /\.p12$/i, /id_rsa/i, /id_ed25519/i];

function isSecretFile(filePath: string): boolean {
  const base = filePath.split("/").pop() ?? filePath;
  return SECRET_PATTERNS.some((p) => p.test(base));
}

describe("isSecretFile (secret file denylist)", () => {
  it("blocks .env files", () => {
    expect(isSecretFile(".env")).toBe(true);
    expect(isSecretFile(".env.local")).toBe(true);
    expect(isSecretFile("src/.env.production")).toBe(true);
  });

  it("blocks credential and secret files", () => {
    expect(isSecretFile("credentials.json")).toBe(true);
    expect(isSecretFile("my-secret-key.txt")).toBe(true);
    expect(isSecretFile("app-secrets.yaml")).toBe(true);
  });

  it("blocks SSH/TLS key files", () => {
    expect(isSecretFile("id_rsa")).toBe(true);
    expect(isSecretFile("id_ed25519")).toBe(true);
    expect(isSecretFile("server.pem")).toBe(true);
    expect(isSecretFile("private.key")).toBe(true);
    expect(isSecretFile("cert.pfx")).toBe(true);
    expect(isSecretFile("keystore.p12")).toBe(true);
  });

  it("allows normal files", () => {
    expect(isSecretFile("package.json")).toBe(false);
    expect(isSecretFile("src/index.ts")).toBe(false);
    expect(isSecretFile("README.md")).toBe(false);
    expect(isSecretFile("config/app.yaml")).toBe(false);
    expect(isSecretFile("scripts/deploy.sh")).toBe(false);
  });

  it("handles nested paths correctly by checking basename", () => {
    expect(isSecretFile("config/.env")).toBe(true);
    expect(isSecretFile("infra/tls/server.key")).toBe(true);
  });
});
