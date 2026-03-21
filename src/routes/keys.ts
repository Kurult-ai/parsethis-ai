import { Hono } from "hono";
import { authMiddleware, createApiKey, listApiKeys, deleteApiKey } from "../auth.js";

export const keysRoutes = new Hono();

keysRoutes.get("/v1/keys", authMiddleware("admin"), async (c) => {
  const keys = await listApiKeys();
  return c.json({ keys });
});

keysRoutes.post("/v1/keys", authMiddleware("admin"), async (c) => {
  const body = await c.req.json<{ name: string; scopes?: string[] }>();

  if (!body.name || typeof body.name !== "string") {
    return c.json({ error: "name is required and must be a string" }, 400);
  }

  if (body.name.length > 100) {
    return c.json({ error: "name must be less than 100 characters" }, 400);
  }

  if (body.scopes !== undefined) {
    if (!Array.isArray(body.scopes)) {
      return c.json({ error: "scopes must be an array" }, 400);
    }
    const validScopes = ["analyze", "evaluate", "chat", "admin"];
    const invalid = body.scopes.filter((s) => !validScopes.includes(s));
    if (invalid.length > 0) {
      return c.json({ error: `Invalid scopes: ${invalid.join(", ")}. Valid: ${validScopes.join(", ")}` }, 400);
    }
  }

  const key = await createApiKey(body.name, body.scopes || ["analyze", "evaluate", "chat"]);
  return c.json(key, 201);
});

keysRoutes.delete("/v1/keys/:id", authMiddleware("admin"), async (c) => {
  const id = c.req.param("id")!;
  const deleted = await deleteApiKey(id);
  if (!deleted) {
    return c.json({ error: "Key not found or cannot be deleted" }, 404);
  }
  return c.json({ deleted: true });
});
