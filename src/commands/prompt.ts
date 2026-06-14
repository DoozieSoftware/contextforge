import type { CommandContext, CommandResult, PackageFileSummary } from "./types.js";
import { rankCandidates } from "../scanner/candidates.js";
import { buildContextPackage, packageToMarkdown } from "../context/package.js";
import { buildReport, formatReport } from "../context/budget.js";
import { scanRepo } from "../scanner/index.js";
import { openGraph } from "../scanner/graph.js";
import { buildHeuristics } from "../scanner/heuristics.js";
import { readProjectMemory } from "../memory/project.js";
import { CommandError } from "../util/args.js";

export type PromptKind =
  | "understand"
  | "trace"
  | "review"
  | "breakdown"
  | "proposal"
  | "explain"
  | "find-bug";

export interface PromptOptions {
  kind: PromptKind;
  target: string;
  query?: string;
  maxFiles: number;
  budgetTokens: number;
}

const PROMPT_TEMPLATES: Record<PromptKind, { title: string; task: string; deliverable: string }> = {
  understand: {
    title: "Understand this file",
    task: "Read the context package below and produce a structured understanding of the file at the center of the package.",
    deliverable: `Return exactly these sections, in this order, with no preamble:
## Purpose
## Key Exports
## Dependencies (incoming + outgoing)
## Data Flow
## Risk Areas
## Suggested Reading Order
Use precise symbol names from the code. Do not invent.`,
  },
  trace: {
    title: "Trace this query",
    task: "Read the context package below and trace the query across the codebase to find the most likely root cause(s).",
    deliverable: `Return exactly these sections, in this order:
## Probable Root Causes (ranked)
## Affected Files (with line ranges)
## Confidence Level (High / Medium / Low)
## Suggested Fixes
## Regression Tests to Add
If the package does not contain a candidate that obviously matches the query, say so explicitly.`,
  },
  review: {
    title: "Review this change",
    task: "Read the context package below (changed file + the imports/tests that the change touches) and produce a code review.",
    deliverable: `Return findings grouped by severity, then a summary:

## Critical
## High
## Medium
## Low
## Summary
For each finding: file:line, what's wrong, suggested fix. Be specific.`,
  },
  breakdown: {
    title: "Break down this requirement",
    task: "Read the context package below (the requirement document plus the modules it would touch) and break the work into shippable units.",
    deliverable: `Return exactly these sections, in this order:
## Epic
## Features
## Stories (with estimates)
## Tasks (with estimates)
## Dependencies
## Risks
Use Fibonacci estimates (1, 2, 3, 5, 8). Be concrete; no generic tasks.`,
  },
  proposal: {
    title: "Build an implementation proposal",
    task: "Read the context package below (the understanding document plus the modules it would touch) and write an implementation proposal.",
    deliverable: `Return exactly these sections, in this order:
## Scope
## Assumptions
## Modules to Touch
## Effort Estimate
## Risk
## Implementation Plan (ordered steps)
Each step should be small enough to ship in one PR.`,
  },
  explain: {
    title: "Explain this code",
    task: "Read the context package below and explain what it does, focusing on the non-obvious parts.",
    deliverable: `Return exactly these sections, in this order:
## What it does (1-3 sentences)
## How it works (walk through the key path)
## Inputs / Outputs
## Edge cases worth knowing
Keep it tight; no preamble.`,
  },
  "find-bug": {
    title: "Find bugs in this code",
    task: "Read the context package below and find bugs, race conditions, security issues, or correctness problems. Focus on changed/recent code first, but check the dependencies it relies on for broken invariants.",
    deliverable: `Return findings ordered by severity:

## Critical (will lose data / money / security)
## High (will break under normal use)
## Medium (will break under edge cases)
## Low (smell / future risk)

For each: file:line, the failure mode, the fix. If you find nothing, say "No bugs found" — do not invent.`,
  },
};

export function listPromptKinds(): string[] {
  return Object.keys(PROMPT_TEMPLATES);
}

