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
}

export interface OpenRouterProtocolToolDescriptions {
  listChannels: string;
  getCurrentChannel: string;
  listChatMembers: string;
}

export interface ProtocolToolContext {
  listChannels?: () => Promise<ChannelSummary[]>;
  getCurrentChannel?: () => Promise<ChannelSummary | null>;
  listChatMembers?: (input?: ChatMemberLookupInput) => Promise<ChatMemberSummary[]>;
  toolNames?: Partial<OpenRouterProtocolToolNames>;
  toolDescriptions?: Partial<OpenRouterProtocolToolDescriptions>;
}
