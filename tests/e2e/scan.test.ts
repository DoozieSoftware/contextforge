import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runScan } from "~/commands/scan.js";
import { renderOutput } from "~/context/render.js";
import { detectProjectMemory, writeProjectMemory } from "~/memory/project.js";
import { createStats } from "~/llm/stats.js";
import type { CommandContext } from "~/commands/types.js";
import type { AppConfig } from "~/util/config.js";
import { copyFixture } from "./_helpers.js";

describe("ctx scan (e2e)", () => {
  let root: string;
  beforeEach(() => {
    root = copyFixture("sample-laravel");
    writeProjectMemory(root, detectProjectMemory(root));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("produces a summary listing files, symbols, edges", async () => {
    const mem = detectProjectMemory(root);
    const appConfig: AppConfig = {
      provider: {
        provider: "anthropic",
        plannerModel: "mock",
        writerModel: "mock",
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
      provider: null as any,
      stats: createStats(),
      offline: true,
    };
    const result = await runScan({ format: "markdown" }, ctx);
    const rendered = renderOutput("markdown", { title: result.title, body: result.body, report: result.report });
    expect(rendered).toContain("Scanner summary");
    expect(rendered).toContain("Files discovered:");
    expect(rendered).toContain("Edges (resolved imports):");
  });

  it("with a target, produces a ranked candidate list", async () => {
    const mem = detectProjectMemory(root);
    const appConfig: AppConfig = {
      provider: { provider: "anthropic", plannerModel: "m", writerModel: "m", inputCostPer1M: 0, outputCostPer1M: 0 },
      maxPlannerSteps: 4,
    };
    const ctx: CommandContext = {
      root, cwd: root, appConfig, memory: mem, provider: null as any, stats: createStats(), offline: true,
    };
    const result = await runScan({ target: "app/Services/InvoiceService.php", format: "markdown", max: 10 }, ctx);
    const rendered = renderOutput("markdown", { title: result.title, body: result.body, report: result.report });
    expect(rendered).toContain("Top candidates for");
    expect(rendered).toMatch(/InvoiceService\.php/);
  });
});
