import type { ProviderConfig } from "../util/config.js";
import type {
  LLMProvider,
  ChatMessage,
  ChatResult,
  ChatOptions,
  ToolSpec,
  ToolCall,
} from "./types.js";

interface AnthropicResponse {
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
}

export class AnthropicProvider implements LLMProvider {
  constructor(private cfg: ProviderConfig) {}

  private async client(): Promise<any> {
    const mod = await import("@anthropic-ai/sdk").catch(() => null);
    if (!mod) throw new Error("@anthropic-ai/sdk is not installed");
    return new mod.default({ apiKey: this.cfg.apiKey });
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[], opts: ChatOptions): Promise<ChatResult> {
    const client = await this.client();
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const rest = messages.filter((m) => m.role !== "system") as ChatMessage[];
    const t0 = Date.now();
    const resp = (await client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.2,
      system,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as any,
      })),
      messages: rest.map(toAnthropic),
    })) as AnthropicResponse;
    const latencyMs = Date.now() - t0;
    const toolCalls: ToolCall[] = [];
    let text = "";
    for (const c of resp.content ?? []) {
      if (c.type === "text") text += c.text ?? "";
      else if (c.type === "tool_use") {
        toolCalls.push({ id: c.id ?? "", name: c.name ?? "", input: (c.input as any) ?? {} });
      }
    }
    return {
      content: text,
      toolCalls,
      tokensIn: resp.usage?.input_tokens ?? 0,
      tokensOut: resp.usage?.output_tokens ?? 0,
      model: resp.model ?? opts.model,
      latencyMs,
    };
  }
}

function toAnthropic(m: ChatMessage): any {
  if (m.role === "user") return { role: "user", content: m.content };
  if (m.role === "assistant") {
    if (m.tool_calls && m.tool_calls.length) {
      return {
        role: "assistant",
        content: m.tool_calls.map((t) => ({
          type: "tool_use",
          id: t.id,
          name: t.name,
          input: t.input,
        })),
      };
    }
    return { role: "assistant", content: m.content };
  }
  if (m.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: m.tool_call_id,
          content: m.content,
        },
      ],
    };
  }
  return { role: "user", content: m.content };
}
