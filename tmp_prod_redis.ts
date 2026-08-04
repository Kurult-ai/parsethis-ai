import { ensureRedisConnected, getRedis } from "./src/redis.js";

(async () => {
  const connected = await ensureRedisConnected();
  if (!connected) { console.log("Redis NOT connected"); process.exit(1); }
  const redis = getRedis();
  const fallbackSize = await redis.scard("parse:fallback_keys:index").catch((e: any) => "scard err: " + e.message);
  console.log("Prod fallback key set size:", fallbackSize);
  const allKeys = await redis.keys("*");
  console.log("Total prod Redis keys:", allKeys.length);
  const fallbackRelated = allKeys.filter((k: string) => k.includes("fallback") || k.includes("self-service") || k.includes("keygen"));
  console.log("Fallback/keygen related:", fallbackRelated.slice(0, 20));
  redis.disconnect();
})();
