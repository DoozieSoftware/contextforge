# FAQ

## General

### What does `ctx` actually do?

It generates the smallest high-signal code context package for an
engineering task. You ask `ctx` a question (`understand <file>`,
`trace "<query>"`, `review` the diff, etc.), and it returns a
markdown document scoped to the code that matters.

### How is it different from `git grep` or my IDE's "Find Usages"?

Both are lookup tools; `ctx` is a packaging tool. `ctx` ranks
candidate files by BFS over the import graph + heuristics, hands
the top N to an LLM, and returns a brief-shaped markdown document.
You paste the result into Claude / ChatGPT / Cursor and the model
already has the right files.

### Is the LLM optional?

Yes. `ctx` runs fully offline if no provider is configured. The
offline output is a ranked file list with symbols / routes / tests
noted — useful but not the same as the LLM-driven prose. The
`ctx package` and `ctx scan` commands are offline by design.

### Which languages are supported?

PHP, JavaScript, TypeScript, and Python. The scanner is regex-based
for portability; tree-sitter is an optional dependency that is
loaded only when present (see `docs/ROADMAP.md` for the plan to
expose it behind a flag).

## Cost and limits

### How much does each command cost?

Roughly, `ctx understand` is ~$0.01 with the default Anthropic
planner/writer pair (claude-haiku-4-5 + claude-sonnet-4-5). The
planner is the cheap part (a few tool calls, ~2k input tokens); the
writer is the expensive part (12-15k input tokens for the
context package). Use `--max-cost 0.05` if you want a hard cap.

### What does `--max-cost` do exactly?

It throws `CostExceededError` (exit 3) when the running total of
estimated spend exceeds the cap. The estimate is the input
token count times the provider's `inputCostPer1M`. Output tokens
are recorded but not pre-estimated. Tunable per command.

### Can I run `ctx` without burning tokens?

Yes:

- `--offline` forces the heuristic-only path. No LLM calls.
- The LLM response cache (`llm-cache.json`) makes repeat invocations
  free for 7 days. The cache key is
  `sha256(model + toolCount + JSON(messages))`.
- `--no-cache` disables the cache for one run (e.g. when you
  intentionally want a fresh answer).

### What if I have a really big repo?

A full scan of a 1M-LOC repo takes ~10-20s on a developer laptop.
After that, repeat invocations use the mtime cache and complete in
under a second. If even the first scan is too slow, add more
globs to `ignoreGlobs` via `ctx memory add-ignore`.

## Caching

### How do I clear the cache?

Delete `.contextforge/llm-cache.json` and
`.contextforge/.scan-cache.json`. Both are gitignored. The next
`ctx` command will rebuild them.

### Is the cache safe to share across machines?

The cache is a local JSON file. The planner and writer responses
are model-specific; if two machines use different model names for
the same prompt, the cache misses. Don't put it in a shared
filesystem expecting it to work.

## CI / pipelines

### How do I use `ctx` in CI?

Two common recipes.

**Lint-only (no LLM)**:

```yaml
- run: npm install -g @dooz-ecosystem/contextforge
- run: ctx review --base origin/main --format json --output ctx-review.json
```

`--format json` is stable across versions. Use `--offline` if you
don't want to spend money in CI.

**With LLM (gated)**:

```yaml
- if: github.event_name == 'pull_request'
  env:
    CTX_PROVIDER: anthropic
    CTX_ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_KEY }}
  run: ctx review --output ctx-review.md
```

### How do I exit non-zero when a critical finding is found?

Today, `ctx review` exits 0 even when it lists critical findings.
We're tracking `ctx review --strict` for v0.2 (see
`docs/ROADMAP.md`). For now, grep the output:

```bash
ctx review | grep -q "^## Critical$" && exit 1 || true
```

## Security

### Is the planner sandboxed?

Yes. The planner's `read_file` and `list_dir` tools are gated by
`safeResolve(root, path)` in `src/util/fs.ts`. Path-traversal
attempts (`../../etc/passwd`) return `ERROR:` to the planner; they
do not actually read outside the repo.

### Where is my API key stored?

`~/.config/contextforge/credentials.json` with mode `0600`. The
file is created by `ctx init` and read by every subsequent
command. You can also pass keys via `CTX_ANTHROPIC_API_KEY`,
`CTX_OPENAI_API_KEY`, or `CTX_OPENAI_COMPAT_API_KEY` env vars —
env vars take precedence.

### Are secrets redacted from the LLM context?

Yes. `src/context/redact.ts` replaces AWS access keys, GitHub
PATs, Slack tokens, JWTs, URL basic-auth, and `api_key="…"`
patterns with `<REDACTED:TYPE>` placeholders. The redaction is
applied in `buildContextPackage` and is on by default. Disable
per-run with `--no-redact` (not yet exposed — file an issue if you
need it).

## Output

### Why is `--format context` different from `--format markdown`?

- `markdown` is the brief-shaped output (Purpose / Dependencies /
  Data Flow, etc.) with the budget footer and (optionally) the
  LLM stats block. This is what you paste into a chat.
- `context` is the raw `CONTEXT PACKAGE` the writer saw. This is
  the "give me the code" output — file contents with line numbers,
  kind/tokens/reason metadata. Use this when you want to pipe
  code into your own pipeline or inspect what the model saw.
- `json` is the same data as a JSON object. Stable across
  versions; use this for tooling.

### Where can I learn more about the budget footer?

The footer is:

```
Files Scanned: 1240
Files Selected: 14
Repo Size:     420,000 tokens
Context Size:  14,200 tokens
Reduction:     96.6%
```

`Files Scanned` is the number of source files the scanner
considered. `Files Selected` is what made it into the context
package. `Repo Size` and `Context Size` are token counts
(`gpt-tokenizer` with `cl100k_base`). `Reduction` is
`1 - ContextSize/RepoSize`. A high reduction means the package
is much smaller than the repo — i.e. the scanner found a tight
neighbourhood around your target.

## Troubleshooting

### "No scannable files found"

The scanner couldn't find any source files for the supported
languages. Either:

- The repo has no `.php`/`.ts`/`.py` files.
- The `ignoreGlobs` in `project.json` are too aggressive. Run
  `ctx memory show` and check.
- The repo is in a subdirectory and `findRepoRoot` walked too far.
  Try `cd` to the actual project root and re-run.

### "Planner hit step limit"

The planner used all 8 of its tool-call rounds without converging
on a selection. Try:

- A larger `--max-files` so the writer gets more context.
- A more specific target (full path, not just a directory).
- `--max-steps 12` to give the planner more room.

### "Cost guard exceeded"

You hit `--max-cost` or `--max-tokens`. Either:

- Raise the cap (`--max-cost 0.50`).
- Use `--offline` for this run.
- Use `--no-cache` to skip the cache (sometimes cheaper when the
  cached answer is wrong).

## Project status

### Is `ctx` production-ready?

For the user-facing flows in `README.md`, yes. The MVP (v0.1.0) is
shipped. The audit gap is at 9/10. Remaining items are tracked in
`docs/ROADMAP.md`.

### Where is the changelog?

`CHANGELOG.md` at the repo root. New entries go under
`[Unreleased]`.
