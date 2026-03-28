import type { Env } from "./env";
import type {
  ContactMessageInput,
  ChatMemberLookupInput,
  OpenRouterProtocolToolDescriptions,
  OpenRouterProtocolToolNames,
  ProtocolToolContext,
} from "./protocols/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openrouter/auto";
const DEFAULT_SYSTEM_PROMPT =
  "You are a concise, friendly assistant replying to chat users. Keep answers practical and brief unless they ask for detail.";
const MAX_TOOL_ROUNDS = 6;
const TOOL_DEBUG_ENABLED = isTruthyEnvValue(process.env.OPENROUTER_TOOL_DEBUG);

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | Array<{ type?: string; text?: string }>;
      tool_calls?: OpenRouterToolCall[];
    };
  }>;
}

interface OpenRouterToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenRouterToolContext extends ProtocolToolContext {}

const DEFAULT_TOOL_NAMES: OpenRouterProtocolToolNames = {
  listChannels: "list_channels",
  getCurrentChannel: "get_current_channel",
  listChatMembers: "list_chat_members",
  sendMessageToContact: "send_message_to_contact",
};

const DEFAULT_TOOL_DESCRIPTIONS: OpenRouterProtocolToolDescriptions = {
  listChannels: "List the channels available to this bot account",
  getCurrentChannel: "Get details about the current channel for this message",
  listChatMembers:
    "List name and ID for chat members. Provide chatId and/or chatName to target a specific chat; omit both for current chat.",
  sendMessageToContact:
    "Send a direct message to a contact by protocol contact ID. Use list_chat_members first when only a name is known. The protocol layer adds AI-assistant disclosure automatically.",
};

type JsonSchemaObject = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: boolean;
};

type OpenRouterToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchemaObject;
  };
};

export async function generateReplyFromOpenRouter(
  env: Env,
  userMessage: string,
  toolContext: OpenRouterToolContext = {}
): Promise<string> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const model = env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const systemPrompt = env.OPENROUTER_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;
  const messages: OpenRouterMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];
  const tools = buildTools(toolContext);
  const workflowInstruction = buildToolWorkflowInstruction(toolContext);
  if (workflowInstruction) {
    messages.splice(1, 0, { role: "system", content: workflowInstruction });
  }
  const conversationMessages = [...messages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    logToolDebug("openrouter.request", {
      round: round + 1,
      messageCount: conversationMessages.length,
      recentMessages: summarizeRecentMessages(conversationMessages),
    });

    const responseData = await requestOpenRouterCompletion(env, {
      model,
      messages: conversationMessages,
      tools,
    });

    const responseMessage = responseData.choices?.[0]?.message;
    const toolCalls = responseMessage?.tool_calls || [];
    logToolDebug("openrouter.response", {
      round: round + 1,
      toolCallCount: toolCalls.length,
      toolCalls: toolCalls.map((toolCall) => ({
        id: toolCall.id || "missing-tool-call-id",
        name: toolCall.function?.name || "unknown",
        argumentsPreview: safePreview(toolCall.function?.arguments),
      })),
      assistantContentPreview: safePreview(normalizeAssistantContent(responseMessage?.content)),
    });

    if (toolCalls.length === 0) {
      return extractAssistantText(responseData);
    }

    const assistantToolMessage: OpenRouterMessage = {
      role: "assistant",
      content: normalizeAssistantContent(responseMessage?.content),
      tool_calls: toolCalls,
    };

    const toolResultMessages = await executeToolCalls(toolCalls, toolContext);
    logToolDebug("openrouter.tool_results", {
      round: round + 1,
      results: toolResultMessages.map((message) => ({
        toolCallId: message.tool_call_id || "missing-tool-call-id",
        name: message.name || "unknown",
        contentPreview: safePreview(message.content),
      })),
    });

    if (toolResultMessages.length === 0) {
      return extractAssistantText(responseData);
    }

    conversationMessages.push(assistantToolMessage, ...toolResultMessages);
  }

  throw new Error(`OpenRouter exceeded max tool rounds (${MAX_TOOL_ROUNDS})`);
}

