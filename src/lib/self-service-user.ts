import { prisma } from "../db.js";
import { SELF_SERVICE_USER_ID } from "./constants.js";

/**
 * Guarantee the sentinel row that owns every self-service API key.
 *
 * `api_keys.user_id` has a foreign key to `users`, and the public signup paths
 * write the literal id "self-service". With no such row the insert violates the
 * constraint, createApiKeyFromService silently falls back to the Redis key
 * store, and the key gets a `redis_…` id that exists in no table. Checkout then
 * completes, the customer is charged, and `checkout.session.completed` fails
 * writing the Subscription row — so the plan they paid for is never granted.
 *
 * Idempotent, and safe to call on every boot: it is one upsert on a fixed id.
 * The row is not a login. The password hash is a value bcrypt can never match,
 * and the email uses .invalid (RFC 2606) so it can never be delivered to.
 */
export async function ensureSelfServiceUser(): Promise<void> {
  await prisma.user.upsert({
    where: { id: SELF_SERVICE_USER_ID },
    update: {},
    create: {
      id: SELF_SERVICE_USER_ID,
      email: "self-service@internal.invalid",
      passwordHash: "!no-login",
      name: "Self-service signups",
    },
  });
}
