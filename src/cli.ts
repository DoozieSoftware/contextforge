#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runUnderstand } from "./commands/understand.js";
import { runTrace } from "./commands/trace.js";
import { runReview } from "./commands/review.js";
import { runBreakdown } from "./commands/breakdown.js";
import { runProposal } from "./commands/proposal.js";
import { runScan } from "./commands/scan.js";
import { runMemory } from "./commands/memory.js";
import { renderOutput, type OutputFormat } from "./context/render.js";
import { readProjectMemory, detectProjectMemory, writeProjectMemory } from "./memory/project.js";
import { loadConfig, hasUsableConfig, type AppConfig } from "./util/config.js";
import { findRepoRoot } from "./util/repo.js";
import { getProvider } from "./llm/provider.js";
import { createStats } from "./llm/stats.js";
import { log } from "./util/log.js";
import { parsePositiveInteger, parseNonNegativeInteger, CommandError } from "./util/args.js";
import { CostExceededError } from "./llm/cost.js";
import { CachedProvider } from "./llm/cached.js";
import { LLMCache } from "./llm/cache.js";
import type { CommandContext } from "./commands/types.js";

const VERSION = "0.1.0";

const QUIET = process.env.CTX_QUIET === "1" || process.env.CTX_QUIET === "true";
function logf(level: "info" | "warn" | "error", msg: string) {
  if (QUIET && level !== "error") return;
  const tag = level === "info" ? "i" : level === "warn" ? "w" : "!";
  process.stderr.write(`[${tag}] ${msg}\n`);
}

interface BuildOpts {
  offline: boolean;
  forceOffline: boolean;
  noAutoInit: boolean;
}

function effectiveAppConfig(): AppConfig {
  const cfg = loadConfig();
  if (!cfg) {
    return {
      provider: {
        provider: "anthropic",
        plannerModel: "claude-haiku-4-5",
        writerModel: "claude-sonnet-4-5",
        inputCostPer1M: 0,
        outputCostPer1M: 0,
      },
      maxPlannerSteps: 8,
    };
  }
  // Apply program-level overrides
  try {
    const p: any = program.opts();
    if (p.maxCost != null) {
      cfg.costGuard = { ...(cfg.costGuard ?? {}), maxUsd: Number(p.maxCost) };
    }
    if (p.maxTokens != null) {
      cfg.costGuard = { ...(cfg.costGuard ?? {}), maxTokens: Number(p.maxTokens) };
    }
    if (p.cacheTtl != null) {
      cfg.cache = { ...(cfg.cache ?? {}), ttlMs: Number(p.cacheTtl) };
    }
    if (p.cache === false) {
      cfg.cache = { ...(cfg.cache ?? {}), disabled: true };
    }
  } catch {
    // program.opts() throws when called before any subcommand parses; ignore.
  }
  return cfg;
}

async function buildContext(opts: BuildOpts): Promise<CommandContext | null> {
  const cwd = process.cwd();
  // Walk up to the project root so the tool works correctly when invoked
  // from a subdirectory of a monorepo.
  const root = findRepoRoot(cwd);
  process.chdir(root);
  // Ensure project memory exists. Auto-detect on first run so the user
  // doesn't have to type `ctx init` before every command.
  let mem = readProjectMemory(root);
  if (!mem) {
    mem = detectProjectMemory(root);
    writeProjectMemory(root, mem);
    if (!opts.noAutoInit) {
      logf("info", `Detected project memory at ${path.relative(root, path.join(root, ".contextforge/project.json"))}`);
    }
  }

  const cfg = effectiveAppConfig();
  const providerUsable = !!cfg && (
    cfg.provider.provider === "openai-compat"
      ? !!cfg.provider.apiKey && !!cfg.provider.baseUrl
      : !!cfg.provider.apiKey
  );

  // Provider is required for LLM mode. If it's missing, fall back to
  // offline (heuristic-only) mode and tell the user.
  const offline = opts.forceOffline || !providerUsable;
  if (offline && !opts.forceOffline && !opts.noAutoInit) {
    logf("warn", "No LLM provider configured. Running in offline (heuristic) mode. Run `ctx init` to set one up.");
  }

  const appConfig = cfg;
  const baseProvider = offline
    ? new (await import("./llm/mock.js")).MockProvider("offline")
    : await getProvider(appConfig.provider);

  // Wrap with SQLite-backed response cache unless disabled. Bypassed
  // automatically for tool turns (CachedProvider handles that).
  const cacheOpts = (appConfig.cache ?? {}) as { ttlMs?: number; disabled?: boolean };
  const provider =
    offline || cacheOpts.disabled
      ? baseProvider
      : new CachedProvider(baseProvider, new LLMCache(root, { ttlMs: cacheOpts.ttlMs }));

  return {
    root,
    cwd: root,
    appConfig,
    memory: mem,
    provider,
    stats: createStats(),
    offline,
  };
}

