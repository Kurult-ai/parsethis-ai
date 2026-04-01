import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

let _prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    const adapter = new PrismaPg({ connectionString: DATABASE_URL });
    _prisma = new PrismaClient({ adapter });
  }
  return _prisma;
}

/** Lazy proxy — property access forwards to the real PrismaClient. */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getPrisma(), prop, receiver);
  },
});

export async function disconnectDb() {
  if (_prisma) {
    await _prisma.$disconnect();
  }
}
