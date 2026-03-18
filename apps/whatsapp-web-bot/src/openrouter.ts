import type { Env } from "./env";
import type { WhatsAppGroupChatSummary } from "./whatsapp";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openrouter/auto";
const DEFAULT_SYSTEM_PROMPT =
  "You are a concise, friendly assistant replying to WhatsApp users. Keep answers practical and brief unless they ask for detail.";

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

export interface OpenRouterToolContext {
  listWhatsAppGroupChats?: () => Promise<WhatsAppGroupChatSummary[]>;
}

const LIST_WHATSAPP_GROUP_CHATS_TOOL = "list_whatsapp_group_chats";
const LIST_WHATSAPP_GROUP_CHATS_DESCRIPTION =
  "List the name and ID of each whatsapp group chats this user belongs to";

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

function buildTools(toolContext: OpenRouterToolContext): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, never>;
      additionalProperties: boolean;
    };
  };
}> {
  const tools: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: {
        type: "object";
        properties: Record<string, never>;
        additionalProperties: boolean;
      };
    };
  }> = [];

  if (toolContext.listWhatsAppGroupChats) {
    tools.push({
      type: "function",
      function: {
        name: LIST_WHATSAPP_GROUP_CHATS_TOOL,
        description: LIST_WHATSAPP_GROUP_CHATS_DESCRIPTION,
        parameters: {
          type: "object",
          properties: {},
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
  const messages: OpenRouterMessage[] = [];

  for (const toolCall of toolCalls) {
    const toolCallId = toolCall.id || "missing-tool-call-id";
    const toolName = toolCall.function?.name || "unknown";

    if (
      toolName === LIST_WHATSAPP_GROUP_CHATS_TOOL &&
      toolContext.listWhatsAppGroupChats
    ) {
      const groups = await toolContext.listWhatsAppGroupChats();
      messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        name: toolName,
        content: JSON.stringify(groups),
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
        parameters: {
          type: "object";
          properties: Record<string, never>;
          additionalProperties: boolean;
        };
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
