import type { Context } from "hono";
import type { Env } from "./index";
import { generateReplyFromOpenRouter } from "./openrouter";
import { parseFirstIncomingMessage } from "./whatsapp-webhook";
import { sendWhatsAppText } from "./whatsapp-send";

type WebhookContext = Context<{ Bindings: Env }>;
const NON_TEXT_FALLBACK_MESSAGE =
  "I can only handle text messages right now. Please send your question as text.";

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
  console.log("Received webhook event");
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

  try {
    const outboundBody =
      incomingMessage.type === "text"
        ? await generateReplyFromOpenRouter(
            context.env,
            incomingMessage.textBody || ""
          )
        : NON_TEXT_FALLBACK_MESSAGE;

    const outboundMessageId = await sendWhatsAppText(context.env, {
      phoneNumberId: incomingMessage.phoneNumberId,
      to: incomingMessage.from,
      body: outboundBody,
    });

    console.log(
      JSON.stringify({
        type: "webhook_message_processed",
        inboundMessageId: incomingMessage.messageId,
        outboundMessageId,
        inboundType: incomingMessage.type,
      })
    );
  } catch (error) {
    console.error("Failed to process webhook event", error);
    return context.body(null, 500);
  }

  return context.body(null, 200);
}

async function validateAndReadRawBody(
  context: WebhookContext
): Promise<string | null> {
  const signature = context.req.header("X-Hub-Signature-256");
  if (!signature || !signature.startsWith("sha256=")) {
    return null;
  }

  // {"object":"whatsapp_business_account","entry":[{"id":"0","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"16505551111","phone_number_id":"123456123"},"contacts":[{"profile":{"name":"test user name"},"wa_id":"16315551181","user_id":"US.13491208655302741918"}],"messages":[{"id":"ABGGFlA5Fpa","timestamp":"1504902988","from":"16315551181","from_user_id":"US.13491208655302741918","type":"text","text":{"body":"this is a text message"}}]}}]}]}
  const rawBody = await context.req.text();
  console.log(
    JSON.stringify({
      type: "request_body",
      body: rawBody,
    })
  );

  const expectedHex = signature.slice("sha256=".length);

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
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}