import { describe, it, expect } from "vitest";
import { CostGuard, CostExceededError } from "../../src/llm/cost.js";

const cfg = { inputCostPer1M: 1.0, outputCostPer1M: 5.0 };

describe("CostGuard", () => {
  it("records input + output tokens and accumulates cost", () => {
    const g = new CostGuard(cfg, { maxUsd: 1000, maxTokens: 1_000_000 });
    g.estimate([{ content: "hello" }]);
    g.record(1000, 500);
    const t = g.total;
    expect(t.tokens).toBe(1500);
    expect(t.usd).toBeCloseTo(0.001 + 0.0025, 6);
  });

  it("throws CostExceededError when token cap is exceeded", () => {
    const g = new CostGuard(cfg, { maxTokens: 100, maxUsd: 1000 });
    g.record(60, 0);
    expect(() => g.record(60, 0)).toThrow(CostExceededError);
  });

  it("throws CostExceededError when USD cap is exceeded", () => {
    const g = new CostGuard(cfg, { maxTokens: 1_000_000, maxUsd: 0.0001 });
    g.record(0, 0);
    expect(() => g.record(1000, 1000)).toThrow(CostExceededError);
  });

  it("throws on estimate that projects over the limit", () => {
    const g = new CostGuard(cfg, { maxTokens: 10 });
    expect(() => g.estimate([{ content: "x".repeat(400) }])).toThrow(CostExceededError);
  });

  it("disabled mode never throws and never records", () => {
    const g = new CostGuard(cfg, { maxTokens: 1, maxUsd: 0.0001, disabled: true });
    g.estimate([{ content: "x".repeat(100000) }]);
    g.record(1000, 1000);
    expect(g.total).toEqual({ tokens: 0, usd: 0 });
  });

  it("includes used/limit in the error", () => {
    const g = new CostGuard(cfg, { maxTokens: 50 });
    g.record(30, 0);
    let caught: unknown = null;
    try {
      g.record(30, 0);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CostExceededError);
    const err = caught as CostExceededError;
    expect(err.limit.tokens).toBe(50);
    expect(err.used.tokens).toBeGreaterThan(50);
  });
});
