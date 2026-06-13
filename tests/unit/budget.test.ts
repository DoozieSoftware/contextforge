import { describe, it, expect } from "vitest";
import { countTokens, buildReport, formatReport } from "~/context/budget.js";

describe("budget", () => {
  it("counts tokens for a known string", () => {
    const tokens = countTokens("hello world");
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(10);
  });

  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("builds a report and renders it", () => {
    const r = buildReport(100, 10, 100_000, 10_000);
    expect(r.reduction).toBeCloseTo(0.9, 2);
    const out = formatReport(r);
    expect(out).toContain("Files Scanned: 100");
    expect(out).toContain("Files Selected: 10");
    expect(out).toContain("Repo Size:     100,000 tokens");
    expect(out).toContain("Context Size:  10,000 tokens");
    expect(out).toMatch(/Reduction:\s+90\.0%/);
  });
});
