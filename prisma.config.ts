// Prisma configuration for Skematron's own metadata database only.
// Never point SKEMATRON_DATABASE_URL at a user's application database.
// Run Prisma from the repository root (the pnpm db:* scripts do).
import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.SKEMATRON_DATABASE_URL ?? "" },
});
