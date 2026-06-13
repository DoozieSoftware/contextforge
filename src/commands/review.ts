import fs from "node:fs";
import path from "node:path";
import { getRepoDiff, parseUnifiedDiff } from "../git/diff.js";
import { scanRepo, openGraph, rankCandidates, buildHeuristics, listRepoFiles } from "../scanner/index.js";
import { buildContextPackage, packageToMarkdown } from "../context/package.js";
import { buildReport } from "../context/budget.js";
import { runPlanner, runWriter, loadPromptTemplate } from "../llm/loop.js";
import type { CommandContext, CommandResult } from "./types.js";
import type { Candidate } from "../scanner/candidates.js";
import { offlineReview } from "./offline.js";
import { redactForFinding } from "../context/redact.js";

export interface ReviewOptions {
  base?: string;
  range?: string;
  staged?: boolean;
  maxFiles?: number;
  budgetTokens?: number;
}

const RISKY_PATTERNS: { id: string; re: RegExp; severity: "Critical" | "High" | "Medium" | "Low"; hint: string }[] = [
  { id: "todo", re: /TODO|FIXME|XXX|HACK/i, severity: "Low", hint: "Unresolved TODO/FIXME" },
  { id: "console-log", re: /console\.(log|debug|info|warn|error)\(/, severity: "Low", hint: "console.* left in code" },
  { id: "var", re: /\bvar\s+[A-Za-z_]/, severity: "Medium", hint: "Implicit global (var)" },
  { id: "eval", re: /\beval\s*\(/, severity: "High", hint: "Dynamic eval" },
  { id: "dangerouslySetInnerHTML", re: /dangerouslySetInnerHTML/, severity: "High", hint: "Raw HTML in React" },
  { id: "innerHTML", re: /\.innerHTML\s*=/, severity: "High", hint: "Direct innerHTML write" },
  { id: "math-random", re: /Math\.random\s*\(\s*\)/, severity: "High", hint: "Math.random — non-cryptographic" },
  { id: "secret", re: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i, severity: "Critical", hint: "Hard-coded secret" },
  { id: "sql-string", re: /\b(SELECT|INSERT|UPDATE|DELETE)\b[^\n]*\+\s*[A-Za-z_]/i, severity: "High", hint: "Possible string-concat SQL" },
  { id: "empty-catch", re: /catch\s*\([^)]*\)\s*\{\s*\}/, severity: "Medium", hint: "Empty catch block" },
  { id: "any-ts", re: /:\s*any\b/, severity: "Low", hint: "TypeScript `any`" },
];

export interface HeuristicFinding {
  file: string;
  line: number;
  severity: "Critical" | "High" | "Medium" | "Low";
  hint: string;
  snippet: string;
  id: string;
}

export async function runReview(opts: ReviewOptions, ctx: CommandContext): Promise<CommandResult> {
  const diff = await getRepoDiff({
    base: opts.base,
    range: opts.range,
    staged: opts.staged,
    cwd: ctx.cwd,
  });

  // Parse the unified diff into per-file added-line ranges so heuristics
  // only run on the actual change, not the whole file. This kills the
  // false-positive flood from the previous behaviour.
  const hunks = parseUnifiedDiff(diff.patch);

  await scanRepo(ctx.root, { memory: ctx.memory });
  const db = openGraph(ctx.root);
  let candidates: Candidate[] = [];
  try {
    for (const f of diff.files) {
      const cs = rankCandidates(f, db, buildHeuristics(ctx.memory), { depth: 1, max: 5 });
      candidates.push(...cs);
    }
  } finally {
    db.close();
  }
  const seen = new Set<string>();
  const uniq = candidates.filter((c) => (seen.has(c.path) ? false : (seen.add(c.path), true)));

  // CHANGE-AWARE heuristic findings: only flag lines that appear in the diff
  const heuristicFindings = runHeuristicsOnDiff(hunks);

  const allFiles = listRepoFiles(ctx.root, ctx.memory);
  const totalSize = allFiles.reduce((sum, rel) => {
    try {
      return sum + fs.statSync(path.join(ctx.root, rel)).size;
    } catch {
      return sum;
    }
  }, 0);
  const repoTokens = Math.ceil(totalSize / 4);

  const candidateSummary = uniq
    .slice(0, 25)
    .map((c, i) => `${i + 1}. ${c.path} (score=${c.score}, kind=${c.kind})\n   reasons: ${c.reasons.join("; ")}`)
    .join("\n");

  let selectedFiles: string[] = [];
  let planNotes = "";
  if (!ctx.offline) {
    const plannerOut = await runPlanner({
      goal: `Pick up to ${opts.maxFiles ?? 10} files in the diff that warrant deeper LLM review.`,
      systemPrompt: loadPromptTemplate("review"),
      candidateSummary,
      root: ctx.root,
      memory: ctx.memory,
      appConfig: ctx.appConfig,
      provider: ctx.provider,
      stats: ctx.stats,
    });
    if (plannerOut.selectedFiles.length > 0) {
      selectedFiles = plannerOut.selectedFiles;
      planNotes = plannerOut.planNotes;
    } else {
      selectedFiles = uniq.slice(0, opts.maxFiles ?? 10).map((c) => c.path);
      planNotes = plannerOut.fallbackReason
        ? `(planner fallback: ${plannerOut.fallbackReason})`
        : "(using scanner order)";
    }
  } else {
    selectedFiles = uniq.slice(0, opts.maxFiles ?? 10).map((c) => c.path);
    planNotes = "(offline mode)";
  }

  // Build a diff-anchored context package: only the changed line ranges
  // from each file, plus a header noting the file and the base→head range.
  const order = uniq.map((c) => ({
    path: c.path,
    reason: c.reasons.join("; "),
    isTest: c.isTest,
    isRoute: c.isRoute,
    kind: c.kind,
  }));
  const pkg = await buildContextPackage(selectedFiles, {
    budgetTokens: opts.budgetTokens ?? 14_000,
    maxFiles: opts.maxFiles ?? 10,
    root: ctx.root,
    order,
    lineNumbers: true,
    redactSecrets: true,
  });

  let body = "";
  if (!ctx.offline) {
    const writerOut = await runWriter({
      command: "review",
      promptBody: loadPromptTemplate("review"),
      contextPackage:
        `Diff base: ${diff.base}\nDiff head: ${diff.head}\n\n` +
        `Files changed:\n${diff.files.map((f) => `- ${f}`).join("\n")}\n\n` +
        `Heuristic findings (limited to added/changed lines):\n` +
        (heuristicFindings.length === 0
          ? "- (no heuristic findings on changed lines)\n"
          : heuristicFindings
              .map((f) => `- [${f.severity}] ${f.file}:${f.line} — ${f.hint} (redacted: \`${redactForFinding(f.snippet)}\`)`)
              .join("\n")) +
        `\n\n` +
        packageToMarkdown(pkg, true),
      userGoal: `Review the diff. Planner notes: ${planNotes}`,
      appConfig: ctx.appConfig,
      provider: ctx.provider,
      stats: ctx.stats,
    });
    body = writerOut.body;
  } else {
    body = offlineReview(heuristicFindings);
  }

  const report = buildReport(allFiles.length, pkg.files.length, repoTokens, pkg.totalTokens);
  return {
    body,
    stats: ctx.stats,
    report,
    title: `Review: ${diff.base}..${diff.head}`,
    packageFiles: pkg.files.map((f) => ({ path: f.path, tokens: f.tokens, kind: f.kind, reason: f.reason })),
  };
}

export function runHeuristicsOnDiff(
  hunks: Map<string, { addedLines: number[]; addedText: string }>,
): HeuristicFinding[] {
  const out: HeuristicFinding[] = [];
  const seen = new Set<string>();
  for (const [file, h] of hunks) {
    const lines = h.addedText.split("\n");
    lines.forEach((line, i) => {
      const realLine = h.addedLines[i] ?? -1;
      if (realLine < 0) return;
      for (const p of RISKY_PATTERNS) {
        if (p.re.test(line)) {
          const k = `${file}:${realLine}:${p.id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({
            file,
            line: realLine,
            severity: p.severity,
            hint: p.hint,
            snippet: redactForFinding(line.trim().slice(0, 200)),
            id: p.id,
          });
        }
      }
    });
  }
  return out;
}
