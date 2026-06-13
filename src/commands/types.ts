import type { AppConfig } from "../util/config.js";
import type { ProjectMemory } from "../memory/project.js";
import type { LLMProvider } from "../llm/types.js";
import type { LlmStats } from "../llm/stats.js";
import type { BudgetReport } from "../context/budget.js";

export interface CommandContext {
  root: string;
  cwd: string;
  appConfig: AppConfig;
  memory: ProjectMemory;
  provider: LLMProvider;
  stats: LlmStats;
  offline: boolean;
  quiet?: boolean;
}

export interface PackageFileSummary {
  path: string;
  tokens: number;
  kind: string;
  reason: string;
}

export interface CommandResult {
  body: string;
  stats: LlmStats;
  report: BudgetReport;
  title?: string;
  packageFiles?: PackageFileSummary[];
  target?: string;
  query?: string;
  fallbackReason?: string;
  /**
   * Pre-rendered raw CONTEXT PACKAGE markdown (file contents with
   * `## path` headers, kind/tokens/reason metadata, and code fences).
   * Populated by commands that build a context package (understand,
   * trace, package). The renderer's `context` format uses this when
   * present so the user gets the actual file contents, not just the
   * metadata summary.
   */
  contextPackageMd?: string;
}
