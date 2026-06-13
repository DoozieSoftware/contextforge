import { describe, it, expect } from "vitest";
import { getProvider } from "../../src/llm/provider.js";
import type { LLMProvider, ChatMessage, ChatResult, ChatOptions, ToolSpec } from "../../src/llm/types.js";

/**
 * Real-provider smoke tests. Gated on CTX_LIVE=1 plus the right env vars
 * (CTX_PROVIDER + the API key). These do NOT assert output quality — they
 * only assert that the wire format the SDK sends works for a one-line
 * prompt. That catches breakage from upstream API changes without
 * spending many tokens.
 */
const LIVE = process.env.CTX_LIVE === "1" || process.env.CTX_LIVE === "true";

const providerName = process.env.CTX_PROVIDER as "anthropic" | "openai" | "openai-compat" | undefined;
const apiKey =
  process.env.CTX_ANTHROPIC_API_KEY ||
  process.env.CTX_OPENAI_API_KEY ||
  process.env.CTX_OPENAI_COMPAT_API_KEY;
const baseUrl = process.env.CTX_OPENAI_COMPAT_BASE_URL;

const hasKey = !!providerName && !!apiKey && (providerName !== "openai-compat" || !!baseUrl);
const itLive = LIVE && hasKey ? it : it.skip;

describe("live provider smoke", () => {
  itLive("completes a one-line chat without throwing", async () => {
    const cfg: any = {
      provider: providerName,
      apiKey,
      baseUrl,
      plannerModel:
        providerName === "anthropic"
          ? "claude-haiku-4-5"
          : providerName === "openai"
          ? "gpt-4o-mini"
          : process.env.CTX_PLANNER_MODEL ?? "test",
      writerModel:
        providerName === "anthropic"
          ? "claude-sonnet-4-5"
          : providerName === "openai"
          ? "gpt-4o"
          : process.env.CTX_WRITER_MODEL ?? "test",
      inputCostPer1M: 0,
      outputCostPer1M: 0,
    };
    const p: LLMProvider = await getProvider(cfg);
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Reply with the single word OK and nothing else." },
    ];
    const opts: ChatOptions = { model: cfg.plannerModel, maxTokens: 32, temperature: 0 };
    const r: ChatResult = await p.chat(messages, [], opts);
    expect(typeof r.content).toBe("string");
    expect(r.content.length).toBeGreaterThan(0);
    expect(r.tokensIn).toBeGreaterThan(0);
  });
});
