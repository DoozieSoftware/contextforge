import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runScan } from "~/commands/scan.js";
import { detectProjectMemory, writeProjectMemory } from "~/memory/project.js";
import { createStats } from "~/llm/stats.js";
import type { CommandContext } from "~/commands/types.js";
import type { AppConfig } from "~/util/config.js";

describe("path alias resolution (e2e)", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-alias-"));
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@/components/*": ["src/components/*"],
            "@/lib/*": ["src/lib/*"],
          },
        },
      }),
    );
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "alias-test" }));
    fs.mkdirSync(path.join(root, "src/components"), { recursive: true });
    fs.mkdirSync(path.join(root, "src/lib"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/components/Foo.tsx"), "export const Foo = 1;\n");
    fs.writeFileSync(path.join(root, "src/lib/db.ts"), "export const db = 1;\n");
    fs.writeFileSync(
      path.join(root, "src/index.ts"),
      "import { Foo } from \"@/components/Foo\";\nimport { db } from \"@/lib/db\";\n",
    );
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("detects path aliases from tsconfig.json and resolves imports", async () => {
    writeProjectMemory(root, detectProjectMemory(root));
    const mem = detectProjectMemory(root);
    // After detection, the @ → . alias should be in there.
    expect(mem.pathAliases["@"]).toBeDefined();
    // The detector strips the trailing "*" and the corresponding target's "*",
    // so the alias key keeps the trailing slash and the target keeps its
    // trailing slash as well.
    expect(mem.pathAliases["@/components/"]).toBe("src/components/");
    expect(mem.pathAliases["@/lib/"]).toBe("src/lib/");

    // Now run scan to populate the graph, and check that scan can rank
    // candidates for the import.
    const appConfig: AppConfig = {
      provider: { provider: "anthropic", plannerModel: "m", writerModel: "m", inputCostPer1M: 0, outputCostPer1M: 0 },
      maxPlannerSteps: 4,
    };
    const ctx: CommandContext = {
      root, cwd: root, appConfig, memory: mem, provider: null as any, stats: createStats(), offline: true,
    };
    const result = await runScan({ target: "src/index.ts", format: "markdown", max: 10 }, ctx);
    expect(result.body).toContain("src/index.ts");
    // The body should reference at least one of the resolved paths
    expect(result.body).toMatch(/src\/(components|lib)\//);
  });
});
