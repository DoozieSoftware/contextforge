import { LLMCache } from "./cache.js";
import type { LLMProvider, ChatMessage, ChatResult, ChatOptions, ToolSpec } from "./types.js";

/**
 * Wraps a real provider with a SQLite-backed response cache. Cache is
 * bypassed when the model has tool specs and the messages include a tool
 * role — those depend on dynamic state and should not be cached.
 */
export class CachedProvider implements LLMProvider {
  constructor(private inner: LLMProvider, private cache: LLMCache) {}

  async chat(
    messages: ChatMessage[],
    tools: ToolSpec[],
    opts: ChatOptions,
  ): Promise<ChatResult> {
    const hasTools = tools.length > 0;
    const hasToolResponse = messages.some((m) => m.role === "tool");
    if (hasTools || hasToolResponse) {
      // Don't cache multi-turn tool flows — they're stateful.
      return this.inner.chat(messages, tools, opts);
    }
    const key = LLMCache.keyFor(opts.model, messages, tools.length);
    const hit = this.cache.get(key);
    if (hit) {
      return {
        content: hit.content,
        toolCalls: hit.toolCalls as any,
        tokensIn: hit.tokensIn,
        tokensOut: hit.tokensOut,
        model: hit.model,
        latencyMs: 0,
      };
    }
    const result = await this.inner.chat(messages, tools, opts);
    this.cache.put(key, result.model, result.content, result.toolCalls, result.tokensIn, result.tokensOut);
    return result;
  }
}
