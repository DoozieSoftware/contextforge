import path from "node:path";
import type { GraphDB } from "./graph.js";
import type { GraphEdge, GraphNode } from "./types.js";
import type { HeuristicFilter } from "./heuristics.js";

export interface Candidate {
  path: string;
  /** Higher score = more relevant. */
  score: number;
  /** Why this file was selected. */
  reasons: string[];
  /** Number of hops from the target. */
  depth: number;
  /** True if the candidate is a test file. */
  isTest: boolean;
  /** True if the candidate is a route definition. */
  isRoute: boolean;
  /** Coarse classification. */
  kind: HeuristicFilter["classify"] extends (...a: any) => infer R ? R : never;
  /** Symbol/import counts. */
  symbolCount: number;
  importCount: number;
  size: number;
  language: string;
}

export interface CandidateOptions {
  /** Max BFS depth from the target. Default 2. */
  depth?: number;
  /** Max number of candidates to return. Default 25. */
  max?: number;
  /** Whether to also include the target itself. Default true. */
  includeTarget?: boolean;
}

/**
 * Ranks files related to a target by BFS over the import graph. The target
 * can be a file path, a directory, or a symbol/keyword. Returns at most
 * `max` candidates with reasons explaining the relationship.
 */
export function rankCandidates(
  target: string,
  db: GraphDB,
  heuristics: HeuristicFilter,
  opts: CandidateOptions = {},
): Candidate[] {
  const depth = opts.depth ?? 2;
  const max = opts.max ?? 25;
  const includeTarget = opts.includeTarget ?? true;

  const allFiles = db.listFiles();
  const fileByPath = new Map<string, GraphNode>(allFiles.map((f) => [f.path, f]));

  // Find the target node
  const targetNode = findTargetNode(target, allFiles);
  const visited = new Map<string, { depth: number; reasons: string[]; score: number }>();

  if (targetNode) {
    if (includeTarget) {
      visited.set(targetNode.path, {
        depth: 0,
        reasons: ["target file"],
        score: 1000,
      });
    }
    bfs(targetNode.path, depth, db, visited);
  } else {
    // Fallback: keyword match on symbol names
    keywordFallback(target, allFiles, visited, depth);
  }

  const out: Candidate[] = [];
  for (const [p, v] of visited) {
    const node = fileByPath.get(p);
    if (!node) continue;
    out.push({
      path: p,
      score: v.score,
      reasons: v.reasons,
      depth: v.depth,
      isTest: heuristics.isTest(p),
      isRoute: heuristics.isRoute(p),
      kind: heuristics.classify(p),
      symbolCount: node.symbolCount,
      importCount: node.importCount,
      size: node.size,
      language: node.language,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max);
}

function bfs(
  start: string,
  maxDepth: number,
  db: GraphDB,
  visited: Map<string, { depth: number; reasons: string[]; score: number }>,
): void {
  let frontier: string[] = [start];
  for (let d = 1; d <= maxDepth; d++) {
    const next: string[] = [];
    for (const node of frontier) {
      const out = db.edgesFrom(node);
      const inc = db.edgesTo(node);
      for (const e of out) {
        consider(e.to, d, `imported by ${path.basename(node)}`, visited, next);
      }
      for (const e of inc) {
        consider(e.from, d, `imports ${path.basename(node)}`, visited, next);
      }
    }
    frontier = next;
  }
}

function consider(
  candidate: string,
  d: number,
  reason: string,
  visited: Map<string, { depth: number; reasons: string[]; score: number }>,
  next: string[],
): void {
  if (visited.has(candidate)) {
    const v = visited.get(candidate)!;
    if (d < v.depth) v.depth = d;
    if (!v.reasons.includes(reason)) v.reasons.push(reason);
    return;
  }
  const score = Math.max(0, 100 - d * 30);
  visited.set(candidate, { depth: d, reasons: [reason], score });
  next.push(candidate);
}

function findTargetNode(target: string, all: GraphNode[]): GraphNode | null {
  // exact match
  for (const n of all) {
    if (n.path === target || n.path.endsWith("/" + target) || n.path === target.replace(/^\.\//, "")) {
      return n;
    }
  }
  // basename match
  const base = path.basename(target);
  for (const n of all) {
    if (path.basename(n.path) === base) return n;
  }
  return null;
}

function keywordFallback(
  target: string,
  all: GraphNode[],
  visited: Map<string, { depth: number; reasons: string[]; score: number }>,
  depth: number,
): void {
  const kw = target.toLowerCase();
  for (const n of all) {
    const base = path.basename(n.path).toLowerCase();
    if (base.includes(kw) || kw.includes(base)) {
      visited.set(n.path, {
        depth: 0,
        reasons: [`filename matches "${target}"`],
        score: 50,
      });
    }
  }
}

export { type GraphEdge };
