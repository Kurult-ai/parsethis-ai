/**
 * Domain ownership for organizations.
 *
 * An organization proves it controls an email domain by publishing a DNS TXT
 * record. Once proved, an account on that domain cannot bootstrap a second
 * organization, and its unaffiliated keys become claimable by the organization
 * that owns the domain.
 *
 * Proof is required rather than assumed for the obvious reason: without it, the
 * first person to type "gmail.com" would govern every Gmail account on Parse,
 * and the second person to type a competitor's domain would lock them out of
 * their own control plane.
 */

import { promises as dns } from "node:dns";
import { randomBytes, createHash } from "node:crypto";

/**
 * Domains nobody may claim, however well they prove control. A shared mail
 * provider is not an organization, and claiming one would let its owner govern
 * unrelated strangers and deny them the ability to create their own org.
 */
export const PUBLIC_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "fastmail.com",
  "hey.com",
  "tutanota.com",
  "tuta.io",
  "qq.com",
  "163.com",
  "126.com",
  "naver.com",
  "example.com",
  "test.com",
]);

export type DomainValidation =
  | { ok: true; domain: string }
  | { ok: false; reason: "malformed" | "public_mail"; detail: string };

/**
 * Normalise and vet a domain before anything is stored or queried.
 *
 * Pure, so the rules that decide what may be claimed are unit-tested rather
 * than asserted inside a route handler.
 */
export function validateClaimableDomain(raw: unknown): DomainValidation {
  if (typeof raw !== "string") {
    return { ok: false, reason: "malformed", detail: "domain must be a string" };
  }

  // Accept what a person would paste: an address, a URL, mixed case, a trailing
  // dot, surrounding whitespace.
  let domain = raw.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (domain.includes("@")) domain = domain.split("@").pop() ?? "";
  domain = domain.replace(/\.$/, "");

  if (!domain || domain.length > 253) {
    return { ok: false, reason: "malformed", detail: "domain is empty or too long" };
  }
  // Labels: alphanumeric with internal hyphens, at least two of them, and a
  // TLD that is not numeric.
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    return {
      ok: false,
      reason: "malformed",
      detail: `"${domain}" is not a valid domain name`,
    };
  }

  if (PUBLIC_MAIL_DOMAINS.has(domain)) {
    return {
      ok: false,
      reason: "public_mail",
      detail: `${domain} is a shared mail provider and cannot be claimed by one organization. Claim a domain your organization controls.`,
    };
  }

  return { ok: true, domain };
}

/** The hostname an organization publishes its proof at. */
export function challengeHost(domain: string): string {
  return `_parse-challenge.${domain}`;
}

/** The exact TXT value the organization must publish. */
export function challengeValue(token: string): string {
  return `parse-verify=${token}`;
}

/**
 * A fresh challenge token. Derived from the org id so a token issued for one
 * organization cannot be replayed to prove a domain for another, and random so
 * it cannot be predicted from the org id alone.
 */
export function mintChallengeToken(orgId: string): string {
  const nonce = randomBytes(16).toString("hex");
  const bound = createHash("sha256").update(`${orgId}:${nonce}`).digest("hex").slice(0, 32);
  return `${nonce}${bound}`;
}

/** Whether the token was minted for this organization. */
export function tokenMatchesOrg(token: string, orgId: string): boolean {
  if (typeof token !== "string" || token.length !== 64) return false;
  const nonce = token.slice(0, 32);
  const bound = token.slice(32);
  const expected = createHash("sha256").update(`${orgId}:${nonce}`).digest("hex").slice(0, 32);
  return bound === expected;
}

export type DnsProof =
  | { ok: true }
  | { ok: false; reason: "not_found" | "no_records" | "lookup_failed"; detail: string };

/**
 * Look for the challenge in DNS. Never throws — a resolver failure is a
 * "try again", not a 500, and certainly not a verified domain.
 */
export async function checkDnsChallenge(domain: string, token: string): Promise<DnsProof> {
  const host = challengeHost(domain);
  const wanted = challengeValue(token);

  let records: string[][];
  try {
    records = await dns.resolveTxt(host);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return {
        ok: false,
        reason: "no_records",
        detail: `No TXT record found at ${host}. Publish ${wanted} there, then try again — DNS can take a few minutes to propagate.`,
      };
    }
    return {
      ok: false,
      reason: "lookup_failed",
      detail: `Could not read DNS for ${host}: ${(err as Error).message}`,
    };
  }

  // resolveTxt returns chunked strings per record; join each record's chunks.
  const values = records.map((chunks) => chunks.join("").trim());
  if (values.includes(wanted)) return { ok: true };

  return {
    ok: false,
    reason: "not_found",
    detail: `${host} has ${values.length} TXT record(s), none matching ${wanted}.`,
  };
}
