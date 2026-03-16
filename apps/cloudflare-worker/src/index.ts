import { Hono } from "hono";

export interface Env {
  WHATSAPP_VERIFY_TOKEN: string;
  WHATSAPP_APP_SECRET: string;
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

app.post("/webhooks", async (context) => {
  const signature = context.req.header("X-Hub-Signature-256");
  if (!signature || !signature.startsWith("sha256=")) {
    return context.body(null, 401);
  }

  const expectedHex = signature.slice("sha256=".length);
  const rawBody = await context.req.text();

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(context.env.WHATSAPP_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(rawBody)
  );

  const computedHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (!timingSafeEqual(encoder.encode(computedHex), encoder.encode(expectedHex))) {
    return context.body(null, 401);
  }

  return context.body(null, 200);
});

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

app.all("*", () => {
  return new Response("not found", { status: 404 });
});

export default app;