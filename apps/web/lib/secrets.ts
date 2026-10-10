// Encryption at rest for stored secrets (database connection URLs): AES-256-GCM.
// Token format: "v1.<iv>.<ciphertext>.<tag>" (base64url). The version prefix leaves room
// for key rotation later.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretError";
  }
}

/** Decodes SKEMATRON_SECRET_KEY: base64 of exactly 32 random bytes (`openssl rand -base64 32`). */
export function parseSecretKey(base64: string): Buffer {
  const key = Buffer.from(base64.trim(), "base64");
  if (key.length !== 32) {
    throw new SecretError(
      "SKEMATRON_SECRET_KEY must be base64 of 32 bytes (generate one with `openssl rand -base64 32`).",
    );
  }
  return key;
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decryptSecret(token: string, key: Buffer): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new SecretError("Unrecognized secret format.");
  }
  const [, iv, ciphertext, tag] = parts as [string, string, string, string];
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong key or tampered data. Never include the token in the message.
    throw new SecretError(
      "Cannot decrypt a stored secret. Was SKEMATRON_SECRET_KEY changed?",
    );
  }
}
