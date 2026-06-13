import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "~/git/diff.js";

describe("parseUnifiedDiff", () => {
  it("extracts added line numbers and text per file", () => {
    const patch = `diff --git a/foo.ts b/foo.ts
index 1234567..abcdef0 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
 line1
+added line
 line2
+another added
 line3
diff --git a/bar.ts b/bar.ts
--- a/bar.ts
+++ b/bar.ts
@@ -10,2 +10,3 @@
 unchanged
+new here
 also unchanged
`;
    const out = parseUnifiedDiff(patch);
    expect(out.size).toBe(2);
    const foo = out.get("foo.ts");
    expect(foo).toBeDefined();
    expect(foo!.addedLines).toEqual([2, 4]);
    expect(foo!.addedText).toContain("added line");
    expect(foo!.addedText).toContain("another added");
    const bar = out.get("bar.ts");
    expect(bar!.addedLines).toEqual([11]);
    expect(bar!.addedText).toContain("new here");
  });
});
