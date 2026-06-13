import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runTrace } from "~/commands/trace.js";
import { renderFinalMarkdown } from "~/context/render.js";
import { detectProjectMemory, writeProjectMemory } from "~/memory/project.js";
import { makeMockProvider } from "../fixtures/mock-llm.js";
import { createStats } from "~/llm/stats.js";
import type { CommandContext } from "~/commands/types.js";
import type { AppConfig } from "~/util/config.js";
import { copyFixture } from "./_helpers.js";

describe("ctx trace (e2e, mock LLM)", () => {
  let root: string;
  beforeEach(() => {
    root = copyFixture("sample-laravel");
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("emits Probable Root Causes and at least one candidate file path", async () => {
    writeProjectMemory(root, detectProjectMemory(root));
    const mem = detectProjectMemory(root);
    const provider = makeMockProvider();
    const appConfig: AppConfig = {
      provider: {
        provider: "anthropic",
        apiKey: "sk-test",
        plannerModel: "mock-model",
        writerModel: "mock-model",
        inputCostPer1M: 0,
        outputCostPer1M: 0,
      },
      maxPlannerSteps: 4,
    };
    const ctx: CommandContext = {
      root,
      cwd: root,
      appConfig,
      memory: mem,
      provider,
      stats: createStats(),
      offline: false,
    };
    const result = await runTrace({ query: "tax mismatch" }, ctx);
    expect(result.body).toContain("## Probable Root Causes");
    expect(result.body).toMatch(/app\/(Services|Models|Http)\/[\w\/]+\.php/);
    const rendered = renderFinalMarkdown(result.body, { report: result.report, stats: result.stats, title: result.title });
    expect(rendered).toContain("LLM Stats");
  });
});
