/**
 * User Authentication Service
 *
 * Email/password-based auth for paying customers (separate from API key auth).
 * - bcrypt(12) password hashing
 * - Redis-backed sessions (30-day TTL)
 * - Prisma-backed user records and password resets
 */

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../db.js";
import { getRedis, ensureRedisConnected, isRedisAvailable } from "../redis.js";

const BCRYPT_ROUNDS = 12;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Password Hashing ────────────────────────────────────────────────

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

// ── User CRUD ───────────────────────────────────────────────────────

export type PublicUser = {
  id: string;
  email: string;
  name: string | null;
  stripeCustomerId: string | null;
};

export async function createUser(
  email: string,
  password: string,
  name?: string
): Promise<PublicUser> {
  const normalizedEmail = email.toLowerCase().trim();
  const passwordHash = hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      passwordHash,
      name: name?.trim() || null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      stripeCustomerId: true,
    },
  });
  return user;
}

export async function authenticateUser(
  email: string,
  password: string
): Promise<PublicUser | null> {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      name: true,
      passwordHash: true,
      stripeCustomerId: true,
    },
  });
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;

  // Update lastLoginAt (fire-and-forget)
  prisma.user
    .update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })
    .catch(() => {});

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    stripeCustomerId: user.stripeCustomerId,
  };
}

export async function getUserById(userId: string): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      stripeCustomerId: true,
    },
  });
  return user;
}

export async function getUserByEmail(email: string): Promise<PublicUser | null> {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      name: true,
      stripeCustomerId: true,
    },
  });
  return user;
}

// ── Sessions (Redis-backed) ─────────────────────────────────────────

const SESSION_KEY_PREFIX = "session:";

export async function createSession(userId: string): Promise<string | null> {
  if (!isRedisAvailable()) return null;
  const connected = await ensureRedisConnected();
  if (!connected) return null;

  try {
    const token = randomBytes(32).toString("hex");
    const redis = getRedis();
    await redis.set(
      SESSION_KEY_PREFIX + token,
      userId,
      "EX",
      SESSION_TTL_SECONDS
    );
    return token;
  } catch {
    return null;
  }
}

export async function getSessionUser(token: string): Promise<PublicUser | null> {
  if (!token) return null;
  if (!isRedisAvailable()) return null;
  const connected = await ensureRedisConnected();
  if (!connected) return null;

  try {
    const redis = getRedis();
    const userId = await redis.get(SESSION_KEY_PREFIX + token);
    if (!userId) return null;
    return getUserById(userId);
  } catch {
    return null;
  }
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  if (!isRedisAvailable()) return;
  const connected = await ensureRedisConnected();
  if (!connected) return;

  try {
    const redis = getRedis();
    await redis.del(SESSION_KEY_PREFIX + token);
  } catch {
    // Non-fatal
  }
}

// ── Password Reset ──────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createPasswordReset(
  userId: string
): Promise<string | null> {
  try {
    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    await prisma.passwordReset.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });
    return token;
  } catch {
    return null;
  }
}

export async function validatePasswordReset(
  token: string
): Promise<string | null> {
  try {
    const tokenHash = hashToken(token);
    const reset = await prisma.passwordReset.findUnique({
      where: { tokenHash },
    });
    if (!reset) return null;
    if (reset.usedAt) return null;
    if (reset.expiresAt < new Date()) return null;
    return reset.userId;
  } catch {
    return null;
  }
}

export async function consumePasswordReset(
  token: string,
  newPassword: string
): Promise<boolean> {
  try {
    const tokenHash = hashToken(token);
    const reset = await prisma.passwordReset.findUnique({
      where: { tokenHash },
    });
    if (!reset) return false;
    if (reset.usedAt) return false;
    if (reset.expiresAt < new Date()) return false;

    const newHash = hashPassword(newPassword);

    // Update password and mark token as used in a transaction
    await prisma.$transaction([
      prisma.user.update({
        where: { id: reset.userId },
        data: { passwordHash: newHash },
      }),
      prisma.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}
