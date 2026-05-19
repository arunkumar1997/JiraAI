/**
 * PostgreSQL Database Client (Prisma ORM)
 *
 * Exports a singleton PrismaClient connected to PostgreSQL via the
 * @prisma/adapter-pg driver adapter (Prisma 7+).
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { logger } from "./logger.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  logger.error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill in the value.",
  );
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter } as any);

// Graceful shutdown
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});
