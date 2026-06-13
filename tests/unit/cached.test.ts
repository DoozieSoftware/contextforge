import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CachedProvider } from "../../src/llm/cached.js";
import { LLMCache } from "../../src/llm/cache.js";
import type { LLMProvider, ChatMessage, ChatResult, ChatOptions, ToolSpec } from "../../src/llm/types.js";

class CountingProvider implements LLMProvider {
  public calls = 0;
  async chat(_messages: ChatMessage[], _tools: ToolSpec[], _opts: ChatOptions): Promise<ChatResult> {
    this.calls++;
    return {
      content: `reply-${this.calls}`,
      toolCalls: [],
      tokensIn: 10,
      tokensOut: 5,
      model: "test",
      latencyMs: 1,
    };
  }
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-cached-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("CachedProvider", () => {
  it("caches a simple non-tool chat and reuses it on second call", async () => {
    const inner = new CountingProvider();
    const cache = new LLMCache(tmp);
    const p = new CachedProvider(inner, cache);
    const messages: ChatMessage[] = [{ role: "user", content: "hello" }];
    const r1 = await p.chat(messages, [], { model: "m" });
    const r2 = await p.chat(messages, [], { model: "m" });
    expect(r1.content).toBe("reply-1");
    expect(r2.content).toBe("reply-1"); // served from cache, no extra inner call
    expect(inner.calls).toBe(1);
  });

  it("bypasses cache when tools are provided", async () => {
    const inner = new CountingProvider();
    const cache = new LLMCache(tmp);
    const p = new CachedProvider(inner, cache);
    const messages: ChatMessage[] = [{ role: "user", content: "hello" }];
    const tools: ToolSpec[] = [{ name: "read_file", description: "r", input_schema: { type: "object" } }];
    await p.chat(messages, tools, { model: "m" });
    await p.chat(messages, tools, { model: "m" });
    expect(inner.calls).toBe(2);
  });

  it("bypasses cache when a tool role is present in messages", async () => {
    const inner = new CountingProvider();
    const cache = new LLMCache(tmp);
    const p = new CachedProvider(inner, cache);
    const messages: ChatMessage[] = [
      { role: "user", content: "hello" },
      { role: "tool", content: "x", tool_call_id: "1" },
    ];
    await p.chat(messages, [], { model: "m" });
    await p.chat(messages, [], { model: "m" });
    expect(inner.calls).toBe(2);
  });
});
