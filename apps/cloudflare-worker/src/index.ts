import { Hono } from "hono";

export interface Env {
  WHATSAPP_VERIFY_TOKEN: string;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/webhooks", (context) => {
  const mode = context.req.query("hub.mode");
  const verifyToken = context.req.query("hub.verify_token");
  const challenge = context.req.query("hub.challenge");

  if (
    mode === "subscribe" &&
    verifyToken === context.env.WHATSAPP_VERIFY_TOKEN &&
    typeof challenge === "string"
  ) {
    return context.text(challenge);
  }

  return context.body(null, 400);
});

app.all("*", () => {
  return new Response("not found", { status: 404 });
});

export default app;