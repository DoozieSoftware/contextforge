# Architecture

This document explains the moving parts so contributors can add parsers,
providers, or commands without breaking the loop.

## 30-second mental model

`ctx` is a single-binary CLI. Every command is a three-pass pipeline:

1. **Scanner** — fast, deterministic, runs without an LLM. Walks the
   repo, parses PHP/JS/TS/Python with regex-based extractors, builds a
   SQLite import graph, ranks candidate files for the target.
2. **Planner model** (cheap, e.g. `claude-haiku-4-5`) — receives the
   candidate list, calls `read_file` / `list_dir` (sandboxed to the
   repo root), and returns a final `selectedFiles` list.
3. **Writer model** (mid-tier, e.g. `claude-sonnet-4-5`) — receives a
   pre-assembled `CONTEXT PACKAGE` markdown and produces the
   brief-shaped output (Purpose / Dependencies / …, Probable Root
   Causes / …).

Offline mode (no LLM) skips passes 2 and 3 and emits a deterministic
ranked summary instead.

## Repo layout

```
src/
├── cli.ts                 # commander entrypoint, global flags, buildContext()
├── commands/              # one file per command
│   ├── init.ts            # interactive provider setup
│   ├── understand.ts
│   ├── trace.ts
│   ├── review.ts
│   ├── breakdown.ts
│   ├── proposal.ts
│   ├── package.ts         # raw context-package emit (no LLM)
│   ├── scan.ts            # diagnostic — what does the scanner see?
│   ├── memory.ts          # read / edit .contextforge/project.json
│   ├── offline.ts         # deterministic offline templates
│   └── types.ts           # CommandContext, CommandResult, PackageFileSummary
├── scanner/
│   ├── index.ts           # orchestrator: walk repo, dispatch to parsers, persist graph
│   ├── graph.ts           # SQLite import-graph store (upsertFile, removeFile, insertEdge)
│   ├── candidates.ts      # BFS over the import graph, ranks by depth + reason
│   ├── heuristics.ts      # project-memory-driven include/ignore + classification
│   ├── types.ts           # Language, ImportRef, SymbolRef, RouteRef, FileAnalysis, GraphNode, GraphEdge
│   └── parsers/
│       ├── php.ts         # tree-sitter when available, regex fallback
│       ├── ts.ts          # regex-based; covers imports, classes, decorators, arrow-fn components
│       └── python.ts      # regex-based; covers imports, classes, async defs, Flask routes
├── context/
│   ├── budget.ts          # gpt-tokenizer (cl100k_base) counting + BudgetReport
│   ├── package.ts         # builds the markdown CONTEXT PACKAGE from candidates
│   ├── render.ts          # renders per-command markdown / context / json
│   └── redact.ts          # AWS / GitHub PAT / Slack / JWT / assignment-pattern redaction
├── llm/
│   ├── provider.ts        # interface: chat(messages, tools, opts) → ChatResult
│   ├── anthropic.ts       # Messages API adapter
│   ├── openai.ts          # Chat Completions adapter
│   ├── openai-compat.ts   # generic OpenAI-compat (Ollama / OpenRouter / vLLM)
│   ├── mock.ts            # canned-response provider for tests
│   ├── types.ts           # LLMProvider, ChatMessage, ChatResult, ChatOptions, ToolSpec
│   ├── tools.ts           # read_file / list_dir — sandboxed to repo root
│   ├── loop.ts            # runPlanner / runWriter; tool-call rounds; cost guard; repair pass
│   ├── validate.ts        # planner JSON shape + writer section validation
│   ├── cost.ts            # CostGuard — pre-call estimate, post-call record, CostExceededError
│   ├── cache.ts           # LLMCache — SQLite response cache, 7-day TTL
│   ├── cached.ts          # CachedProvider — bypass for tool turns
│   ├── retry.ts           # withRetry / HttpError — backoff + timeout
│   ├── stats.ts           # per-call usage log → final ctx stats block
│   └── prompts/           # one .md per command (writer system prompts)
├── memory/
│   ├── project.ts         # read/write .contextforge/project.json; detect + auto-detect
│   └── credentials.ts     # read/write ~/.config/contextforge/credentials.json (0600)
├── git/
│   └── diff.ts            # getRepoDiff (default main...HEAD) + parseUnifiedDiff
└── util/
    ├── fs.ts              # safeResolve / readFileSafe — path-traversal guard
    ├── repo.ts            # findRepoRoot — walks up looking for package.json / composer.json / .git
    ├── args.ts            # parsePositiveInteger / parseNonNegativeInteger
    ├── config.ts          # env-var + credentials.json merge for AppConfig
    ├── log.ts             # stderr-only logger (stdout reserved for markdown)
    └── progress.ts        # throttled stderr progress reporter
```

