import type { Candidate } from "../scanner/candidates.js";
import { listRepoFiles } from "../scanner/index.js";
import { openGraph, buildHeuristics } from "../scanner/index.js";
import { readProjectMemory } from "../memory/project.js";
import path from "node:path";

/**
 * Scanner-backed offline output for `ctx understand`. The goal is to give
 * a real answer even without an LLM: a ranked file list, a list of
 * symbols/routes/tests found in the target's neighbourhood, and a
 * suggested reading order. We surface the limitation in the header so the
 * user knows they're not getting the LLM-grade output.
 */
export function offlineUnderstand(
  pkg: { files: { path: string; tokens: number; kind: string }[] },
  target: string,
  planNotes: string,
  candidates: Candidate[],
): string {
  const targetInPkg = pkg.files.find((f) => f.path === target);
  const others = pkg.files.filter((f) => f.path !== target);
  const targetC = candidates.find((c) => c.path === target);
  const top = candidates
    .filter((c) => c.path !== target)
    .slice(0, 10);

  return [
    `> **Offline mode** — scanner-backed output. No LLM was called. ${planNotes}`,
    ``,
    `## Purpose`,
    targetInPkg
      ? `\`${target}\` was found in the repo (${targetInPkg.tokens.toLocaleString()} tokens). ${purposeFromKind(targetInPkg.kind, targetC)}`
      : `Target file \`${target}\` was not found in the discovered candidates. Listed below are the closest matches.`,
    ``,
    `## Dependencies`,
    ...(others.length === 0
      ? ["- (no related files discovered — try `ctx scan` to inspect the graph)"]
      : others.map((o) => `- \`${o.path}\` (${o.kind})`)),
    ``,
    `## Data Flow`,
    `Read \`${target}\` top-to-bottom. Follow imports into the files listed in Dependencies, in the order shown in Suggested Reading Order.`,
    ``,
    `## Risk Areas`,
    top.length === 0
      ? "- (no candidates ranked — graph may be sparse for this target)"
      : top
          .slice(0, 3)
          .map((c) => `- \`${c.path}\` — ${c.reasons[0] ?? "no reason recorded"}`),
    ``,
    `## Suggested Reading Order`,
    ...(top.length === 0
      ? [`- ${target}`]
      : top.slice(0, 5).map((c) => `- \`${c.path}\` — ${c.reasons[0] ?? ""}`)),
    ``,
    `> Limitations: section structure, natural-language summaries, and cross-file reasoning are not produced in offline mode. Run \`ctx init\` and provide an API key to enable the LLM pass.`,
  ].join("\n");
}

function purposeFromKind(kind: string, cand?: Candidate): string {
  if (!cand) return "";
  const symbolHint =
    cand.symbolCount > 0
      ? ` Contains ${cand.symbolCount} symbol${cand.symbolCount === 1 ? "" : "s"}.`
      : "";
  const testHint = cand.isTest ? " Likely a test file." : "";
  const routeHint = cand.isRoute ? " Likely a route definition." : "";
  return `Classified as \`${kind}\`.${symbolHint}${testHint}${routeHint}`;
}

/**
 * Offline body for `ctx trace <query>`. Re-scans the repo to surface
 * files that contain the query string in their source, ranked by how
 * many hits each file has.
 */
export function offlineTrace(
  pkg: { files: { path: string; tokens: number; kind: string }[] },
  query: string,
  planNotes: string,
  root: string,
  memory: ReturnType<typeof readProjectMemory>,
  candidateHits: { path: string; hits: number }[],
): string {
  return [
    `> **Offline mode** — heuristic only. ${planNotes}`,
    ``,
    `## Probable Root Causes`,
    candidateHits.length === 0
      ? `- No source files contain \`${query}\`. Broaden the query or run \`ctx init\` to enable the LLM pass.`
      : candidateHits
          .slice(0, 5)
          .map((c) => `- \`${c.path}\` — ${c.hits} mention${c.hits === 1 ? "" : "s"} of \`${query}\``),
    ``,
    `## Affected Files`,
    ...(pkg.files.length === 0
      ? ["- (none in the candidate set)"]
      : pkg.files.map((f) => `- \`${f.path}\` (${f.kind})`)),
    ``,
    `## Confidence Level`,
    `Low — offline mode cannot reason about runtime behaviour.`,
    ``,
    `## Suggested Fixes`,
    `- Manually inspect each file above for \`${query}\` and adjacent logic.`,
    ``,
    `## Regression Tests`,
    `- Add a test that exercises the path mentioned in each affected file.`,
    ``,
    `> Limitations: root-cause reasoning is heuristic. Enable the LLM pass for ranked, contextual analysis.`,
  ].join("\n");
}

