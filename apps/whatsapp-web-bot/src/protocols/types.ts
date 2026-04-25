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

export interface OutreachParticipantInput {
  protocol?: string;
  id: string;
  name?: string;
}

export interface StartOutreachWorkflowInput {
  topic?: string;
  question?: string;
  participants?: OutreachParticipantInput[];
  responseWindowHours?: number;
  originChannelId?: string;
  originChannelName?: string;
  evaluationMode?: string;
}

export interface OutreachChildWorkflowStatus {
  childWorkflowId: string;
  participant: OutreachParticipantInput;
  status: "pending" | "sent" | "responded" | "failed" | "canceled";
  sentAt?: string;
  responseText?: string;
  responseAt?: string;
  error?: string;
}

export interface StartOutreachWorkflowResult {
  ok: boolean;
  workflowId: string;
  status: "active" | "completed" | "failed" | "canceled" | "expired";
  topic: string;
  question: string;
  createdAt: string;
  responseDeadlineAt: string;
  participants: OutreachChildWorkflowStatus[];
  summary: string;
  error?: string;
}

export interface GetOutreachWorkflowStatusInput {
  workflowId?: string;
}

export interface OutreachWorkflowStatusResult {
  ok: boolean;
  workflowId: string;
  status: "active" | "completed" | "failed" | "canceled" | "expired";
  topic: string;
  question: string;
  createdAt: string;
  responseDeadlineAt: string;
  participantCount: number;
  respondedCount: number;
  pendingCount: number;
  failedCount: number;
  participants: OutreachChildWorkflowStatus[];
  summary: string;
  error?: string;
}

export interface CancelOutreachWorkflowInput {
  workflowId?: string;
  reason?: string;
}

export interface CancelOutreachWorkflowResult {
  ok: boolean;
  workflowId: string;
  status: "canceled" | "completed" | "failed" | "expired";
  canceledAt: string;
  reason?: string;
  summary: string;
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
  startOutreachWorkflow: string;
  getOutreachWorkflowStatus: string;
  cancelOutreachWorkflow: string;
}

export interface OpenRouterProtocolToolDescriptions {
  listChannels: string;
  getCurrentChannel: string;
  listChatMembers: string;
  sendMessageToContact: string;
  startOutreachWorkflow: string;
  getOutreachWorkflowStatus: string;
  cancelOutreachWorkflow: string;
}

export interface ProtocolToolContext {
  listChannels?: () => Promise<ChannelSummary[]>;
  getCurrentChannel?: () => Promise<ChannelSummary | null>;
  listChatMembers?: (input?: ChatMemberLookupInput) => Promise<ChatMemberSummary[]>;
  sendMessageToContact?: (input?: ContactMessageInput) => Promise<ContactMessageResult>;
  startOutreachWorkflow?: (
    input?: StartOutreachWorkflowInput
  ) => Promise<StartOutreachWorkflowResult>;
  getOutreachWorkflowStatus?: (
    input?: GetOutreachWorkflowStatusInput
  ) => Promise<OutreachWorkflowStatusResult>;
  cancelOutreachWorkflow?: (
    input?: CancelOutreachWorkflowInput
  ) => Promise<CancelOutreachWorkflowResult>;
  toolNames?: Partial<OpenRouterProtocolToolNames>;
  toolDescriptions?: Partial<OpenRouterProtocolToolDescriptions>;
}
