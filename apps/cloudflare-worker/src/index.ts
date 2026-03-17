import { Hono } from "hono";
import { privacyPolicyResponse } from "./privacy";
import { handleWebhookEvent, handleWebhookVerification } from "./webhooks";

export interface Env {
  WHATSAPP_VERIFY_TOKEN: string;
  WHATSAPP_APP_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/privacy", privacyPolicyResponse);

app.get("/webhooks", handleWebhookVerification);

app.post("/webhooks", handleWebhookEvent);

app.all("*", () => {
  return new Response("not found", { status: 404 });
});

console.log("Cloudflare Worker is running...");

export default app;