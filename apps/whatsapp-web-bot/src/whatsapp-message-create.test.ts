import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { createWhatsAppRuntime } from "./whatsapp";

const mockState = vi.hoisted(() => {
  return {
    initialize: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    removeAllListeners: vi.fn(),
    on: vi.fn(),
    generateReplyFromOpenRouter: vi.fn(async () => "bot reply"),
  };
});

vi.mock("./openrouter", () => {
  return {
    generateReplyFromOpenRouter: mockState.generateReplyFromOpenRouter,
  };
});

vi.mock("whatsapp-web.js", () => {
  class LocalAuth {
    constructor(_options: unknown) {}
  }

  class Client {
    on = mockState.on;
    initialize = mockState.initialize;
    destroy = mockState.destroy;
    removeAllListeners = mockState.removeAllListeners;

    constructor(_options: unknown) {}
  }

  return {
    default: {
      Client,
      LocalAuth,
    },
  };
});

vi.mock("qrcode-terminal", () => {
  return {
    default: {
      generate: vi.fn(),
    },
  };
});

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
  vi.restoreAllMocks();
  mockState.initialize.mockClear();
  mockState.destroy.mockClear();
  mockState.removeAllListeners.mockClear();
  mockState.on.mockClear();
  mockState.generateReplyFromOpenRouter.mockClear();
});

describe("createWhatsAppRuntime message_create", () => {
  it("drops inbound non-owner command messages", async () => {
    createWhatsAppRuntime(env());

    const messageRegistration = mockState.on.mock.calls.find(
      ([event]) => event === "message"
    );

    expect(messageRegistration).toBeDefined();

    const onMessage = messageRegistration?.[1] as
      | ((message: {
          fromMe: boolean;
          from: string;
          to: string;
          type: string;
          body: string;
          reply: (text: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;

    expect(onMessage).toBeDefined();

    const reply = vi.fn(async () => {});

    await onMessage?.({
      fromMe: false,
      from: "15550001111@c.us",
      to: "15551234567@c.us",
      type: "chat",
      body: "!herder tell me a secret",
      reply,
    });

    expect(mockState.generateReplyFromOpenRouter).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("replies to self-directed mention messages", async () => {
    createWhatsAppRuntime(env());

    const messageCreateRegistration = mockState.on.mock.calls.find(
      ([event]) => event === "message_create"
    );

    expect(messageCreateRegistration).toBeDefined();

    const onMessageCreate = messageCreateRegistration?.[1] as
      | ((message: {
          fromMe: boolean;
          from: string;
          to: string;
          type: string;
          body: string;
          reply: (text: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;

    expect(onMessageCreate).toBeDefined();

    const reply = vi.fn(async () => {});

    await onMessageCreate?.({
      fromMe: true,
      from: "15551234567@c.us",
      to: "15551234567@c.us",
      type: "chat",
      body: "!herder tell whats the score",
      reply,
    });

    expect(mockState.generateReplyFromOpenRouter).toHaveBeenCalledTimes(1);
    expect(mockState.generateReplyFromOpenRouter).toHaveBeenCalledWith(
      expect.any(Object),
      "tell whats the score",
      expect.objectContaining({
        listWhatsAppGroupChats: expect.any(Function),
        getCurrentWhatsAppGroupChat: expect.any(Function),
      })
    );
    expect(reply).toHaveBeenCalledWith("bot reply");
  });

  it("ignores outgoing messages that are not self-directed", async () => {
    createWhatsAppRuntime(env());

    const messageCreateRegistration = mockState.on.mock.calls.find(
      ([event]) => event === "message_create"
    );
    const onMessageCreate = messageCreateRegistration?.[1] as
      | ((message: {
          fromMe: boolean;
          from: string;
          to: string;
          type: string;
          body: string;
          reply: (text: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;

    const reply = vi.fn(async () => {});

    await onMessageCreate?.({
      fromMe: true,
      from: "15551234567@c.us",
      to: "15557654321@c.us",
      type: "chat",
      body: "!herder tell whats the score",
      reply,
    });

    expect(mockState.generateReplyFromOpenRouter).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("treats resource-suffixed self JIDs as self-directed", async () => {
    createWhatsAppRuntime(env());

    const messageCreateRegistration = mockState.on.mock.calls.find(
      ([event]) => event === "message_create"
    );
    const onMessageCreate = messageCreateRegistration?.[1] as
      | ((message: {
          fromMe: boolean;
          from: string;
          to: string;
          type: string;
          body: string;
          reply: (text: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;

    const reply = vi.fn(async () => {});

    await onMessageCreate?.({
      fromMe: true,
      from: "15551234567:24@c.us",
      to: "15551234567@c.us",
      type: "chat",
      body: "!herder tell whats the score",
      reply,
    });

    expect(mockState.generateReplyFromOpenRouter).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith("bot reply");
  });

  it("treats @lid recipient as self-directed for fromMe messages", async () => {
    createWhatsAppRuntime(env());

    const messageCreateRegistration = mockState.on.mock.calls.find(
      ([event]) => event === "message_create"
    );
    const onMessageCreate = messageCreateRegistration?.[1] as
      | ((message: {
          fromMe: boolean;
          from: string;
          to: string;
          type: string;
          body: string;
          reply: (text: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;

    const reply = vi.fn(async () => {});

    await onMessageCreate?.({
      fromMe: true,
      from: "15198544596@c.us",
      to: "129244273332351@lid",
      type: "chat",
      body: "!herder tell whats the score",
      reply,
    });

    expect(mockState.generateReplyFromOpenRouter).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith("bot reply");
  });

  it("processes fromMe command messages sent to groups", async () => {
    createWhatsAppRuntime(env());

    const messageCreateRegistration = mockState.on.mock.calls.find(
      ([event]) => event === "message_create"
    );
    const onMessageCreate = messageCreateRegistration?.[1] as
      | ((message: {
          fromMe: boolean;
          from: string;
          to: string;
          type: string;
          body: string;
          reply: (text: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;

    const reply = vi.fn(async () => {});

    await onMessageCreate?.({
      fromMe: true,
      from: "129244273332351@lid",
      to: "120363399999999999@g.us",
      type: "chat",
      body: "!herder test",
      reply,
    });

    expect(mockState.generateReplyFromOpenRouter).toHaveBeenCalledTimes(1);
    expect(mockState.generateReplyFromOpenRouter).toHaveBeenCalledWith(
      expect.any(Object),
      "test",
      expect.objectContaining({
        listWhatsAppGroupChats: expect.any(Function),
        getCurrentWhatsAppGroupChat: expect.any(Function),
      })
    );
    expect(reply).toHaveBeenCalledWith("bot reply");
  });
});
