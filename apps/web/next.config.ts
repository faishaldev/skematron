import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

const repositoryRoot = resolve(process.cwd(), "../..");

// Configuration lives in the repository's .env (written by `pnpm db:start`).
// Variables already set in the environment take precedence over the file.
const envFile = resolve(repositoryRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@skematron/core", "@skematron/adapters"],
  turbopack: { root: repositoryRoot },
  poweredByHeader: false,
};

export default config;
