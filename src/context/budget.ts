import { encode } from "gpt-tokenizer";

export function countTokens(s: string): number {
  if (!s) return 0;
  try {
    return encode(s).length;
  } catch {
    // Approximate fallback: 4 chars per token
    return Math.ceil(s.length / 4);
  }
}

export interface BudgetReport {
  filesScanned: number;
  filesSelected: number;
  repoSize: number;
  contextSize: number;
  reduction: number;
}

export function buildReport(
  filesScanned: number,
  filesSelected: number,
  repoSize: number,
  contextSize: number,
): BudgetReport {
  const reduction = repoSize === 0 ? 0 : 1 - contextSize / repoSize;
  return {
    filesScanned,
    filesSelected,
    repoSize,
    contextSize,
    reduction,
  };
}

export function formatReport(r: BudgetReport): string {
  const pct = (r.reduction * 100).toFixed(1) + "%";
  return [
    "",
    "---",
    `Files Scanned: ${r.filesScanned.toLocaleString()}`,
    `Files Selected: ${r.filesSelected.toLocaleString()}`,
    `Repo Size:     ${r.repoSize.toLocaleString()} tokens`,
    `Context Size:  ${r.contextSize.toLocaleString()} tokens`,
    `Reduction:     ${pct}`,
    "",
  ].join("\n");
}
