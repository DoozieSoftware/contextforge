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

export async function parsePython(path: string, src: string): Promise<FileAnalysis> {
  const imports: ImportRef[] = [];
  const symbols: SymbolRef[] = [];
  const routes: RouteRef[] = [];
  const tests: SymbolRef[] = [];
  const tags: string[] = [];

  // `import x`, `import x.y`, `import x.y as z`
  for (const m of regexAll(src, /(?:^|\n)\s*import\s+([A-Za-z0-9_\.]+)(?:\s+as\s+([A-Za-z0-9_]+))?/g)) {
    imports.push({ raw: m[1], line: lineOf(src, m.index) });
  }

  // `from x import y, z`
  for (const m of regexAll(src, /(?:^|\n)\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+([^\n]+)/g)) {
    const typeOnly = /\bfrom\s+typing\b/.test(m[0]);
    imports.push({ raw: m[1], line: lineOf(src, m.index), typeOnly });
  }

  // class declarations
  for (const m of regexAll(src, /(?:^|\n)\s*class\s+([A-Za-z0-9_]+)/g)) {
    symbols.push({ kind: "class", name: m[1], line: lineOf(src, m.index) });
  }

  // function declarations with optional return type annotation
  // `def foo(...):`  or  `def foo(...) -> SomeType:`
  for (const m of regexAll(
    src,
    /(?:^|\n)\s*(async\s+)?def\s+([A-Za-z0-9_]+)\s*\([^)]*\)(?:\s*->\s*([^:]+?))?(?::|\s*$)/gm,
  )) {
    const isAsync = !!m[1];
    const name = m[2];
    const returnType = (m[3] ?? "").trim() || undefined;
    if (name.startsWith("test_")) {
      tests.push({ kind: "function", name, line: lineOf(src, m.index), annotation: "pytest" });
    } else {
      symbols.push({
        kind: "function",
        name,
        line: lineOf(src, m.index),
        annotation: isAsync ? (returnType ? `async->${returnType}` : "async") : returnType,
      });
    }
  }

  // top-level await / async-with: capture as a tag if present
  if (/\basync\s+def\b/.test(src)) tags.push("async");
  if (/\bawait\s+/.test(src)) tags.push("await");

  // decorators on functions
  for (const m of regexAll(
    src,
    /(?:^|\n)\s*@([A-Za-z0-9_\.]+)[^\n]*\n\s*(?:async\s+)?def\s+([A-Za-z0-9_]+)/g,
  )) {
    symbols.push({
      kind: "decorator",
      name: m[2],
      line: lineOf(src, m.index),
      annotation: m[1],
    });
  }

  // FastAPI / Flask route detection
  for (const m of regexAll(
    src,
    /@app\.(get|post|put|patch|delete|route)\s*\(\s*['"]([^'"]*)['"]/g,
  )) {
    const handler = src.slice(m.index).match(/def\s+([A-Za-z0-9_]+)/);
    routes.push({
      method: m[1].toUpperCase(),
      path: m[2],
      handler: handler ? handler[1] : undefined,
      line: lineOf(src, m.index),
    });
  }

  // Django URL patterns (heuristic)
  for (const m of regexAll(src, /path\(\s*['"]([^'"]*)['"]\s*,\s*([A-Za-z0-9_.\:]+)/g)) {
    routes.push({ method: "PATH", path: m[1], handler: m[2], line: lineOf(src, m.index) });
  }

  // tags
  if (/\/views?\//.test(path) || /views?\.py$/.test(path)) tags.push("view");
  if (/\/models?\//.test(path) || /models?\.py$/.test(path)) tags.push("model");
  if (/\/serializers?\//.test(path) || /serializers?\.py$/.test(path)) tags.push("serializer");
  if (/\/services?\//.test(path) || /services?\.py$/.test(path)) tags.push("service");
  if (/\/controllers?\//.test(path)) tags.push("controller");
  if (/\/tests?\//.test(path) || /test_[^/]*\.py$/.test(path)) tags.push("test");

  return {
    path,
    language: "python" as Language,
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
