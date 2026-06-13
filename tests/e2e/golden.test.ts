import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runScan } from "~/commands/scan.js";
import { runUnderstand } from "~/commands/understand.js";
import { renderFinalMarkdown, renderOutput } from "~/context/render.js";
import { detectProjectMemory, writeProjectMemory } from "~/memory/project.js";
import { MockProvider } from "~/llm/mock.js";
import { createStats } from "~/llm/stats.js";
import type { CommandContext } from "~/commands/types.js";
import type { AppConfig } from "~/util/config.js";
import { copyFixture } from "./_helpers.js";

const GOLDEN_DIR = path.resolve(__dirname, "./golden");

function makeCtx(root: string, offline: boolean): CommandContext {
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
    provider: offline ? new MockProvider("offline") : new MockProvider("test"),
    stats: createStats(),
    offline,
  };
}

/**
 * Golden-file snapshots. The output of an offline `scan` depends only on
 * the input fixture, so we can pin it and catch regressions. To update a
 * snapshot, delete the golden file and re-run the test.
 */
describe("golden output snapshots", () => {
  let root: string;
  beforeEach(() => {
    root = copyFixture("sample-node");
    writeProjectMemory(root, detectProjectMemory(root));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function checkGolden(name: string, rendered: string) {
    const goldenPath = path.join(GOLDEN_DIR, `${name}.md`);
    if (!fs.existsSync(goldenPath)) {
      fs.mkdirSync(GOLDEN_DIR, { recursive: true });
      fs.writeFileSync(goldenPath, rendered, "utf-8");
      // First run: just record the golden and pass. The developer can
      // review the generated file and commit it.
      return;
    }
    const expected = fs.readFileSync(goldenPath, "utf-8");
    expect(rendered).toBe(expected);
  }

  it("scan offline matches golden", async () => {
    const result = await runScan({ format: "markdown", max: 15 }, makeCtx(root, true));
    const out = renderOutput("markdown", {
      title: result.title,
      body: result.body,
      report: result.report,
      packageFiles: result.packageFiles,
    });
    checkGolden("scan-offline-sample-node", out);
  });

  it("scan (with target) offline matches golden", async () => {
    const result = await runScan(
      { target: "src/services/billing.ts", format: "markdown", max: 5 },
      makeCtx(root, true),
    );
    const out = renderOutput("markdown", {
      title: result.title,
      body: result.body,
      report: result.report,
      packageFiles: result.packageFiles,
      target: result.target,
    });
    checkGolden("scan-with-target-offline-sample-node", out);
  });

  it("understand offline body is deterministic", async () => {
    // The offline understand body lists the ranked files, which depends
    // on the fixture. We snapshot the structure (section headers and
    // file count) rather than the literal text to avoid brittleness.
    const result = await runUnderstand(
      { target: "src/services/billing.ts" },
      makeCtx(root, true),
    );
    const rendered = renderFinalMarkdown(result.body, {
      report: result.report,
      stats: result.stats,
      title: result.title,
    });
    expect(rendered).toMatch(/^# /m);
    expect(rendered).toMatch(/^## /m);
    // The offline body should NOT include the LLM stats block
    expect(rendered).not.toContain("## LLM Stats");
    // And it SHOULD include the budget footer
    expect(rendered).toMatch(/Files Scanned:/);
    expect(rendered).toMatch(/Context Size:/);
  });
});

/**
 * The pure context-package render is the most stable golden target: it
 * is fully deterministic, no LLM, no stats. This is the user-facing
 * promise: "give me the smallest high-signal code context".
 */
describe("context package goldens", () => {
  let root: string;
  beforeEach(() => {
    root = copyFixture("sample-node");
    writeProjectMemory(root, detectProjectMemory(root));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function checkGolden(name: string, rendered: string) {
    const goldenPath = path.join(GOLDEN_DIR, `${name}.md`);
    if (!fs.existsSync(goldenPath)) {
      fs.mkdirSync(GOLDEN_DIR, { recursive: true });
      fs.writeFileSync(goldenPath, rendered, "utf-8");
      return;
    }
    const expected = fs.readFileSync(goldenPath, "utf-8");
    expect(rendered).toBe(expected);
  }

  it("understand context-format output matches golden", async () => {
    const result = await runUnderstand(
      { target: "src/services/billing.ts" },
      makeCtx(root, true),
    );
    const out = renderOutput("context", {
      title: result.title,
      body: result.body,
      report: result.report,
      packageFiles: result.packageFiles,
      contextPackageMd: result.contextPackageMd,
      target: result.target,
    });
    checkGolden("understand-context-sample-node", out);
  });
});