function writeOutput(out: string, format: OutputFormat, target?: string) {
  if (target) {
    const abs = path.isAbsolute(target) ? target : path.join(process.cwd(), target);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, out, "utf-8");
    process.stdout.write(`Wrote ${out.length.toLocaleString()} bytes to ${abs}\n`);
    return;
  }
  process.stdout.write(out + "\n");
}

const program = new Command();
program
  .name("ctx")
  .description("Token-efficient context packages for any AI tool.")
  .version(VERSION)
  .option("--offline", "Run the current command in offline (heuristic) mode without LLM calls.")
  .option("--no-auto-init", "Suppress the auto-init info log on first run.")
  .option("--format <fmt>", "Output format: markdown | context | json", "markdown")
  .option("--output <file>", "Write the result to a file instead of stdout.")
  .option("--quiet", "Suppress non-error log output on stderr.")
  .option("--max-cost <usd>", "Hard cap on USD spend per command (also via CTX_MAX_COST).")
  .option("--max-tokens <n>", "Hard cap on total tokens per command (also via CTX_MAX_TOKENS).")
  .option("--no-cache", "Disable the LLM response cache for this run.")
  .option("--cache-ttl <ms>", "Override the cache TTL in milliseconds (default 7 days).");

program
  .command("init")
  .description("Interactive setup: provider, API key, and project memory detection.")
  .option("-f, --force", "Force init even if config exists")
  .option("--skip-provider", "Skip provider/key collection (use env vars)")
  .action(async (opts: { force?: boolean; skipProvider?: boolean }) => {
    if (!process.stdout.isTTY && !opts.force && !opts.skipProvider) {
      process.stdout.write("ctx init is interactive. Run it in a terminal, or set CTX_PROVIDER + key env vars to skip.\n");
      return;
    }
    await runInit({ force: opts.force, skipProvider: opts.skipProvider });
  });

program
  .command("understand <file>")
  .description("Produce a structured understanding of a file.")
  .option("--max-candidates <n>", "Max scanner candidates", "15")
  .option("--max-files <n>", "Max files in the context package", "12")
  .option("--budget <n>", "Approx token budget for the package", "14000")
  .option("--no-line-numbers", "Omit line numbers from the context package")
  .option("--no-redact", "Disable secret redaction in the context package")
  .action(async (file: string, opts: any) => {
    const ctx = await buildContext({ offline: !!program.opts().offline, forceOffline: false, noAutoInit: !!program.opts().autoInit === false ? false : true });
    if (!ctx) return;
    const result = await runUnderstand(
      {
        target: file,
        maxCandidates: parsePositiveInteger(opts.maxCandidates, "--max-candidates"),
        maxFiles: parsePositiveInteger(opts.maxFiles, "--max-files"),
        budgetTokens: parsePositiveInteger(opts.budget, "--budget"),
      },
      ctx,
    );
    const out = renderOutput(
      (program.opts().format as OutputFormat) ?? "markdown",
      { title: result.title, body: result.body, report: result.report, stats: result.stats, packageFiles: result.packageFiles, contextPackageMd: result.contextPackageMd, target: result.target },
    );
    writeOutput(out, (program.opts().format as OutputFormat) ?? "markdown", program.opts().output);
  });

