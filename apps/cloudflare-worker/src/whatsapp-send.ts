import type { Env } from "./index";

const GRAPH_API_VERSION = "v23.0";

interface SendResponse {
  messages?: Array<{ id?: string }>;
}

export async function sendWhatsAppText(
  env: Env,
  options: {
    phoneNumberId: string;
    to: string;
    body: string;
  }
): Promise<string | null> {
  if (!env.WHATSAPP_ACCESS_TOKEN) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is not configured");
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${options.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: options.to,
        type: "text",
        text: {
          preview_url: false,
          body: options.body,
        },
      }),
    }
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${details}`);
  }

  const data = (await response.json()) as SendResponse;
  return data.messages?.[0]?.id ?? null;
}
