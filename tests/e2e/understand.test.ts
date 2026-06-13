import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runUnderstand } from "~/commands/understand.js";
import { renderFinalMarkdown } from "~/context/render.js";
import { detectProjectMemory, writeProjectMemory } from "~/memory/project.js";
import { makeMockProvider } from "../fixtures/mock-llm.js";
import { createStats } from "~/llm/stats.js";
import type { CommandContext } from "~/commands/types.js";
import type { AppConfig } from "~/util/config.js";
import { copyFixture } from "./_helpers.js";

describe("ctx understand (e2e, mock LLM)", () => {
  let root: string;
  beforeEach(() => {
    root = copyFixture("sample-laravel");
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("emits a markdown body with all 5 brief sections + footer", async () => {
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
    const result = await runUnderstand({ target: "app/Services/InvoiceService.php" }, ctx);
    expect(result.body).toContain("## Purpose");
    expect(result.body).toContain("## Dependencies");
    expect(result.body).toContain("## Data Flow");
    expect(result.body).toContain("## Risk Areas");
    expect(result.body).toContain("## Suggested Reading Order");
    expect(result.body).toContain("app/Services/InvoiceService.php");
    const rendered = renderFinalMarkdown(result.body, { report: result.report, stats: result.stats, title: result.title });
    expect(rendered).toContain("Files Scanned:");
    expect(rendered).toContain("Files Selected:");
    expect(rendered).toContain("Reduction:");
    expect(provider.callLog.length).toBeGreaterThanOrEqual(2);
  });
});
