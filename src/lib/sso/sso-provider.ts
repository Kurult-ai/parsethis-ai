/**
 * SSO Provider Library (Task 6.1)
 *
 * Implements a thin OAuth2 Authorization Code flow abstraction that works
 * generically with Okta, Azure AD (Entra ID), Google Workspace, and WorkOS.
 *
 * - initiateSSO(providerId) → builds the authorization URL for the IdP
 * - handleSSOCallback(providerId, code) → exchanges code for user info,
 *   maps the IdP user to an org + role, returns a signed JWT session token
 *
 * Session tokens are JWTs (HMAC-SHA256) signed with SERVER_SECRET, valid 24h.
 * Client secrets are encrypted at rest with AES-256-GCM using the same secret.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../../db.js";

// ─── Types ──────────────────────────────────────────────────────────────

export type ProviderType = "okta" | "azure" | "google" | "workos";

/** Runtime representation of an SSO provider configuration. */
export interface SSOProvider {
  id: string;
  org_id: string;
  provider_type: ProviderType;
  client_id: string;
  client_secret: string; // decrypted
  redirect_uri: string;
  domains: string[];
}

/** Internal: IdP endpoint configuration resolved per provider type. */
interface IdPEndpoints {
  authUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scope: string;
}

/** User info returned by the IdP's userinfo endpoint. */
interface IdPUserInfo {
  email: string;
  name?: string;
  sub?: string;
  [key: string]: unknown;
}

/** Result of handleSSOCallback — the data embedded in the JWT. */
export interface SSOSessionPayload {
  org_id: string;
  provider_id: string;
  email: string;
  name?: string;
  role: string;
  iat: number;
  exp: number;
}

// ─── Constants ──────────────────────────────────────────────────────────

const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const ALG = "HS256";
const TYP = "JWT";

const VALID_PROVIDER_TYPES: ProviderType[] = ["okta", "azure", "google", "workos"];

// ─── Secret resolution ──────────────────────────────────────────────────

function getServerSecret(): string {
  const secret = process.env.SSO_ENCRYPTION_KEY || process.env.SERVER_SECRET || process.env.MASTER_API_KEY;
  if (!secret) {
    throw new Error("SSO_ENCRYPTION_KEY or SERVER_SECRET must be set to use SSO");
  }
  // Ensure at least 32 bytes for AES-256
  return secret.padEnd(32, secret).slice(0, 32);
}

// ─── Encryption (AES-256-GCM) ───────────────────────────────────────────

/**
 * Encrypt a plaintext secret for storage. Returns a base64 string containing
 * the 12-byte IV + ciphertext + 16-byte auth tag.
 */
