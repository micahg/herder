import type { Env } from "./env";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openrouter/auto";
const DEFAULT_SYSTEM_PROMPT =
  "You are a concise, friendly assistant replying to WhatsApp users. Keep answers practical and brief unless they ask for detail.";

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

export async function generateReplyFromOpenRouter(
  env: Env,
  userMessage: string
): Promise<string> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const model = env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const systemPrompt = env.OPENROUTER_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;

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
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
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

  let data: OpenRouterResponse;
  try {
    data = (await response.json()) as OpenRouterResponse;
  } catch {
    throw new Error("OpenRouter returned a non-JSON response body");
  }

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
