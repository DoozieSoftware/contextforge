import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runUnderstand } from "../../src/commands/understand.js";
import { renderOutput } from "../../src/context/render.js";
import { detectProjectMemory, writeProjectMemory } from "../../src/memory/project.js";
import { MockProvider } from "../../src/llm/mock.js";
import { createStats } from "../../src/llm/stats.js";
import type { CommandContext } from "../../src/commands/types.js";
import type { AppConfig } from "../../src/util/config.js";
import { copyFixture } from "./_helpers.js";
import { runScan } from "../../src/commands/scan.js";

describe("ctx package raw content", () => {
  let root: string;
  beforeEach(() => {
    root = copyFixture("sample-node");
    writeProjectMemory(root, detectProjectMemory(root));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function makeCtx(): CommandContext {
    const mem = detectProjectMemory(root);
    const appConfig: AppConfig = {
      provider: { provider: "anthropic", plannerModel: "mock", writerModel: "mock", inputCostPer1M: 0, outputCostPer1M: 0 },
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

  it("understand's --format context emits actual file contents (not just metadata)", async () => {
    const result = await runUnderstand({ target: "src/services/billing.ts" }, makeCtx());
    expect(result.contextPackageMd).toBeDefined();
    expect(result.contextPackageMd!).toContain("CONTEXT PACKAGE");
    // The actual file body should be present, with line numbers
    expect(result.contextPackageMd!).toContain("createInvoice");
    expect(result.contextPackageMd!).toMatch(/^\d+ │ /m);
    // And the renderer should surface it (not just metadata)
    const out = renderOutput("context", {
      title: result.title,
      body: result.body,
      report: result.report,
      packageFiles: result.packageFiles,
      contextPackageMd: result.contextPackageMd,
      target: result.target,
    });
    expect(out).toContain("createInvoice");
  });
});

describe("ctx scan cached count", () => {
  let root: string;
  beforeEach(() => {
    root = copyFixture("sample-node");
    writeProjectMemory(root, detectProjectMemory(root));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function makeCtx(): CommandContext {
    const mem = detectProjectMemory(root);
    const appConfig: AppConfig = {
      provider: { provider: "anthropic", plannerModel: "mock", writerModel: "mock", inputCostPer1M: 0, outputCostPer1M: 0 },
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

  it("scan summary reports correct Files discovered when served from cache", async () => {
    // First scan populates the cache
    const r1 = await runScan({ format: "markdown", max: 15 }, makeCtx());
    // Second scan should hit the mtime cache
    const r2 = await runScan({ format: "markdown", max: 15 }, makeCtx());
    expect(r2.body).toMatch(/Files discovered: [1-9]/);
    // Also report's filesScanned should be > 0 in cached mode
    expect(r2.report.filesScanned).toBeGreaterThan(0);
  });
});

describe("ctx trace --format context emits raw file contents", () => {
  let root: string;
  beforeEach(() => {
    root = copyFixture("sample-node");
    writeProjectMemory(root, detectProjectMemory(root));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function makeCtx(): CommandContext {
    const mem = detectProjectMemory(root);
    const appConfig: AppConfig = {
      provider: { provider: "anthropic", plannerModel: "mock", writerModel: "mock", inputCostPer1M: 0, outputCostPer1M: 0 },
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

  it("trace populates contextPackageMd with raw file contents", async () => {
    const { runTrace } = await import("../../src/commands/trace.js");
    const result = await runTrace({ query: "billing" }, makeCtx());
    expect(result.contextPackageMd).toBeDefined();
    expect(result.contextPackageMd!).toContain("CONTEXT PACKAGE");
    // Should include the actual function body from billing.ts
    expect(result.contextPackageMd!).toContain("createInvoice");
    // And when rendered in context format, the raw content should appear
    const out = renderOutput("context", {
      title: result.title,
      body: result.body,
      report: result.report,
      packageFiles: result.packageFiles,
      contextPackageMd: result.contextPackageMd,
      query: result.query,
    });
    expect(out).toContain("createInvoice");
  });
});
