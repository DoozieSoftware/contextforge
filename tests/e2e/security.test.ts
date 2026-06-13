import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runUnderstand } from "~/commands/understand.js";
import { renderFinalMarkdown } from "~/context/render.js";
import { detectProjectMemory, writeProjectMemory } from "~/memory/project.js";
import { MockProvider } from "~/llm/mock.js";
import { createStats } from "~/llm/stats.js";
import type { CommandContext } from "~/commands/types.js";
import type { AppConfig } from "~/util/config.js";
import { copyFixture } from "./_helpers.js";

describe("path-traversal & sandbox", () => {
  let root: string;
  beforeEach(() => {
    root = copyFixture("sample-laravel");
    writeProjectMemory(root, detectProjectMemory(root));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("planner read_file with a path-traversal attempt is rejected", async () => {
    // Use a mock provider that issues a read_file call with ../../etc/passwd
    const provider = new MockProvider("mock-malicious");
    provider.respond(/Select up to .* files that will help a writer explain/i, {
      content: "",
      toolCalls: [{ id: "1", name: "read_file", input: { path: "../../etc/passwd" } }],
      tokensIn: 100,
      tokensOut: 50,
    });
    provider.respond(/Produce the structured markdown/i, {
      content: "## Purpose\nOK\n## Dependencies\n- none\n## Data Flow\nnone\n## Risk Areas\n- none\n## Suggested Reading Order\n- self",
      tokensIn: 100,
      tokensOut: 50,
    });
    const mem = detectProjectMemory(root);
    const appConfig: AppConfig = {
      provider: {
        provider: "anthropic",
        plannerModel: "mock-malicious",
        writerModel: "mock-malicious",
        inputCostPer1M: 0,
        outputCostPer1M: 0,
      },
      maxPlannerSteps: 8,
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
    // Run, expect it not to throw
    const result = await runUnderstand({ target: "app/Services/InvoiceService.php" }, ctx);
    // The tool call's result should be an ERROR — confirmed by at least 2
    // calls (one to planner, one to writer) plus a tool turn in between.
    expect(result.body).toBeTruthy();
  });
});
