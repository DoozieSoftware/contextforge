import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LLMCache } from "../../src/llm/cache.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-cache-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("LLMCache.keyFor", () => {
  it("is deterministic for the same input", () => {
    const k1 = LLMCache.keyFor("m", [{ role: "user", content: "hi" }], 0);
    const k2 = LLMCache.keyFor("m", [{ role: "user", content: "hi" }], 0);
    expect(k1).toBe(k2);
  });
  it("changes when the model changes", () => {
    const a = LLMCache.keyFor("a", [{ role: "user", content: "x" }], 0);
    const b = LLMCache.keyFor("b", [{ role: "user", content: "x" }], 0);
    expect(a).not.toBe(b);
  });
  it("changes when message content changes", () => {
    const a = LLMCache.keyFor("m", [{ role: "user", content: "x" }], 0);
    const b = LLMCache.keyFor("m", [{ role: "user", content: "y" }], 0);
    expect(a).not.toBe(b);
  });
  it("changes when the tool count changes", () => {
    const a = LLMCache.keyFor("m", [{ role: "user", content: "x" }], 0);
    const b = LLMCache.keyFor("m", [{ role: "user", content: "x" }], 1);
    expect(a).not.toBe(b);
  });
});

describe("LLMCache roundtrip", () => {
  it("put then get returns the same payload", () => {
    const c = new LLMCache(tmp);
    c.gc();
    const k = LLMCache.keyFor("m", [{ role: "user", content: "hi" }], 0);
    c.put(k, "m", "hello world", [{ id: "1", name: "read_file", input: { path: "a.ts" } }], 10, 5);
    const hit = c.get(k);
    expect(hit).not.toBeNull();
    expect(hit!.content).toBe("hello world");
    expect(hit!.toolCalls[0].name).toBe("read_file");
    expect(hit!.tokensIn).toBe(10);
    expect(hit!.tokensOut).toBe(5);
  });

  it("returns null for unknown keys", () => {
    const c = new LLMCache(tmp);
    expect(c.get("nope")).toBeNull();
  });

  it("expires after TTL", () => {
    const c = new LLMCache(tmp, { ttlMs: 1 });
    const k = LLMCache.keyFor("m", [{ role: "user", content: "x" }], 0);
    c.put(k, "m", "y", [], 0, 0);
    // Wait so the timestamp is unambiguously in the past
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const hit = c.get(k);
        expect(hit).toBeNull();
        resolve();
      }, 25);
    });
  });

  it("disabled mode never writes or reads", () => {
    const c = new LLMCache(tmp, { disabled: true });
    c.put("k", "m", "x", [], 0, 0);
    expect(c.get("k")).toBeNull();
  });

  it("clear empties the cache", () => {
    const c = new LLMCache(tmp);
    c.put("k1", "m", "a", [], 0, 0);
    c.put("k2", "m", "b", [], 0, 0);
    c.clear();
    expect(c.get("k1")).toBeNull();
    expect(c.get("k2")).toBeNull();
  });
});
