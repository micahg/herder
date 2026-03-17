import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./index";
import { sendWhatsAppText } from "./whatsapp-send";

const originalFetch = globalThis.fetch;

function env(overrides: Partial<Env> = {}): Env {
  return {
    WHATSAPP_VERIFY_TOKEN: "verify-token",
    WHATSAPP_APP_SECRET: "app-secret",
    WHATSAPP_ACCESS_TOKEN: "wa-token",
    OPENROUTER_API_KEY: "openrouter-key",
    OPENROUTER_MODEL: "openrouter/auto",
    OPENROUTER_SYSTEM_PROMPT: "system prompt",
    OPENROUTER_SITE_URL: "https://example.test",
    OPENROUTER_APP_TITLE: "Herder Test",
    ...overrides,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("sendWhatsAppText", () => {
  it("throws when WHATSAPP_ACCESS_TOKEN is missing", async () => {
    await expect(
      sendWhatsAppText(env({ WHATSAPP_ACCESS_TOKEN: "" }), {
        phoneNumberId: "1063260676863328",
        to: "15198544596",
        body: "hello",
      })
    ).rejects.toThrow("WHATSAPP_ACCESS_TOKEN is not configured");
  });

  it("posts expected payload and returns outbound message id", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain("graph.facebook.com/v23.0/1063260676863328/messages");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer wa-token"
      );

      const payload = JSON.parse(String(init?.body));
      expect(payload.messaging_product).toBe("whatsapp");
      expect(payload.to).toBe("15198544596");
      expect(payload.type).toBe("text");
      expect(payload.text.body).toBe("hello");

      return new Response(
        JSON.stringify({ messages: [{ id: "wamid.outbound.123" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const id = await sendWhatsAppText(env(), {
      phoneNumberId: "1063260676863328",
      to: "15198544596",
      body: "hello",
    });

    expect(id).toBe("wamid.outbound.123");
  });

  it("returns null when send response has no message id", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ messages: [{}] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const id = await sendWhatsAppText(env(), {
      phoneNumberId: "1063260676863328",
      to: "15198544596",
      body: "hello",
    });

    expect(id).toBeNull();
  });

  it("throws with status and details when send fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("bad request", { status: 400 });
    }) as typeof fetch;

    await expect(
      sendWhatsAppText(env(), {
        phoneNumberId: "1063260676863328",
        to: "15198544596",
        body: "hello",
      })
    ).rejects.toThrow("WhatsApp send failed (400): bad request");
  });
});
