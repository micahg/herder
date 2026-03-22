import whatsappWeb from "whatsapp-web.js";
import type { Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Env } from "../../env";
import { generateReplyFromOpenRouter } from "../../openrouter";
import type {
  ChannelSummary,
  ChatMemberLookupInput,
  ChatMemberSummary,
  ProtocolRuntime,
} from "../types";

const { Client, LocalAuth } = whatsappWeb;

export interface WhatsAppRuntime extends ProtocolRuntime {
  getLatestQr(): string | null;
  listGroupChats(): Promise<WhatsAppGroupChatSummary[]>;
}

export interface WhatsAppGroupChatSummary extends ChannelSummary {
  id: string;
  name: string;
}

export interface WhatsAppChatMemberSummary extends ChatMemberSummary {
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

  const listChatMembersForRuntime = async (
    input: ChatMemberLookupInput,
    message: Message
  ): Promise<WhatsAppChatMemberSummary[]> => {
    if (!initialized || shutdownStarted) {
      throw new Error("WhatsApp runtime is not initialized");
    }

    if (!ready) {
      throw new Error("WhatsApp runtime is not ready");
    }

    return listChatMembers(client, input, message);
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
    // Commands are owner-only and are handled exclusively via message_create.
    // Drop all inbound chat messages from other participants.
    if (!message.fromMe) {
      return;
    }
  });

  client.on("message_create", async (message: Message) => {
    console.log(`Received WhatsApp message_create from ${message.from}: ${message.body}`);
    if (!isEligibleOutgoingCommandMessage(message)) {
      return;
    }

    console.log(`Received eligible outgoing WhatsApp command: ${message.body}`);
    try {
      await maybeReply(
        env,
        message,
        listGroupChatsForRuntime,
        listChatMembersForRuntime
      );
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
    getLatestSetupCode() {
      return latestQr;
    },
    isReady() {
      return ready;
    },
    listGroupChats: listGroupChatsForRuntime,
    listChannels: listGroupChatsForRuntime,
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
  listGroupChatsForRuntime: () => Promise<WhatsAppGroupChatSummary[]>,
  listChatMembersForRuntime: (
    input: ChatMemberLookupInput,
    message: Message
  ) => Promise<WhatsAppChatMemberSummary[]>
): Promise<void> {
  if (!message.fromMe) {
    return;
  }

  if (message.type !== "chat") {
    return;
  }

  if (!isEligibleOutgoingCommandMessage(message)) {
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
    listChannels: listGroupChatsForRuntime,
    getCurrentChannel: () => getCurrentWhatsAppGroupChat(message),
    listChatMembers: (input) => listChatMembersForRuntime(input || {}, message),
    toolNames: {
      listChannels: "list_whatsapp_group_chats",
      getCurrentChannel: "get_current_whatsapp_group_chat",
      listChatMembers: "list_whatsapp_chat_members",
    },
    toolDescriptions: {
      listChannels: "List the name and ID of each whatsapp group chats this user belongs to",
      getCurrentChannel: "Get the name and ID of the whatsapp group chat for the current message",
      listChatMembers:
        "List the name and ID of each member in a whatsapp group chat. Accepts optional chatId and chatName; defaults to current chat when omitted.",
    },
  });
  await message.reply(reply);
}

async function listChatMembers(
  client: InstanceType<typeof Client>,
  input: ChatMemberLookupInput,
  message: Message
): Promise<WhatsAppChatMemberSummary[]> {
  const targetChat = await resolveTargetGroupChat(client, input, message);
  const participants = extractGroupParticipants(targetChat);
  if (participants.length > 0) {
    return resolveMemberSummaries(client, participants);
  }

  return [];
}

async function resolveTargetGroupChat(
  client: InstanceType<typeof Client>,
  input: ChatMemberLookupInput,
  message: Message
): Promise<unknown> {
  if (input.chatId) {
    const byId = await getGroupChatById(client, input.chatId);
    if (byId) {
      return byId;
    }
  }

  if (input.chatName) {
    const byName = await getGroupChatByName(client, input.chatName);
    if (byName) {
      return byName;
    }
  }

  const groupJid = extractGroupJidFromMessage(message);
  if (!groupJid) {
    return null;
  }

  const fromMessageChat = await getGroupChatFromMessage(message, groupJid);
  if (fromMessageChat) {
    return fromMessageChat;
  }

  return getGroupChatById(client, groupJid);
}

async function getGroupChatById(
  client: InstanceType<typeof Client>,
  groupJid: string
): Promise<unknown> {
  try {
    const chats = await client.getChats();
    return chats.find((chat) => (chat.isGroup || chat.id?.server === "g.us") && chat.id?._serialized === groupJid) || null;
  } catch {
    return null;
  }
}

async function getGroupChatByName(
  client: InstanceType<typeof Client>,
  chatName: string
): Promise<unknown> {
  const normalizedTarget = chatName.trim().toLowerCase();
  if (!normalizedTarget) {
    return null;
  }

  try {
    const chats = await client.getChats();
    const groupChats = chats.filter((chat) => chat.isGroup || chat.id?.server === "g.us");

    const exact = groupChats.find(
      (chat) => (chat.name || "").trim().toLowerCase() === normalizedTarget
    );
    if (exact) {
      return exact;
    }

    return (
      groupChats.find((chat) => (chat.name || "").trim().toLowerCase().includes(normalizedTarget)) ||
      null
    );
  } catch {
    return null;
  }
}

async function getGroupChatFromMessage(
  message: Message,
  groupJid: string
): Promise<unknown> {
  try {
    const chat = await message.getChat();
    if (chat && (chat.id?._serialized === groupJid || chat.isGroup)) {
      return chat;
    }
  } catch {
    // Ignore and fall back to client chat search.
  }

  return null;
}

function extractGroupParticipants(chat: unknown): unknown[] {
  if (!chat || typeof chat !== "object") {
    return [];
  }

  const maybeParticipants = (chat as { participants?: unknown }).participants;
  if (!Array.isArray(maybeParticipants)) {
    return [];
  }

  return maybeParticipants;
}

async function resolveMemberSummaries(
  client: InstanceType<typeof Client>,
  participants: unknown[]
): Promise<WhatsAppChatMemberSummary[]> {
  const contactNameIndex = await buildContactNameIndex(client);
  const lookupMemberName = buildMemberNameLookup(client, contactNameIndex);
  const seenIds = new Set<string>();
  const members: WhatsAppChatMemberSummary[] = [];

  for (const participant of participants) {
    const id = extractParticipantId(participant);
    if (!id || seenIds.has(id)) {
      continue;
    }

    const knownName = extractParticipantName(participant);
    const name = knownName || (await lookupMemberName(id)) || id;

    seenIds.add(id);
    members.push({ id, name });
  }

  console.log("Resolved WhatsApp chat members", members);

  return members;
}

async function buildContactNameIndex(
  client: InstanceType<typeof Client>
): Promise<Map<string, string>> {
  const index = new Map<string, string>();

  try {
    const contacts = await client.getContacts();
    for (const contact of contacts) {
      addContactToNameIndex(index, contact);
    }
  } catch {
    console.warn("Failed to build WhatsApp contact name index.");
    // Keep index empty when contact hydration is unavailable.
  }

  return index;
}

function addContactToNameIndex(index: Map<string, string>, contact: unknown): void {
  if (!contact || typeof contact !== "object") {
    return;
  }

  const displayName =
    extractNonEmptyString((contact as { name?: unknown }).name) ||
    extractNonEmptyString((contact as { pushname?: unknown }).pushname) ||
    extractNonEmptyString((contact as { shortName?: unknown }).shortName) ||
    extractNonEmptyString((contact as { verifiedName?: unknown }).verifiedName);

  if (!displayName) {
    return;
  }

  const rawId = (contact as { id?: unknown }).id;
  const serializedId = extractContactId(rawId);
  if (serializedId) {
    index.set(serializedId, displayName);

    const user = extractUserFromJid(serializedId);
    if (user) {
      index.set(user, displayName);
    }
  }

  const number = extractNonEmptyString((contact as { number?: unknown }).number);
  if (number) {
    index.set(number, displayName);
  }
}

function extractContactId(rawId: unknown): string {
  if (typeof rawId === "string") {
    return rawId;
  }

  if (!rawId || typeof rawId !== "object") {
    return "";
  }

  const serialized = extractNonEmptyString((rawId as { _serialized?: unknown })._serialized);
  if (serialized) {
    return serialized;
  }

  const user = extractNonEmptyString((rawId as { user?: unknown }).user);
  const server = extractNonEmptyString((rawId as { server?: unknown }).server);
  if (user && server) {
    return `${user}@${server}`;
  }

  return "";
}

function extractUserFromJid(id: string): string {
  const [user] = id.split("@", 2);
  return user || "";
}

function buildMemberNameLookup(
  client: InstanceType<typeof Client>,
  contactNameIndex: Map<string, string>
): (id: string) => Promise<string> {
  const getContactById = (client as { getContactById?: (id: string) => Promise<unknown> })
    .getContactById;
  const getChatById = (client as { getChatById?: (id: string) => Promise<unknown> })
    .getChatById;

  return async (id: string): Promise<string> => {
    const fromIndex =
      contactNameIndex.get(id) || contactNameIndex.get(extractUserFromJid(id)) || "";
    if (fromIndex) {
      return fromIndex;
    }

    const candidateIds = buildContactLookupCandidates(id);
    for (const candidateId of candidateIds) {
      if (typeof getContactById === "function") {
        try {
          const contact = await getContactById(candidateId);
          if (contact && typeof contact === "object") {
            addContactToNameIndex(contactNameIndex, contact);
            const contactName = extractDisplayNameFromContact(contact);
            if (contactName) {
              return contactName;
            }
          }
        } catch {
          // Try next lookup strategy.
        }
      }

      if (typeof getChatById === "function") {
        try {
          const chat = await getChatById(candidateId);
          const chatName = await extractDisplayNameFromChat(chat);
          if (chatName) {
            contactNameIndex.set(candidateId, chatName);
            const candidateUser = extractUserFromJid(candidateId);
            if (candidateUser) {
              contactNameIndex.set(candidateUser, chatName);
            }
            const originalUser = extractUserFromJid(id);
            if (originalUser) {
              contactNameIndex.set(originalUser, chatName);
            }
            return chatName;
          }
        } catch {
          // Try next candidate.
        }
      }

      const refreshedFromIndex =
        contactNameIndex.get(id) ||
        contactNameIndex.get(extractUserFromJid(id)) ||
        contactNameIndex.get(candidateId) ||
        contactNameIndex.get(extractUserFromJid(candidateId)) ||
        "";
      if (refreshedFromIndex) {
        return refreshedFromIndex;
      }
    }

    return "";
  };
}

function extractDisplayNameFromContact(contact: unknown): string {
  if (!contact || typeof contact !== "object") {
    return "";
  }

  return (
    extractNonEmptyString((contact as { name?: unknown }).name) ||
    extractNonEmptyString((contact as { pushname?: unknown }).pushname) ||
    extractNonEmptyString((contact as { shortName?: unknown }).shortName) ||
    extractNonEmptyString((contact as { verifiedName?: unknown }).verifiedName) ||
    extractNonEmptyString((contact as { number?: unknown }).number) ||
    ""
  );
}

async function extractDisplayNameFromChat(chat: unknown): Promise<string> {
  if (!chat || typeof chat !== "object") {
    return "";
  }

  const directName = extractNonEmptyString((chat as { name?: unknown }).name);
  if (directName) {
    return directName;
  }

  const getContact = (chat as { getContact?: () => Promise<unknown> }).getContact;
  if (typeof getContact !== "function") {
    return "";
  }

  try {
    const contact = await getContact();
    return extractDisplayNameFromContact(contact);
  } catch {
    return "";
  }
}

function buildContactLookupCandidates(id: string): string[] {
  const trimmed = id.trim();
  if (!trimmed) {
    return [];
  }

  const user = extractUserFromJid(trimmed);
  const candidates = [trimmed];

  if (user) {
    candidates.push(`${user}@c.us`);
    candidates.push(`${user}@lid`);
  }

  return Array.from(new Set(candidates));
}

function extractParticipantId(participant: unknown): string {
  if (!participant || typeof participant !== "object") {
    return "";
  }

  const rawId = (participant as { id?: unknown }).id;
  if (typeof rawId === "string") {
    return rawId;
  }

  if (!rawId || typeof rawId !== "object") {
    return "";
  }

  const serialized = extractNonEmptyString((rawId as { _serialized?: unknown })._serialized);
  if (serialized) {
    return serialized;
  }

  const user = extractNonEmptyString((rawId as { user?: unknown }).user);
  const server = extractNonEmptyString((rawId as { server?: unknown }).server);
  if (user && server) {
    return `${user}@${server}`;
  }

  return "";
}

function extractParticipantName(participant: unknown): string {
  if (!participant || typeof participant !== "object") {
    return "";
  }

  return (
    extractNonEmptyString((participant as { name?: unknown }).name) ||
    extractNonEmptyString((participant as { pushname?: unknown }).pushname) ||
    extractNonEmptyString((participant as { shortName?: unknown }).shortName) ||
    ""
  );
}

function extractNonEmptyString(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
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

  // Some self-chat message_create events use @lid instead of @c.us for to.
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

async function getCurrentWhatsAppGroupChat(
  message: Message
): Promise<WhatsAppGroupChatSummary | null> {
  const groupJid = extractGroupJidFromMessage(message);
  if (!groupJid) {
    return null;
  }

  try {
    const chat = await message.getChat();
    if (chat && (chat.isGroup || chat.id?.server === "g.us")) {
      return {
        id: chat.id?._serialized || groupJid,
        name: chat.name || "(unnamed group)",
      };
    }
  } catch {
    // Fall back to JID-only data if chat lookup is unavailable.
  }

  return {
    id: groupJid,
    name: "(unknown group)",
  };
}

function extractGroupJidFromMessage(message: Message): string | null {
  if (isGroupJid(message.from || "")) {
    return message.from;
  }

  if (isGroupJid(message.to || "")) {
    return message.to;
  }

  return null;
}
