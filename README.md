# ContextForge (`ctx`)

Token-efficient context packages for any AI tool. Terminal-first CLI that prepares
rich, curated context for the questions engineers actually ask:

- `ctx understand <file>` — what is this file and what does it touch?
- `ctx trace "<query>"` — root-cause a query across the codebase
- `ctx review` — review the diff (`main...HEAD` by default)
- `ctx breakdown <req.md>` — break a requirement into stories/tasks
- `ctx proposal <understanding.md>` — build an implementation proposal
- `ctx package <file>` — emit the raw context package (no LLM)
- `ctx scan [target]` — diagnostic: what does the scanner see?
- `ctx init` / `ctx memory show|add-...` — provider and project-memory setup

**New here?** Start with [`docs/QUICKSTART.md`](docs/QUICKSTART.md).
**Want the design?** Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
**Picking the next thing to build?** See [`docs/ROADMAP.md`](docs/ROADMAP.md).
**Testing on real code?** See [`docs/TEST_PROJECTS.md`](docs/TEST_PROJECTS.md)
(one greenfield, one open-source project). Other docs: [`CONTRIBUTING`](docs/CONTRIBUTING.md), [`FAQ`](docs/FAQ.md).

All content commands (`understand` / `trace` / `review` / `breakdown` / `proposal`) are LLM-driven by default. A three-pass flow does the work:

1. **Scanner** walks the repo (PHP / JS/TS / Python via lightweight parsers),
   builds an import graph, and returns a ranked candidate list.
2. **Planner model** (cheap, e.g. `claude-haiku-4-5`) inspects the candidates with
   sandboxed `read_file` / `list_dir` tool calls and returns the final selection.
3. **Writer model** (mid-tier, e.g. `claude-sonnet-4-5`) emits the command-specific
   markdown (Purpose / Dependencies / Data Flow / …, Probable Root Causes / …, etc.).

Every command prints a budget footer and (when LLM is enabled) an LLM stats block.

## Install

```bash
npm install -g contextforge
```

## First run

```bash
ctx init    # interactive: pick provider, paste API key, detect stack
```

`ctx init` is the explicit setup path. It is **not** auto-launched on every
command — instead, the CLI:

1. **Auto-creates** `.contextforge/project.json` on the first invocation
   inside a repo (scans the top-level for `composer.json`, `package.json`,
   `pyproject.toml`, etc.).
2. **Falls back to offline (heuristic) mode** when no LLM provider is
   configured, and prints a clear message so you know what you got.
3. If you do want an interactive setup, run `ctx init` once. It is gated
   on a TTY — in non-TTY environments it prints a one-liner telling you
   to set `CTX_PROVIDER` and the matching key env var.

## Usage

```bash
# Core content commands
ctx understand app/Services/InvoiceService.php
ctx trace "tax mismatch on California orders"
ctx review
ctx review --base develop
ctx review --range HEAD~3..HEAD
ctx review --staged
ctx breakdown docs/REQ-123.md
ctx proposal docs/UNDERSTANDING-123.md

# Force heuristic-only mode
ctx understand app/Services/InvoiceService.php --offline

# Output formats: markdown (default) | context | json
ctx understand app/Foo.php --format json
ctx understand app/Foo.php --format context
ctx understand app/Foo.php --output foo-context.md

# Diagnostic: what does the scanner see?
ctx scan
ctx scan app/Services/InvoiceService.php
ctx scan --format json

# Direct context package: the "give me the smallest high-signal code
# context for this engineering task" promise
ctx package app/Services/InvoiceService.php --output pkg.md

# Inspect and tweak the project memory
ctx memory show
ctx memory add-ignore --value "tmp/**"
ctx memory add-alias --value "App\\=app"
```

When you run a command without an LLM provider configured, ContextForge
auto-creates `.contextforge/project.json` and falls back to
heuristic-only mode. The output says so in its first line so you always
know what you got.

## Output

Every command prints a markdown body followed by a budget footer and (when LLM
is enabled) an LLM stats block:

```
---
Files Scanned: 1240
Files Selected: 14
Repo Size:     420,000 tokens
Context Size:  14,200 tokens
Reduction:     96.6%


## LLM Stats

- PLANNER: claude-haiku-4-5 • 3 calls • 1,840 in / 612 out
- WRITER:  claude-sonnet-4-5 • 1 call • 12,400 in / 1,820 out

**Totals**: 4 calls • 14,240 in / 2,432 out • est. cost $0.0138
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `CTX_PROVIDER` | — | `anthropic` \| `openai` \| `openai-compat` |
| `CTX_ANTHROPIC_API_KEY` | — | Anthropic API key |
| `CTX_OPENAI_API_KEY` | — | OpenAI API key |
| `CTX_OPENAI_COMPAT_BASE_URL` | — | e.g. `http://localhost:11434/v1` |
| `CTX_OPENAI_COMPAT_API_KEY` | — | API key for the OpenAI-compat provider |
| `CTX_PLANNER_MODEL` | provider default | e.g. `claude-haiku-4-5` |
| `CTX_WRITER_MODEL` | provider default | e.g. `claude-sonnet-4-5` |
| `CTX_MAX_STEPS` | `8` | Max planner tool-call rounds |
| `CTX_MAX_COST` | `1.00` | Hard cap on USD spend per command |
| `CTX_MAX_TOKENS` | `1000000` | Hard cap on total tokens per command |
| `CTX_CACHE_TTL_MS` | `604800000` | LLM response cache TTL (7 days) |
| `CTX_NO_CACHE` | — | Set to `1` to disable the LLM response cache |
| `CTX_CONFIG_DIR` | — | Override the config directory (CI / tests) |
| `CTX_QUIET` | — | Set to `1` to suppress stderr logs |
| `CTX_DEBUG` | — | Set to `1` to enable debug logs |
| `CTX_LIVE` | — | Set to `1` to use real providers in tests |
| `CTX_MOCK_PROVIDER` | — | Set to `1` to force the in-memory mock |

