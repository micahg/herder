import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { generateReplyFromOpenRouter } from "./openrouter";

const originalFetch = globalThis.fetch;

function env(overrides: Partial<Env> = {}): Env {
  return {
    PORT: 3000,
    WA_WEB_ADMIN_SETUP_TOKEN: "setup-token",
    WA_WEB_CLIENT_ID: "herder",
    BOT_MENTION_PREFIX: "!herder",
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
  it("returns trimmed string content", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "  hi there  " } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const reply = await generateReplyFromOpenRouter(env(), "hello");
    expect(reply).toBe("hi there");
  });

  it("throws on non-2xx response", async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response("oops", { status: 500 });
    }) as typeof fetch;

    await expect(generateReplyFromOpenRouter(env(), "hello")).rejects.toThrow(
      "OpenRouter request failed (500): oops"
    );
  });
});
