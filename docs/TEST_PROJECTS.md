# Test projects

Two recipes for testing `ctx` end-to-end. The first is a tiny
greenfield you can spin up in five minutes. The second is a real
open-source project where you can file a PR, run `ctx review` on
your diff, and have something to show for it.

## Why two projects?

The greenfield exercises every command on a codebase `ctx` already
understands. The OSS project exercises the same commands on a
codebase that is messy, opinionated, and full of edge cases — i.e.
the kind of code you'll actually be reviewing at work.

If you can produce a clean `ctx review` on a non-trivial OSS PR,
the tool is working.

---

## Project 1 — greenfield: `doozie/context-forge-fixture` (synthetic, on disk)

A 12-file PHP / TypeScript / Python monorepo shipped as a fixture
under `tests/fixtures/` in this repo. It's not a "real" project but
it is the most useful greenfield you can test against because:

- It exercises all three language parsers.
- It includes a Laravel-shaped PHP service with a real `routes/web.php`,
  a Next.js Pages-Router API route, and a Flask Blueprint view.
- The scanner graph, candidate ranking, and `ctx review` heuristics
  were designed against it. The Laravel fixture has
  `App\Services\TaxCalculator` and `App\Services\InvoiceService` so
  `ctx trace "tax"` produces non-empty candidates.
- It's deterministic: no remote dependencies, no LLM keys needed.

### Setup

```bash
cd /path/to/context-forge
ls tests/fixtures/
# sample-laravel  sample-node  sample-py
```

### Test plan

Each step should take under a minute. Run them in order; the
output is informative even in offline mode.

```bash
cd tests/fixtures/sample-laravel

# 1. What does the scanner see?
ctx scan
# expected: 8-12 files, 1-2 routes, 1 test

# 2. Build a raw context package (no LLM needed)
ctx package app/Services/InvoiceService.php --output /tmp/pkg.md
cat /tmp/pkg.md

# 3. Understand a file (LLM, but offline-fallback works)
ctx understand app/Services/InvoiceService.php --offline

# 4. Trace a query (use a keyword the fixture actually contains)
ctx trace "tax" --offline
# expected: at least one candidate file path appears in the body
# (TaxCalculator, InvoiceService, the Invoice model, or InvoiceServiceTest).
# The substring "mismatch" is *not* in the fixture -- pick a term the
# fixture contains.

# 5. Set up a git diff and review it
git init -q && git add . && git commit -qm "baseline"
echo '// TODO: hardcoded tax rate' >> app/Services/InvoiceService.php
git add . && git commit -qm "add TODO"
ctx review
# expected: a ## Low finding naming InvoiceService.php and the
# "TODO" string

# 6. JSON export
ctx scan --format json | head -30

# 7. Project memory tweaks
ctx memory show
ctx memory add-ignore --value "**/*.bak"
ctx memory add-ignore --value "tmp/**"
```

Repeat the same plan under `tests/fixtures/sample-node` (Next.js
Pages Router) and `tests/fixtures/sample-py` (Flask Blueprint +
dataclass). The Python fixture uses `@bp.post` decorators and
`flask.Blueprint`; the Node fixture uses `NextApiRequest` /
`NextApiResponse` and exports a default `handler`.

### What good looks like

- `ctx scan` reports 0 `Files discovered` only if the include globs
  in `project.json` are wrong. If you see 0, the fixture is broken
  — open an issue.
- `ctx package` always emits at least one file (the target). If it
  emits zero, the BFS isn't reaching the target's neighbours.
- `ctx review` on a one-line `console.log` change should produce a
  `## Low` finding.
- `ctx memory show` lists the detected stack, the test patterns,
  and the route patterns — all should be non-empty.

---

## Project 2 — open source: **Refactoring**

[Refactoring](https://github.com/refactoring/refactoring-example)
is a small, well-structured JavaScript codebase that pairs with the
classic Fowler book. It is the recommended greenfield for "I want
to learn a new tool without yak-shaving."

It is small (a couple thousand lines), pure JavaScript (no build
step), and has clear "good first issue" labels. It is the right
size for `ctx` to walk end-to-end in a single command.

### Why this project

- **Small**: < 5k LOC. `ctx scan` finishes in under a second.
- **Well-organized**: one file per refactoring pattern, no
  cross-cutting concerns.
- **No build step**: `git clone` and you're done.
- **Active issues**: there are open "good first issue" tickets
  where you can file a real PR.

### Setup

```bash
git clone https://github.com/refactoring/refactoring-example
cd refactoring-example
npm install -g contextforge   # if you haven't already
```

### Test plan

```bash
# 1. Discover what ctx sees
ctx scan
# expected: 30-60 .js files, dozens of symbols, no tests/routes
# (the project is plain JS, not a framework)

# 2. Pick a meaningful file and package its context
ctx package src/chapter_01.js --output /tmp/pkg.md
# expected: 3-5 files in the package, all in src/

# 3. Try the LLM path (needs API keys)
export CTX_PROVIDER=anthropic
export CTX_ANTHROPIC_API_KEY=sk-...
ctx understand src/chapter_01.js
# expected: 5 brief-shaped sections + budget footer + LLM stats

# 4. Trace a query
ctx trace "extract function"
# expected: at least one file path that matches the refactoring
# pattern

# 5. Branch, change, review
git checkout -b ctx-demo
# Try a change that the heuristics actually flag, e.g. one of:
#   - add a TODO/FIXME comment, or
#   - introduce `var ` instead of `const`, or
#   - call `console.log` in production code, or
#   - hard-code a string that looks like a secret.
# A pure comment like `// refactored with ctx` will not trigger any
# finding -- the heuristics look for risky patterns, not style.
git add . && git commit -qm "demo"
ctx review
# expected: at least one Low/Medium/High finding naming the file
# and the triggering pattern. If you see "no findings" you
# picked a change the heuristics do not match -- try a TODO.
```

### Contribute a real PR

After you've run the test plan and are happy with the tool:

1. Pick an open issue labeled `good first issue` on the
   [Refactoring repo](https://github.com/refactoring/refactoring-example/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22).
2. Branch off `main` and make the change.
3. Run `ctx review` on your diff before opening the PR. The
   output is grouped by severity (Critical/High/Medium/Low) and
   is pasteable into the PR description.
4. If `ctx review` reports a false positive, file an issue against
   this repo (`context-forge`) so we can tune the heuristics.

### If Refactoring doesn't fit

If you'd rather contribute to a project you already use, the same
recipe works for any small-to-medium OSS repo. The only requirement
is that the repo has a clean `main` branch you can diff against.
A few alternatives in increasing order of size:

- **[tj/n](https://github.com/tj/n)** — 1k LOC shell / C. Excellent
  for testing `ctx` on a non-JS codebase. No framework; just a
  handful of files.
- **[vercel/next.js examples](https://github.com/vercel/next.js/tree/canary/examples)** — pick one
  example app. Small, modern, no legacy.
- **[expressjs/express](https://github.com/expressjs/express)** — mid-sized
  TypeScript project with a real test suite and an active
  maintainer base. Good for stress-testing `ctx review` on a
  non-trivial diff.

For all three: `ctx scan` first to confirm the scanner finds what
you expect, then `ctx package` on a real file to confirm BFS
quality, then a real PR with `ctx review` in the description.

---

## Reporting issues

If `ctx` misbehaves on either of these projects, file an issue at
the `context-forge` repo with:

- The exact command you ran.
- The first 30 lines of output (or attach the full output).
- The relevant lines from the offending file (3-5 lines is
  enough).
- `ctx --version` and `node --version`.

The above is usually enough to reproduce. We do not need access to
your machine.
