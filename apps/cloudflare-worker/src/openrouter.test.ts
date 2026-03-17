import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./index";
import { generateReplyFromOpenRouter } from "./openrouter";

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

describe("generateReplyFromOpenRouter", () => {
  it("throws when OPENROUTER_API_KEY is missing", async () => {
    await expect(
      generateReplyFromOpenRouter(
        env({ OPENROUTER_API_KEY: "" }),
        "hello"
      )
    ).rejects.toThrow("OPENROUTER_API_KEY is not configured");
  });

  it("sends expected request and returns trimmed string content", async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.model).toBe("openrouter/auto");
      expect(payload.messages[0]).toEqual({ role: "system", content: "system prompt" });
      expect(payload.messages[1]).toEqual({ role: "user", content: "hello" });

      return new Response(
        JSON.stringify({ choices: [{ message: { content: "  hi there  " } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    globalThis.fetch = fetchMock as typeof fetch;

    const reply = await generateReplyFromOpenRouter(env(), "hello");
    expect(reply).toBe("hi there");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("supports array content and joins text parts", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  { type: "text", text: "part one" },
                  { type: "text", text: "part two" },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const reply = await generateReplyFromOpenRouter(env(), "hello");
    expect(reply).toBe("part one part two");
  });

  it("throws on non-2xx OpenRouter response", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("oops", { status: 500 });
    }) as typeof fetch;

    await expect(generateReplyFromOpenRouter(env(), "hello")).rejects.toThrow(
      "OpenRouter request failed (500): oops"
    );
  });

  it("throws a clear error when fetch throws before response", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;

    await expect(generateReplyFromOpenRouter(env(), "hello")).rejects.toThrow(
      "OpenRouter request threw before response: network down"
    );
  });

  it("throws when response has no usable content", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "   " } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    await expect(generateReplyFromOpenRouter(env(), "hello")).rejects.toThrow(
      "OpenRouter returned an empty assistant message"
    );
  });
});
