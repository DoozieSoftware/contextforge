import { describe, it, expect } from "vitest";
import { parsePositiveInteger, CommandError } from "~/util/args.js";

describe("parsePositiveInteger", () => {
  it("accepts valid integers", () => {
    expect(parsePositiveInteger("1", "--foo")).toBe(1);
    expect(parsePositiveInteger("9999", "--foo")).toBe(9999);
  });
  it("rejects empty strings", () => {
    expect(() => parsePositiveInteger("", "--foo")).toThrow(CommandError);
  });
  it("rejects zero and negative", () => {
    expect(() => parsePositiveInteger("0", "--foo")).toThrow(CommandError);
    expect(() => parsePositiveInteger("-5", "--foo")).toThrow(CommandError);
  });
  it("rejects non-integers", () => {
    expect(() => parsePositiveInteger("12abc", "--foo")).toThrow(CommandError);
    expect(() => parsePositiveInteger("1.5", "--foo")).toThrow(CommandError);
    expect(() => parsePositiveInteger("abc", "--foo")).toThrow(CommandError);
  });
});