program
  .command("trace <query>")
  .description("Trace a query across the codebase.")
  .option("--max-candidates <n>", "Max scanner candidates", "25")
  .option("--max-files <n>", "Max files in the context package", "10")
  .option("--max-results <n>", "Max candidate files to consider", "12")
  .option("--budget <n>", "Approx token budget", "14000")
  .action(async (query: string, opts: any) => {
    const ctx = await buildContext({ offline: !!program.opts().offline, forceOffline: false, noAutoInit: false });
    if (!ctx) return;
    const result = await runTrace(
      {
        query,
        maxCandidates: parsePositiveInteger(opts.maxCandidates, "--max-candidates"),
        maxFiles: parsePositiveInteger(opts.maxFiles, "--max-files"),
        maxResults: parsePositiveInteger(opts.maxResults, "--max-results"),
        budgetTokens: parsePositiveInteger(opts.budget, "--budget"),
      },
      ctx,
    );
    const out = renderOutput(
      (program.opts().format as OutputFormat) ?? "markdown",
      { title: result.title, body: result.body, report: result.report, stats: result.stats, packageFiles: result.packageFiles, contextPackageMd: result.contextPackageMd, query: result.query },
    );
    writeOutput(out, (program.opts().format as OutputFormat) ?? "markdown", program.opts().output);
  });

program
  .command("review")
  .description("Review the diff (default: main...HEAD).")
  .option("--base <ref>", "Base ref (default: main)", "main")
  .option("--range <a>..<b>", "Explicit range")
  .option("--staged", "Use staged changes", false)
  .option("--max-files <n>", "Max files in the context package", "10")
  .option("--budget <n>", "Approx token budget", "14000")
  .action(async (opts: any) => {
    const ctx = await buildContext({ offline: !!program.opts().offline, forceOffline: false, noAutoInit: false });
    if (!ctx) return;
    const result = await runReview(
      {
        base: opts.base,
        range: opts.range,
        staged: opts.staged,
        maxFiles: parsePositiveInteger(opts.maxFiles, "--max-files"),
        budgetTokens: parsePositiveInteger(opts.budget, "--budget"),
      },
      ctx,
    );
    const out = renderOutput(
      (program.opts().format as OutputFormat) ?? "markdown",
      { title: result.title, body: result.body, report: result.report, stats: result.stats, packageFiles: result.packageFiles },
    );
    writeOutput(out, (program.opts().format as OutputFormat) ?? "markdown", program.opts().output);
  });

program
  .command("breakdown <file>")
  .description("Break down a requirement document into epics/stories/tasks.")
  .option("--max-files <n>", "Max files in the context package", "5")
  .option("--budget <n>", "Approx token budget", "8000")
  .action(async (file: string, opts: any) => {
    const ctx = await buildContext({ offline: !!program.opts().offline, forceOffline: false, noAutoInit: false });
    if (!ctx) return;
    const result = await runBreakdown(
      {
        inputFile: file,
        maxFiles: parsePositiveInteger(opts.maxFiles, "--max-files"),
        budgetTokens: parsePositiveInteger(opts.budget, "--budget"),
      },
      ctx,
    );
    const out = renderOutput(
      (program.opts().format as OutputFormat) ?? "markdown",
      { title: result.title, body: result.body, report: result.report, stats: result.stats, packageFiles: result.packageFiles },
    );
    writeOutput(out, (program.opts().format as OutputFormat) ?? "markdown", program.opts().output);
  });