function buildTools(toolContext: OpenRouterToolContext): OpenRouterToolDefinition[] {
  const toolNames = resolveToolNames(toolContext);
  const toolDescriptions = resolveToolDescriptions(toolContext);
  const tools: OpenRouterToolDefinition[] = [];

  if (toolContext.listChannels) {
    tools.push({
      type: "function",
      function: {
        name: toolNames.listChannels,
        description: toolDescriptions.listChannels,
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    });
  }

  if (toolContext.getCurrentChannel) {
    tools.push({
      type: "function",
      function: {
        name: toolNames.getCurrentChannel,
        description: toolDescriptions.getCurrentChannel,
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    });
  }

  if (toolContext.listChatMembers) {
    tools.push({
      type: "function",
      function: {
        name: toolNames.listChatMembers,
        description: toolDescriptions.listChatMembers,
        parameters: {
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
        },
      },
    });
  }

  if (toolContext.sendMessageToContact) {
    tools.push({
      type: "function",
      function: {
        name: toolNames.sendMessageToContact,
        description: toolDescriptions.sendMessageToContact,
        parameters: {
          type: "object",
          properties: {
            contactId: {
              type: "string",
              description:
                "Protocol contact ID, such as a WhatsApp JID like 15551234567@c.us",
            },
            message: {
              type: "string",
              description: "Message text to send to that contact",
            },
          },
          required: ["contactId", "message"],
          additionalProperties: false,
        },
      },
    });
  }

  return tools;
}

async function executeToolCalls(
  toolCalls: OpenRouterToolCall[],
  toolContext: OpenRouterToolContext
): Promise<OpenRouterMessage[]> {
  const toolNames = resolveToolNames(toolContext);
  const messages: OpenRouterMessage[] = [];

  for (const toolCall of toolCalls) {
    const toolCallId = toolCall.id || "missing-tool-call-id";
    const toolName = toolCall.function?.name || "unknown";

    if (toolName === toolNames.listChannels && toolContext.listChannels) {
      const groups = await toolContext.listChannels();
      logToolDebug("tool.listChannels", {
        toolCallId,
        count: groups.length,
        names: groups.map((group) => group.name).slice(0, 12),
      });
      messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        name: toolName,
        content: JSON.stringify(groups),
      });
      continue;
    }

    if (toolName === toolNames.getCurrentChannel && toolContext.getCurrentChannel) {
      const group = await toolContext.getCurrentChannel();
      logToolDebug("tool.getCurrentChannel", {
        toolCallId,
        id: group?.id || null,
        name: group?.name || null,
      });
      messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        name: toolName,
        content: JSON.stringify(group),
      });
      continue;
    }

    if (toolName === toolNames.listChatMembers && toolContext.listChatMembers) {
      const members = await toolContext.listChatMembers(
        parseChatMemberLookupInput(toolCall.function?.arguments)
      );
      logToolDebug("tool.listChatMembers", {
        toolCallId,
        count: members.length,
        members: members.slice(0, 20).map((member) => ({
          id: member.id,
          name: member.name,
        })),
      });
      messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        name: toolName,
        content: JSON.stringify(members),
      });
      continue;
    }

    if (toolName === toolNames.sendMessageToContact && toolContext.sendMessageToContact) {
      const result = await toolContext.sendMessageToContact(
        parseContactMessageInput(toolCall.function?.arguments)
      );
      logToolDebug("tool.sendMessageToContact", {
        toolCallId,
        ok: result.ok,
        contactId: result.contactId,
        resolvedContactId: result.resolvedContactId || null,
        protocolMessageId: result.protocolMessageId || null,
        error: result.error || null,
      });
      messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        name: toolName,
        content: JSON.stringify(result),
      });
      continue;
    }

    messages.push({
      role: "tool",
      tool_call_id: toolCallId,
      name: toolName,
      content: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
    });
    logToolDebug("tool.unknown", {
      toolCallId,
      name: toolName,
    });
  }

  return messages;
}

