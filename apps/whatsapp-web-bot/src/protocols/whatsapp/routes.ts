import type { Hono } from "hono";
import type { Env } from "../../env";
import type { WhatsAppRuntime } from "./runtime";

export function registerWhatsAppSetupRoutes(
  app: Hono,
  env: Env,
  runtime: WhatsAppRuntime
): void {
  app.get("/setup/qr", (c) => {
    const authHeader = c.req.header("Authorization") || "";
    const expected = `Bearer ${env.WA_WEB_ADMIN_SETUP_TOKEN}`;

    if (authHeader !== expected) {
      return c.json({ error: "unauthorized" }, 401);
    }

    return c.json({
      ready: runtime.isReady(),
      qr: runtime.getLatestQr(),
    });
  });
}