program
  .command("proposal <file>")
  .description("Build an implementation proposal from an understanding document.")
  .option("--max-files <n>", "Max files in the context package", "5")
  .option("--budget <n>", "Approx token budget", "8000")
  .action(async (file: string, opts: any) => {
    const ctx = await buildContext({ offline: !!program.opts().offline, forceOffline: false, noAutoInit: false });
    if (!ctx) return;
    const result = await runProposal(
      {
        inputFile: file,
        maxFiles: parsePositiveInteger(opts.maxFiles, "--max-files"),
        budgetTokens: parsePositiveInteger(opts.budget, "--budget"),
      },
      ctx,
    );
    const out = renderOutput(
      (program.opts().format as OutputFormat) ?? "markdown",
      { title: result.title, body: result.body, report: result.report, stats: result.stats, packageFiles: result.packageFiles },
    );
    writeOutput(out, (program.opts().format as OutputFormat) ?? "markdown", program.opts().output);
  });

program
  .command("scan [target]")
  .description("Scanner diagnostic: lists parsed files, symbols, edges. With [target], shows ranked candidates.")
  .option("--max <n>", "Max candidates to show (when target is given)", "15")
  .action(async (target: string | undefined, opts: any) => {
    const ctx = await buildContext({ offline: true, forceOffline: true, noAutoInit: false });
    if (!ctx) return;
    const result = await runScan(
      {
        target,
        max: parsePositiveInteger(opts.max, "--max"),
        format: (program.opts().format as OutputFormat) ?? "markdown",
      },
      ctx,
    );
    const fmt = (program.opts().format as OutputFormat) ?? "markdown";
    const out = fmt === "json"
      ? JSON.stringify(result, null, 2)
      : renderOutput(fmt, { title: result.title, body: result.body, report: result.report, packageFiles: result.packageFiles });
    writeOutput(out, fmt, program.opts().output);
  });

program
  .command("memory")
  .description("Show or edit the project memory file.")
  .option("action", "show | edit", "show")
  .option("--value <v>", "For add-note / add-ignore / add-alias")
  .action(async (actionOrOpts: any, opts: any) => {
    // commander nests subcommand args oddly; accept either shape
    const action = typeof actionOrOpts === "string" ? actionOrOpts : actionOrOpts?.action ?? "show";
    const ctx = await buildContext({ offline: true, forceOffline: true, noAutoInit: true });
    if (!ctx) return;
    const result = await runMemory(
      { action, format: (program.opts().format as OutputFormat) ?? "markdown", value: opts.value },
      ctx,
    );
    const fmt = (program.opts().format as OutputFormat) ?? "markdown";
    const out = fmt === "json"
      ? JSON.stringify(result, null, 2)
      : renderOutput(fmt, { title: result.title, body: result.body, report: result.report });
    writeOutput(out, fmt, program.opts().output);
  });

// Hidden alias: `ctx memory show`
program
  .command("package [target]")
  .description("Build a context package for a target and emit it directly (no LLM).")
  .option("--max-files <n>", "Max files in the package", "12")
  .option("--budget <n>", "Approx token budget", "14000")
  .action(async (target: string | undefined, opts: any) => {
    const ctx = await buildContext({ offline: true, forceOffline: true, noAutoInit: false });
    if (!ctx) return;
    if (!target) {
      process.stdout.write("Usage: ctx package <target>\n");
      return;
    }
    // For convenience, run understand offline and emit the context format.
    const result = await runUnderstand(
      {
        target,
        maxFiles: parsePositiveInteger(opts.maxFiles, "--max-files"),
        budgetTokens: parsePositiveInteger(opts.budget, "--budget"),
      },
      ctx,
    );
    const out = renderOutput("context", {
      title: result.title,
      body: result.body,
      report: result.report,
      packageFiles: result.packageFiles,
      contextPackageMd: result.contextPackageMd,
      target: result.target,
    });
    writeOutput(out, "context", program.opts().output);
  });

async function main() {
  if (process.argv.length <= 2) {
    process.stdout.write(program.helpInformation());
    return;
  }
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CommandError) {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 2;
    } else if (err instanceof CostExceededError) {
      process.stderr.write(`Error: ${err.message}\nHint: raise the limit with CTX_MAX_COST or CTX_MAX_TOKENS.\n`);
      process.exitCode = 3;
    } else {
      throw err;
    }
  }
}

main().catch((err) => {
  log.error((err as Error).message);
  process.exitCode = 1;
});
void fs;
