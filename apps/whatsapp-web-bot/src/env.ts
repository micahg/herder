export interface Env {
  PORT: number;
  CHAT_PROTOCOL: string;
  WA_WEB_ADMIN_SETUP_TOKEN: string;
  WA_WEB_CLIENT_ID: string;
  BOT_MENTION_PREFIX: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_SYSTEM_PROMPT?: string;
  OPENROUTER_SITE_URL?: string;
  OPENROUTER_APP_TITLE?: string;
}

function requireString(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function resolveSetupToken(): string {
  const value = process.env.WA_WEB_ADMIN_SETUP_TOKEN?.trim();
  if (value) {
    return value;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("WA_WEB_ADMIN_SETUP_TOKEN is not configured");
  }

  const generated = `dev-${crypto.randomUUID()}`;
  console.info(
    "Using generated ephemeral development setup token (set WA_WEB_ADMIN_SETUP_TOKEN to override):",
    generated
  );
  return generated;
}

export function loadEnv(): Env {
  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer");
  }

  return {
    PORT: port,
    CHAT_PROTOCOL: process.env.CHAT_PROTOCOL?.trim().toLowerCase() || "whatsapp",
    WA_WEB_ADMIN_SETUP_TOKEN: resolveSetupToken(),
    WA_WEB_CLIENT_ID: process.env.WA_WEB_CLIENT_ID?.trim() || "herder",
    BOT_MENTION_PREFIX: process.env.BOT_MENTION_PREFIX?.trim().toLowerCase() || "!herder",
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY?.trim(),
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL?.trim(),
    OPENROUTER_SYSTEM_PROMPT: process.env.OPENROUTER_SYSTEM_PROMPT?.trim(),
    OPENROUTER_SITE_URL: process.env.OPENROUTER_SITE_URL?.trim(),
    OPENROUTER_APP_TITLE: process.env.OPENROUTER_APP_TITLE?.trim(),
  };
}
