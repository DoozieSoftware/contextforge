import type { ProviderConfig } from "../util/config.js";
import type { LLMProvider, ChatMessage, ChatResult, ChatOptions, ToolSpec, ToolCall } from "./types.js";

export type { LLMProvider, ChatMessage, ChatResult, ChatOptions, ToolSpec, ToolCall };

/**
 * Returns the right provider implementation for the given config. Uses
 * dynamic imports so that an offline test environment without the SDKs
 * installed can still construct a mock.
 */
export async function getProvider(cfg: ProviderConfig): Promise<LLMProvider> {
  if (process.env.CTX_MOCK_PROVIDER === "1") {
    const mod = await import("./mock.js");
    return new mod.MockProvider();
  }
  if (cfg.provider === "anthropic") {
    const mod = await import("./anthropic.js");
    return new mod.AnthropicProvider(cfg);
  }
  if (cfg.provider === "openai") {
    const mod = await import("./openai.js");
    return new mod.OpenAIProvider(cfg);
  }
  if (cfg.provider === "openai-compat") {
    const mod = await import("./openai-compat.js");
    return new mod.OpenAICompatProvider(cfg);
  }
  throw new Error(`Unknown provider: ${cfg.provider}`);
}
