import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runUnderstand } from "~/commands/understand.js";
import { runTrace } from "~/commands/trace.js";
import { runReview } from "~/commands/review.js";
import { runBreakdown } from "~/commands/breakdown.js";
import { runProposal } from "~/commands/proposal.js";
import { renderFinalMarkdown } from "~/context/render.js";
import { detectProjectMemory, writeProjectMemory } from "~/memory/project.js";
import { MockProvider } from "~/llm/mock.js";
import { createStats } from "~/llm/stats.js";
import type { CommandContext } from "~/commands/types.js";
import type { AppConfig } from "~/util/config.js";
import { copyFixture } from "./_helpers.js";
import { simpleGit } from "simple-git";

describe("offline (--offline) e2e", () => {
  let root: string;
  beforeEach(() => {
    root = copyFixture("sample-laravel");
    writeProjectMemory(root, detectProjectMemory(root));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeCtx(): CommandContext {
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
    return {
      root,
      cwd: root,
      appConfig,
      memory: mem,
      provider: new MockProvider("offline"),
      stats: createStats(),
      offline: true,
    };
  }

  it("understand emits offline placeholder body", async () => {
    const result = await runUnderstand({ target: "app/Services/InvoiceService.php" }, makeCtx());
    const rendered = renderFinalMarkdown(result.body, { report: result.report, stats: result.stats, title: result.title });
    expect(rendered).toContain("(offline mode");
    expect(rendered).not.toContain("## LLM Stats");
  });

  it("trace emits offline placeholder body", async () => {
    const result = await runTrace({ query: "tax" }, makeCtx());
    const rendered = renderFinalMarkdown(result.body, { report: result.report, stats: result.stats, title: result.title });
    expect(rendered).toContain("offline mode");
  });

  it("review emits heuristic findings without LLM", async () => {
    // commit baseline first so the review has a diff
    const git = simpleGit({ baseDir: root });
    await git.init();
    await git.addConfig("user.email", "t@t.com");
    await git.addConfig("user.name", "T");
    await git.add(".");
    try { await git.checkoutLocalBranch("main"); } catch { await git.checkout("main"); }
    await git.commit("baseline", ["--no-verify"]);
    // introduce a console.log
    const target = path.join(root, "app/Services/InvoiceService.php");
    const src = fs.readFileSync(target, "utf-8");
    fs.writeFileSync(target, src + "\n<?php // dummy\n// console.log('debug')\n");
    await git.add(".");
    await git.commit("add console.log", ["--no-verify"]);

    const result = await runReview({}, makeCtx());
    const rendered = renderFinalMarkdown(result.body, { report: result.report, stats: result.stats, title: result.title });
    expect(rendered).toContain("## Low");
  });

  it("breakdown emits deterministic template", async () => {
    const req = path.join(root, "req.md");
    fs.writeFileSync(req, "# Req\nbody\n");
    const result = await runBreakdown({ inputFile: req }, makeCtx());
    const rendered = renderFinalMarkdown(result.body, { report: result.report, stats: result.stats, title: result.title });
    // Deterministic template: all 7 brief-defined sections present, no "(offline mode)" placeholder
    for (const h of ["## Epic", "## Features", "## Stories", "## Tasks", "## Estimates", "## Dependencies", "## Risks"]) {
      expect(rendered).toContain(h);
    }
    expect(rendered).toContain("**Offline mode**");
    expect(rendered).not.toContain("(offline mode");
  });

  it("proposal emits deterministic template", async () => {
    const req = path.join(root, "understanding.md");
    fs.writeFileSync(req, "# Understanding\nbody\n");
    const result = await runProposal({ inputFile: req }, makeCtx());
    const rendered = renderFinalMarkdown(result.body, { report: result.report, stats: result.stats, title: result.title });
    for (const h of ["## Scope", "## Assumptions", "## Modules", "## Effort", "## Risk", "## Implementation Plan"]) {
      expect(rendered).toContain(h);
    }
    expect(rendered).toContain("**Offline mode**");
    expect(rendered).not.toContain("(offline mode");
  });
});
