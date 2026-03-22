import type { Env } from "./env";
import type {
  ChatMemberLookupInput,
  OpenRouterProtocolToolDescriptions,
  OpenRouterProtocolToolNames,
  ProtocolToolContext,
} from "./protocols/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openrouter/auto";
const DEFAULT_SYSTEM_PROMPT =
  "You are a concise, friendly assistant replying to chat users. Keep answers practical and brief unless they ask for detail.";

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
};

const DEFAULT_TOOL_DESCRIPTIONS: OpenRouterProtocolToolDescriptions = {
  listChannels: "List the channels available to this bot account",
  getCurrentChannel: "Get details about the current channel for this message",
  listChatMembers:
    "List name and ID for chat members. Provide chatId and/or chatName to target a specific chat; omit both for current chat.",
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

  const firstPassData = await requestOpenRouterCompletion(env, {
    model,
    messages,
    tools,
  });

  const firstMessage = firstPassData.choices?.[0]?.message;
  const toolCalls = firstMessage?.tool_calls || [];
  if (toolCalls.length === 0) {
    return extractAssistantText(firstPassData);
  }

  const toolResultMessages = await executeToolCalls(toolCalls, toolContext);
  if (toolResultMessages.length === 0) {
    return extractAssistantText(firstPassData);
  }

  const assistantToolMessage: OpenRouterMessage = {
    role: "assistant",
    content: normalizeAssistantContent(firstMessage?.content),
    tool_calls: toolCalls,
  };

  const secondPassData = await requestOpenRouterCompletion(env, {
    model,
    messages: [...messages, assistantToolMessage, ...toolResultMessages],
    tools,
  });

  return extractAssistantText(secondPassData);
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
      messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        name: toolName,
        content: JSON.stringify(members),
      });
      continue;
    }

    messages.push({
      role: "tool",
      tool_call_id: toolCallId,
      name: toolName,
      content: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
    });
  }

  return messages;
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
