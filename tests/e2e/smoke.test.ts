import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";

describe("smoke", () => {
  it("node dist/cli.js --version exits 0 and prints 0.1.3", () => {
    const cli = path.resolve(__dirname, "../../dist/cli.js");
    const out = execSync(`node ${cli} --version`, { encoding: "utf-8" }).trim();
    expect(out).toBe("0.1.3");
  });

  it("node dist/cli.js --help shows the five commands", () => {
    const cli = path.resolve(__dirname, "../../dist/cli.js");
    const out = execSync(`node ${cli} --help`, { encoding: "utf-8" });
    expect(out).toContain("init");
    expect(out).toContain("understand");
    expect(out).toContain("trace");
    expect(out).toContain("review");
    expect(out).toContain("breakdown");
    expect(out).toContain("proposal");
  });
});
