import fs from "node:fs";
import { safeResolve, readFileSafe } from "../util/fs.js";
import { countTokens } from "./budget.js";
import { redactSecrets } from "./redact.js";

export interface PackageFile {
  path: string;
  content: string;
  tokens: number;
  reason: string;
  isTest: boolean;
  isRoute: boolean;
  kind: string;
  redacted: number;
  truncated: boolean;
}

export interface ContextPackage {
  files: PackageFile[];
  totalTokens: number;
  budget: number;
}

export interface BuildPackageOptions {
  budgetTokens: number;
  maxFiles: number;
  root: string;
  order?: { path: string; reason?: string; isTest?: boolean; isRoute?: boolean; kind?: string }[];
  /** When true, content is emitted with `1 │ …` line markers. */
  lineNumbers?: boolean;
  /** When true (default), redact obvious hard-coded secrets in the body. */
  redactSecrets?: boolean;
  /** Cap per-file size in bytes (default 1.5MB). */
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 1_500_000;

/**
 * Reads files from disk in a budget-aware manner. Files are admitted in
 * `order` if provided (otherwise just in the input sequence), skipped if
 * they would push the package over budget. Returns a ContextPackage with
 * the accumulated content and per-file token counts.
 */
export async function buildContextPackage(
  filePaths: string[],
  opts: BuildPackageOptions,
): Promise<ContextPackage> {
  const orderMap = new Map<string, { reason?: string; isTest?: boolean; isRoute?: boolean; kind?: string }>();
  if (opts.order) {
    for (const o of opts.order) orderMap.set(o.path, o);
  }

  const out: PackageFile[] = [];
  let totalTokens = 0;
  const seen = new Set<string>();
  const maxBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  for (const rel of filePaths) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (out.length >= opts.maxFiles) break;

    let abs: string;
    try {
      abs = safeResolve(opts.root, rel);
    } catch {
      continue;
    }
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    if (stat.size > maxBytes) continue;

    const raw = readFileSafe(abs, maxBytes);
    const truncated = stat.size > maxBytes;
    const shouldRedact = opts.redactSecrets !== false;
    const redacted = shouldRedact ? redactSecrets(raw) : raw;
    const content = opts.lineNumbers ? withLineNumbers(redacted) : redacted;
    const tokens = countTokens(content);
    if (totalTokens + tokens > opts.budgetTokens) continue;
    totalTokens += tokens;

    const meta = orderMap.get(rel);
    out.push({
      path: rel,
      content,
      tokens,
      reason: meta?.reason ?? "selected by planner",
      isTest: !!meta?.isTest,
      isRoute: !!meta?.isRoute,
      kind: meta?.kind ?? "other",
      redacted: shouldRedact ? countReplacements(redacted) : 0,
      truncated,
    });
  }

  return { files: out, totalTokens, budget: opts.budgetTokens };
}

function withLineNumbers(s: string): string {
  // Strip the last "truncated" marker (we add line numbers before it for legibility)
  const truncationMarker = "\n\n/* …truncated… */\n";
  const hasTruncation = s.endsWith(truncationMarker);
  const body = hasTruncation ? s.slice(0, -truncationMarker.length) : s;
  const lines = body.split("\n");
  const width = String(lines.length).length;
  const numbered = lines.map((l, i) => `${String(i + 1).padStart(width, " ")} │ ${l}`).join("\n");
  return numbered + (hasTruncation ? truncationMarker : "");
}

function countReplacements(s: string): number {
  return (s.match(/<REDACTED:[A-Z_]+>/g) ?? []).length;
}

export function packageToMarkdown(pkg: ContextPackage, _lineNumbers = false): string {
  // Note: f.content is already line-numbered (or not) by the package
  // builder, depending on opts.lineNumbers passed to buildContextPackage.
  // We do NOT re-apply line numbers here — that would produce
  // "1 │  1 │ ..." double-numbering. The `_lineNumbers` arg is kept
  // for backwards-compat with callers that pass it.
  const parts: string[] = [];
  parts.push("# CONTEXT PACKAGE");
  parts.push("");
  for (const f of pkg.files) {
    const tags = [f.kind, f.isTest ? "test" : null, f.isRoute ? "route" : null, f.truncated ? "truncated" : null]
      .filter(Boolean)
      .join(" · ");
    const meta = `*${tags} · ${f.tokens.toLocaleString()} tokens · ${f.reason}${f.redacted > 0 ? ` · ${f.redacted} secret(s) redacted` : ""}*`;
    parts.push(`## ${f.path}`);
    parts.push("");
    parts.push(meta);
    parts.push("");
    parts.push("```");
    parts.push(f.content.trim());
    parts.push("```");
    parts.push("");
  }
  return parts.join("\n");
}
