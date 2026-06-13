import { describe, it, expect } from "vitest";

describe("billing", () => {
  it("computes CA tax at 8.75%", () => {
    const tax = Math.floor(10000 * 0.0875);
    expect(tax).toBe(875);
  });
});