## The data flow

A command like `ctx understand src/services/billing.ts` runs through
these layers:

```
process.cwd()
  └─→ findRepoRoot()                 (util/repo.ts)
        └─→ loadConfig() / credentials.json + env (util/config.ts)
              └─→ buildContext()     (cli.ts)
                    ├─→ readProjectMemory() / detectProjectMemory() (memory/project.ts)
                    ├─→ getProvider() / CachedProvider (llm/provider.ts + cached.ts)
                    └─→ return CommandContext
                          └─→ runUnderstand()
                                ├─→ scanRepo() (scanner/index.ts)
                                │     ├─→ fast-glob + heuristics filter
                                │     ├─→ language parsers (parsers/*.ts)
                                │     ├─→ upsertFile + insertEdge (scanner/graph.ts)
                                │     └─→ writeScanCache (mtime manifest)
                                ├─→ rankCandidates() (scanner/candidates.ts)
                                ├─→ buildContextPackage() (context/package.ts)
                                │     └─→ redactSecrets() + withLineNumbers()
                                ├─→ runPlanner() / runWriter() (llm/loop.ts)
                                │     ├─→ CostGuard.estimate() + .record()
                                │     └─→ validatePlannerOutput() / validateOutput()
                                └─→ renderOutput() (context/render.ts)
                                      └─→ BudgetReport footer + (optional) LLM Stats block
```

## Key types

The shape of `CommandResult` is the contract between a command and the
renderer:

```ts
interface CommandResult {
  body: string;                  // writer's output (or offline template)
  stats: LlmStats;               // per-call usage log
  report: BudgetReport;          // filesScanned / filesSelected / repoSize / contextSize / reduction
  title?: string;
  packageFiles?: PackageFileSummary[];
  contextPackageMd?: string;     // pre-rendered CONTEXT PACKAGE (used by --format context)
  target?: string;
  query?: string;
  fallbackReason?: string;
}
```

A `PackageFileSummary` is the metadata-only view:

```ts
interface PackageFileSummary {
  path: string;
  tokens: number;
  kind: string;                  // controller / model / service / route / test / other
  reason: string;                // "imports X", "defines route Y", "test for Z"
}
```

The full `ContextPackage` is the raw markdown with file contents:

```ts
interface ContextPackage {
  files: PackageFile[];
  totalTokens: number;
  budget: number;
}
```

`CommandResult.contextPackageMd` is the markdown form of
`ContextPackage` (one `## path` section per file, with line numbers,
kind/tokens/reason metadata, and a code fence).

## The planner loop

`runPlanner` in `src/llm/loop.ts`:

1. Build the system + user messages: project memory, candidate list,
   request for `selectedFiles` and `planNotes` JSON.
2. Call the planner model. Estimate cost with `CostGuard.estimate()`
   first; record actual tokens after.
3. If the model returned tool calls, execute `read_file` / `list_dir`
   (sandboxed), append tool results to the message list, loop.
4. When the model returns a final message, parse it as JSON. If
   `validatePlannerOutput` accepts it, return the selection.
5. Otherwise, make one repair pass: ask the model to reshape its
   output. If validation still fails, fall back to an empty selection
   with a `fallbackReason`.

