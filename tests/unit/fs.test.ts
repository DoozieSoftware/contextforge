import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeResolve, readFileSafe, listDirSafe, ensureDir, fileExists, dirExists } from "~/util/fs.js";

describe("util/fs sandbox", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-fs-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("resolves paths inside the root", () => {
    expect(safeResolve(root, "foo/bar.ts")).toBe(path.join(root, "foo/bar.ts"));
  });

  it("rejects path-traversal attempts", () => {
    expect(() => safeResolve(root, "../../etc/passwd")).toThrow(/escapes sandbox/);
  });

  it("reads a file safely and truncates huge content", () => {
    const f = path.join(root, "big.txt");
    fs.writeFileSync(f, "x".repeat(3_000_000), "utf-8");
    const out = readFileSafe(f, 1000);
    expect(out.length).toBeLessThan(2000);
    expect(out).toContain("truncated");
  });

  it("lists directory contents", () => {
    fs.writeFileSync(path.join(root, "a.ts"), "x");
    fs.mkdirSync(path.join(root, "sub"));
    fs.writeFileSync(path.join(root, "sub", "b.ts"), "y");
    expect(listDirSafe(root)).toEqual(expect.arrayContaining(["a.ts", "sub/"]));
  });

  it("detects file and directory existence", () => {
    fs.writeFileSync(path.join(root, "exists.ts"), "x");
    fs.mkdirSync(path.join(root, "dir"));
    expect(fileExists(path.join(root, "exists.ts"))).toBe(true);
    expect(dirExists(path.join(root, "dir"))).toBe(true);
    expect(fileExists(path.join(root, "missing.ts"))).toBe(false);
  });

  it("ensureDir creates nested directories", () => {
    const p = path.join(root, "a", "b", "c");
    ensureDir(p);
    expect(fs.existsSync(p)).toBe(true);
  });
});
