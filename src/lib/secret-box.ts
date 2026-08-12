/**
 * Encryption at rest for the few secrets Parse has to store on a customer's
 * behalf: an org's upstream provider key, a SIEM auth header.
 *
 * Parse deliberately avoided persisting provider credentials for a long time —
 * "the C17 blast radius is minimized by not persisting provider keys to
 * disk/database". That trade was reversed on 2026-08-12 for one reason: the
 * gateway is the only enforcement point that does not depend on an agent
 * honestly declaring its own tools, and it was unreachable by any customer,
 * because configuring it required an `admin` scope no self-service key holds.
 * An enforcement point nobody can reach is not an enforcement point.
 *
 * The trade is now managed rather than avoided:
 *   - AES-256-GCM with a random IV per seal, so the ciphertext is authenticated
 *     and two seals of the same plaintext differ.
 *   - A dedicated key from PARSE_SECRET_KEY, not the master API key, so
 *     rotating one does not silently invalidate the other.
 *   - No route ever returns a sealed value or its plaintext. Reads report
 *     `configured: true` and nothing else.
 *   - Fail closed: with no key configured, sealing throws and the routes that
 *     store secrets answer 503. Storing plaintext because a key is missing is
 *     the failure this module exists to prevent.
 *
 * Format: `v1.<iv-b64>.<tag-b64>.<ciphertext-b64>`. The version prefix is what
 * lets `isSealed` tell a migrated row from a legacy plaintext one.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard
const KEY_BYTES = 32;

export class SecretKeyMissingError extends Error {
  constructor() {
    super(
      "PARSE_SECRET_KEY is not configured, so secrets cannot be encrypted at rest. Set it to 32 random bytes, base64-encoded: openssl rand -base64 32",
    );
    this.name = "SecretKeyMissingError";
  }
}

function loadKey(): Buffer {
  const raw = process.env.PARSE_SECRET_KEY;
  if (!raw) throw new SecretKeyMissingError();

  // Accept base64 or hex; anything else is a configuration mistake worth
  // failing loudly on at startup rather than at the first write.
  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `PARSE_SECRET_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

/** Whether a stored value has already been sealed by this module. */
export function isSealed(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}.`) && value.split(".").length === 4;
}

/** True when the process can seal secrets at all. Used by the startup check. */
export function secretBoxReady(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

export function sealSecret(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext === "") {
    throw new Error("sealSecret requires a non-empty string");
  }
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

/**
 * Open a sealed value. Throws on a tampered ciphertext or tag — GCM
 * authentication failing must never degrade into returning something.
 */
export function openSecret(sealed: string): string {
  if (!isSealed(sealed)) {
    throw new Error("openSecret received a value that was not sealed by this module");
  }
  const [, ivB64, tagB64, dataB64] = sealed.split(".");
  const key = loadKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/**
 * Read a column that may hold either a sealed value or a legacy plaintext one.
 *
 * `SIEMConfig.authHeader` carried the schema comment "stored encrypted at rest"
 * and was written in the clear, so existing rows have to keep working while
 * they are migrated on next write.
 */
export function openMaybeSealed(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return isSealed(value) ? openSecret(value) : value;
}

/** Never log a secret. This is what goes in a log line or an API response. */
export function redact(value: string | null | undefined): string {
  return value ? "[redacted]" : "";
}
