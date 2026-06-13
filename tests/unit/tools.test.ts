import { describe, it, expect } from "vitest";
import { executeTool, plannerTools } from "~/llm/tools.js";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../fixtures/sample-laravel");

describe("llm/tools sandbox", () => {
  it("exposes read_file and list_dir tool specs", () => {
    const specs = plannerTools();
    expect(specs.map((s) => s.name).sort()).toEqual(["list_dir", "read_file"]);
    for (const s of specs) {
      expect(s.description).toBeTruthy();
      expect(s.input_schema.type).toBe("object");
    }
  });

  it("rejects path traversal in read_file", () => {
    const r = executeTool({ id: "1", name: "read_file", input: { path: "../../etc/passwd" } }, { root: ROOT });
    expect(r.content).toMatch(/ERROR/);
  });

  it("rejects path traversal in list_dir", () => {
    const r = executeTool({ id: "1", name: "list_dir", input: { path: "../../../" } }, { root: ROOT });
    expect(r.content).toMatch(/ERROR/);
  });

  it("reads a file inside the root", () => {
    const r = executeTool({ id: "1", name: "read_file", input: { path: "composer.json" } }, { root: ROOT });
    expect(r.content).toContain("laravel/framework");
  });

  it("lists a directory inside the root", () => {
    const r = executeTool({ id: "1", name: "list_dir", input: { path: "app" } }, { root: ROOT });
    expect(r.content).toMatch(/Models|Services|Http/);
  });

  it("returns error for unknown tool", () => {
    const r = executeTool({ id: "1", name: "what", input: {} }, { root: ROOT });
    expect(r.content).toMatch(/unknown tool/);
  });
});
