// Prisma client for Skematron's metadata database (never a user database).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { metadataDatabaseUrl } from "./env.ts";

// One client per process; kept on globalThis so dev hot reloads don't open new pools.
// It remembers the generated class it came from: after `pnpm db:generate`, a hot reload
// brings a new class, and a client made from the old one lacks the new models.
const cache = globalThis as unknown as {
  skematronMetadata?: { client: PrismaClient; generated: typeof PrismaClient };
};

export function db(): PrismaClient {
  if (cache.skematronMetadata?.generated !== PrismaClient) {
    const stale = cache.skematronMetadata?.client;
    if (stale !== undefined) void stale.$disconnect().catch(() => undefined);
    cache.skematronMetadata = {
      client: new PrismaClient({
        adapter: new PrismaPg({ connectionString: metadataDatabaseUrl() }),
      }),
      generated: PrismaClient,
    };
  }
  return cache.skematronMetadata.client;
}
