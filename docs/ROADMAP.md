# Roadmap

The MVP (v0.1.0) is feature-complete against the brief: first-run UX,
diff-aware review, scanner pruning, output formats, scan / memory
commands, validation, caching, redaction, golden tests. This document
is the working plan for what comes next.

Items are tagged with one of:

- **[shipped]** — already in the codebase, here for context.
- **[next]** — the next batch of work. High-leverage, low-risk.
- **[later]** — wants-driven. Worth doing when there is a concrete
  user need, not before.
- **[avoid]** — things we considered and explicitly chose not to do.

## Shipped (v0.1.0)

- Scanner: PHP, JS/TS, Python; SQLite import graph; BFS candidate
  ranking; mtime-aware re-scan; stale-node pruning.
- LLM: Anthropic, OpenAI, OpenAI-compat, mock; pre-call cost guard;
  response cache with TTL; tool-call sandbox to repo root; one
  repair pass on malformed output; section validator.
- CLI: `init`, `understand`, `trace`, `review`, `breakdown`,
  `proposal`, `package`, `scan`, `memory`; `--format
  markdown|context|json`; `--output`; `--offline`; `--quiet`;
  `--max-cost`; `--max-tokens`; `--no-cache`; `--cache-ttl`.
- Project memory: auto-detect from `composer.json` / `package.json` /
  `pyproject.toml`; `pathAliases` for tsconfig paths, PSR-4, `@/`.
- Security: planner tools sandboxed via `safeResolve`; secret
  redaction in context packages; credentials file with `0600`.
- CI: GitHub Actions with Node 22+24 matrix; lint / build / test /
  `npm pack --dry-run` / smoke; live-provider job gated on secrets.
- Tests: 116 passing, 1 skipped (live provider). Golden-file
  snapshots for the offline paths.

## Next (v0.2.0 candidate)

These are concrete, scoped, and unblock new users / new workflows.

### 1. Tree-sitter parsers behind a feature flag [next]

The current regex parsers cover the high-value cases but miss things
like nested class methods, deeply nested decorators, Python
type-annotated generics, and PHP attributes on parameters. A
`ctx scan --tree-sitter` flag (or an opt-in `CTX_TREE_SITTER=1`) would
load the real grammars for users who want it.

Why now: the optional dependency is already in `package.json`; we
just need to gate the load and the parse path. Useful for codebases
where the planner repeatedly calls `read_file` because the scanner
missed the relevant symbols.

### 2. Monorepo workspaces [next]

`findRepoRoot` already walks up to a `package.json`, but it does not
detect `pnpm-workspace.yaml` or `workspaces:` fields. A `ctx
--workspace <name>` flag (or auto-detect the package containing
`process.cwd()`) would let users run `ctx` from inside a sub-package
without affecting the rest of the monorepo.

Why now: monorepos are the default for new TypeScript projects. This
is the most common "why does `ctx scan` find too many files?" ticket.

### 3. `ctx review --branch <name>` and merge-base support [next]

Today `ctx review` defaults to `main...HEAD` and accepts `--base` or
`--range`. Adding `--branch <name>` would let the user review a
feature branch against a non-`main` base (e.g. a long-lived
`develop` or `uat` branch). Merge-base support means the diff is
"everything on this branch since it diverged from base," not
"everything between two SHAs."

Why now: the audit had multiple teams with `main` / `dev` / `uat`
branches. A two-line change to `git/diff.ts`.

### 4. `ctx review` markdown rendering improvements [next]

Heuristic findings currently show as plain bullets. Grouping them by
file (with the file as a `## file` heading) and showing the actual
code snippet in a code fence would make the output pasteable into
PRs and chat. The data is already there — just the rendering needs
to change.

### 5. `ctx trace` improvements [next]

Two concrete improvements:

- **Multi-line queries**: parse `"new line" && "old line"` as an AND
  over the corpus; parse `error OR exception` as OR; show hit count
  per file.
- **Call-graph overlay**: when the import graph has an edge from file
  A to file B, also list the functions in A that B might call
  (computed from the parser's symbol table). This is what the
  planner currently has to figure out with `read_file` calls.

### 6. `ctx init` non-interactive mode for CI [next]

Today `ctx init` is gated on a TTY. A `ctx init --from-env` mode
would print "config is in env vars, you're done" and exit 0 without
prompting. Useful for pre-commit hooks and CI.

### 7. Refactor heuristics into a typed rules engine [next]

`scanner/heuristics.ts` is a single function returning a closure.
For v0.2 we want to expose the rules as a list of `Rule` objects so
they can be inspected, tested, and overridden from `project.json`.

## Later (v0.3+)

These are real features, not polish. They go in once a real user asks.

### LLM-as-a-judge for the planner's tool calls [later]

The planner calls `read_file`/`list_dir` and we trust it. A second
LLM pass that scores the tool calls for "did this actually move the
needle?" would catch pathological cases (planner reading the same
file 20 times). Expensive but high-leverage.

### Per-team prompt templates [later]

`ctx understand` on a PHP codebase benefits from a different writer
prompt than on a TypeScript one. Letting teams drop
`.contextforge/prompts/understand.md` to override the default
template is a 50-line change. We will not do it speculatively.

### IDE integration [later]

VS Code extension that runs `ctx` in the background and shows the
ranked candidates in a sidebar. Possible but probably premature.

### Real-time scanner watch [later]

`chokidar` watches the repo and re-runs the scanner on change,
keeping the SQLite graph up to date so `ctx` commands are instant.
Already in `package.json` as an unused dep.

### Multi-language context [later]

Mixed-language repos (PHP backend + TS frontend) are common.
Today the scanner handles them; the writer prompt is one-language.
A blended prompt that explicitly says "this is a polyglot repo"
could help.

## Avoid (explicit non-goals)

These came up in design discussions. We are not going to do them.

### **Avoid**: Build a context IDE

A GUI on top of `ctx`. The CLI is the product. IDEs already have
their own indexing; `ctx` is the bridge to LLMs that don't.

### **Avoid**: Support more languages in the writer prompt

We currently have 5 prompts (`understand`, `trace`, `review`,
`breakdown`, `proposal`). Adding `ctx refactor`, `ctx document`,
`ctx test` etc. dilutes the brand. If a team really needs it, the
`ctx proposal` template is general enough to repurpose.

### **Avoid**: Auto-running `ctx review` on every commit

This is what GitHub Copilot and CodeRabbit do. The audit
specifically did not ask for it. `ctx` is the high-signal
human-in-the-loop review; CI review is a different product.

### **Avoid**: Real-time token streaming to the LLM

The audit listed this as a "would be nice." It is not on the
critical path and adds significant complexity to the provider
adapters. Skip until a user asks.

### **Avoid**: Replace regex parsers with tree-sitter everywhere

Tree-sitter is more accurate but requires a native binding. The
regex parsers cover 90% of the value at 1% of the install cost. We
will keep the regex parsers as the default and ship tree-sitter
behind a feature flag instead.

## How to influence the roadmap

Open an issue with one of these labels:

- `bug` — wrong output, missing case, broken regression
- `next-candidate` — well-scoped, has a use case, just needs a hand
- `later-discuss` — big idea, needs a design conversation
- `docs` — README / doc / example inaccuracy

The current backlog is tracked in `CHANGELOG.md` under
`[Unreleased]`.
