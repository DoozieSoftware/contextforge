import { formatReport, type BudgetReport } from "./budget.js";
import type { LlmStats } from "../llm/stats.js";

export interface RenderOptions {
  report: BudgetReport;
  stats?: LlmStats;
  title?: string;
}

export function renderFinalMarkdown(body: string, opts: RenderOptions): string {
  const parts: string[] = [];
  if (opts.title) {
    parts.push(`# ${opts.title}`);
    parts.push("");
  }
  if (body.trim()) {
    parts.push(body.trim());
  }
  parts.push(formatReport(opts.report));
  if (opts.stats && opts.stats.calls.length > 0) {
    parts.push("");
    parts.push("## LLM Stats");
    parts.push("");
    for (const call of opts.stats.calls) {
      parts.push(
        `- ${call.role.toUpperCase()}: ${call.model} • ${call.tokensIn.toLocaleString()} in / ${call.tokensOut.toLocaleString()} out${call.tools ? ` • tools: ${call.tools}` : ""}`,
      );
    }
    parts.push("");
    parts.push(
      `**Totals**: ${opts.stats.totalCalls} calls • ${opts.stats.totalTokensIn.toLocaleString()} in / ${opts.stats.totalTokensOut.toLocaleString()} out • est. cost $${opts.stats.estimatedCostUsd.toFixed(4)}`,
    );
  }
  return parts.join("\n");
}

export type OutputFormat = "markdown" | "context" | "json";

/**
 * Renders the command result in one of the supported output formats.
 *
 * - markdown: the brief-shaped body + budget footer + LLM stats (default)
 * - context:  the raw CONTEXT PACKAGE the writer saw, plus the file list
 *              and selection summary (the "give me the smallest
 *              high-signal code context" promise the product makes)
 * - json:     machine-readable object for piping into other tools
 */
export function renderOutput(
  fmt: OutputFormat,
  payload: {
    title?: string;
    body: string;
    report: BudgetReport;
    stats?: LlmStats;
    packageFiles?: { path: string; tokens: number; kind: string; reason: string }[];
    target?: string;
    query?: string;
    /**
     * Pre-rendered raw CONTEXT PACKAGE markdown with full file
     * contents. When present, the `context` format emits this instead
     * of the metadata summary.
     */
    contextPackageMd?: string;
  },
): string {
  if (fmt === "json") {
    return JSON.stringify(
      {
        title: payload.title,
        body: payload.body,
        report: payload.report,
        stats: payload.stats,
        files: payload.packageFiles,
        contextPackageMd: payload.contextPackageMd,
        target: payload.target,
        query: payload.query,
      },
      null,
      2,
    );
  }
  if (fmt === "context") {
    // When the command produced a raw context package (full file
    // contents), prefer that over the metadata-only summary. This is
    // the "give me the smallest high-signal code context" promise.
    if (payload.contextPackageMd) {
      const parts: string[] = [];
      if (payload.title) {
        parts.push(`# ${payload.title} — context package`);
        parts.push("");
      }
      parts.push(formatReport(payload.report));
      parts.push("");
      parts.push(payload.contextPackageMd);
      return parts.join("\n") + "\n";
    }
    // Fallback: metadata-only summary
    const parts: string[] = [];
    if (payload.title) {
      parts.push(`# ${payload.title} — context package`);
      parts.push("");
    }
    parts.push(formatReport(payload.report));
    if (payload.packageFiles && payload.packageFiles.length > 0) {
      parts.push("");
      parts.push("## Files in this package");
      parts.push("");
      for (const f of payload.packageFiles) {
        parts.push(`- \`${f.path}\` — ${f.tokens.toLocaleString()} tokens · ${f.kind} · ${f.reason}`);
      }
    }
    return parts.join("\n") + "\n";
  }
  return renderFinalMarkdown(payload.body, { report: payload.report, stats: payload.stats, title: payload.title });
}
