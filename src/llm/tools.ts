import path from "node:path";
import { safeResolve, readFileSafe, listDirSafe, fileExists, dirExists } from "../util/fs.js";
import type { ToolSpec, ToolCall } from "./types.js";

export interface ToolContext {
  root: string;
}

export function plannerTools(): ToolSpec[] {
  return [
    {
      name: "read_file",
      description:
        "Read a file from the repository. Paths are relative to the repo root. Returns the file contents (truncated to 2MB).",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the repo root" },
        },
        required: ["path"],
      },
    },
    {
      name: "list_dir",
      description:
        "List entries in a directory under the repository. Paths are relative to the repo root. Returns up to 200 names.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the repo root" },
        },
        required: ["path"],
      },
    },
  ];
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
}

export function executeTool(call: ToolCall, ctx: ToolContext): ToolResult {
  try {
    const input = call.input ?? {};
    if (call.name === "read_file") {
      const p = String(input.path ?? "");
      if (!p) return { tool_call_id: call.id, content: "ERROR: path required" };
      const abs = safeResolve(ctx.root, p);
      if (!fileExists(abs)) return { tool_call_id: call.id, content: `ERROR: not found: ${p}` };
      const content = readFileSafe(abs);
      return { tool_call_id: call.id, content };
    }
    if (call.name === "list_dir") {
      const p = String(input.path ?? "");
      const abs = safeResolve(ctx.root, p);
      if (!dirExists(abs)) return { tool_call_id: call.id, content: `ERROR: not a directory: ${p}` };
      const entries = listDirSafe(abs);
      return { tool_call_id: call.id, content: entries.join("\n") || "(empty)" };
    }
    return { tool_call_id: call.id, content: `ERROR: unknown tool: ${call.name}` };
  } catch (err) {
    return { tool_call_id: call.id, content: `ERROR: ${(err as Error).message}` };
  }
}
