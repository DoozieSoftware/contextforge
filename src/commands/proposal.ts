import fs from "node:fs";
import path from "node:path";
import { buildContextPackage, packageToMarkdown } from "../context/package.js";
import { buildReport } from "../context/budget.js";
import { listRepoFiles } from "../scanner/index.js";
import { runPlanner, runWriter, loadPromptTemplate } from "../llm/loop.js";
import type { CommandContext, CommandResult } from "./types.js";
import { offlineProposal } from "./offline.js";

export interface ProposalOptions {
  inputFile: string;
  maxFiles?: number;
  budgetTokens?: number;
}

export async function runProposal(opts: ProposalOptions, ctx: CommandContext): Promise<CommandResult> {
  const inputAbs = path.isAbsolute(opts.inputFile) ? opts.inputFile : path.join(ctx.cwd, opts.inputFile);
  if (!fs.existsSync(inputAbs)) {
    throw new Error(`Input file not found: ${opts.inputFile}`);
  }
  const inputText = fs.readFileSync(inputAbs, "utf-8");

  const allFiles = listRepoFiles(ctx.root, ctx.memory);
  const totalSize = allFiles.reduce((sum, rel) => {
    try {
      return sum + fs.statSync(path.join(ctx.root, rel)).size;
    } catch {
      return sum;
    }
  }, 0);
  const repoTokens = Math.ceil(totalSize / 4);

  let selectedFiles: string[] = [];
  let planNotes = "";
  if (!ctx.offline) {
    const plannerOut = await runPlanner({
      goal: `Pick up to ${opts.maxFiles ?? 5} project files that give relevant context for the proposal.`,
      systemPrompt: loadPromptTemplate("proposal"),
      candidateSummary: `Understanding input: ${path.relative(ctx.cwd, inputAbs)}\n\nUnderstanding text:\n${inputText.slice(0, 4000)}`,
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
      planNotes = plannerOut.fallbackReason
        ? `(planner fallback: ${plannerOut.fallbackReason})`
        : "(no files selected by planner)";
    }
  } else {
    planNotes = "(offline mode)";
  }

  const pkg = await buildContextPackage(selectedFiles, {
    budgetTokens: opts.budgetTokens ?? 8_000,
    maxFiles: opts.maxFiles ?? 5,
    root: ctx.root,
    lineNumbers: true,
    redactSecrets: true,
  });

  let body = "";
  if (!ctx.offline) {
    const writerOut = await runWriter({
      command: "proposal",
      promptBody: loadPromptTemplate("proposal"),
      contextPackage:
        `Understanding input: ${path.relative(ctx.cwd, inputAbs)}\n\nUnderstanding text:\n${inputText}\n\n` +
        packageToMarkdown(pkg, true),
      userGoal: `Build an implementation proposal. Planner notes: ${planNotes}`,
      appConfig: ctx.appConfig,
      provider: ctx.provider,
      stats: ctx.stats,
    });
    body = writerOut.body;
  } else {
    body = offlineProposal(inputText, ctx.root, ctx.memory);
  }

  const report = buildReport(allFiles.length, pkg.files.length, repoTokens, pkg.totalTokens);
  return {
    body,
    stats: ctx.stats,
    report,
    title: `Proposal: ${path.basename(inputAbs)}`,
    packageFiles: pkg.files.map((f) => ({ path: f.path, tokens: f.tokens, kind: f.kind, reason: f.reason })),
  };
}
