import path from "node:path";
import fs from "node:fs";

/**
 * Resolves a user-supplied path against a sandbox root and rejects escapes.
 * Throws if the resolved path is outside of root.
 */
export function safeResolve(root: string, requested: string): string {
  const rootResolved = path.resolve(root);
  const candidate = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(rootResolved, requested);
  const rel = path.relative(rootResolved, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes sandbox root: ${requested}`);
  }
  return candidate;
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function readFileSafe(p: string, maxBytes = 2_000_000): string {
  const stat = fs.statSync(p);
  if (stat.size > maxBytes) {
    const buf = fs.readFileSync(p, { encoding: "utf-8", flag: "r" });
    return buf.slice(0, maxBytes) + "\n\n/* …truncated… */\n";
  }
  return fs.readFileSync(p, "utf-8");
}

export function listDirSafe(p: string, max = 200): string[] {
  if (!dirExists(p)) return [];
  const entries = fs.readdirSync(p, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (out.length >= max) break;
    out.push(e.isDirectory() ? `${e.name}/` : e.name);
  }
  return out;
}
