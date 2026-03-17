import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";

async function hmacSignature(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function withSignatureHeaders(body: string): Promise<Record<string, string>> {
  return hmacSignature(body).then((hex) => ({
    "Content-Type": "application/json",
    "X-Hub-Signature-256": `sha256=${hex}`,
  }));
}

function textMessageBody(text = "hello world"): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1834714370529058",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15551599981",
                phone_number_id: "1063260676863328",
              },
              messages: [
                {
                  from: "15198544596",
                  id: "wamid.inbound.123",
                  timestamp: "1773753553",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function imageMessageBody(): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "1834714370529058",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15551599981",
                phone_number_id: "1063260676863328",
              },
              messages: [
                {
                  from: "15198544596",
                  id: "wamid.inbound.456",
                  timestamp: "1773753553",
                  type: "image",
                  image: { mime_type: "image/jpeg", id: "abc" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

const originalFetch = globalThis.fetch;

async function postSignedWebhook(body: string): Promise<Response> {
  return SELF.fetch("http://localhost/webhooks", {
    method: "POST",
    headers: await withSignatureHeaders(body),
    body,
  });
}

describe("POST /webhooks", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account" });

  it("returns 401 when X-Hub-Signature-256 header is missing", async () => {
    const res = await SELF.fetch("http://localhost/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when header lacks sha256= prefix", async () => {
    const res = await SELF.fetch("http://localhost/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": "notvalid",
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when signature is wrong", async () => {
    const res = await SELF.fetch("http://localhost/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256":
          "sha256=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 when signature is valid", async () => {
    const hex = await hmacSignature(body);
    const res = await SELF.fetch("http://localhost/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": `sha256=${hex}`,
      },
      body,
    });
    expect(res.status).toBe(200);
  });

  it("handles text messages by calling OpenRouter then WhatsApp send", async () => {
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("openrouter.ai/api/v1/chat/completions")) {
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string, string>).Authorization).toContain(
          "Bearer"
        );
        const payload = JSON.parse(String(init?.body));
        expect(payload.messages[0].role).toBe("system");
        expect(payload.messages[1].role).toBe("user");
        expect(payload.messages[1].content).toBe("hello from user");
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "hello from assistant" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("graph.facebook.com/v23.0/1063260676863328/messages")) {
        expect(init?.method).toBe("POST");
        const payload = JSON.parse(String(init?.body));
        expect(payload.to).toBe("15198544596");
        expect(payload.text.body).toBe("hello from assistant");
        return new Response(
          JSON.stringify({ messages: [{ id: "wamid.outbound.789" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return originalFetch(input, init);
    };

    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const res = await postSignedWebhook(textMessageBody("hello from user"));
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles non-text messages with fixed fallback reply", async () => {
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("openrouter.ai/api/v1/chat/completions")) {
        throw new Error("OpenRouter should not be called for non-text messages");
      }

      if (url.includes("graph.facebook.com/v23.0/1063260676863328/messages")) {
        const payload = JSON.parse(String(init?.body));
        expect(payload.text.body).toContain("only handle text messages");
        return new Response(JSON.stringify({ messages: [{ id: "wamid.outbound" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return originalFetch(input, init);
    };

    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const res = await postSignedWebhook(imageMessageBody());
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns 500 when OpenRouter fails", async () => {
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("openrouter.ai/api/v1/chat/completions")) {
        return new Response("upstream error", { status: 500 });
      }

      if (url.includes("graph.facebook.com")) {
        throw new Error("WhatsApp send should not run if OpenRouter fails");
      }

      return originalFetch(input, init);
    };

    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const res = await postSignedWebhook(textMessageBody("will fail"));
      expect(res.status).toBe(500);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns 500 when WhatsApp send fails", async () => {
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("openrouter.ai/api/v1/chat/completions")) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "assistant reply" } }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("graph.facebook.com/v23.0/1063260676863328/messages")) {
        return new Response("send failed", { status: 500 });
      }

      return originalFetch(input, init);
    };

    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const res = await postSignedWebhook(textMessageBody("hello"));
      expect(res.status).toBe(500);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns 200 when payload has no actionable message", async () => {
    const noMessageBody = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "1", changes: [{ field: "messages", value: { metadata: {} } }] }],
    });

    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("openrouter.ai") || url.includes("graph.facebook.com")) {
        throw new Error("No outbound calls expected for non-actionable payload");
      }
      return originalFetch(input, init);
    };

    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const res = await postSignedWebhook(noMessageBody);
      expect(res.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("GET /webhooks", () => {
  it("returns challenge when mode/token are valid", async () => {
    const challenge = "test-challenge";
    const res = await SELF.fetch(
      `http://localhost/webhooks?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=${challenge}`
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(challenge);
  });

  it("returns 400 when verify token is wrong", async () => {
    const res = await SELF.fetch(
      "http://localhost/webhooks?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=test-challenge"
    );

    expect(res.status).toBe(400);
  });

  it("returns 400 when challenge is missing", async () => {
    const res = await SELF.fetch(
      `http://localhost/webhooks?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}`
    );

    expect(res.status).toBe(400);
  });
});

describe("GET /privacy", () => {
  it("returns 200 with markdown privacy policy", async () => {
    const res = await SELF.fetch("http://localhost/privacy");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");

    const body = await res.text();
    expect(body).toContain("# Privacy Policy");
    expect(body).toContain("Steakholder Meating");
  });
});
