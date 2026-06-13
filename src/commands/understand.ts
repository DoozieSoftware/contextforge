import path from "node:path";
import fs from "node:fs";
import { scanRepo, openGraph, rankCandidates, buildHeuristics, listRepoFiles } from "../scanner/index.js";
import { buildContextPackage, packageToMarkdown } from "../context/package.js";
import { countTokens, buildReport } from "../context/budget.js";
import { runPlanner, runWriter, loadPromptTemplate } from "../llm/loop.js";
import { createStats } from "../llm/stats.js";
import type { CommandContext, CommandResult } from "./types.js";
import type { Candidate } from "../scanner/candidates.js";
import { offlineUnderstand } from "./offline.js";

export interface UnderstandOptions {
  target: string;
  maxCandidates?: number;
  maxFiles?: number;
  budgetTokens?: number;
}

export async function runUnderstand(opts: UnderstandOptions, ctx: CommandContext): Promise<CommandResult> {
  await scanRepo(ctx.root, { memory: ctx.memory });
  const db = openGraph(ctx.root);
  let candidates: Candidate[] = [];
  try {
    candidates = rankCandidates(opts.target, db, buildHeuristics(ctx.memory), {
      depth: 2,
      max: opts.maxCandidates ?? 15,
    });
  } finally {
    db.close();
  }
  const allFiles = listRepoFiles(ctx.root, ctx.memory);
  const totalSize = allFiles.reduce((sum, rel) => {
    try {
      return sum + fs.statSync(path.join(ctx.root, rel)).size;
    } catch {
      return sum;
    }
  }, 0);
  const repoTokens = Math.ceil(totalSize / 4);

  const candidateSummary = candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.path} (depth=${c.depth}, score=${c.score}, kind=${c.kind}, test=${c.isTest}, route=${c.isRoute})\n   reasons: ${c.reasons.join("; ")}`,
    )
    .join("\n");

  let selectedFiles: string[] = [];
  let planNotes = "";
  let fallbackReason: string | undefined;
  if (!ctx.offline) {
    const plannerOut = await runPlanner({
      goal: `Select up to ${opts.maxFiles ?? 12} files that will help a writer explain the file "${opts.target}".`,
      systemPrompt: loadPromptTemplate("understand"),
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
      selectedFiles = candidates.slice(0, opts.maxFiles ?? 12).map((c) => c.path);
      planNotes = plannerOut.fallbackReason
        ? `(planner fallback: ${plannerOut.fallbackReason})`
        : "(using scanner order)";
      fallbackReason = plannerOut.fallbackReason;
    }
  } else {
    selectedFiles = candidates.slice(0, opts.maxFiles ?? 12).map((c) => c.path);
    planNotes = "(offline mode — using scanner order)";
  }

  const order = candidates.map((c) => ({
    path: c.path,
    reason: c.reasons.join("; "),
    isTest: c.isTest,
    isRoute: c.isRoute,
    kind: c.kind,
  }));
  const pkg = await buildContextPackage(selectedFiles, {
    budgetTokens: opts.budgetTokens ?? 14_000,
    maxFiles: opts.maxFiles ?? 12,
    root: ctx.root,
    order,
    lineNumbers: true,
    redactSecrets: true,
  });

  let body = "";
  if (!ctx.offline) {
    const writerOut = await runWriter({
      command: "understand",
      promptBody: loadPromptTemplate("understand"),
      contextPackage: packageToMarkdown(pkg, true),
      userGoal: `Explain the file "${opts.target}". Planner notes: ${planNotes}`,
      appConfig: ctx.appConfig,
      provider: ctx.provider,
      stats: ctx.stats,
    });
    body = writerOut.body;
    if (writerOut.missingSections.length > 0) {
      planNotes += ` | writer repair: missing ${writerOut.missingSections.join(", ")}`;
    }
  } else {
    body = offlineUnderstand(pkg, opts.target, planNotes, candidates);
  }

  const report = buildReport(allFiles.length, pkg.files.length, repoTokens, pkg.totalTokens);
  return {
    body,
    stats: ctx.stats,
    report,
    title: `Understand: ${opts.target}`,
    packageFiles: pkg.files.map((f) => ({ path: f.path, tokens: f.tokens, kind: f.kind, reason: f.reason })),
    contextPackageMd: packageToMarkdown(pkg, true),
    target: opts.target,
    fallbackReason,
  };
}
