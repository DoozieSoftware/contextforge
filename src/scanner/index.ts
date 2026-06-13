import path from "node:path";
import fs from "node:fs";
import fg from "fast-glob";
import { openGraph, resolveImport, type GraphDB } from "./graph.js";
import { buildHeuristics } from "./heuristics.js";
import { parsePhp } from "./parsers/php.js";
import { parseTs } from "./parsers/ts.js";
import { parsePython } from "./parsers/python.js";
import { readProjectMemory } from "../memory/project.js";
import { Progress } from "../util/progress.js";
import type { FileAnalysis, ScanResult, Language } from "./types.js";

export { openGraph, resolveImport } from "./graph.js";
export { rankCandidates } from "./candidates.js";
export { buildHeuristics, globMatch } from "./heuristics.js";
export type { Candidate } from "./candidates.js";
export type { FileAnalysis, ScanResult, GraphNode, GraphEdge } from "./types.js";

function detectLanguage(p: string): Language | null {
  if (p.endsWith(".ts") || p.endsWith(".tsx")) return "typescript";
  if (p.endsWith(".js") || p.endsWith(".jsx") || p.endsWith(".mjs") || p.endsWith(".cjs")) return "javascript";
  if (p.endsWith(".py")) return "python";
  if (p.endsWith(".php")) return "php";
  return null;
}

export interface ScanOptions {
  /** Force a full re-scan (ignore cached hash). */
  full?: boolean;
  /** Optional override of the project memory. */
  memory?: ReturnType<typeof readProjectMemory>;
}

export class ScannerEmptyError extends Error {
  constructor(public readonly root: string) {
    super(
      `No scannable files found in ${root}. ` +
      `Check that .contextforge/project.json has appropriate includeGlobs / ignoreGlobs, ` +
      `or that the working directory contains source files.`,
    );
    this.name = "ScannerEmptyError";
  }
}

export async function scanRepo(root: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const mem = opts.memory ?? readProjectMemory(root);
  if (!mem) {
    throw new Error("Project memory not found. Run `ctx init` first.");
  }
  const heuristics = buildHeuristics(mem);
  const db = openGraph(root);
  try {
    const files = await fg(["**/*"], {
      cwd: root,
      dot: false,
      absolute: false,
      onlyFiles: true,
      followSymbolicLinks: false,
      ignore: mem.ignoreGlobs,
    });

    // Prune stale files from the previous run that are no longer present
    // or that are no longer matched by the heuristics (e.g. user updated
    // .contextforge/project.json to ignore a new glob).
    const seenNow = new Set(files.filter((rel) => heuristics.include(rel)));
    const prior = db.listFiles();
    for (const node of prior) {
      if (!seenNow.has(node.path)) {
        db.removeFile(node.path);
      }
    }

    const analyses: FileAnalysis[] = [];
    let totalSize = 0;
    const filtered = files.filter((rel) => heuristics.include(rel));
    const scannable = filtered.filter((rel) => detectLanguage(rel) !== null);
    if (scannable.length === 0) {
      throw new ScannerEmptyError(root);
    }

    // Mtime-based skip: when nothing has changed since the last scan, reuse
    // the existing graph and analyses metadata instead of re-parsing.
    if (!opts.full) {
      const prior = readScanCache(root);
      const current = new Map<string, { mtimeMs: number; size: number }>();
      for (const rel of filtered) {
        try {
          const st = fs.statSync(path.join(root, rel));
          current.set(rel, { mtimeMs: st.mtimeMs, size: st.size });
        } catch {
          // stat failure → force a rescan for this file
          current.set(rel, { mtimeMs: -1, size: -1 });
        }
      }
      const unchanged = prior && sameScanSet(prior.entries, current);
      if (unchanged) {
        const nodes = db.listFiles();
        const edges = db.listEdges();
        db.close();
        return {
          files: [], // callers re-list from graph when needed
          nodes,
          edges,
          totalFiles: nodes.length,
          totalSize: nodes.reduce((s, n) => s + n.size, 0),
          cached: true,
        };
      }
    }

    const progress = new Progress("scan", filtered.length);

    for (const rel of filtered) {
      const lang = detectLanguage(rel);
      if (!lang) continue;
      const abs = path.join(root, rel);
      const stat = fs.statSync(abs);
      if (stat.size > 2_000_000) continue; // skip binary/huge

      const src = fs.readFileSync(abs, "utf-8");
      const analysis = await parseFile(rel, src, lang);
      analyses.push(analysis);
      totalSize += stat.size;
      progress.tick();

      // upsert into graph
      db.upsertFile({
        path: analysis.path,
        hash: analysis.hash,
        language: analysis.language,
        size: analysis.size,
        symbolCount: analysis.symbols.length,
        importCount: analysis.imports.length,
      });

      // resolve imports → edges
      for (const imp of analysis.imports) {
        const resolved = resolveImport(rel, imp.raw, root, mem.pathAliases ?? {});
        if (resolved) {
          db.insertEdge({
            from: rel,
            to: resolved,
            raw: imp.raw,
            resolved: true,
          });
        }
      }
    }

    const nodes = db.listFiles();
    const edges = db.listEdges();
    writeScanCache(root, filtered);
    progress.done();
    return {
      files: analyses,
      nodes,
      edges,
      totalFiles: analyses.length,
      totalSize,
    };
  } finally {
    db.close();
  }
}

async function parseFile(rel: string, src: string, lang: Language): Promise<FileAnalysis> {
  if (lang === "php") return parsePhp(rel, src);
  if (lang === "typescript") return parseTs(rel, src, "typescript");
  if (lang === "javascript") return parseTs(rel, src, "javascript");
  return parsePython(rel, src);
}

const SCAN_CACHE_FILE = ".scan-cache.json";

interface ScanCache {
  version: 1;
  entries: { path: string; mtimeMs: number; size: number }[];
}

function scanCachePath(root: string): string {
  return path.join(root, ".contextforge", SCAN_CACHE_FILE);
}

function readScanCache(root: string): ScanCache | null {
  try {
    const raw = fs.readFileSync(scanCachePath(root), "utf-8");
    const parsed = JSON.parse(raw) as ScanCache;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeScanCache(root: string, files: string[]): void {
  try {
    const entries: ScanCache["entries"] = [];
    for (const rel of files) {
      try {
        const st = fs.statSync(path.join(root, rel));
        entries.push({ path: rel, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        // skip — next scan will rescan this file
      }
    }
    const dir = path.dirname(scanCachePath(root));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      scanCachePath(root),
      JSON.stringify({ version: 1, entries } satisfies ScanCache),
      "utf-8",
    );
  } catch {
    // best-effort
  }
}

function sameScanSet(
  prior: ScanCache["entries"],
  current: Map<string, { mtimeMs: number; size: number }>,
): boolean {
  if (prior.length !== current.size) return false;
  const byPath = new Map(prior.map((e) => [e.path, e]));
  for (const [p, info] of current) {
    const pe = byPath.get(p);
    if (!pe) return false;
    if (pe.mtimeMs !== info.mtimeMs || pe.size !== info.size) return false;
  }
  return true;
}

/**
 * Lightweight file lister that does not parse — used when scanning the
 * candidate list or doing quick repo-size estimation.
 */
export function listRepoFiles(root: string, memory: ReturnType<typeof readProjectMemory>): string[] {
  if (!memory) return [];
  return fg.sync(["**/*"], {
    cwd: root,
    dot: false,
    absolute: false,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: memory.ignoreGlobs,
  });
}
