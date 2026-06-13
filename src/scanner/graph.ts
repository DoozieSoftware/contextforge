import path from "node:path";
import fs from "node:fs";
import { graphFilePath, projectDir } from "../memory/project.js";
import { ensureDir } from "../util/fs.js";
import type { GraphNode, GraphEdge } from "./types.js";

export interface GraphDB {
  upsertFile(node: GraphNode): void;
  insertEdge(edge: GraphEdge): void;
  getFile(p: string): GraphNode | null;
  listFiles(): GraphNode[];
  listEdges(): GraphEdge[];
  edgesFrom(p: string): GraphEdge[];
  edgesTo(p: string): GraphEdge[];
  clear(): void;
  removeFile(path: string): void;
  close(): void;
}

interface GraphSnapshot {
  version: 1;
  files: GraphNode[];
  edges: GraphEdge[];
}

const EMPTY: GraphSnapshot = { version: 1, files: [], edges: [] };

/**
 * JSON-file-backed import graph. Holds the data in memory for fast
 * BFS lookups and writes the whole snapshot to disk on `close()`.
 *
 * Why JSON over SQLite: the graph is small (one row per file, one row
 * per edge) and the only consumer is a single CLI invocation. SQLite
 * pulled in a native build (better-sqlite3) that breaks the npm install
 * on recent Node versions. JSON is a few hundred lines fewer in deps
 * and good enough for a cache.
 *
 * Atomicity: write to `<file>.tmp` then rename, so a crash mid-write
 * leaves the previous snapshot intact. Worst case is a stale snapshot
 * that gets rebuilt on the next scan (the .scan-cache.json mtime check
 * already handles this gracefully).
 */
export function openGraph(root: string): GraphDB {
  const dir = projectDir(root);
  ensureDir(dir);
  const file = graphFilePath(root);

  let snapshot: GraphSnapshot = readSnapshot(file);
  // Indexes: by path, and by from/to for edges.
  const filesByPath = new Map<string, GraphNode>();
  for (const n of snapshot.files) filesByPath.set(n.path, n);
  const edgesByFrom = new Map<string, GraphEdge[]>();
  const edgesByTo = new Map<string, GraphEdge[]>();
  for (const e of snapshot.edges) {
    pushEdge(edgesByFrom, e.from, e);
    pushEdge(edgesByTo, e.to, e);
  }

  // Edge identity: (from, to, raw). The SQLite version had a PRIMARY KEY
  // on that tuple; we replicate with a Set keyed on the same.
  const edgeKeys = new Set<string>();
  for (const e of snapshot.edges) edgeKeys.add(edgeKey(e.from, e.to, e.raw));

  let dirty = false;

  function markDirty() {
    dirty = true;
  }

  return {
    upsertFile(node) {
      const existing = filesByPath.get(node.path);
      if (
        existing &&
        existing.hash === node.hash &&
        existing.language === node.language &&
        existing.size === node.size &&
        existing.symbolCount === node.symbolCount &&
        existing.importCount === node.importCount
      ) {
        return; // no-op
      }
      filesByPath.set(node.path, { ...node });
      markDirty();
    },
    insertEdge(edge) {
      const k = edgeKey(edge.from, edge.to, edge.raw);
      if (edgeKeys.has(k)) return;
      edgeKeys.add(k);
      pushEdge(edgesByFrom, edge.from, edge);
      pushEdge(edgesByTo, edge.to, edge);
      markDirty();
    },
    getFile(p) {
      const n = filesByPath.get(p);
      return n ? { ...n } : null;
    },
    listFiles() {
      return Array.from(filesByPath.values()).map((n) => ({ ...n }));
    },
    listEdges() {
      const all: GraphEdge[] = [];
      for (const list of edgesByFrom.values()) for (const e of list) all.push({ ...e });
      return all;
    },
    edgesFrom(p) {
      return (edgesByFrom.get(p) ?? []).map((e) => ({ ...e }));
    },
    edgesTo(p) {
      return (edgesByTo.get(p) ?? []).map((e) => ({ ...e }));
    },
    clear() {
      if (filesByPath.size === 0 && edgeKeys.size === 0) return;
      filesByPath.clear();
      edgesByFrom.clear();
      edgesByTo.clear();
      edgeKeys.clear();
      markDirty();
    },
    removeFile(p) {
      if (filesByPath.delete(p)) markDirty();
      const from = edgesByFrom.get(p);
      if (from && from.length) {
        markDirty();
        for (const e of from) edgeKeys.delete(edgeKey(e.from, e.to, e.raw));
        edgesByFrom.delete(p);
      }
      const to = edgesByTo.get(p);
      if (to && to.length) {
        markDirty();
        for (const e of to) edgeKeys.delete(edgeKey(e.from, e.to, e.raw));
        edgesByTo.delete(p);
      }
    },
    close() {
      if (!dirty) return;
      const next: GraphSnapshot = {
        version: 1,
        files: Array.from(filesByPath.values()),
        edges: collectEdges(edgesByFrom),
      };
      writeSnapshot(file, next);
      snapshot = next;
      dirty = false;
    },
  };
}

