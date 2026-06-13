import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRepoDiff } from "~/git/diff.js";
import { simpleGit } from "simple-git";

describe("git/diff default base", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-git-"));
    const git = simpleGit({ baseDir: cwd });
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test");
    fs.writeFileSync(path.join(cwd, "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(cwd, "b.ts"), "export const b = 2;\n");
    await git.add(".");
    // initial commit on main
    try {
      await git.checkoutLocalBranch("main");
    } catch {
      await git.checkout("main");
    }
    await git.commit("initial", ["--no-verify"]);
    // create a feature branch with the next change
    await git.checkoutLocalBranch("feature");
    fs.writeFileSync(path.join(cwd, "a.ts"), "export const a = 1;\nexport const aNew = 2;\n");
    fs.writeFileSync(path.join(cwd, "c.ts"), "export const c = 3;\n");
    await git.add(".");
    await git.commit("second", ["--no-verify"]);
  });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it("defaults to main...HEAD on a feature branch", async () => {
    const r = await getRepoDiff({ cwd });
    expect(r.base).toBe("main");
    expect(r.head).toBe("HEAD");
    expect(r.files).toContain("a.ts");
    expect(r.files).toContain("c.ts");
    expect(r.patch).toMatch(/aNew/);
  });

  it("honors --range override (HEAD~1..HEAD)", async () => {
    const r = await getRepoDiff({ cwd, range: "HEAD~1..HEAD" });
    expect(r.files.length).toBeGreaterThan(0);
  });
});
