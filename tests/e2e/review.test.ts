import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { runReview } from "~/commands/review.js";
import { renderFinalMarkdown } from "~/context/render.js";
import { detectProjectMemory, writeProjectMemory } from "~/memory/project.js";
import { makeMockProvider } from "../fixtures/mock-llm.js";
import { createStats } from "~/llm/stats.js";
import type { CommandContext } from "~/commands/types.js";
import type { AppConfig } from "~/util/config.js";
import { copyFixture } from "./_helpers.js";

describe("ctx review (e2e, mock LLM)", () => {
  let root: string;
  beforeEach(async () => {
    root = copyFixture("sample-laravel");
    writeProjectMemory(root, detectProjectMemory(root));
    const git = simpleGit({ baseDir: root });
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test");
    await git.add(".");
    try {
      await git.checkoutLocalBranch("main");
    } catch {
      await git.checkout("main");
    }
    await git.commit("baseline", ["--no-verify"]);
    // introduce a dirty change that contains a Math.random() — heuristic should flag it
    const target = path.join(root, "app/Services/InvoiceService.php");
    const src2 = fs.readFileSync(target, "utf-8");
    fs.writeFileSync(
      target,
      src2.replace(
        "return intdiv($amountCents * $bps, 10_000);",
        "return intdiv($amountCents * $bps, 10_000) + (int) (Math.random() * 100);",
      ),
    );
    await git.add(".");
    await git.commit("introduce random tax", ["--no-verify"]);
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("emits Critical/High/Medium/Low and a known file name", async () => {
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
    const result = await runReview({}, ctx);
    const rendered = renderFinalMarkdown(result.body, { report: result.report, stats: result.stats, title: result.title });
    expect(rendered).toContain("## Critical");
    expect(rendered).toContain("## High");
    expect(rendered).toContain("## Medium");
    expect(rendered).toContain("## Low");
    expect(rendered).toMatch(/InvoiceService\.php/);
  });
});
