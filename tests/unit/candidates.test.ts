import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepo, openGraph, rankCandidates, buildHeuristics } from "~/scanner/index.js";
import { detectProjectMemory, writeProjectMemory } from "~/memory/project.js";

describe("candidates BFS", () => {
  let root: string;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-cand-"));
    // minimal Laravel-ish layout
    fs.writeFileSync(
      path.join(root, "composer.json"),
      JSON.stringify({ require: { "laravel/framework": "^10.0" } }),
    );
    fs.mkdirSync(path.join(root, "app/Models"), { recursive: true });
    fs.mkdirSync(path.join(root, "app/Services"), { recursive: true });
    fs.mkdirSync(path.join(root, "app/Http/Controllers"), { recursive: true });
    fs.writeFileSync(path.join(root, "app/Models/Invoice.php"), "<?php\nnamespace App\\Models;\nuse App\\Services\\InvoiceService;\nclass Invoice {}\n");
    fs.writeFileSync(path.join(root, "app/Services/InvoiceService.php"), "<?php\nnamespace App\\Services;\nuse App\\Models\\Invoice;\nclass InvoiceService {}\n");
    fs.writeFileSync(path.join(root, "app/Http/Controllers/InvoiceController.php"), "<?php\nnamespace App\\Http\\Controllers;\nuse App\\Services\\InvoiceService;\nclass InvoiceController {}\n");
    writeProjectMemory(root, detectProjectMemory(root));
    await scanRepo(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("ranks BFS results by depth and includes the target", async () => {
    const db = openGraph(root);
    try {
      const cands = rankCandidates("app/Models/Invoice.php", db, buildHeuristics(detectProjectMemory(root)), {
        depth: 2,
        max: 10,
      });
      expect(cands.length).toBeGreaterThan(0);
      const paths = cands.map((c) => c.path);
      expect(paths).toContain("app/Models/Invoice.php");
      expect(paths).toContain("app/Services/InvoiceService.php");
    } finally {
      db.close();
    }
  });

  it("respects depth limit", () => {
    const db = openGraph(root);
    try {
      const cands = rankCandidates("app/Models/Invoice.php", db, buildHeuristics(detectProjectMemory(root)), {
        depth: 0,
        max: 10,
      });
      // With depth 0 only the target should appear
      expect(cands.length).toBe(1);
      expect(cands[0]?.path).toBe("app/Models/Invoice.php");
    } finally {
      db.close();
    }
  });
});
