import type { FileAnalysis, ImportRef, SymbolRef, RouteRef, Language } from "../types.js";

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

export async function parseTs(
  path: string,
  src: string,
  language: "typescript" | "javascript" = "typescript",
): Promise<FileAnalysis> {
  const imports: ImportRef[] = [];
  const symbols: SymbolRef[] = [];
  const routes: RouteRef[] = [];
  const tests: SymbolRef[] = [];
  const tags: string[] = [];

  // ES imports: `import x from 'y'`, `import { a, b } from 'y'`, `import * as x from 'y'`
  for (const m of regexAll(
    src,
    /(?:^|\n)\s*import\s+(?:type\s+)?(?:[\w*\s{},]+from\s+)?['"]([^'"]+)['"]/g,
  )) {
    const typeOnly = /\bimport\s+type\b/.test(m[0]);
    imports.push({ raw: m[1], line: lineOf(src, m.index), typeOnly });
  }

  // CommonJS require
  for (const m of regexAll(src, /require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    imports.push({ raw: m[1], line: lineOf(src, m.index) });
  }

  // dynamic import
  for (const m of regexAll(src, /import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    imports.push({ raw: m[1], line: lineOf(src, m.index) });
  }

  // class declarations
  for (const m of regexAll(src, /(?:^|\n)\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/g)) {
    symbols.push({ kind: "class", name: m[1], line: lineOf(src, m.index) });
  }

  // function declarations
  for (const m of regexAll(
    src,
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
  )) {
    symbols.push({ kind: "function", name: m[1], line: lineOf(src, m.index) });
  }

  // arrow-function components (heuristic for React pages / handlers)
  for (const m of regexAll(
    src,
    /(?:^|\n)\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Z][A-Za-z0-9_]+)/g,
  )) {
    symbols.push({ kind: "function", name: m[1], line: lineOf(src, m.index) });
  }

  // arrow-function component: `export const Foo = (...) => ...` or `const Foo = (...) => ...`
  for (const m of regexAll(
    src,
    /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?const\s+([A-Z][A-Za-z0-9_]+)\s*(?::\s*[A-Za-z0-9_<>\[\]\.\s,]+)?\s*=\s*(?:(?:async\s*)?\([^)]*\)|[A-Za-z0-9_]+)\s*=>/g,
  )) {
    symbols.push({ kind: "function", name: m[1], line: lineOf(src, m.index), annotation: "arrow" });
  }

  // decorators on the line directly above a class/method/function.
  // Two passes:
  //   pass 1: decorator directly before `class NAME` or `function NAME`
  //   pass 2: decorator before a method (`public/private/protected NAME(`)
  for (const m of regexAll(
    src,
    /(?:^|\n)\s*@([A-Za-z_][A-Za-z0-9_\.]*)(?:\([^)]*\))?\s*\n[ \t]*(?:export\s+)?(?:abstract\s+)?(?:class|function)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  )) {
    symbols.push({
      kind: "decorator",
      name: m[2],
      annotation: m[1],
      line: lineOf(src, m.index),
    });
  }
  for (const m of regexAll(
    src,
    /(?:^|\n)\s*@([A-Za-z_][A-Za-z0-9_\.]*)(?:\([^)]*\))?\s*\n[ \t]*(?:public|private|protected|static|async|readonly|get|set)\s+(?:[A-Za-z<>\[\]\?\s,]*?)\s*([A-Za-z_][A-Za-z0-9_]*)\s*[\(<]/g,
  )) {
    // Skip duplicates already captured by the class/function pass
    if (symbols.some((s) => s.kind === "decorator" && s.name === m[2] && s.annotation === m[1])) continue;
    symbols.push({
      kind: "decorator",
      name: m[2],
      annotation: m[1],
      line: lineOf(src, m.index),
    });
  }

  // test functions
  for (const m of regexAll(
    src,
    /(?:^|\n)\s*(?:it|test|describe)\s*\(\s*['"`]([^'"`]+)['"`]/g,
  )) {
    tests.push({ kind: "test", name: m[1], line: lineOf(src, m.index), annotation: "jest/vitest" });
  }

  // Next.js route handlers
  for (const m of regexAll(
    src,
    /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
  )) {
    routes.push({ method: m[1], handler: m[1], line: lineOf(src, m.index) });
  }

  // tags
  if (/\/api\//.test(path) || /\/route\.(t|j)sx?$/.test(path)) tags.push("route");
  if (/\/pages\//.test(path)) tags.push("page");
  if (/\/components\//.test(path)) tags.push("component");
  if (/\/hooks?\//.test(path)) tags.push("hook");
  if (/\/services?\//.test(path)) tags.push("service");
  if (/\/controllers?\//.test(path)) tags.push("controller");
  if (/\/models?\//.test(path)) tags.push("model");
  if (/\/__tests__\//.test(path) || /\.(test|spec)\.(t|j)sx?$/.test(path)) tags.push("test");

  return {
    path,
    language: language as Language,
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
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}
