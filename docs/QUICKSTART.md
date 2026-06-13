# Quickstart — five minutes to a real context package

This walkthrough takes you from zero to a working `ctx` command on a tiny
project. No LLM keys are required for the first three steps — `ctx` works
fully offline and only calls an LLM if you opt in.

## 0. Requirements

- Node 22+ (`node --version`)
- A repo you want to analyse. The walkthrough uses a tiny Express app.

## 1. Install

```bash
npm install -g contextforge
```

Or to try it without polluting your global installs:

```bash
git clone https://github.com/your-org/context-forge
cd context-forge
npm install
npm run build
npm link
```

Verify:

```bash
ctx --version
# 0.1.0
```

## 2. Try the no-LLM path

This is the fastest way to see `ctx` do real work. Pick any repo, `cd`
into it, and run:

```bash
cd ~/work/some-repo
ctx scan
```

What you should see (output trimmed):

```
# Scanner report

## Scanner summary
- Files discovered: 142
- Symbols: 318
- Tests: 24
- Routes: 6
- Edges (resolved imports): 87
- Repo size: 41.7 KiB

## By extension
- `.ts`: 118
- `.js`: 24
- ...
```

If `ctx scan` reports `Files discovered: 0`, your repo is missing source
files for the supported languages (PHP, JS/TS, Python). Either add
source or run `ctx memory add-ignore` to tighten the include globs.

## 3. The "give me the context" path

This is the user-facing promise. Pick a file you actually want to
understand:

```bash
ctx package src/server.ts --output /tmp/pkg.md
```

Open `/tmp/pkg.md`. You'll see a budget footer and a `## CONTEXT
PACKAGE` block listing the target file plus its closest imports, with
line numbers and a brief reason for each. The package is line-numbered
so you can paste specific line ranges into your AI tool.

## 4. Add an LLM (optional)

Without an LLM, `ctx` produces a useful ranked list of files. With an
LLM, it produces the brief-shaped prose the audit lists
(Purpose / Dependencies / Data Flow, Probable Root Causes, etc.).

`ctx init` is interactive. It prompts for provider, model, and API key,
then writes `~/.config/contextforge/credentials.json` (mode `0600`).

```bash
ctx init
# ? Which provider? (anthropic | openai | openai-compat)
# ? Planner model? (claude-haiku-4-5)
# ? Writer model? (claude-sonnet-4-5)
# ? API key? ************
# [i] Wrote credentials to ~/.config/contextforge/credentials.json
```

Or, if you don't want an interactive prompt (CI / scripted use):

```bash
export CTX_PROVIDER=anthropic
export CTX_ANTHROPIC_API_KEY=sk-...
ctx understand src/server.ts
```

Any combination of `CTX_PROVIDER` + the matching key env var is enough
to skip `ctx init`.

## 5. Real command examples

```bash
# 1) Understand a file
ctx understand src/server.ts

# 2) Trace a query
ctx trace "rate limiter returning 500"

# 3) Review the diff against main
git checkout -b feature/x
# ... make changes ...
ctx review
# exit 0 + markdown body listing Critical/High/Medium/Low findings

# 4) JSON / raw context for piping
ctx understand src/server.ts --format json
ctx understand src/server.ts --format context --output /tmp/ctx.md

# 5) Strict offline (never call the LLM)
ctx trace "auth" --offline

# 6) Tighten the budget
ctx review --budget 8000 --max-cost 0.10
```

## 6. Add a project-memory edit

`ctx memory show` prints the detected stack, ignore globs, test
patterns, and path aliases. The default is fine for most projects. To
add an ignore glob:

```bash
ctx memory add-ignore --value "**/*.snap"
```

To add a path alias (e.g. for an internal `@billing` shorthand):

```bash
ctx memory add-alias --value "@billing=src/services/billing"
```

To launch your editor on the raw JSON:

```bash
$EDITOR "$(ctx memory show --format json | jq -r .rootPath)/.contextforge/project.json"
# or simply:
ctx memory edit        # uses $VISUAL / $EDITOR / vi
```

## 7. What you should not do

- **Do not** edit `.contextforge/graph.json` or `llm-cache.json` by hand.
  They are JSON caches; deleting them is safe but editing is not.
- **Do not** commit `.contextforge/project.json` with secrets. The
  file is meant to be shared but it does record the `rootPath`.
- **Do not** rely on `--offline` mode for "tier-1" outputs. Offline
  produces a ranked file list; LLM-mode produces reasoned prose.

## What's next

- See [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) for the three-pass flow.
- See [`docs/TEST_PROJECTS.md`](TEST_PROJECTS.md) for two concrete
  repos (one greenfield, one OSS) you can use to test on real code.
- See [`docs/FAQ.md`](FAQ.md) for cost, cache, and CI recipes.
