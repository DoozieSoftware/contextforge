import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectProjectMemory, writeProjectMemory } from "~/memory/project.js";
import { buildHeuristics, globMatch } from "~/scanner/heuristics.js";

describe("heuristics", () => {
  it("globMatch handles ** and *", () => {
    expect(globMatch("**/*.ts", "src/foo/bar.ts")).toBe(true);
    expect(globMatch("**/*.ts", "a.ts")).toBe(true);
    expect(globMatch("**/*.ts", "deep/nested/dir/a.ts")).toBe(true);
    expect(globMatch("vendor/**", "vendor/foo/bar.php")).toBe(true);
    expect(globMatch("vendor/**", "app/foo.ts")).toBe(false);
    expect(globMatch("**/test_*.py", "tests/test_foo.py")).toBe(true);
    expect(globMatch("*.ts", "a.ts")).toBe(true);
    expect(globMatch("*.ts", "dir/a.ts")).toBe(false);
    expect(globMatch("a/*.ts", "a/x.ts")).toBe(true);
    expect(globMatch("a/*.ts", "b/x.ts")).toBe(false);
    expect(globMatch("a/**/b", "a/b")).toBe(true);
    expect(globMatch("a/**/b", "a/x/y/b")).toBe(true);
    expect(globMatch("?ingle.ts", "single.ts")).toBe(true);
    expect(globMatch("?ingle.ts", "ingle.ts")).toBe(false);
  });

  describe("with Laravel project memory", () => {
    let root: string;
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-heu-"));
      fs.writeFileSync(
        path.join(root, "composer.json"),
        JSON.stringify({ require: { "laravel/framework": "^10.0" } }),
      );
      writeProjectMemory(root, detectProjectMemory(root));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it("suppresses vendor/ and includes tests/Feature/", () => {
      const mem = detectProjectMemory(root);
      const h = buildHeuristics(mem);
      expect(h.include("vendor/foo/bar.php")).toBe(false);
      expect(h.include("app/Models/Invoice.php")).toBe(true);
      expect(h.isTest("tests/Feature/InvoiceServiceTest.php")).toBe(true);
      expect(h.isRoute("routes/web.php")).toBe(true);
      expect(h.classify("app/Http/Controllers/FooController.php")).toBe("controller");
    });
  });
});
