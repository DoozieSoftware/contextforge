import type { FileAnalysis, ImportRef, SymbolRef, RouteRef, Language } from "../types.js";

/**
 * Lightweight PHP scanner. We avoid a hard tree-sitter dependency in the runtime
 * path so the tool still works in restricted environments; we fall back to
 * line-based regex extraction which is good enough for the heuristics that
 * drive the planner model. tree-sitter is still wired in as an optional
 * import below — when available we use it for richer symbol extraction.
 */
let cachedParser: any = null;
async function getTreeSitter(): Promise<any | null> {
  if (cachedParser) return cachedParser;
  try {
    const ts = await import("tree-sitter");
    const php = await import("tree-sitter-php");
    cachedParser = new (ts as any).Parser();
    cachedParser.setLanguage((php as any).php);
    return cachedParser;
  } catch {
    return null;
  }
}

function lineOf(src: string, idx: number): number {
  let line = 1;
  for (let i = 0; i < idx && i < src.length; i++) {
    if (src.charCodeAt(i) === 10) line++;
  }
  return line;
}

function regexAll(src: string, re: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m);
  return out;
}

export async function parsePhp(path: string, src: string): Promise<FileAnalysis> {
  const imports: ImportRef[] = [];
  const symbols: SymbolRef[] = [];
  const routes: RouteRef[] = [];
  const tests: SymbolRef[] = [];
  const tags: string[] = [];

  // imports
  for (const m of regexAll(src, /(?:^|\n)\s*use\s+([A-Za-z0-9_\\]+)(?:\s+as\s+([A-Za-z0-9_]+))?/g)) {
    imports.push({ raw: m[1], line: lineOf(src, m.index) });
  }

  // namespaces
  for (const m of regexAll(src, /(?:^|\n)\s*namespace\s+([A-Za-z0-9_\\]+)/g)) {
    symbols.push({ kind: "namespace", name: m[1], line: lineOf(src, m.index) });
  }

  // classes / interfaces / traits
  for (const m of regexAll(
    src,
    /(?:^|\n)\s*(?:abstract\s+|final\s+)?(?:class|interface|trait)\s+([A-Za-z0-9_]+)/g,
  )) {
    symbols.push({ kind: "class", name: m[1], line: lineOf(src, m.index) });
  }

  // functions / methods
  for (const m of regexAll(src, /(?:^|\n)\s*(?:public|private|protected|static|\s)*function\s+([A-Za-z0-9_]+)/g)) {
    const name = m[1];
    if (name.startsWith("test") || /Test$/.test(name)) {
      tests.push({ kind: "method", name, line: lineOf(src, m.index), annotation: "phpunit" });
    } else {
      symbols.push({ kind: "method", name, line: lineOf(src, m.index) });
    }
  }

  // routes (Laravel)
  for (const m of regexAll(src, /Route::(get|post|put|patch|delete|any|match)\s*\(\s*['"]([^'"]*)['"]\s*,\s*([^)]+)\)/g)) {
    routes.push({ method: m[1].toUpperCase(), path: m[2], handler: m[3].trim(), line: lineOf(src, m.index) });
  }

  // PHP 8 attributes: #[Route('/api')], #[ORM\Entity], etc.
  for (const m of regexAll(src, /#\[([^\]\n]+)\]/g)) {
    const first = m[1].split(",")[0].trim();
    symbols.push({
      kind: "decorator",
      name: first.replace(/\s*\(.*\)$/, ""),
      annotation: "attribute",
      line: lineOf(src, m.index),
    });
  }

  // function / method return type: `function foo(...): Type`
  for (const m of regexAll(
    src,
    /function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*:[^{;\n]+/g,
  )) {
    const ret = m[0].split(":").slice(1).join(":").trim().replace(/\s*\/\*.*?\*\//g, "").trim();
    if (!ret) continue;
    const line = lineOf(src, m.index);
    const existing = symbols.find((s) => s.name === m[1] && Math.abs(s.line - line) <= 3);
    if (existing) {
      existing.annotation = `${existing.annotation ?? ""}->${ret}`.replace(/^->/, "");
    }
  }

  // tags from filename heuristics
  if (/\/Controllers\//i.test(path)) tags.push("controller");
  if (/\/Models\//i.test(path)) tags.push("model");
  if (/\/Services\//i.test(path)) tags.push("service");
  if (/\/Http\/Requests\//i.test(path)) tags.push("request");
  if (/\/Http\/Resources\//i.test(path)) tags.push("resource");
  if (/\/Jobs\//i.test(path)) tags.push("job");
  if (/\/Events\//i.test(path)) tags.push("event");
  if (/\/Listeners\//i.test(path)) tags.push("listener");
  if (/\/Policies\//i.test(path)) tags.push("policy");
  if (/\/Migrations\//i.test(path)) tags.push("migration");
  if (/\/Tests\//i.test(path) || /Test\.php$/.test(path)) tags.push("test");

  return {
    path,
    language: "php" as Language,
    size: src.length,
    hash: hash(src),
    imports,
    symbols,
    routes,
    tests,
    tags,
  };
}

function hash(s: string): string {
  // tiny FNV-1a — good enough for change detection
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}
