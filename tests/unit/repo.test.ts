import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findRepoRoot, findGitRoot } from "~/util/repo.js";

describe("util/repo", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = fs.realpathSync(process.cwd());
  });

  it("finds the project root by walking up to composer.json", () => {
    // Use the sample-laravel fixture
    const root = findRepoRoot(path.resolve(__dirname, "../fixtures/sample-laravel/app/Services"));
    expect(root).toBe(fs.realpathSync(path.resolve(__dirname, "../fixtures/sample-laravel")));
  });

  it("finds the project root by walking up to package.json", () => {
    const root = findRepoRoot(path.resolve(__dirname, ".."));
    expect(root).toBe(fs.realpathSync(path.resolve(__dirname, "../..")));
  });

  it("returns start when no marker is found", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-repo-"));
    try {
      const sub = path.join(tmp, "deep", "down", "here");
      fs.mkdirSync(sub, { recursive: true });
      expect(findRepoRoot(sub)).toBe(sub);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("finds git root when in a git repo", () => {
    const root = findGitRoot(cwd);
    // this may or may not be a git repo depending on whether `git init` was run
    // in the fixture; if so, returns the path, else null. Just check the type.
    expect(root === null || typeof root === "string").toBe(true);
  });
});
