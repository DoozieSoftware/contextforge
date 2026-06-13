import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runProposal } from "~/commands/proposal.js";
import { renderFinalMarkdown } from "~/context/render.js";
import { detectProjectMemory, writeProjectMemory } from "~/memory/project.js";
import { makeMockProvider } from "../fixtures/mock-llm.js";
import { createStats } from "~/llm/stats.js";
import type { CommandContext } from "~/commands/types.js";
import type { AppConfig } from "~/util/config.js";
import { copyFixture } from "./_helpers.js";

describe("ctx proposal (e2e, mock LLM)", () => {
  let root: string;
  let input: string;
  beforeEach(() => {
    root = copyFixture("sample-laravel");
    input = path.join(os.tmpdir(), `prop-${Date.now()}-${Math.random()}.md`);
    fs.writeFileSync(
      input,
      `# Understanding: per-region tax\n\nWe need a new data store for tax rates and a refactor of the calculator.\n`,
    );
  });
  afterEach(() => {
    fs.rmSync(input, { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("emits Scope, Modules, Effort, Implementation Plan sections", async () => {
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
    const result = await runProposal({ inputFile: input }, ctx);
    expect(result.body).toContain("## Scope");
    expect(result.body).toContain("## Modules");
    expect(result.body).toContain("## Effort");
    expect(result.body).toContain("## Implementation Plan");
    const rendered = renderFinalMarkdown(result.body, { report: result.report, stats: result.stats, title: result.title });
    expect(rendered).toContain("LLM Stats");
  });
});
