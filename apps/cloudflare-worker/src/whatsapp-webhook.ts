export interface ParsedWhatsAppMessage {
  phoneNumberId: string;
  from: string;
  messageId: string;
  type: string;
  textBody?: string;
}

interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: {
          phone_number_id?: string;
        };
        messages?: Array<{
          id?: string;
          from?: string;
          type?: string;
          text?: {
            body?: string;
          };
        }>;
      };
    }>;
  }>;
}

export function parseFirstIncomingMessage(
  payload: unknown
): ParsedWhatsAppMessage | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const root = payload as WhatsAppWebhookPayload;

  for (const entry of root.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") {
        continue;
      }

      const phoneNumberId = change.value?.metadata?.phone_number_id;
      const message = change.value?.messages?.[0];

      if (
        typeof phoneNumberId !== "string" ||
        typeof message?.id !== "string" ||
        typeof message?.from !== "string" ||
        typeof message?.type !== "string"
      ) {
        continue;
      }

      return {
        phoneNumberId,
        from: message.from,
        messageId: message.id,
        type: message.type,
        textBody:
          message.type === "text" ? message.text?.body?.trim() || "" : undefined,
      };
    }
  }

  return null;
}
