import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
export const prisma = new PrismaClient({ adapter });

export async function disconnectDb() {
  await prisma.$disconnect();
}
