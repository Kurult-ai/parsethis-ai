/**
 * Signed Agent Identity (Task 10.1)
 *
 * Cryptographic signing utilities for agent requests using Ed25519.
 * Agents generate a keypair, register the public key with the Parse API,
 * then sign each request payload. Downstream systems verify the signature
 * to confirm which agent made the screening call.
 */

import crypto from "node:crypto";

export interface KeyPairResult {
  publicKey: string; // base64-encoded DER/SPKI public key
  privateKey: string; // base64-encoded DER/PKCS8 private key
}

/**
 * Generate an Ed25519 key pair.
 * Returns base64-encoded DER representations suitable for storage and transport.
 */
export function generateKeyPair(): KeyPairResult {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return {
    publicKey: Buffer.from(publicKey).toString("base64"),
    privateKey: Buffer.from(privateKey).toString("base64"),
  };
}

/**
 * Sign a payload using an Ed25519 private key.
 *
 * @param privateKeyB64 - base64-encoded DER/PKCS8 private key
 * @param payload - the data to sign (string or object, objects are JSON-serialized)
 * @returns base64-encoded signature
 */
export function signPayload(privateKeyB64: string, payload: unknown): string {
  const privateKeyDer = Buffer.from(privateKeyB64, "base64");
  const privateKeyObj = crypto.createPrivateKey({
    key: privateKeyDer,
    format: "der",
    type: "pkcs8",
  });

  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  const signature = crypto.sign(null, Buffer.from(data), privateKeyObj);
  return signature.toString("base64");
}

/**
 * Verify a signature against a payload using an Ed25519 public key.
 *
 * @param publicKeyB64 - base64-encoded DER/SPKI public key
 * @param payload - the original data that was signed (string or object)
 * @param signatureB64 - base64-encoded signature
 * @returns true if the signature is valid, false otherwise
 */
export function verifySignature(
  publicKeyB64: string,
  payload: unknown,
  signatureB64: string,
): boolean {
  try {
    const publicKeyDer = Buffer.from(publicKeyB64, "base64");
    const publicKeyObj = crypto.createPublicKey({
      key: publicKeyDer,
      format: "der",
      type: "spki",
    });

    const data =
      typeof payload === "string" ? payload : JSON.stringify(payload);
    const signature = Buffer.from(signatureB64, "base64");

    return crypto.verify(null, Buffer.from(data), publicKeyObj, signature);
  } catch {
    return false;
  }
}
