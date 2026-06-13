import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectProjectMemory, readProjectMemory, writeProjectMemory } from "~/memory/project.js";
import * as credentials from "~/memory/credentials.js";

describe("memory/project", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-mem-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns null when no project.json", () => {
    expect(readProjectMemory(root)).toBeNull();
  });

  it("round-trips project.json", () => {
    const mem = detectProjectMemory(root);
    writeProjectMemory(root, mem);
    const back = readProjectMemory(root);
    expect(back).not.toBeNull();
    expect(back?.projectName).toBe(mem.projectName);
  });

  it("detects Laravel from composer.json", () => {
    fs.writeFileSync(
      path.join(root, "composer.json"),
      JSON.stringify({
        require: { "laravel/framework": "^10.0", "illuminate/database": "^10.0" },
      }),
    );
    fs.mkdirSync(path.join(root, "app"), { recursive: true });
    fs.mkdirSync(path.join(root, "routes"), { recursive: true });
    const mem = detectProjectMemory(root);
    expect(mem.stacks).toContain("laravel");
    expect(mem.primaryLanguage).toBe("php");
    expect(mem.architecture).toBe("mvc");
  });
});

describe("memory/credentials (sandboxed via CTX_CONFIG_DIR)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-home-"));
    process.env.CTX_CONFIG_DIR = tmp;
  });
  afterEach(() => {
    delete process.env.CTX_CONFIG_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes and reads credentials under CTX_CONFIG_DIR", () => {
    const file = credentials.writeCredentials({
      provider: "anthropic",
      apiKey: "sk-test-1234",
      plannerModel: "claude-haiku-4-5",
      writerModel: "claude-sonnet-4-5",
      createdAt: new Date().toISOString(),
    });
    expect(fs.existsSync(file)).toBe(true);
    expect(file).toContain(tmp);
    const back = credentials.readCredentials();
    expect(back?.apiKey).toBe("sk-test-1234");
    expect(back?.provider).toBe("anthropic");
  });
});
