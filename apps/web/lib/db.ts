// Prisma client for Skematron's metadata database (never a user database).
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { metadataDatabaseUrl } from "./env.ts";

// One client per process; kept on globalThis so dev hot reloads don't open new pools.
const cache = globalThis as unknown as { skematronPrisma?: PrismaClient };

export function db(): PrismaClient {
  cache.skematronPrisma ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: metadataDatabaseUrl() }),
  });
  return cache.skematronPrisma;
}
