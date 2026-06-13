import fs from "node:fs";
import path from "node:path";
import { scanRepo, openGraph, rankCandidates, buildHeuristics, listRepoFiles } from "../scanner/index.js";
import type { CommandResult, CommandContext } from "./types.js";
import type { OutputFormat } from "../context/render.js";

export interface ScanOptions {
  /** Restrict to a specific file or directory. */
  target?: string;
  /** Max candidates to surface when `target` is given. */
  max?: number;
  format: OutputFormat;
}

/**
 * Diagnostic command: rescans the repo, prints summary stats, and — when
 * a `target` is given — runs BFS to surface the most related files.
 * Intended for debugging and for building user trust in the scanner.
 */
export async function runScan(opts: ScanOptions, ctx: CommandContext): Promise<CommandResult> {
  const result = await scanRepo(ctx.root, { memory: ctx.memory });
  const allFiles = listRepoFiles(ctx.root, ctx.memory);
  const totalSize = allFiles.reduce((sum, rel) => {
    try {
      return sum + fs.statSync(path.join(ctx.root, rel)).size;
    } catch {
      return sum;
    }
  }, 0);
  // When the scan was served from the mtime cache, `result.files` is
  // empty. We can still surface summary stats from the graph nodes
  // themselves (and the on-disk files, if any).
  const files = result.files.length > 0 ? result.files : result.nodes.map((n) => ({
    path: n.path,
    language: n.language,
    symbols: [],
    tests: [],
    routes: [],
  }));
  const symbols = files.reduce((s, f: any) => s + (f.symbols?.length ?? 0), 0);
  const tests = files.reduce((s, f: any) => s + (f.tests?.length ?? 0), 0);
  const routes = files.reduce((s, f: any) => s + (f.routes?.length ?? 0), 0);
  const byKind: Record<string, number> = {};
  for (const f of files) {
    const k = path.extname(f.path).replace(/^\./, "") || "other";
    byKind[k] = (byKind[k] ?? 0) + 1;
  }

  let body = "";
  if (opts.target) {
    const db = openGraph(ctx.root);
    let cands;
    try {
      cands = rankCandidates(opts.target, db, buildHeuristics(ctx.memory), {
        depth: 2,
        max: opts.max ?? 15,
      });
    } finally {
      db.close();
    }
    body = [
      `## Top candidates for \`${opts.target}\``,
      ...cands.map(
        (c, i) => `${i + 1}. \`${c.path}\` (score=${c.score}, kind=${c.kind}, depth=${c.depth}, test=${c.isTest}, route=${c.isRoute})\n   reasons: ${c.reasons.join("; ")}`,
      ),
    ].join("\n");
  } else {
    const discoveredCount = result.cached ? result.nodes.length : result.files.length;
    body = [
      `## Scanner summary`,
      `- Files discovered: ${discoveredCount}`,
      `- Symbols: ${symbols}`,
      `- Tests: ${tests}`,
      `- Routes: ${routes}`,
      `- Edges (resolved imports): ${result.edges.length}`,
      `- Repo size: ${(totalSize / 1024).toFixed(1)} KiB`,
      ``,
      `## By extension`,
      ...Object.entries(byKind)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `- \`.${k}\`: ${n}`),
    ].join("\n");
  }

  return {
    body,
    stats: ctx.stats,
    report: {
      filesScanned: result.cached ? result.nodes.length : result.files.length,
      filesSelected: 0,
      repoSize: 0,
      contextSize: 0,
      reduction: 0,
    },
    title: "Scanner report",
    packageFiles: result.files.slice(0, 25).map((f) => ({
      path: f.path,
      tokens: 0,
      kind: path.extname(f.path).replace(/^\./, "") || "other",
      reason: `${f.symbols.length} symbols · ${f.imports.length} imports`,
    })),
  };
}