Env vars override the credentials file. Credentials are stored at
`~/.config/contextforge/credentials.json` with mode `0600`.

## Global flags

These work for every subcommand (set on the program, before the subcommand):

| Flag | Description |
| --- | --- |
| `--offline` | Run the current command in offline (heuristic) mode without LLM calls |
| `--format <fmt>` | Output format: `markdown` (default) \| `context` \| `json` |
| `--output <file>` | Write the result to a file instead of stdout |
| `--quiet` | Suppress non-error log output on stderr |
| `--max-cost <usd>` | Hard cap on USD spend per command (overrides `CTX_MAX_COST`) |
| `--max-tokens <n>` | Hard cap on total tokens per command (overrides `CTX_MAX_TOKENS`) |
| `--no-cache` | Disable the LLM response cache for this run |
| `--cache-ttl <ms>` | Override the cache TTL in milliseconds (default 7 days) |
| `--no-auto-init` | Suppress the auto-init info log on first run |

## Files written into the target repo

- `.contextforge/project.json` — detected stack, ignore globs, test patterns
  (commit this so the team shares scanner heuristics)
- `.contextforge/graph.json` — JSON cache of the import graph
- `.contextforge/.scan-cache.json` — mtime manifest that lets subsequent
  `ctx` runs skip the scanner when nothing has changed
- `.contextforge/llm-cache.json` — JSON response cache (LLM replies
  keyed on `model + messages + toolCount`, 7-day TTL)

`graph.json`, `.scan-cache.json`, and `llm-cache.json` are gitignored. The
`.gitignore` shipped with `contextforge` covers all three. `project.json`
is intentionally committed so teams share the same scanner heuristics —
override per-repo by editing `.gitignore` or moving the file outside the
git tree.

## Performance

- The scanner is mtime-aware: re-runs with no file changes skip parsing and
  return the cached graph (a single `stat` per file). The manifest is
  written to `.contextforge/.scan-cache.json`.
- The LLM response cache makes repeat invocations free — the same planner
  prompt against the same model returns instantly. Tool-call turns are
  never cached (they depend on dynamic state). Disable with `--no-cache`
  or `CTX_NO_CACHE=1`.
- The cost guard throws `CostExceededError` (exit 3) when the running
  total exceeds `--max-cost` / `--max-tokens`. Tune to match your budget.

## Development

```bash
npm install
npm run build
npm test           # unit + e2e (mock LLM)
npm run test:unit  # unit only
npm run test:e2e   # e2e only
npm run test:live  # e2e against real Anthropic / OpenAI when CTX_LIVE=1 and keys are set
npm run lint       # tsc --noEmit
```

## Commands

| Command | Purpose | LLM | Output formats |
| --- | --- | --- | --- |
| `ctx init` | Interactive provider setup + first-time project detection | — | — |
| `ctx understand <file>` | What is this file, what does it touch? | yes | `markdown` \| `context` \| `json` |
| `ctx trace "<query>"` | Root-cause a query across the codebase | yes | `markdown` \| `context` \| `json` |
| `ctx review` | Review the diff (default `main...HEAD`) | yes | `markdown` \| `json` |
| `ctx breakdown <req.md>` | Break a requirement into stories/tasks | yes | `markdown` |
| `ctx proposal <understanding.md>` | Implementation proposal from a doc | yes | `markdown` |
| `ctx package <target>` | Emit a raw context package (no LLM) | no | `context` |
| `ctx scan [target]` | Diagnostic — parsed files, symbols, edges | no | `markdown` \| `json` |
| `ctx memory show\|add-...` | Show / edit `.contextforge/project.json` | no | `markdown` \| `json` |

All five content commands (`understand` / `trace` / `review` / `breakdown` /
`proposal`) auto-fall-back to offline mode and emit a scanner-backed
ranked summary if no provider is configured. The `package` and `scan`
commands are fully offline by design — they are the
"smallest high-signal code context" / "what does the scanner see"
paths, respectively.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the three-pass flow
(scanner → planner → writer), repo layout, planner loop, scanner pruning,
cost / cache model, and the "add a command / parser / provider" recipes.

The one-line summary: `ctx` is a single-binary CLI; every content command
is `scan → plan (cheap LLM) → write (mid-tier LLM) → render`.

## Security

The planner's `read_file` and `list_dir` tools are sandboxed to the repo root
via `util/fs.ts`. Path-traversal attempts return an `ERROR:` result instead of
the requested file's contents. The scanner never reads outside `root` either.
