import type { Context } from "hono";
import type { Env } from "./index";
import { generateReplyFromOpenRouter } from "./openrouter";
import { parseFirstIncomingMessage } from "./whatsapp-webhook";
import { sendWhatsAppText } from "./whatsapp-send";

type WebhookContext = Context<{ Bindings: Env }>;
const BOT_MENTION_PREFIX = "@herder";

export function handleWebhookVerification(context: WebhookContext) {
  console.log("Received webhook verification request");
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
}

export async function handleWebhookEvent(context: WebhookContext) {
  const rawBody = await validateAndReadRawBody(context);
  if (rawBody === null) {
    return context.body(null, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("Invalid JSON payload in webhook event");
    return context.body(null, 500);
  }

  const incomingMessage = parseFirstIncomingMessage(payload);
  if (!incomingMessage) {
    return context.body(null, 200);
  }

  const prompt = extractMentionedPrompt(incomingMessage);
  if (prompt === null) {
    return context.body(null, 200);
  }

  try {
    const outboundBody = await generateReplyFromOpenRouter(context.env, prompt);

    const outboundMessageId = await sendWhatsAppText(context.env, {
      phoneNumberId: incomingMessage.phoneNumberId,
      to: incomingMessage.from,
      body: outboundBody,
    });
  } catch (error) {
    console.error("Failed to process webhook event", error);
    return context.body(null, 500);
  }

  return context.body(null, 200);
}

function extractMentionedPrompt(
  incomingMessage: ReturnType<typeof parseFirstIncomingMessage>
): string | null {
  if (!incomingMessage || incomingMessage.type !== "text") {
    return null;
  }

  const text = incomingMessage.textBody?.trim() || "";
  const lower = text.toLowerCase();
  if (!lower.startsWith(BOT_MENTION_PREFIX)) {
    return null;
  }

  return text.slice(BOT_MENTION_PREFIX.length).trim();
}

async function validateAndReadRawBody(
  context: WebhookContext
): Promise<string | null> {
  const signature = context.req.header("X-Hub-Signature-256");
  if (!signature || !signature.startsWith("sha256=")) {
    return null;
  }

  const expectedHex = signature.slice("sha256=".length);

  try {
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
      return null;
    }

    return rawBody;
  } catch (error) {
    console.error("Failed to validate webhook signature", error);
    return null;
  }
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}