import type { LLMProvider, ChatMessage, ChatResult, ChatOptions, ToolSpec } from "./types.js";

/**
 * Deterministic mock provider. Tests can register canned responses and then
 * assert call sequences without touching a real API. The mock tries to match
 * the joined message contents against the supplied patterns.
 */
export class MockProvider implements LLMProvider {
  public readonly model: string;
  public responses: { match: RegExp; result: Partial<ChatResult> }[] = [];
  public callLog: { messages: ChatMessage[]; tools: ToolSpec[]; opts: ChatOptions }[] = [];

  constructor(model = "mock-model") {
    this.model = model;
  }

  /** Register a canned response. The first matching `match` wins. */
  respond(match: RegExp, partial: Partial<ChatResult>): this {
    this.responses.push({ match, result: partial });
    return this;
  }

  async chat(messages: ChatMessage[], tools: ToolSpec[], opts: ChatOptions): Promise<ChatResult> {
    this.callLog.push({ messages, tools, opts });
    const text = messages.map((m) => m.content).join("\n");
    for (const r of this.responses) {
      if (r.match.test(text)) {
        return {
          content: r.result.content ?? "",
          toolCalls: r.result.toolCalls ?? [],
          tokensIn: r.result.tokensIn ?? 100,
          tokensOut: r.result.tokensOut ?? 50,
          model: r.result.model ?? this.model,
          latencyMs: r.result.latencyMs ?? 10,
        };
      }
    }
    return {
      content: "",
      toolCalls: [],
      tokensIn: 0,
      tokensOut: 0,
      model: this.model,
      latencyMs: 0,
    };
  }
}
