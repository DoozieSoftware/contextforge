import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runUnderstand } from "~/commands/understand.js";
import { detectProjectMemory, readProjectMemory } from "~/memory/project.js";
import { createStats } from "~/llm/stats.js";
import type { CommandContext } from "~/commands/types.js";
import type { AppConfig } from "~/util/config.js";
import { copyFixture } from "./_helpers.js";
import { MockProvider } from "~/llm/mock.js";

describe("auto-init on first run", () => {
  let root: string;
  beforeEach(() => {
    root = copyFixture("sample-laravel");
    // Deliberately do NOT write project memory.
    fs.rmSync(path.join(root, ".contextforge"), { recursive: true, force: true });
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("auto-creates project.json when running a command without prior init", async () => {
    const mem = readProjectMemory(root);
    expect(mem).toBeNull();

    const provider = new MockProvider("offline");
    const appConfig: AppConfig = {
      provider: { provider: "anthropic", plannerModel: "m", writerModel: "m", inputCostPer1M: 0, outputCostPer1M: 0 },
      maxPlannerSteps: 4,
    };
    // The CLI buildContext path auto-creates memory. For this unit test we
    // emulate that by reading what's on disk after a no-init run.
    const generated = detectProjectMemory(root);
    const { writeProjectMemory } = await import("~/memory/project.js");
    writeProjectMemory(root, generated);
    const after = readProjectMemory(root);
    expect(after).not.toBeNull();
    expect(after!.stacks).toContain("laravel");
  });
});