function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function summarizeRecentMessages(messages: OpenRouterMessage[]): Array<Record<string, unknown>> {
  return messages.slice(-4).map((message) => ({
    role: message.role,
    name: message.name,
    toolCallId: message.tool_call_id,
    toolCallNames: (message.tool_calls || []).map((toolCall) => toolCall.function?.name || "unknown"),
    contentPreview: safePreview(message.content),
  }));
}

function safePreview(value: string | undefined, maxLength = 280): string {
  if (!value) {
    return "";
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function logToolDebug(event: string, payload: Record<string, unknown>): void {
  if (!TOOL_DEBUG_ENABLED) {
    return;
  }

  console.debug(`[openrouter-debug] ${event}`, payload);
}

function parseContactMessageInput(rawArgs: string | undefined): ContactMessageInput {
  if (!rawArgs) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const contactId = normalizeOptionalString((parsed as { contactId?: unknown }).contactId);
  const message = normalizeOptionalString((parsed as { message?: unknown }).message);

  return {
    ...(contactId ? { contactId } : {}),
    ...(message ? { message } : {}),
  };
}

function parseChatMemberLookupInput(rawArgs: string | undefined): ChatMemberLookupInput {
  if (!rawArgs) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const chatId = normalizeOptionalString((parsed as { chatId?: unknown }).chatId);
  const chatName = normalizeOptionalString((parsed as { chatName?: unknown }).chatName);

  return {
    ...(chatId ? { chatId } : {}),
    ...(chatName ? { chatName } : {}),
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveToolNames(toolContext: OpenRouterToolContext): OpenRouterProtocolToolNames {
  return {
    ...DEFAULT_TOOL_NAMES,
    ...(toolContext.toolNames || {}),
  };
}

function resolveToolDescriptions(
  toolContext: OpenRouterToolContext
): OpenRouterProtocolToolDescriptions {
  return {
    ...DEFAULT_TOOL_DESCRIPTIONS,
    ...(toolContext.toolDescriptions || {}),
  };
}

function buildToolWorkflowInstruction(toolContext: OpenRouterToolContext): string {
  const toolNames = resolveToolNames(toolContext);

  if (!toolContext.listChatMembers || !toolContext.sendMessageToContact) {
    return "";
  }

  return [
    "Guidance for contact messaging requests:",
    "When the user asks to message a person in a chat and only provides a name, the usual approach is:",
    `use ${toolNames.listChatMembers} for that chat, extract the best case-insensitive member name match (exact first, then substring),`,
    `and use ${toolNames.sendMessageToContact} with that matched member id and the intended message text.`,
    "If the match is ambiguous, ask a short clarification question with candidate names.",
    "If the member id is already known, send directly without unnecessary lookup.",
  ].join(" ");
}

function normalizeAssistantContent(
  content: string | Array<{ type?: string; text?: string }> | undefined
): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text || "")
      .join(" ");
  }

  return "";
}

async function requestOpenRouterCompletion(
  env: Env,
  body: {
    model: string;
    messages: OpenRouterMessage[];
    tools: Array<{
      type: "function";
      function: {
        name: string;
        description: string;
        parameters: JsonSchemaObject;
      };
    }>;
  }
): Promise<OpenRouterResponse> {
  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.OPENROUTER_SITE_URL || "https://herder.local",
        "X-OpenRouter-Title": env.OPENROUTER_APP_TITLE || "Herder",
      },
      body: JSON.stringify({
        model: body.model,
        messages: body.messages,
        ...(body.tools.length > 0 ? { tools: body.tools } : {}),
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenRouter request threw before response: ${message}`);
  }

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenRouter request failed (${response.status}): ${details}`);
  }

  try {
    return (await response.json()) as OpenRouterResponse;
  } catch {
    throw new Error("OpenRouter returned a non-JSON response body");
  }
}

function extractAssistantText(data: OpenRouterResponse): string {
  const content = data.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.trim().length > 0) {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text?.trim() || "")
      .join(" ")
      .trim();

    if (text.length > 0) {
      return text;
    }
  }

  throw new Error("OpenRouter returned an empty assistant message");
}
