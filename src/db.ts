import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

let _prisma: PrismaClient | null = null;

export function databaseUrlSchema(databaseUrl: string): string | undefined {
  const url = new URL(databaseUrl);
  return url.searchParams.get("schema") ?? undefined;
}

export function databaseUrlWithoutPrismaSchemaParam(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (!url.searchParams.has("schema")) return databaseUrl;
  url.searchParams.delete("schema");
  return url.toString();
}

export function databaseUrlWithSchemaSearchPath(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const schema = databaseUrlSchema(databaseUrl);
  if (!schema) return databaseUrl;

  url.searchParams.delete("schema");
  if (!url.searchParams.has("options")) {
    url.searchParams.set("options", `-c search_path=${schema}`);
  }
  return url.toString();
}

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    const connectionString = databaseUrlWithoutPrismaSchemaParam(DATABASE_URL);
    const schema = databaseUrlSchema(DATABASE_URL);
    const adapter = new PrismaPg({ connectionString }, schema ? { schema } : undefined);
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
