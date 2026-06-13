import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanRepo, ScannerEmptyError } from "../../src/scanner/index.js";
import { writeProjectMemory, type ProjectMemory } from "../../src/memory/project.js";

function makeProjectMemory(root: string): ProjectMemory {
  const mem: ProjectMemory = {
    root: path.basename(root),
    detectedAt: new Date().toISOString(),
    languages: ["javascript"],
    framework: null,
    packageManager: null,
    testFrameworks: [],
    orm: null,
    entrypoints: [],
    ignoreGlobs: ["node_modules", "dist", ".git", ".contextforge"],
    includeGlobs: ["**/*"],
    testGlobs: ["**/*.test.*"],
    routeGlobs: [],
    notes: [],
    pathAliases: {},
  };
  writeProjectMemory(root, mem);
  return mem;
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-scan-"));
  // create a sample source file
  fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "src/a.ts"), "export const a = 1;\n");
  makeProjectMemory(tmp);
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("scanRepo", () => {
  it("returns a non-cached result on first run", async () => {
    const r = await scanRepo(tmp);
    expect(r.cached).toBeFalsy();
    expect(r.totalFiles).toBeGreaterThan(0);
  });

  it("serves a cached result on second run when mtimes are unchanged", async () => {
    await scanRepo(tmp);
    const r2 = await scanRepo(tmp);
    expect(r2.cached).toBe(true);
    expect(r2.totalFiles).toBeGreaterThan(0);
  });

  it("re-scans when a file is modified", async () => {
    await scanRepo(tmp);
    // touch the file with a newer mtime
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(tmp, "src/a.ts"), future, future);
    const r = await scanRepo(tmp);
    expect(r.cached).toBeFalsy();
  });

  it("throws ScannerEmptyError when no scannable files exist", async () => {
    // Replace src/a.ts content with an unsupported extension
    fs.rmSync(path.join(tmp, "src/a.ts"));
    fs.writeFileSync(path.join(tmp, "src/a.txt"), "hello");
    let caught: unknown = null;
    try {
      await scanRepo(tmp);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ScannerEmptyError);
  });

  it("respects opts.full to force rescan", async () => {
    await scanRepo(tmp);
    const r = await scanRepo(tmp, { full: true });
    expect(r.cached).toBeFalsy();
  });
});
