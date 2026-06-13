import { describe, it, expect } from "vitest";
import { validateOutput, validatePlannerOutput } from "~/llm/validate.js";

describe("validate", () => {
  it("passes a well-formed understand body", () => {
    const v = validateOutput("understand", "## Purpose\nfoo\n## Dependencies\nbar\n## Data Flow\nx\n## Risk Areas\ny\n## Suggested Reading Order\nz");
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
  });

  it("fails when a section is missing", () => {
    const v = validateOutput("understand", "## Purpose\nfoo");
    expect(v.ok).toBe(false);
    expect(v.missing.length).toBeGreaterThan(0);
  });

  it("fails when the planner returns a non-JSON blob", () => {
    const v = validatePlannerOutput("I think these files matter: a, b, c", "/tmp");
    expect(v.ok).toBe(false);
  });

  it("fails when selectedFiles is empty", () => {
    const v = validatePlannerOutput(`{"selectedFiles": [], "planNotes": ""}`, "/tmp");
    expect(v.ok).toBe(false);
  });

  it("rejects path-traversal in selectedFiles", () => {
    const v = validatePlannerOutput(`{"selectedFiles": ["../../etc/passwd", "a/b.ts"]}`, "/tmp");
    expect(v.ok).toBe(true);
    expect(v.selectedFiles).toEqual(["a/b.ts"]);
  });

  it("dedupes repeated entries", () => {
    const v = validatePlannerOutput(`{"selectedFiles": ["a.ts", "a.ts", "b.ts"]}`, "/tmp");
    expect(v.selectedFiles).toEqual(["a.ts", "b.ts"]);
  });

  it("parses a code-fenced JSON object", () => {
    const v = validatePlannerOutput('```json\n{"selectedFiles": ["a.ts"], "planNotes": "x"}\n```', "/tmp");
    expect(v.ok).toBe(true);
    expect(v.selectedFiles).toEqual(["a.ts"]);
  });

  it("passes a well-formed trace body", () => {
    const v = validateOutput("trace", "## Probable Root Causes\nx\n## Affected Files\ny\n## Confidence Level\nz\n## Suggested Fixes\na\n## Regression Tests\nb");
    expect(v.ok).toBe(true);
  });

  it("passes a well-formed review body", () => {
    const v = validateOutput("review", "## Critical\nx\n## High\ny\n## Medium\nz\n## Low\na");
    expect(v.ok).toBe(true);
  });

  it("passes a well-formed breakdown body (all 7 sections)", () => {
    const v = validateOutput(
      "breakdown",
      "## Epic\nx\n## Features\ny\n## Stories\nz\n## Tasks\na\n## Estimates\nb\n## Dependencies\nc\n## Risks\nd",
    );
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
  });

  it("fails breakdown when Estimates / Dependencies / Risks are missing", () => {
    const v = validateOutput("breakdown", "## Epic\nx\n## Features\ny\n## Stories\nz\n## Tasks\na");
    expect(v.ok).toBe(false);
    // Should be missing the three extra sections
    expect(v.missing.length).toBe(3);
  });

  it("passes a well-formed proposal body (all 6 sections)", () => {
    const v = validateOutput(
      "proposal",
      "## Scope\nx\n## Assumptions\ny\n## Modules\nz\n## Effort\na\n## Risk\nb\n## Implementation Plan\nc",
    );
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
  });

  it("fails proposal when Assumptions / Risk are missing", () => {
    const v = validateOutput("proposal", "## Scope\nx\n## Modules\ny\n## Effort\nz\n## Implementation Plan\na");
    expect(v.ok).toBe(false);
    expect(v.missing.length).toBe(2);
  });
});