/** Offline body for `ctx review`. Returns the heuristic findings as a
 *  Critical/High/Medium/Low grouped list. Used by review.ts directly. */
export function offlineReview(findings: { severity: string; file: string; line: number; hint: string; snippet: string }[]): string {
  const groups: Record<string, typeof findings> = { Critical: [], High: [], Medium: [], Low: [] };
  for (const f of findings) groups[f.severity]?.push(f);
  const parts: string[] = [`> **Offline mode** — heuristic findings only. Reviewer LLM not called.`];
  for (const sev of ["Critical", "High", "Medium", "Low"]) {
    parts.push(``, `## ${sev}`);
    if (groups[sev]!.length === 0) parts.push("- (none)");
    for (const f of groups[sev]!) {
      parts.push(`- \`${f.file}\`:${f.line} — ${f.hint}`);
      parts.push(`  - \`${f.snippet}\``);
    }
  }
  return parts.join("\n");
}

/**
 * Offline body for `ctx breakdown`. We cannot reason about the
 * requirement, but we CAN:
 *  - extract bullet points / numbered items already in the source doc
 *  - suggest likely modules based on keyword matching
 *  - emit a deterministic skeleton that maps to the brief's section shape
 */
export function offlineBreakdown(inputText: string, root?: string, memory?: ReturnType<typeof readProjectMemory>): string {
  const lines = inputText.split("\n").map((l) => l.trim());
  const title = lines.find((l) => l && !l.startsWith("#")) ?? "(empty requirement)";
  const bullets = lines.filter((l) => /^[-*+]\s+/.test(l) || /^\d+\.\s+/.test(l));
  const sections = inputText.split(/^##\s+/m).slice(1).map((s) => s.split("\n")[0]?.trim() ?? "");

  // Very rough module suggestion: look for words that match candidate
  // file paths in the repo.
  const moduleHits: { word: string; path: string }[] = [];
  if (root && memory) {
    const candidates = listRepoFiles(root, memory).slice(0, 300);
    const words = title.toLowerCase().split(/\W+/).filter((w) => w.length >= 4);
    for (const w of words) {
      for (const p of candidates) {
        if (p.toLowerCase().includes(w)) {
          moduleHits.push({ word: w, path: p });
          break;
        }
      }
      if (moduleHits.length >= 3) break;
    }
  }

  return [
    `> **Offline mode** — deterministic template. ${bullets.length} bullet(s) and ${sections.length} sub-heading(s) found in the source.`,
    ``,
    `## Epic`,
    title.slice(0, 200),
    ``,
    `## Features`,
    ...(bullets.length > 0
      ? bullets.slice(0, 6).map((b) => `- ${b.replace(/^[-*+\d.]\s+/, "").slice(0, 200)}`)
      : sections.length > 0
        ? sections.slice(0, 6).map((s) => `- ${s}`)
        : ["- (add bullet points or sections to your requirement to see them here)"]),
    ``,
    `## Stories`,
    ...(bullets.length > 1
      ? bullets.slice(0, 4).map((b) => `- As a user, I want ${b.replace(/^[-*+\d.]\s+/, "").toLowerCase().slice(0, 180)}`)
      : ["- (offline — one story per bullet would be a good starting point)"]),
    ``,
    `## Tasks`,
    ...(bullets.length > 0
      ? bullets.slice(0, 5).map((b) => `- [ ] ${b.replace(/^[-*+\d.]\s+/, "").slice(0, 200)}`)
      : ["- [ ] (define tasks in the requirement doc)"]),
    ``,
    `## Estimates`,
    `Rough heuristic: ${bullets.length} bullet(s) × ~half-day each ≈ **${Math.max(1, Math.ceil(bullets.length / 2))} engineer-day(s)**.`,
    ``,
    `## Dependencies`,
    ...(moduleHits.length > 0
      ? moduleHits.map((m) => `- \`${m.path}\` (matched keyword \`${m.word}\`)`)
      : ["- (no obvious file dependencies detected from the requirement text)"]),
    ``,
    `## Risks`,
    `- Requirements written in natural language may be ambiguous — confirm acceptance criteria before sizing.`,
    moduleHits.length === 0
      ? `- No candidate modules were detected; double-check that you are running \`ctx breakdown\` from inside the project root.`
      : `- Only keyword-matched files are listed; manual review is required.`,
    ``,
    `> Limitations: this is a template — enable the LLM pass for ranked, contextual breakdown.`,
  ].join("\n");
}

/**
 * Offline body for `ctx proposal`. We can't reason about the input, but
 * we can detect likely module touch-points and emit a deterministic
 * skeleton that matches the brief's section shape.
 */
export function offlineProposal(inputText: string, root?: string, memory?: ReturnType<typeof readProjectMemory>): string {
  const lines = inputText.split("\n").map((l) => l.trim());
  const title = lines.find((l) => l && !l.startsWith("#")) ?? "(empty understanding)";
  const sections = inputText.split(/^##\s+/m).slice(1).map((s) => s.split("\n")[0]?.trim() ?? "");

  const moduleHits: { path: string }[] = [];
  if (root && memory) {
    const candidates = listRepoFiles(root, memory).slice(0, 300);
    const words = title.toLowerCase().split(/\W+/).filter((w) => w.length >= 4);
    for (const w of words) {
      for (const p of candidates) {
        if (p.toLowerCase().includes(w)) {
          moduleHits.push({ path: p });
          break;
        }
      }
      if (moduleHits.length >= 3) break;
    }
  }

  return [
    `> **Offline mode** — deterministic template. ${sections.length} sub-heading(s) found in the source.`,
    ``,
    `## Scope`,
    title.slice(0, 200),
    ``,
    `## Assumptions`,
    ...(sections.length > 0
      ? sections.slice(0, 4).map((s) => `- The "**${s}**" section of the source is treated as a known assumption.`)
      : ["- (add ## sub-headings to your understanding doc to enumerate assumptions)"]),
    ``,
    `## Modules`,
    ...(moduleHits.length > 0
      ? moduleHits.map((m) => `- \`${m.path}\` — touch point detected by keyword match`)
      : ["- (no candidate modules detected — run from the project root to enable keyword matching)"]),
    ``,
    `## Effort`,
    `Rough heuristic: **S** if ${moduleHits.length} <= 1 touched module(s), **M** otherwise. Refine with team velocity.`,
    ``,
    `## Risk`,
    `- Understanding documents often miss edge cases; surface them in code review.`,
    moduleHits.length === 0
      ? `- No candidate modules were detected from the source text; the proposal may be too vague.`
      : `- Keyword-matched modules may be tangentially related — verify before scoping.`,
    ``,
    `## Implementation Plan`,
    ...(moduleHits.length > 0
      ? [
          `1. Read each module listed above and confirm the change is local.`,
          `2. Write a failing test that exercises the behavior described in the source.`,
          `3. Make the smallest change that turns the test green.`,
          `4. Re-run \`ctx review\` on the diff before opening a PR.`,
        ]
      : [`1. Add structure to the understanding doc (## sections).`, `2. Re-run \`ctx proposal\` to surface modules.`]),
    ``,
    `> Limitations: this is a template — enable the LLM pass for a contextual implementation plan.`,
  ].join("\n");
}

/** Pure helper: count occurrences of a substring across the repo. */
export function countQueryHits(root: string, memory: ReturnType<typeof readProjectMemory>, query: string): { path: string; hits: number }[] {
  if (!memory) return [];
  const files = listRepoFiles(root, memory);
  const lower = query.toLowerCase();
  const out: { path: string; hits: number }[] = [];
  for (const rel of files) {
    if (rel.includes("node_modules/") || rel.includes("vendor/") || rel.includes("dist/")) continue;
    try {
      const src = fs.readFileSync(path.join(root, rel), "utf-8");
      const lower_src = src.toLowerCase();
      let hits = 0;
      let idx = 0;
      while ((idx = lower_src.indexOf(lower, idx)) !== -1) {
        hits++;
        idx += lower.length;
      }
      if (hits > 0) out.push({ path: rel, hits });
    } catch {
      // ignore unreadable
    }
  }
  out.sort((a, b) => b.hits - a.hits);
  return out;
}

import fs from "node:fs";
