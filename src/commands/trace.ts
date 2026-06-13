import fs from "node:fs";
import path from "node:path";
import { scanRepo, openGraph, rankCandidates, buildHeuristics, listRepoFiles } from "../scanner/index.js";
import { buildContextPackage, packageToMarkdown } from "../context/package.js";
import { buildReport } from "../context/budget.js";
import { runPlanner, runWriter, loadPromptTemplate } from "../llm/loop.js";
import type { CommandContext, CommandResult } from "./types.js";
import type { Candidate } from "../scanner/candidates.js";
import { offlineTrace, countQueryHits } from "./offline.js";

export interface TraceOptions {
  query: string;
  maxCandidates?: number;
  maxFiles?: number;
  budgetTokens?: number;
  maxResults?: number;
}

export async function runTrace(opts: TraceOptions, ctx: CommandContext): Promise<CommandResult> {
  await scanRepo(ctx.root, { memory: ctx.memory });
  const db = openGraph(ctx.root);
  let candidates: Candidate[] = [];
  try {
    candidates = rankCandidates(opts.query, db, buildHeuristics(ctx.memory), {
      depth: 3,
      max: opts.maxCandidates ?? 25,
    });
  } finally {
    db.close();
  }

  // Pre-filter by keyword across the file content for the offline path
  const keyword = opts.query.toLowerCase();
  const filtered = candidates.filter((c) => {
    if (keywordHit(c.path, keyword)) return true;
    const fullPath = path.join(ctx.root, c.path);
    if (!fs.existsSync(fullPath)) return false;
    const src = fs.readFileSync(fullPath, "utf-8").toLowerCase();
    return src.includes(keyword);
  });
  const finalCandidates = (filtered.length > 0 ? filtered : candidates).slice(0, opts.maxResults ?? 12);

  const allFiles = listRepoFiles(ctx.root, ctx.memory);
  const totalSize = allFiles.reduce((sum, rel) => {
    try {
      return sum + fs.statSync(path.join(ctx.root, rel)).size;
    } catch {
      return sum;
    }
  }, 0);
  const repoTokens = Math.ceil(totalSize / 4);

  const candidateSummary = finalCandidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.path} (score=${c.score}, kind=${c.kind}, route=${c.isRoute}, test=${c.isTest})\n   reasons: ${c.reasons.join("; ")}`,
    )
    .join("\n");

  let selectedFiles: string[] = [];
  let planNotes = "";
  if (!ctx.offline) {
    const plannerOut = await runPlanner({
      goal: `The user's query is: "${opts.query}". Pick up to ${opts.maxFiles ?? 10} files most likely to contain the root cause.`,
      systemPrompt: loadPromptTemplate("trace"),
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
      selectedFiles = finalCandidates.slice(0, opts.maxFiles ?? 10).map((c) => c.path);
      planNotes = plannerOut.fallbackReason
        ? `(planner fallback: ${plannerOut.fallbackReason})`
        : "(using scanner order)";
    }
  } else {
    selectedFiles = finalCandidates.slice(0, opts.maxFiles ?? 10).map((c) => c.path);
    planNotes = "(offline mode)";
  }

  const order = finalCandidates.map((c) => ({
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
      command: "trace",
      promptBody: loadPromptTemplate("trace").replace("{query}", opts.query),
      contextPackage: packageToMarkdown(pkg, true),
      userGoal: `Trace query: "${opts.query}". Planner notes: ${planNotes}`,
      appConfig: ctx.appConfig,
      provider: ctx.provider,
      stats: ctx.stats,
    });
    body = writerOut.body;
  } else {
    const hits = countQueryHits(ctx.root, ctx.memory, opts.query);
    body = offlineTrace(pkg, opts.query, planNotes, ctx.root, ctx.memory, hits);
  }

  const report = buildReport(allFiles.length, pkg.files.length, repoTokens, pkg.totalTokens);
  return {
    body,
    stats: ctx.stats,
    report,
    title: `Trace: ${opts.query}`,
    packageFiles: pkg.files.map((f) => ({ path: f.path, tokens: f.tokens, kind: f.kind, reason: f.reason })),
    contextPackageMd: packageToMarkdown(pkg, true),
    query: opts.query,
  };
}

function keywordHit(p: string, kw: string): boolean {
  const base = path.basename(p).toLowerCase();
  return base.includes(kw.replace(/\s+/g, "")) || base.includes(kw.split(/\s+/)[0] ?? "");
}
