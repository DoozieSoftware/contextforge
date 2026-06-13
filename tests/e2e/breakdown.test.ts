import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runBreakdown } from "~/commands/breakdown.js";
import { renderFinalMarkdown } from "~/context/render.js";
import { detectProjectMemory, writeProjectMemory } from "~/memory/project.js";
import { makeMockProvider } from "../fixtures/mock-llm.js";
import { createStats } from "~/llm/stats.js";
import type { CommandContext } from "~/commands/types.js";
import type { AppConfig } from "~/util/config.js";
import { copyFixture } from "./_helpers.js";

describe("ctx breakdown (e2e, mock LLM)", () => {
  let root: string;
  let req: string;
  beforeEach(() => {
    root = copyFixture("sample-laravel");
    req = path.join(os.tmpdir(), `req-${Date.now()}-${Math.random()}.md`);
    fs.writeFileSync(
      req,
      `# Add per-region tax support\n\nWe need to be able to add a new tax region without redeploying.\n`,
    );
  });
  afterEach(() => {
    fs.rmSync(req, { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("emits Epic, Features, Stories, Tasks sections", async () => {
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
    const result = await runBreakdown({ inputFile: req }, ctx);
    expect(result.body).toContain("## Epic");
    expect(result.body).toContain("## Features");
    expect(result.body).toContain("## Stories");
    expect(result.body).toContain("## Tasks");
    const rendered = renderFinalMarkdown(result.body, { report: result.report, stats: result.stats, title: result.title });
    expect(rendered).toContain("LLM Stats");
  });
});
