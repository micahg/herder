import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { generateReplyFromOpenRouter } from "./openrouter";

const originalFetch = globalThis.fetch;

function env(overrides: Partial<Env> = {}): Env {
  return {
    PORT: 3000,
    CHAT_PROTOCOL: "whatsapp",
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

  it("executes no-arg list channels tool and returns final assistant text", async () => {
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
                        name: "list_channels",
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
    const listChannels = vi.fn(async () => [
      { id: "1@g.us", name: "Family" },
      { id: "2@g.us", name: "Friends" },
    ]);

    const reply = await generateReplyFromOpenRouter(env(), "what groups am i in", {
      listChannels,
    });

    expect(reply).toBe("You are in 2 groups.");
    expect(listChannels).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstBody.tools?.[0]?.function?.name).toBe("list_channels");
    expect(firstBody.tools?.[0]?.function?.description).toBe(
      "List the channels available to this bot account"
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
    expect(toolMessage.name).toBe("list_channels");
    expect(toolMessage.tool_call_id).toBe("call_1");
    expect(toolMessage.content).toBe(
      JSON.stringify([
        { id: "1@g.us", name: "Family" },
        { id: "2@g.us", name: "Friends" },
      ])
    );
  });

  it("executes current channel tool and returns final assistant text", async () => {
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
                        name: "get_current_channel",
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
    const getCurrentChannel = vi.fn(async () => ({
      id: "1@g.us",
      name: "Family",
    }));

    const reply = await generateReplyFromOpenRouter(env(), "what group is this", {
      getCurrentChannel,
    });

    expect(reply).toBe("This message came from Family.");
    expect(getCurrentChannel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstBody.tools?.[0]?.function?.name).toBe("get_current_channel");
    expect(firstBody.tools?.[0]?.function?.description).toBe(
      "Get details about the current channel for this message"
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
    expect(toolMessage.name).toBe("get_current_channel");
    expect(toolMessage.tool_call_id).toBe("call_2");
    expect(toolMessage.content).toBe(JSON.stringify({ id: "1@g.us", name: "Family" }));
  });

  it("executes chat members tool with target args and returns final assistant text", async () => {
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
                      id: "call_3",
                      type: "function",
                      function: {
                        name: "list_chat_members",
                        arguments: JSON.stringify({ chatName: "Family" }),
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
            choices: [{ message: { content: "This chat has 2 members." } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

    globalThis.fetch = fetchMock as typeof fetch;
    const listChatMembers = vi.fn(async () => [
      { id: "111@c.us", name: "Alice" },
      { id: "222@c.us", name: "Bob" },
    ]);

    const reply = await generateReplyFromOpenRouter(env(), "who is in this chat", {
      listChatMembers,
    });

    expect(reply).toBe("This chat has 2 members.");
    expect(listChatMembers).toHaveBeenCalledTimes(1);
    expect(listChatMembers).toHaveBeenCalledWith({ chatName: "Family" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstBody.tools?.[0]?.function?.name).toBe("list_chat_members");
    expect(firstBody.tools?.[0]?.function?.description).toBe(
      "List name and ID for chat members. Provide chatId and/or chatName to target a specific chat; omit both for current chat."
    );
    expect(firstBody.tools?.[0]?.function?.parameters).toEqual({
      type: "object",
      properties: {
        chatId: {
          type: "string",
          description: "Target chat ID, such as a WhatsApp JID like 1234567890@g.us",
        },
        chatName: {
          type: "string",
          description: "Human-readable target chat name, such as Family",
        },
      },
      additionalProperties: false,
    });

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    const toolMessage = secondBody.messages.find(
      (message: { role?: string }) => message.role === "tool"
    );
    expect(toolMessage).toBeDefined();
    expect(toolMessage.name).toBe("list_chat_members");
    expect(toolMessage.tool_call_id).toBe("call_3");
    expect(toolMessage.content).toBe(
      JSON.stringify([
        { id: "111@c.us", name: "Alice" },
        { id: "222@c.us", name: "Bob" },
      ])
    );
  });

  it("executes send-contact-message tool and returns final assistant text", async () => {
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
                      id: "call_4",
                      type: "function",
                      function: {
                        name: "send_message_to_contact",
                        arguments: JSON.stringify({
                          contactId: "222@c.us",
                          message: "can you meet this week?",
                        }),
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
            choices: [{ message: { content: "Done, I sent that to Dan." } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

    globalThis.fetch = fetchMock as typeof fetch;
    const sendMessageToContact = vi.fn(async () => ({
      ok: true,
      contactId: "222@c.us",
      resolvedContactId: "222@c.us",
      message: "can you meet this week?",
      protocolMessageId: "wamid.abc123",
    }));

    const reply = await generateReplyFromOpenRouter(env(), "message dan", {
      sendMessageToContact,
    });

    expect(reply).toBe("Done, I sent that to Dan.");
    expect(sendMessageToContact).toHaveBeenCalledTimes(1);
    expect(sendMessageToContact).toHaveBeenCalledWith({
      contactId: "222@c.us",
      message: "can you meet this week?",
    });

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstBody.tools?.[0]?.function?.name).toBe("send_message_to_contact");
    expect(firstBody.tools?.[0]?.function?.description).toBe(
      "Send a direct message to a contact by protocol contact ID. Use list_chat_members first when only a name is known. The protocol layer adds AI-assistant disclosure automatically."
    );
    expect(firstBody.tools?.[0]?.function?.parameters).toEqual({
      type: "object",
      properties: {
        contactId: {
          type: "string",
          description: "Protocol contact ID, such as a WhatsApp JID like 15551234567@c.us",
        },
        message: {
          type: "string",
          description: "Message text to send to that contact",
        },
      },
      required: ["contactId", "message"],
      additionalProperties: false,
    });
  });

  it("supports multi-round tool calls for lookup-then-send workflows", async () => {
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
                      id: "call_lookup",
                      type: "function",
                      function: {
                        name: "list_chat_members",
                        arguments: JSON.stringify({ chatName: "X Group" }),
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
            choices: [
              {
                message: {
                  role: "assistant",
                  tool_calls: [
                    {
                      id: "call_send",
                      type: "function",
                      function: {
                        name: "send_message_to_contact",
                        arguments: JSON.stringify({
                          contactId: "222@c.us",
                          message: "see when he can meet up",
                        }),
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
            choices: [{ message: { content: "Sent to Dan in X Group." } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

    globalThis.fetch = fetchMock as typeof fetch;

    const listChatMembers = vi.fn(async () => [
      { id: "111@c.us", name: "Alice" },
      { id: "222@c.us", name: "Dan" },
    ]);

    const sendMessageToContact = vi.fn(async () => ({
      ok: true,
      contactId: "222@c.us",
      resolvedContactId: "222@c.us",
      message: "see when he can meet up",
    }));

    const reply = await generateReplyFromOpenRouter(
      env(),
      "message dan from x group to see when he can meet up",
      {
        listChatMembers,
        sendMessageToContact,
      }
    );

    expect(reply).toBe("Sent to Dan in X Group.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(listChatMembers).toHaveBeenCalledWith({ chatName: "X Group" });
    expect(sendMessageToContact).toHaveBeenCalledWith({
      contactId: "222@c.us",
      message: "see when he can meet up",
    });
  });
});