function readSnapshot(file: string): GraphSnapshot {
  try {
    const text = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(text) as GraphSnapshot;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.files) || !Array.isArray(parsed.edges)) {
      return { ...EMPTY };
    }
    return parsed;
  } catch {
    return { ...EMPTY };
  }
}

function writeSnapshot(file: string, snapshot: GraphSnapshot): void {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(snapshot));
  fs.renameSync(tmp, file);
}

function edgeKey(from: string, to: string, raw: string): string {
  return `${from}\u0000${to}\u0000${raw}`;
}

function pushEdge(map: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
  const list = map.get(key);
  if (list) list.push(edge);
  else map.set(key, [edge]);
}

function collectEdges(byFrom: Map<string, GraphEdge[]>): GraphEdge[] {
  const out: GraphEdge[] = [];
  for (const list of byFrom.values()) for (const e of list) out.push(e);
  return out;
}

/**
 * Resolve an import specifier to a file path within the repo, applying the
 * standard heuristics per language.
 */
export function resolveImport(
  fromFile: string,
  spec: string,
  root: string,
  pathAliases: Record<string, string> = {},
): string | null {
  const dir = path.dirname(fromFile);
  const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".php"];

  // PHP PSR-4: App backslash Services backslash InvoiceService -> app/Services/InvoiceService.php
  if (/^[A-Z][A-Za-z0-9_\\]+$/.test(spec) && !spec.startsWith(".") && !spec.startsWith("@")) {
    const parts = spec.replace(/\\/g, "/").split("/");
    const fileName = parts.pop() + ".php";
    let cur = root;
    for (const part of parts) {
      if (!fs.existsSync(cur)) return null;
      const entries = fs.readdirSync(cur);
      const match = entries.find((e) => e.toLowerCase() === part.toLowerCase());
      if (!match) return null;
      cur = path.join(cur, match);
    }
    if (!fs.existsSync(cur)) return null;
    const entries = fs.readdirSync(cur);
    const fileMatch = entries.find((e) => e.toLowerCase() === fileName.toLowerCase());
    if (!fileMatch) return null;
    return path.relative(root, path.join(cur, fileMatch));
  }

  // Python: app.services.invoice -> app/services/invoice.py
  if (/^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(spec)) {
    const rel = spec.replace(/\./g, "/");
    for (const ext of exts) {
      const guess = path.join(root, rel + ext);
      if (fs.existsSync(guess)) return path.relative(root, guess);
    }
    const pkg = path.join(root, rel, "__init__.py");
    if (fs.existsSync(pkg)) return path.relative(root, pkg);
  }

  // JS/TS relative
  if (spec.startsWith(".") || spec.startsWith("/")) {
    const base = path.resolve(root, dir, spec);
    const hit = resolveToFile(root, base, exts);
    if (hit) return path.relative(root, hit);
    return null;
  }

  // Project-specific aliases (e.g. {"@/": "src", "@components": "src/components"})
  // Try longest prefix first to avoid greedy matches.
  const aliasKeys = Object.keys(pathAliases).sort((a, b) => b.length - a.length);
  for (const alias of aliasKeys) {
    if (spec === alias || spec.startsWith(alias + "/") || spec.startsWith(alias)) {
      const rest = spec.slice(alias.length).replace(/^\//, "");
      const target = pathAliases[alias] ?? ".";
      const base = path.resolve(root, target, rest);
      const hit = resolveToFile(root, base, exts);
      if (hit) return path.relative(root, hit);
    }
  }

  // Built-in @/ → root (Next.js convention) and /-rooted imports.
  if (spec.startsWith("@/")) {
    const base = path.resolve(root, spec.slice(2));
    const hit = resolveToFile(root, base, exts);
    if (hit) return path.relative(root, hit);
  }

  return null;
}

function resolveToFile(root: string, base: string, exts: string[]): string | null {
  for (const ext of exts) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  if (fs.existsSync(path.join(base, "index.ts"))) return path.join(base, "index.ts");
  if (fs.existsSync(path.join(base, "index.js"))) return path.join(base, "index.js");
  return null;
}
