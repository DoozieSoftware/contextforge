import type { ProviderConfig } from "../util/config.js";
import { countTokens } from "../context/budget.js";

export interface CostGuardOpts {
  /** Hard cap on estimated spend per command, in USD. Default 1.00. */
  maxUsd?: number;
  /** Hard cap on total tokens (in+out) per command. Default 1_000_000. */
  maxTokens?: number;
  /** Skip the pre-call estimate (useful for tests / mock providers). */
  disabled?: boolean;
}

export class CostExceededError extends Error {
  constructor(public readonly used: { tokens: number; usd: number }, public readonly limit: { tokens: number; usd: number }) {
    super(`Cost guard exceeded: ${used.tokens} tokens / $${used.usd.toFixed(4)} > ${limit.tokens} tokens / $${limit.usd.toFixed(2)}`);
    this.name = "CostExceededError";
  }
}

/**
 * Pre-call cost guard. Call `estimate(messages)` before each chat() to
 * check the input token cost. Call `record()` after each call to update
 * the running total. Throws CostExceededError when the running total
 * exceeds the configured limit.
 */
export class CostGuard {
  readonly maxUsd: number;
  readonly maxTokens: number;
  readonly disabled: boolean;
  private totalTokens = 0;
  private totalUsd = 0;

  constructor(private cfg: Pick<ProviderConfig, "inputCostPer1M" | "outputCostPer1M">, opts: CostGuardOpts = {}) {
    this.maxUsd = opts.maxUsd ?? 1.0;
    this.maxTokens = opts.maxTokens ?? 1_000_000;
    this.disabled = !!opts.disabled;
  }

  /** Estimate the cost of a single call's input and return projected total. */
  estimate(messages: { content: string }[]): { tokens: number; usd: number; projected: { tokens: number; usd: number } } {
    if (this.disabled) return { tokens: 0, usd: 0, projected: { tokens: this.totalTokens, usd: this.totalUsd } };
    const text = messages.map((m) => m.content ?? "").join("\n");
    const tokens = countTokens(text);
    const usd = (tokens / 1_000_000) * this.cfg.inputCostPer1M;
    const projected = { tokens: this.totalTokens + tokens, usd: this.totalUsd + usd };
    this.assertWithinLimit(projected);
    return { tokens, usd, projected };
  }

  record(tokensIn: number, tokensOut: number): void {
    if (this.disabled) return;
    const usd =
      (tokensIn / 1_000_000) * this.cfg.inputCostPer1M +
      (tokensOut / 1_000_000) * this.cfg.outputCostPer1M;
    this.totalTokens += tokensIn + tokensOut;
    this.totalUsd += usd;
    this.assertWithinLimit({ tokens: this.totalTokens, usd: this.totalUsd });
  }

  get total(): { tokens: number; usd: number } {
    return { tokens: this.totalTokens, usd: this.totalUsd };
  }

  private assertWithinLimit(used: { tokens: number; usd: number }): void {
    if (this.disabled) return;
    if (used.tokens > this.maxTokens || used.usd > this.maxUsd) {
      throw new CostExceededError(used, { tokens: this.maxTokens, usd: this.maxUsd });
    }
  }
}
