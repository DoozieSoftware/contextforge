import type { ProviderConfig } from "../util/config.js";
import { withRetry, HttpError } from "./retry.js";
import type {
  LLMProvider,
  ChatMessage,
  ChatResult,
  ChatOptions,
  ToolSpec,
  ToolCall,
} from "./types.js";

interface OpenAIResponse {
  choices: Array<{
    message: {
      content?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
}

/**
 * OpenAI provider. We use the public REST endpoint directly so we don't need
 * the official `openai` package as a runtime dep. The fetch call includes
 * bearer-token auth from the configured API key.
 */
export class OpenAIProvider implements LLMProvider {
  constructor(private cfg: ProviderConfig) {}

  async chat(messages: ChatMessage[], tools: ToolSpec[], opts: ChatOptions): Promise<ChatResult> {
    const t0 = Date.now();
    const body = {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.2,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        tool_call_id: m.tool_call_id,
        tool_calls: m.tool_calls?.map((t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: JSON.stringify(t.input) },
        })),
      })),
      tools: tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      })),
    };

    const resp = await withRetry(async () => {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const text = await r.text();
        throw new HttpError(r.status, text);
      }
      return (await r.json()) as OpenAIResponse;
    });
    const respJson = resp;
    const latencyMs = Date.now() - t0;
    const choice = respJson.choices?.[0];
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function.name,
      input: safeJson(c.function.arguments),
    }));
    return {
      content: choice?.message?.content ?? "",
      toolCalls,
      tokensIn: respJson.usage?.prompt_tokens ?? 0,
      tokensOut: respJson.usage?.completion_tokens ?? 0,
      model: respJson.model ?? opts.model,
      latencyMs,
    };
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