export function encryptSecret(plaintext: string): string {
  const key = Buffer.from(getServerSecret(), "utf-8");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

/** Decrypt a secret produced by encryptSecret(). */
export function decryptSecret(ciphertextB64: string): string {
  const key = Buffer.from(getServerSecret(), "utf-8");
  const buf = Buffer.from(ciphertextB64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const encrypted = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf-8");
}

// ─── JWT (HMAC-SHA256) ──────────────────────────────────────────────────

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

function base64UrlDecode(input: string): Buffer {
  // base64url uses '-' and '_' instead of '+' and '/'
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

/**
 * Sign a session payload as a JWT (HS256). No external dependency — uses
 * Node's built-in crypto.
 */
export function signSessionToken(payload: Omit<SSOSessionPayload, "iat" | "exp">): string {
  const secret = getServerSecret();
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: SSOSessionPayload = {
    ...payload,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };

  const header = base64UrlEncode(JSON.stringify({ alg: ALG, typ: TYP }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${header}.${body}`;
  const signature = createHmac("sha256", secret).update(data).digest();
  const sigB64 = base64UrlEncode(signature);

  return `${data}.${sigB64}`;
}

/**
 * Verify a JWT session token. Returns the decoded payload if valid and not
 * expired; throws otherwise.
 */
export function verifySessionToken(token: string): SSOSessionPayload {
  const secret = getServerSecret();
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const expectedSig = createHmac("sha256", secret).update(data).digest();
  const providedSig = base64UrlDecode(sig);

  if (expectedSig.length !== providedSig.length || !timingSafeEqual(expectedSig, providedSig)) {
    throw new Error("Invalid signature");
  }

  const payload = JSON.parse(base64UrlDecode(body).toString("utf-8")) as SSOSessionPayload;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error("Token expired");
  }
  return payload;
}

// ─── IdP Endpoint Resolution ────────────────────────────────────────────

/**
 * Resolve the OAuth2 endpoints for a given provider type. For Okta, the
 * org must supply the Okta domain via metadata.okta_domain. Azure and
 * Google have well-known discovery URLs; WorkOS has a universal endpoint.
 */
function resolveEndpoints(providerType: ProviderType, metadata: Record<string, unknown> | null): IdPEndpoints {
  const md = metadata ?? {};

  // Check if explicit endpoints are in metadata (highest priority)
  if (md.auth_url && md.token_url && md.userinfo_url) {
    return {
      authUrl: md.auth_url as string,
      tokenUrl: md.token_url as string,
      userinfoUrl: md.userinfo_url as string,
      scope: (md.scope as string) || defaultScope(providerType),
    };
  }

  switch (providerType) {
    case "okta": {
      const oktaDomain = md.okta_domain as string;
      if (!oktaDomain) throw new Error("Okta provider requires metadata.okta_domain");
      const base = oktaDomain.replace(/\/$/, "");
      const authServer = (md.authorization_server_id as string) || "default";
      return {
        authUrl: `${base}/oauth2/${authServer}/v1/authorize`,
        tokenUrl: `${base}/oauth2/${authServer}/v1/token`,
        userinfoUrl: `${base}/oauth2/${authServer}/v1/userinfo`,
        scope: "openid profile email",
      };
    }
    case "azure": {
      const tenantId = (md.tenant_id as string) || "common";
      const base = `https://login.microsoftonline.com/${tenantId}`;
      return {
        authUrl: `${base}/oauth2/v2.0/authorize`,
        tokenUrl: `${base}/oauth2/v2.0/token`,
        userinfoUrl: "https://graph.microsoft.com/oidc/userinfo",
        scope: "openid profile email",
      };
    }
    case "google":
      return {
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
        scope: "openid profile email",
      };
    case "workos": {
      const clientId = md.workos_client_id as string;
      const base = "https://api.workos.com/sso";
      return {
        authUrl: `${base}/authorize?client_id=${encodeURIComponent(clientId)}`,
        tokenUrl: `${base}/token`,
        userinfoUrl: `${base}/userinfo`,
        scope: "openid profile email",
      };
    }
    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }
}

function defaultScope(providerType: ProviderType): string {
  return "openid profile email";
}

// ─── DB Helpers ─────────────────────────────────────────────────────────

/**
 * Load an SSOProvider from the DB by ID, decrypting the client secret.
 */
export async function getSSOProvider(providerId: string): Promise<SSOProvider | null> {
  const row = await prisma.sSOProvider.findUnique({
    where: { id: providerId },
  });
  if (!row) return null;

  return {
    id: row.id,
    org_id: row.orgId,
    provider_type: row.providerType as ProviderType,
    client_id: row.clientId,
    client_secret: decryptSecret(row.clientSecret),
    redirect_uri: row.redirectUri,
    domains: row.domains,
  };
}

/**
 * Get the active SSO provider for an organization (first active one).
 */
export async function getProviderForOrg(orgId: string): Promise<SSOProvider | null> {
  const row = await prisma.sSOProvider.findFirst({
    where: { orgId, active: true },
    orderBy: { createdAt: "asc" },
  });
  if (!row) return null;
  return {
    id: row.id,
    org_id: row.orgId,
    provider_type: row.providerType as ProviderType,
    client_id: row.clientId,
    client_secret: decryptSecret(row.clientSecret),
    redirect_uri: row.redirectUri,
    domains: row.domains,
  };
}

// ─── Core: initiateSSO ──────────────────────────────────────────────────

/**
 * Build the authorization URL for the IdP and return it. The caller
 * (route handler) should redirect the user's browser to this URL.
 *
 * @param providerId  The SSOProvider ID
 * @returns { authorization_url, state }
 */
export async function initiateSSO(
  providerId: string,
): Promise<{ authorization_url: string; state: string }> {
  const provider = await getSSOProvider(providerId);
  if (!provider) {
    throw new Error(`SSO provider ${providerId} not found`);
  }

  const row = await prisma.sSOProvider.findUnique({
    where: { id: providerId },
    select: { metadata: true },
  });
  const endpoints = resolveEndpoints(
    provider.provider_type,
    (row?.metadata as Record<string, unknown> | null) ?? null,
  );

  // State prevents CSRF — caller should verify this in the callback.
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: provider.client_id,
    redirect_uri: provider.redirect_uri,
    scope: endpoints.scope,
    state,
  });

  // WorkOS authUrl already has query params
  const separator = endpoints.authUrl.includes("?") ? "&" : "?";
  const authUrl = `${endpoints.authUrl}${separator}${params.toString()}`;

  return { authorization_url: authUrl, state };
}

// ─── Core: handleSSOCallback ────────────────────────────────────────────

/**
 * Exchange the authorization code for an access token, fetch user info from
 * the IdP, map the user to the org + a role, and return a signed JWT.
 *
 * @param providerId  The SSOProvider ID
 * @param code        The authorization code from the IdP callback
 * @returns { session_token, org_id, email, name, role }
 */
export async function handleSSOCallback(
  providerId: string,
  code: string,
): Promise<{ session_token: string; org_id: string; email: string; name?: string; role: string }> {
  const provider = await getSSOProvider(providerId);
  if (!provider) {
    throw new Error(`SSO provider ${providerId} not found`);
  }

  const row = await prisma.sSOProvider.findUnique({
    where: { id: providerId },
    select: { metadata: true },
  });
  const endpoints = resolveEndpoints(
    provider.provider_type,
    (row?.metadata as Record<string, unknown> | null) ?? null,
  );

  // ── Step 1: Exchange code for access token ──────────────────────────
  const tokenParams = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: provider.client_id,
    client_secret: provider.client_secret,
    code,
    redirect_uri: provider.redirect_uri,
  });

  const tokenRes = await fetch(endpoints.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: tokenParams.toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${errText}`);
  }

  const tokenBody = (await tokenRes.json()) as { access_token?: string; id_token?: string };
  const accessToken = tokenBody.access_token;
  if (!accessToken) {
    throw new Error("No access_token in IdP response");
  }

  // ── Step 2: Fetch user info ────────────────────────────────────────
  const userInfoRes = await fetch(endpoints.userinfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!userInfoRes.ok) {
    const errText = await userInfoRes.text();
    throw new Error(`Userinfo fetch failed (${userInfoRes.status}): ${errText}`);
  }

  const userInfo = (await userInfoRes.json()) as IdPUserInfo;

  // Normalize email
  const email = userInfo.email || (userInfo.sub as string) || "";
  if (!email) {
    throw new Error("IdP did not return an email address");
  }

  // ── Step 3: Validate domain ────────────────────────────────────────
  const emailDomain = email.split("@")[1]?.toLowerCase();
  if (emailDomain && provider.domains.length > 0 && !provider.domains.includes(emailDomain)) {
    throw new Error(`Email domain "${emailDomain}" is not in the allowed domains for this provider`);
  }

  // ── Step 4: Map to org + role ──────────────────────────────────────
  // For v1, the first SSO user for an org gets org_admin; subsequent users
  // get developer. This can be overridden via a role mapping in the future.
  const existingKeys = await prisma.apiKey.count({
    where: { orgId: provider.org_id, revokedAt: null },
  });
  const role = existingKeys === 0 ? "org_admin" : "developer";

  const sessionToken = signSessionToken({
    org_id: provider.org_id,
    provider_id: providerId,
    email,
    name: userInfo.name,
    role,
  });

  return {
    session_token: sessionToken,
    org_id: provider.org_id,
    email,
    name: userInfo.name,
    role,
  };
}

// ─── Validation Helper ──────────────────────────────────────────────────

export function isValidProviderType(type: string): type is ProviderType {
  return VALID_PROVIDER_TYPES.includes(type as ProviderType);
}

export { VALID_PROVIDER_TYPES };
