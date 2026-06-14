import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";

const CLI = path.resolve(__dirname, "../../dist/cli.js");
const FIXTURE = path.resolve(__dirname, "../fixtures/sample-laravel/app/Services/InvoiceService.php");

function run(args: string): string {
  return execSync(`node ${CLI} ${args}`, {
    cwd: path.resolve(__dirname, "../fixtures/sample-laravel"),
    encoding: "utf-8",
  });
}

describe("ctx prompt (no LLM, paste-ready)", () => {
  it("emits a title, task, deliverable, and context package for find-bug", () => {
    const out = run(`prompt find-bug ${FIXTURE}`);
    expect(out).toMatch(/^# Find bugs in this code/);
    expect(out).toMatch(/^## Task/m);
    expect(out).toMatch(/^## Deliverable/m);
    expect(out).toMatch(/^## Context Package/m);
    expect(out).toMatch(/^# CONTEXT PACKAGE/m);
    expect(out).toMatch(/InvoiceService\.php/);
  });

  it("honors --query for trace", () => {
    const out = run(`prompt trace ${FIXTURE} --query "tax mismatch"`);
    expect(out).toMatch(/^# Trace this query/);
    expect(out).toMatch(/\*\*Query:\*\* tax mismatch/);
  });

  it("lists all seven prompt kinds in --help", () => {
    const out = run("--help");
    expect(out).toMatch(/understand/);
    expect(out).toMatch(/trace/);
    expect(out).toMatch(/review/);
    expect(out).toMatch(/breakdown/);
    expect(out).toMatch(/proposal/);
    expect(out).toMatch(/explain/);
    expect(out).toMatch(/find-bug/);
  });

  it("rejects unknown prompt kinds with a clear error", () => {
    let stderr = "";
    try {
      execSync(`node ${CLI} prompt not-a-real-kind ${FIXTURE}`, {
        cwd: path.resolve(__dirname, "../fixtures/sample-laravel"),
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: any) {
      stderr = err.stderr ?? "";
    }
    expect(stderr).toMatch(/unknown prompt kind/i);
    expect(stderr).toMatch(/Available:/);
  });
});
