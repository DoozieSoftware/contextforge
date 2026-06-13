import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
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

export function openGraph(root: string): GraphDB {
  const dir = projectDir(root);
  ensureDir(dir);
  const file = graphFilePath(root);
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      language TEXT NOT NULL,
      size INTEGER NOT NULL,
      symbol_count INTEGER NOT NULL DEFAULT 0,
      import_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS edges (
      from_path TEXT NOT NULL,
      to_path TEXT NOT NULL,
      raw TEXT NOT NULL,
      resolved INTEGER NOT NULL,
      PRIMARY KEY (from_path, to_path, raw)
    );
    CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_path);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_path);
  `);

  const upFile = db.prepare(
    `INSERT INTO files (path, hash, language, size, symbol_count, import_count)
     VALUES (@path, @hash, @language, @size, @symbolCount, @importCount)
     ON CONFLICT(path) DO UPDATE SET
       hash=excluded.hash,
       language=excluded.language,
       size=excluded.size,
       symbol_count=excluded.symbol_count,
       import_count=excluded.import_count`,
  );
  const upEdge = db.prepare(
    `INSERT OR IGNORE INTO edges (from_path, to_path, raw, resolved)
     VALUES (@from, @to, @raw, @resolved)`,
  );
  const getFile = db.prepare(`SELECT * FROM files WHERE path = ?`);
  const listFiles = db.prepare(`SELECT * FROM files`);
  const listEdges = db.prepare(`SELECT * FROM edges`);
  const edgesFrom = db.prepare(`SELECT * FROM edges WHERE from_path = ?`);
  const edgesTo = db.prepare(`SELECT * FROM edges WHERE to_path = ?`);
  const clearEdges = db.prepare(`DELETE FROM edges`);
  const clearFiles = db.prepare(`DELETE FROM files`);
  const clearFn: () => void = () => { clearEdges.run(); clearFiles.run(); };
  const delFile = db.prepare(`DELETE FROM files WHERE path = ?`);
  const delEdgeFrom = db.prepare(`DELETE FROM edges WHERE from_path = ?`);
  const delEdgeTo = db.prepare(`DELETE FROM edges WHERE to_path = ?`);

  return {
    upsertFile(node) {
      upFile.run(node);
    },
    insertEdge(edge) {
      upEdge.run({
        from: edge.from,
        to: edge.to,
        raw: edge.raw,
        resolved: edge.resolved ? 1 : 0,
      });
    },
    getFile(p) {
      const row = getFile.get(p) as any;
      if (!row) return null;
      return {
        path: row.path,
        hash: row.hash,
        language: row.language,
        size: row.size,
        symbolCount: row.symbol_count,
        importCount: row.import_count,
      };
    },
    listFiles() {
      return (listFiles.all() as any[]).map((r) => ({
        path: r.path,
        hash: r.hash,
        language: r.language,
        size: r.size,
        symbolCount: r.symbol_count,
        importCount: r.import_count,
      }));
    },
    listEdges() {
      return (listEdges.all() as any[]).map((r) => ({
        from: r.from_path,
        to: r.to_path,
        raw: r.raw,
        resolved: !!r.resolved,
      }));
    },
    edgesFrom(p) {
      return (edgesFrom.all(p) as any[]).map((r) => ({
        from: r.from_path,
        to: r.to_path,
        raw: r.raw,
        resolved: !!r.resolved,
      }));
    },
    edgesTo(p) {
      return (edgesTo.all(p) as any[]).map((r) => ({
        from: r.from_path,
        to: r.to_path,
        raw: r.raw,
        resolved: !!r.resolved,
      }));
    },
    clear() {
      clearFn();
    },
    removeFile(p: string) {
      delFile.run(p);
      delEdgeFrom.run(p);
      delEdgeTo.run(p);
    },
    close() {
      db.close();
    },
  };
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
