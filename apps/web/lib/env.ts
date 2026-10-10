// Server configuration, read when first needed so modules can be imported (by builds,
// tests and the Better Auth CLI) without every variable set. See docs/self-hosting.md.
import { resolve } from "node:path";
import { parseSecretKey } from "./secrets.ts";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new ConfigError(
      `${name} is not set. For local development run \`pnpm db:start\`; for self-hosting see docs/self-hosting.md.`,
    );
  }
  return value;
}

/** Skematron's own metadata database. Never a user's application database. */
export function metadataDatabaseUrl(): string {
  return required("SKEMATRON_DATABASE_URL");
}

/** Key for encrypting stored connection URLs. */
export function secretKey(): Buffer {
  return parseSecretKey(required("SKEMATRON_SECRET_KEY"));
}

/** Artifact directory. Required in production; development defaults to .local/artifacts. */
export function artifactDirectory(): string {
  const configured = process.env.SKEMATRON_ARTIFACT_DIR;
  if (configured !== undefined && configured !== "") return configured;
  if (process.env.NODE_ENV === "production") {
    required("SKEMATRON_ARTIFACT_DIR");
  }
  // `next dev` runs in apps/web.
  return resolve(process.cwd(), "../../.local/artifacts");
}
