import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runMemory } from "~/commands/memory.js";
import { renderOutput } from "~/context/render.js";
import { detectProjectMemory, writeProjectMemory } from "~/memory/project.js";
import { createStats } from "~/llm/stats.js";
import type { CommandContext } from "~/commands/types.js";
import type { AppConfig } from "~/util/config.js";
import { copyFixture } from "./_helpers.js";

describe("ctx memory (e2e)", () => {
  let root: string;
  beforeEach(() => {
    root = copyFixture("sample-laravel");
    writeProjectMemory(root, detectProjectMemory(root));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("show renders ignore globs, test patterns, route patterns, and path aliases", async () => {
    const mem = detectProjectMemory(root);
    const appConfig: AppConfig = {
      provider: { provider: "anthropic", plannerModel: "m", writerModel: "m", inputCostPer1M: 0, outputCostPer1M: 0 },
      maxPlannerSteps: 4,
    };
    const ctx: CommandContext = {
      root, cwd: root, appConfig, memory: mem, provider: null as any, stats: createStats(), offline: true,
    };
    const result = await runMemory({ action: "show", format: "markdown" }, ctx);
    const rendered = renderOutput("markdown", { title: result.title, body: result.body, report: result.report });
    expect(rendered).toContain("Ignore globs");
    expect(rendered).toContain("vendor/**");
    expect(rendered).toContain("Path aliases");
  });

  it("add-ignore persists the new glob", async () => {
    const mem = detectProjectMemory(root);
    const appConfig: AppConfig = {
      provider: { provider: "anthropic", plannerModel: "m", writerModel: "m", inputCostPer1M: 0, outputCostPer1M: 0 },
      maxPlannerSteps: 4,
    };
    const ctx: CommandContext = {
      root, cwd: root, appConfig, memory: mem, provider: null as any, stats: createStats(), offline: true,
    };
    await runMemory({ action: "add-ignore", format: "markdown", value: "tmp/**" }, ctx);
    const after = JSON.parse(fs.readFileSync(path.join(root, ".contextforge/project.json"), "utf-8"));
    expect(after.ignoreGlobs).toContain("tmp/**");
  });

  it("add-alias persists ALIAS=PATH", async () => {
    const mem = detectProjectMemory(root);
    const appConfig: AppConfig = {
      provider: { provider: "anthropic", plannerModel: "m", writerModel: "m", inputCostPer1M: 0, outputCostPer1M: 0 },
      maxPlannerSteps: 4,
    };
    const ctx: CommandContext = {
      root, cwd: root, appConfig, memory: mem, provider: null as any, stats: createStats(), offline: true,
    };
    await runMemory({ action: "add-alias", format: "markdown", value: "App\\=app" }, ctx);
    const after = JSON.parse(fs.readFileSync(path.join(root, ".contextforge/project.json"), "utf-8"));
    expect(after.pathAliases["App\\"]).toBe("app");
  });
});
