export type ChannelKind = "direct" | "group" | "thread" | "unknown";

export interface ChannelSummary {
  id: string;
  name: string;
  kind?: ChannelKind;
}

export interface ChatMemberSummary {
  id: string;
  name: string;
}

export interface ChatMemberLookupInput {
  chatId?: string;
  chatName?: string;
}

export interface ContactMessageInput {
  contactId?: string;
  message?: string;
}

export interface ContactMessageResult {
  ok: boolean;
  contactId: string;
  message: string;
  resolvedContactId?: string;
  protocolMessageId?: string;
  error?: string;
}

export interface ProtocolRuntime {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  isReady(): boolean;
  getLatestSetupCode(): string | null;
  listChannels(): Promise<ChannelSummary[]>;
}

export interface OpenRouterProtocolToolNames {
  listChannels: string;
  getCurrentChannel: string;
  listChatMembers: string;
  sendMessageToContact: string;
}

export interface OpenRouterProtocolToolDescriptions {
  listChannels: string;
  getCurrentChannel: string;
  listChatMembers: string;
  sendMessageToContact: string;
}

export interface ProtocolToolContext {
  listChannels?: () => Promise<ChannelSummary[]>;
  getCurrentChannel?: () => Promise<ChannelSummary | null>;
  listChatMembers?: (input?: ChatMemberLookupInput) => Promise<ChatMemberSummary[]>;
  sendMessageToContact?: (input?: ContactMessageInput) => Promise<ContactMessageResult>;
  toolNames?: Partial<OpenRouterProtocolToolNames>;
  toolDescriptions?: Partial<OpenRouterProtocolToolDescriptions>;
}
