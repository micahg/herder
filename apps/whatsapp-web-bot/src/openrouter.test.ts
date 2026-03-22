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

  it("executes no-arg list group chats tool and returns final assistant text", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "list_whatsapp_group_chats",
                        arguments: "{}",
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      })
      .mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "You are in 2 groups." } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

    globalThis.fetch = fetchMock as typeof fetch;
    const listWhatsAppGroupChats = vi.fn(async () => [
      { id: "1@g.us", name: "Family" },
      { id: "2@g.us", name: "Friends" },
    ]);

    const reply = await generateReplyFromOpenRouter(env(), "what groups am i in", {
      listWhatsAppGroupChats,
    });

    expect(reply).toBe("You are in 2 groups.");
    expect(listWhatsAppGroupChats).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstBody.tools?.[0]?.function?.name).toBe("list_whatsapp_group_chats");
    expect(firstBody.tools?.[0]?.function?.description).toBe(
      "List the name and ID of each whatsapp group chats this user belongs to"
    );
    expect(firstBody.tools?.[0]?.function?.parameters).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const toolMessage = secondBody.messages.find(
      (message: { role?: string }) => message.role === "tool"
    );
    expect(toolMessage).toBeDefined();
    expect(toolMessage.name).toBe("list_whatsapp_group_chats");
    expect(toolMessage.tool_call_id).toBe("call_1");
    expect(toolMessage.content).toBe(
      JSON.stringify([
        { id: "1@g.us", name: "Family" },
        { id: "2@g.us", name: "Friends" },
      ])
    );
  });

  it("executes current message group chat tool and returns final assistant text", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: "call_2",
                      type: "function",
                      function: {
                        name: "get_current_whatsapp_group_chat",
                        arguments: "{}",
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      })
      .mockImplementationOnce(async () => {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "This message came from Family." } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

    globalThis.fetch = fetchMock as typeof fetch;
    const getCurrentWhatsAppGroupChat = vi.fn(async () => ({
      id: "1@g.us",
      name: "Family",
    }));

    const reply = await generateReplyFromOpenRouter(env(), "what group is this", {
      getCurrentWhatsAppGroupChat,
    });

    expect(reply).toBe("This message came from Family.");
    expect(getCurrentWhatsAppGroupChat).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstBody.tools?.[0]?.function?.name).toBe("get_current_whatsapp_group_chat");
    expect(firstBody.tools?.[0]?.function?.description).toBe(
      "Get the name and ID of the whatsapp group chat for the current message"
    );
    expect(firstBody.tools?.[0]?.function?.parameters).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const toolMessage = secondBody.messages.find(
      (message: { role?: string }) => message.role === "tool"
    );
    expect(toolMessage).toBeDefined();
    expect(toolMessage.name).toBe("get_current_whatsapp_group_chat");
    expect(toolMessage.tool_call_id).toBe("call_2");
    expect(toolMessage.content).toBe(JSON.stringify({ id: "1@g.us", name: "Family" }));
  });
});
