# Changelog

All notable changes to **contextforge** are documented in this file. The
format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `ctx scan [target]` — diagnostic command to inspect scanner output and
  rank candidates for a specific file.
- `ctx memory show | add-ignore | add-alias | add-note` — read and tweak
  `.contextforge/project.json` without hand-editing JSON.
- `ctx package <target>` — emit a curated context package without an
  LLM, in `--format context`.
- `--format markdown|context|json` global flag.
- `--output <file>` global flag for writing results to a file.
- Auto-create `.contextforge/project.json` on first run; commands fall
  back to offline mode when no provider is configured and say so.
- `pathAliases` in project memory: auto-detected from `tsconfig.json`
  `paths`, `composer.json` PSR-4, and the Next.js `@/` convention.
- Secret redaction: AWS access keys, GitHub PATs, Slack tokens, JWTs,
  URL basic-auth, and `key="long-string"` patterns are replaced with
  `<REDACTED:TYPE>` placeholders before they reach the LLM.
- LLM call retries with exponential backoff + timeouts (`src/llm/retry.ts`).
- LLM output validation: planner JSON is shape-checked, writer markdown
  is section-checked; one repair retry on failure (`src/llm/validate.ts`).
- Graph pruning: stale files/edges are removed on each scan.
- Repo-root detection (`src/util/repo.ts`): walks up to find
  `package.json`/`composer.json`/etc.
- `parseUnifiedDiff()` — review heuristics now run on diff hunks, not
  the whole file.
- CLI numeric options validated (`--budget abc` errors with exit 2).
- `tests/fixtures/sample-{laravel,node,py}` — small multi-language repos.
- `tests/fixtures/mock-llm.ts` — canned-response mock for CI.

### Changed
- `ctx review` heuristics now flag only lines that appear in the diff.
- Offline-mode output is now a real ranked summary, not a placeholder.
- Path alias resolution: `resolveImport()` accepts `pathAliases` and
  walks them longest-prefix-first.
- Soft + hard cost guardrails: `CostGuard` estimates input token cost
  before each LLM call and throws `CostExceededError` (exit 3) when the
  running total exceeds the cap. Configurable via `--max-cost`,
  `--max-tokens`, `CTX_MAX_COST`, or `CTX_MAX_TOKENS`.
- LLM response cache: `LLMCache` (JSON-backed, 7-day TTL) and
  `CachedProvider` wrapper. Replay of the same planner / writer
  prompt is free. Bypassed for tool-call turns. Disable with
  `--no-cache` or `CTX_NO_CACHE=1`; override TTL with
  `--cache-ttl <ms>` or `CTX_CACHE_TTL_MS=<ms>`.
- Scanner mtime cache: `.contextforge/.scan-cache.json` lets repeat
  invocations skip parsing when no file has changed.
- `ScannerEmptyError` thrown when the scanner finds no scannable
  files of a supported language.
- Global flags: `--quiet`, `--max-cost`, `--max-tokens`, `--no-cache`,
  `--cache-ttl`.
- GitHub Actions CI workflow (Node 22 + 24 matrix, lint/build/test,
  live-provider job gated on secrets).
- Real-provider smoke test (`tests/e2e/live.test.ts`) gated on
  `CTX_LIVE=1` plus the matching API key.

### Fixed
- Glob matcher: `**/*.ts` now correctly matches top-level files like
  `a.ts` (previously required a path prefix). The new implementation
  uses a placeholder-then-expand strategy that avoids the "regex
  re-interprets its own replacement" bug. Patterns like `**/x` and
  `a/**/b` also behave per glob conventions.
- `ctx scan` shows correct file counts when the mtime cache short-
  circuits the parse step (previously reported zero files).

### Changed
- Parser coverage: TS now extracts arrow-function components
  (`const Foo = () => ...`) and decorators (`@Injectable` on
  classes / methods). Python now captures return type annotations
  and async/await tags. PHP now extracts PHP 8 attributes (`#[...]`)
  and return type declarations.
- `npm run build` strips `.d.ts` and `.js.map` from the published
  tarball. Package size dropped from 90.7 kB to 45.7 kB.

### Added
- Golden-file e2e tests (`tests/e2e/golden.test.ts`) that snapshot
  the deterministic offline `scan` and `understand` outputs. Golden
  files are auto-created on first run and committed.

### Removed
- TUI menu (it was a non-functional stub).

## [0.1.1] — 2026-06-14

### Removed
- `better-sqlite3` dependency. The npm install was failing on recent
  Node versions (no prebuilt for Node 25, and the `prebuild-install`
  / `node-gyp` fallback failed inside npm 11's lifecycle runner with
  `spawn sh ENOENT`). Replaced by pure-JS in-memory `Map`s persisted
  to JSON files.

### Changed
- `.contextforge/graph.db` → `.contextforge/graph.json`.
- `.contextforge/llm-cache.db` → `.contextforge/llm-cache.json`.
- The scanner graph and the LLM response cache are now best-effort
  JSON snapshots. Atomicity is preserved via write-tmp-then-rename.
  The scanner's `.scan-cache.json` mtime check still detects
  "nothing changed" and skips re-parsing.

### Fixed
- `npm install -g contextforge` no longer requires Xcode Command Line
  Tools on macOS and works on any Node >= 22 (no native build).

## [0.1.0] — 2026-06-12

### Added
- Initial MVP: `ctx init | understand | trace | review | breakdown | proposal`.
- Three-pass flow: scanner → planner (with sandboxed `read_file` / `list_dir`)
  → writer.
- Three providers: Anthropic, OpenAI, OpenAI-compatible (Ollama / OpenRouter / vLLM).
- JSON-backed import graph (replaces the better-sqlite3 implementation).
- Token budgeting with `gpt-tokenizer` (cl100k_base).

[Unreleased]: https://github.com/doozie/contextforge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/doozie/contextforge/releases/tag/v0.1.0

### Fixed
- `ctx package` now emits the actual raw file contents (with line
  numbers and kind/tokens/reason metadata), not just a metadata
  summary. The `--format context` output is the user-facing
  "smallest high-signal code context" promise.
- `ctx scan` summary now reports the correct `Files discovered` count
  when the mtime cache short-circuits the parse step.
- `packageToMarkdown` no longer double-applies line numbers when the
  content was already tagged by the package builder.

### Changed
- Writer validation now matches the prompt templates exactly:
  `breakdown` requires Estimates, Dependencies, and Risks; `proposal`
  requires Assumptions and Risk.
- `ctx memory edit` now spawns `$VISUAL` / `$EDITOR` / `vi` on
  `.contextforge/project.json` (was a print-JSON-and-bail stub).
- Offline `breakdown` and `proposal` now produce deterministic
  templates that extract bullets / sections from the input doc and
  keyword-match candidate modules from the repo. No more "(offline
  mode)" placeholders.
- `README.md` corrected: `ctx init` is the explicit setup path, not
  auto-launched; `.gitignore` shipped with the CLI covers
  `graph.json`, `.scan-cache.json`, and `llm-cache.json` but NOT
  `project.json` (commit that for team-shared heuristics).
- Added a Commands reference table to the README.
