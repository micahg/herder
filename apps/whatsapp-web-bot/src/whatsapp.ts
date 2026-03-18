import whatsappWeb from "whatsapp-web.js";
import type { Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Env } from "./env";
import { generateReplyFromOpenRouter } from "./openrouter";

const { Client, LocalAuth } = whatsappWeb;

export interface WhatsAppRuntime {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  getLatestQr(): string | null;
  isReady(): boolean;
  listGroupChats(): Promise<WhatsAppGroupChatSummary[]>;
}

export interface WhatsAppGroupChatSummary {
  id: string;
  name: string;
}

export function createWhatsAppRuntime(env: Env): WhatsAppRuntime {
  let latestQr: string | null = null;
  let ready = false;
  let initialized = false;
  let shutdownStarted = false;
  const executablePath = resolveBrowserExecutablePath();

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: env.WA_WEB_CLIENT_ID }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath,
    },
  });

  const listGroupChatsForRuntime = async (): Promise<WhatsAppGroupChatSummary[]> => {
    if (!initialized || shutdownStarted) {
      throw new Error("WhatsApp runtime is not initialized");
    }

    if (!ready) {
      throw new Error("WhatsApp runtime is not ready");
    }

    return listGroupChats(client);
  };

  client.on("qr", (qr) => {
    latestQr = qr;
    ready = false;
    console.log("WhatsApp QR updated. Use /setup/qr with admin token to fetch it.");
    qrcode.generate(qr, { small: true });
  });

  client.on("authenticated", () => {
    console.log("WhatsApp client authenticated");
  });

  client.on("auth_failure", (message) => {
    ready = false;
    console.error("WhatsApp auth failure", message);
  });

  client.on("ready", () => {
    latestQr = null;
    ready = true;
    console.log("WhatsApp client ready");
  });

  client.on("disconnected", (reason) => {
    ready = false;
    console.warn("WhatsApp client disconnected", reason);
  });

  client.on("message", async (message: Message) => {
    console.log(`Received WhatsApp message from ${message.from}: ${message.body}`);
    if (message.fromMe) {
      return;
    }

    try {
      await maybeReply(env, message, listGroupChatsForRuntime);
    } catch (error) {
      console.error("Failed to handle incoming WhatsApp message", error);
    }
  });

  client.on("message_create", async (message: Message) => {
    console.log(`Received WhatsApp message_create from ${message.from}: ${message.body}`);
    if (!isEligibleOutgoingCommandMessage(message)) {
      return;
    }

    console.log(`Received eligible outgoing WhatsApp command: ${message.body}`);
    try {
      await maybeReply(env, message, listGroupChatsForRuntime);
    } catch (error) {
      console.error("Failed to handle outgoing self WhatsApp message", error);
    }
  });

  return {
    async initialize() {
      if (initialized || shutdownStarted) {
        return;
      }

      try {
        await client.initialize();
        initialized = true;
      } catch (error) {
        if (isMissingChromeError(error)) {
          console.info(
            "WhatsApp connectivity is inactive for this run. Install Chrome/Chromium or set PUPPETEER_EXECUTABLE_PATH to enable it."
          );
          if (executablePath) {
            console.info(`Configured browser executable: ${executablePath}`);
          }
          if (error instanceof Error && error.message) {
            console.info(`Browser launch details: ${error.message}`);
          }
          return;
        }
        throw error;
      }
    },
    async shutdown() {
      if (shutdownStarted) {
        return;
      }

      shutdownStarted = true;
      ready = false;
      latestQr = null;

      try {
        await client.destroy();
      } catch (error) {
        console.warn("WhatsApp client cleanup encountered an error", error);
      } finally {
        client.removeAllListeners();
      }
    },
    getLatestQr() {
      return latestQr;
    },
    isReady() {
      return ready;
    },
    listGroupChats: listGroupChatsForRuntime,
  };
}

function isMissingChromeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("could not find chrome") ||
    message.includes("failed to launch the browser process")
  );
}

function resolveBrowserExecutablePath(): string | undefined {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (envPath) {
    return envPath;
  }

  const root = join(homedir(), ".cache", "puppeteer", "chrome-headless-shell");
  if (!existsSync(root)) {
    return undefined;
  }

  const candidateDirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  for (const dir of candidateDirs) {
    const candidate = join(
      root,
      dir,
      "chrome-headless-shell-linux64",
      "chrome-headless-shell"
    );
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function maybeReply(
  env: Env,
  message: Message,
  listWhatsAppGroupChats: () => Promise<WhatsAppGroupChatSummary[]>
): Promise<void> {
  if (message.type !== "chat") {
    return;
  }

  if (message.fromMe && !isEligibleOutgoingCommandMessage(message)) {
    return;
  }

  const body = message.body?.trim();
  if (!body) {
    return;
  }

  const lower = body.toLowerCase();
  if (!lower.startsWith(env.BOT_MENTION_PREFIX)) {
    return;
  }

  const prompt = body.slice(env.BOT_MENTION_PREFIX.length).trim();
  if (!prompt) {
    return;
  }

  const reply = await generateReplyFromOpenRouter(env, prompt, {
    listWhatsAppGroupChats,
  });
  await message.reply(reply);
}

async function listGroupChats(
  client: InstanceType<typeof Client>
): Promise<WhatsAppGroupChatSummary[]> {
  const chats = await client.getChats();
  return chats
    .filter((chat) => chat.isGroup || chat.id?.server === "g.us")
    .map((chat) => ({
      id: chat.id?._serialized || "unknown",
      name: chat.name || "(unnamed group)",
    }));
}

function isEligibleOutgoingCommandMessage(message: Message): boolean {
  if (!message.fromMe) {
    return false;
  }

  return isSelfDirectedMessage(message) || isGroupDirectedMessage(message);
}

function isSelfDirectedMessage(message: Message): boolean {
  if (!message.fromMe) {
    return false;
  }

  if (!message.from || !message.to) {
    return false;
  }

  if (normalizeWhatsAppJid(message.from) === normalizeWhatsAppJid(message.to)) {
    return true;
  }

  // Some self-chat message_create events use @lid instead of @c.us for `to`.
  if (isLidJid(message.to)) {
    return true;
  }

  return false;
}

function isGroupDirectedMessage(message: Message): boolean {
  if (!message.fromMe) {
    return false;
  }

  return isGroupJid(message.from || "") || isGroupJid(message.to || "");
}

function normalizeWhatsAppJid(jid: string): string {
  const [rawUser, domain] = jid.split("@", 2);
  if (!rawUser || !domain) {
    return jid;
  }

  const normalizedUser = rawUser.split(":", 2)[0];
  return `${normalizedUser}@${domain}`;
}

function isLidJid(jid: string): boolean {
  return jid.endsWith("@lid");
}

function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}
