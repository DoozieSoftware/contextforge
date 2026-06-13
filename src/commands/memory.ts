import { readProjectMemory, writeProjectMemory, type ProjectMemory } from "../memory/project.js";
import type { CommandContext, CommandResult } from "./types.js";
import type { OutputFormat } from "../context/render.js";

export interface MemoryOptions {
  action: "show" | "edit" | "edit-file" | "add-note" | "add-ignore" | "add-alias";
  format: OutputFormat;
  /** Used by add-*: the new entry. */
  value?: string;
}

export async function runMemory(opts: MemoryOptions, ctx: CommandContext): Promise<CommandResult> {
  const mem = readProjectMemory(ctx.root);
  if (!mem) {
    return {
      body: "**No project memory found.** Run `ctx init` first.",
      stats: ctx.stats,
      report: emptyReport(),
      title: "Project memory",
    };
  }

  switch (opts.action) {
    case "show":
      return {
        body: renderMemory(mem),
        stats: ctx.stats,
        report: emptyReport(),
        title: "Project memory",
      };
    case "add-note":
      if (!opts.value) throw new Error("add-note requires a value");
      mem.notes.push(opts.value);
      writeProjectMemory(ctx.root, mem);
      return { body: `Added note.`, stats: ctx.stats, report: emptyReport(), title: "Project memory" };
    case "add-ignore":
      if (!opts.value) throw new Error("add-ignore requires a value");
      if (!mem.ignoreGlobs.includes(opts.value)) mem.ignoreGlobs.push(opts.value);
      writeProjectMemory(ctx.root, mem);
      return { body: `Added ignore glob: \`${opts.value}\``, stats: ctx.stats, report: emptyReport(), title: "Project memory" };
    case "add-alias":
      if (!opts.value || !opts.value.includes("=")) throw new Error("add-alias requires a value of the form ALIAS=PATH");
      const [alias, ...rest] = opts.value.split("=");
      const target = rest.join("=");
      if (!alias || !target) throw new Error("add-alias value must be ALIAS=PATH");
      mem.pathAliases[alias] = target;
      writeProjectMemory(ctx.root, mem);
      return { body: `Added alias: \`${alias}\` → \`${target}\``, stats: ctx.stats, report: emptyReport(), title: "Project memory" };
    case "edit":
    case "edit-file": {
      // Spawn the user's editor ($VISUAL / $EDITOR / vi) on the project
      // memory file. Re-read after the editor closes so subsequent
      // commands see the new values. This is the standard CLI
      // "edit this file" pattern (git commit, crontab -e, etc.).
      const { spawnSync } = await import("node:child_process");
      const { projectFilePath } = await import("../memory/project.js");
      const file = projectFilePath(ctx.root);
      const editor = process.env.VISUAL || process.env.EDITOR || "vi";
      const result = spawnSync(editor, [file], { stdio: "inherit" });
      if (result.status !== 0) {
        return {
          body: `Editor exited with status ${result.status ?? "?"}. File left as-is at \`${file}\`.`,
          stats: ctx.stats,
          report: emptyReport(),
          title: "Project memory",
        };
      }
      // Re-read so the change is reflected in the response body.
      const updated = readProjectMemory(ctx.root);
      return {
        body: `Edited \`${file}\`.\n\n${updated ? renderMemory(updated) : "(could not re-read file)"}`,
        stats: ctx.stats,
        report: emptyReport(),
        title: "Project memory",
      };
    }
  }
}

function renderMemory(mem: ProjectMemory): string {
  return [
    `## Project`,
    `- name: \`${mem.projectName}\``,
    `- root: \`${mem.rootPath}\``,
    `- detectedAt: \`${mem.detectedAt}\``,
    ``,
    `## Stack`,
    `- stacks: ${mem.stacks.join(", ")}`,
    `- primaryLanguage: \`${mem.primaryLanguage}\``,
    `- database: \`${mem.database ?? "n/a"}\``,
    `- architecture: \`${mem.architecture ?? "n/a"}\``,
    ``,
    `## Ignore globs (${mem.ignoreGlobs.length})`,
    ...mem.ignoreGlobs.map((g) => `- \`${g}\``),
    ``,
    `## Test patterns (${mem.testPatterns.length})`,
    ...mem.testPatterns.map((g) => `- \`${g}\``),
    ``,
    `## Route patterns (${mem.routePatterns.length})`,
    ...mem.routePatterns.map((g) => `- \`${g}\``),
    ``,
    `## Path aliases (${Object.keys(mem.pathAliases).length})`,
    ...Object.entries(mem.pathAliases).map(([k, v]) => `- \`${k}\` → \`${v}\``),
    ``,
    `## Notes (${mem.notes.length})`,
    ...(mem.notes.length === 0 ? ["- (none)"] : mem.notes.map((n) => `- ${n}`)),
  ].join("\n");
}

function emptyReport(): CommandResult["report"] {
  return { filesScanned: 0, filesSelected: 0, repoSize: 0, contextSize: 0, reduction: 0 };
}
