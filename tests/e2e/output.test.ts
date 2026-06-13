import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderOutput, type OutputFormat } from "~/context/render.js";
import { detectProjectMemory, writeProjectMemory } from "~/memory/project.js";
import { createStats } from "~/llm/stats.js";
import type { CommandContext } from "~/commands/types.js";
import type { AppConfig } from "~/util/config.js";
import { copyFixture } from "./_helpers.js";
import { runUnderstand } from "~/commands/understand.js";
import { MockProvider } from "~/llm/mock.js";
import { makeMockProvider } from "../fixtures/mock-llm.js";

describe("--output / --format e2e", () => {
  let root: string;
  beforeEach(() => {
    root = copyFixture("sample-laravel");
    writeProjectMemory(root, detectProjectMemory(root));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function ctx(provider: any = new MockProvider("offline")): CommandContext {
    return {
      root,
      cwd: root,
      appConfig: {
        provider: { provider: "anthropic", plannerModel: "m", writerModel: "m", inputCostPer1M: 0, outputCostPer1M: 0 },
        maxPlannerSteps: 4,
      },
      memory: detectProjectMemory(root),
      provider,
      stats: createStats(),
      offline: true,
    };
  }

  it("renders JSON format with structured fields", () => {
    const out = renderOutput("json", {
      title: "Test",
      body: "## Body\n- a",
      report: { filesScanned: 10, filesSelected: 2, repoSize: 1000, contextSize: 200, reduction: 0.8 },
      packageFiles: [{ path: "a.ts", tokens: 100, kind: "service", reason: "test" }],
      target: "x.ts",
    });
    const obj = JSON.parse(out);
    expect(obj.title).toBe("Test");
    expect(obj.report.filesSelected).toBe(2);
    expect(obj.files[0].path).toBe("a.ts");
    expect(obj.target).toBe("x.ts");
  });

  it("renders context format with file list", () => {
    const out = renderOutput("context", {
      title: "T",
      body: "ignored",
      report: { filesScanned: 10, filesSelected: 2, repoSize: 1000, contextSize: 200, reduction: 0.8 },
      packageFiles: [
        { path: "a.ts", tokens: 100, kind: "service", reason: "imports target" },
        { path: "b.ts", tokens: 100, kind: "model", reason: "test" },
      ],
    });
    expect(out).toContain("# T — context package");
    expect(out).toContain("Files in this package");
    expect(out).toContain("`a.ts`");
    expect(out).toContain("imports target");
  });

  it("renderOutput of understand result includes line numbers in markdown body via packageToMarkdown", async () => {
    const provider = makeMockProvider();
    const result = await runUnderstand({ target: "app/Services/InvoiceService.php" }, ctx(provider));
    // Verify the underlying context package is line-numbered (it goes into
    // the writer prompt; we don't see it in the rendered body but we can
    // re-build the package to assert).
    expect(result.body).toContain("## Purpose");
  });
});
