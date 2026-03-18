import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { createWhatsAppRuntime } from "./whatsapp";

const mockState = vi.hoisted(() => {
  return {
    initialize: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
    removeAllListeners: vi.fn(),
    on: vi.fn(),
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
});

describe("createWhatsAppRuntime shutdown", () => {
  it("destroys the client exactly once across repeated shutdown calls", async () => {
    const runtime = createWhatsAppRuntime(env());

    await runtime.shutdown();
    await runtime.shutdown();

    expect(mockState.destroy).toHaveBeenCalledTimes(1);
    expect(mockState.removeAllListeners).toHaveBeenCalledTimes(1);
  });

  it("does not initialize after shutdown has started", async () => {
    const runtime = createWhatsAppRuntime(env());

    await runtime.shutdown();
    await runtime.initialize();

    expect(mockState.initialize).not.toHaveBeenCalled();
  });
});