export async function runPrompt(
  opts: PromptOptions,
  ctx: CommandContext,
): Promise<CommandResult> {
  const tpl = PROMPT_TEMPLATES[opts.kind];
  if (!tpl) {
    throw new CommandError(
      `Unknown prompt kind: ${opts.kind}. Available: ${listPromptKinds().join(", ")}`,
    );
  }

  // 1. Run a fresh scan (or use cache) so the graph is current
  const graph = openGraph(ctx.root);
  try {
    const mem = ctx.memory ?? readProjectMemory(ctx.root);
    if (mem) {
      try {
        await scanRepo(ctx.root, { memory: mem });
      } catch (err) {
        logStderr(`Scanner warning: ${(err as Error).message}`);
      }
    }
  } catch {
    /* best-effort */
  }

  // 2. Build a candidate set for the target
  const target = opts.target;
  let ranked: { path: string; reason: string; score: number; isTest: boolean; isRoute: boolean }[] = [];
  try {
    const mem = ctx.memory ?? readProjectMemory(ctx.root);
    if (mem) {
      const heuristics = buildHeuristics(mem);
      const candidates = rankCandidates(target, graph, heuristics, {
        max: opts.maxFiles,
        depth: 2,
        includeTarget: true,
      });
      ranked = candidates.map((c) => ({
        path: c.path,
        reason: c.reasons.join("; "),
        score: c.score,
        isTest: c.isTest ?? false,
        isRoute: c.isRoute ?? false,
      }));
    }
  } catch {
    ranked = [];
  }

  // Make sure the target itself is first
  const seen = new Set<string>();
  const fileList: string[] = [];
  for (const r of ranked) {
    if (seen.has(r.path)) continue;
    seen.add(r.path);
    fileList.push(r.path);
    if (fileList.length >= opts.maxFiles) break;
  }
  if (!seen.has(target) && fileList.length < opts.maxFiles) {
    fileList.unshift(target);
  }

  // 3. Build the context package (file contents + line numbers + redaction)
  const pkg = await buildContextPackage(fileList, {
    root: ctx.root,
    maxFiles: opts.maxFiles,
    budgetTokens: opts.budgetTokens,
    lineNumbers: true,
    redactSecrets: true,
  });
  const contextMd = packageToMarkdown(pkg, true);

  // 4. Budget report
  const totalScanned = graph.listFiles().length;
  // Estimate repo size from scanned files (sum of approximate file bytes / 4 chars per token)
  // We don't have a real repo scan here; use package totalTokens as the context size and
  // estimate repo size from the graph file list. For a true reduction metric, callers
  // should run `ctx scan` first.
  const report = buildReport(
    totalScanned,
    pkg.files.length,
    Math.max(pkg.totalTokens * 50, pkg.totalTokens + 1000), // coarse repo estimate
    pkg.totalTokens,
  );

  // 5. Assemble the paste-ready prompt
  const queryLine = opts.query ? `\n**Query:** ${opts.query}\n` : "";
  const body = `# ${tpl.title}

**Target:** \`${target}\`
${queryLine}
## Task

${tpl.task}

## Deliverable

${tpl.deliverable}

## Context Package

The following files were selected by a scanner (import-graph BFS, ranked by relevance) and are the minimum context needed to answer. Each block has line numbers so you can cite exact locations.

${contextMd}

---

## How to use this prompt

Copy everything above into Codex, Claude, or ChatGPT. The model has the exact file paths, line numbers, and surrounding code it needs — no further repository access required.

**Token budget report:**

${formatReport(report)}
`;

  try { graph.close(); } catch { /* best-effort */ }

  const pkgFiles: PackageFileSummary[] = pkg.files.map((f) => ({
    path: f.path,
    tokens: f.tokens,
    kind: f.kind,
    reason: f.reason,
  }));

  return {
    body,
    title: tpl.title,
    target,
    query: opts.query,
    report,
    stats: ctx.stats,
    packageFiles: pkgFiles,
    contextPackageMd: contextMd,
  };
}

function logStderr(msg: string): void {
  if (!process.env.CTX_QUIET) {
    process.stderr.write(`[prompt] ${msg}\n`);
  }
}