The loop is bounded by `maxPlannerSteps` (default 8). Tool calls are
bypassed by the LLM cache (`CachedProvider` skips caching for any
turn that has a `role: "tool"` message — those depend on dynamic
state).

## The writer

`runWriter` is a single chat call followed by one repair pass if the
section validator fails. Each command's expected section shape lives
in `src/llm/validate.ts:EXPECTED_SECTIONS` and must match the prompt
template in `src/llm/prompts/<command>.md`.

## The scanner

`scanRepo` in `src/scanner/index.ts` is the orchestrator:

1. `fast-glob` walks the repo, applying `memory.ignoreGlobs` first.
2. `buildHeuristics(memory)` returns a filter that knows about Laravel,
   Next.js, Django, Flask, etc. (default include globs for `.php`
   / `.ts` / `.tsx` / `.js` / `.jsx` / `.mjs` / `.py`).
3. The orchestrator calls each language parser in turn.
4. The graph DB is updated: `upsertFile` per parsed file, `insertEdge`
   for each resolved import.
5. Stale files are pruned by comparing the current `seenNow` set to
   the prior `db.listFiles()`.
6. A mtime manifest is written to `.contextforge/.scan-cache.json` so
   subsequent runs can skip parsing if nothing has changed.

Path resolution (`resolveImport` in `scanner/graph.ts`):

- Relative imports (`./foo`, `../bar`) are resolved relative to the
  importing file.
- Project aliases (from `pathAliases` in project memory) are tried
  longest-prefix-first.
- Built-in `@/` (Next.js convention) and `/`-rooted imports are
  resolved to the repo root.
- Bare specifiers (e.g. `react`, `lodash`) are recorded but not
  resolved — they're treated as external.
- PHP `App\Services\X` is converted to `app/Services/X.php`.

## Cost and cache

`CostGuard` is consulted on every LLM call. It throws
`CostExceededError` (caught at the CLI top-level → exit 3) when the
running total exceeds `--max-cost` or `--max-tokens`. The cost model
uses `inputCostPer1M` / `outputCostPer1M` from `AppConfig.provider`
(defaults per provider preset).

`LLMCache` is a SQLite cache keyed on
`sha256(model + toolCount + JSON(messages))`. Cache hits return
immediately. Cache writes are best-effort. TTL is 7 days by default
(`--cache-ttl <ms>` to override, `--no-cache` to disable).

## Project memory

`.contextforge/project.json` is the user-tunable scan config. It is
auto-detected from `composer.json`, `package.json`, `pyproject.toml`,
etc. on first run. Users can:

- `ctx memory add-ignore --value <glob>` — push to `ignoreGlobs`
- `ctx memory add-alias --value "@foo=src/foo"` — push to
  `pathAliases`
- `ctx memory add-note --value "..."` — push to `notes`
- `ctx memory edit` — launch `$VISUAL` / `$EDITOR` / `vi` on the file

`project.json` is intended to be **committed** so the team shares the
same scanner heuristics. The other `.contextforge/*` files are
gitignored.

## Adding a new command

1. Create `src/commands/<name>.ts` exporting `run<Name>(opts, ctx)`.
2. Add the writer prompt template `src/llm/prompts/<name>.md`.
3. Extend `EXPECTED_SECTIONS` in `src/llm/validate.ts`.
4. Wire the command in `src/cli.ts`.
5. Add a fixture to `tests/fixtures/` and e2e tests under
   `tests/e2e/`.

## Adding a new language

1. Create `src/scanner/parsers/<lang>.ts` exporting
   `parse<Lang>(path, src)` that returns a `FileAnalysis`.
2. Add a `detectLanguage` clause in `src/scanner/index.ts`.
3. Add fixture + unit tests in `tests/unit/parsers.test.ts`.

The regex-based parsers are deliberately minimal — they extract only
the symbols and imports that drive heuristics and BFS ranking. A
tree-sitter backend can be added behind a feature flag if more
precision is needed.
