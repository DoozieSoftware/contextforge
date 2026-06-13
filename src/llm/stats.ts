import type { ProviderConfig } from "../util/config.js";

export interface LlmCallRecord {
  role: "planner" | "writer";
  model: string;
  tokensIn: number;
  tokensOut: number;
  tools?: string;
  latencyMs: number;
  costUsd: number;
}

export interface LlmStats {
  calls: LlmCallRecord[];
  totalCalls: number;
  totalTokensIn: number;
  totalTokensOut: number;
  estimatedCostUsd: number;
}

export function createStats(): LlmStats {
  return {
    calls: [],
    totalCalls: 0,
    totalTokensIn: 0,
    totalTokensOut: 0,
    estimatedCostUsd: 0,
  };
}

export function recordCall(
  stats: LlmStats,
  role: LlmCallRecord["role"],
  model: string,
  tokensIn: number,
  tokensOut: number,
  latencyMs: number,
  cfg: Pick<ProviderConfig, "inputCostPer1M" | "outputCostPer1M">,
  tools?: string,
): void {
  const costUsd =
    (tokensIn / 1_000_000) * cfg.inputCostPer1M +
    (tokensOut / 1_000_000) * cfg.outputCostPer1M;
  stats.calls.push({ role, model, tokensIn, tokensOut, latencyMs, costUsd, tools });
  stats.totalCalls += 1;
  stats.totalTokensIn += tokensIn;
  stats.totalTokensOut += tokensOut;
  stats.estimatedCostUsd += costUsd;
}
