# Contributing

Thanks for opening a PR. This guide is short. If it leaves something
unanswered, open an issue and we'll iterate.

## Setup

```bash
git clone https://github.com/your-org/context-forge
cd context-forge
npm install
npm run build
```

You should now have a working `ctx` in `./dist/cli.js`. Add it to your
PATH with `npm link` if you want to use it from elsewhere.

## Workflow

1. Pick an issue (or open one). Label `next-candidate` is the
   easiest entry point.
2. Branch off `dev`. Format: `feat/<short-name>` or
   `fix/<short-name>`.
3. Make your change. Tests are not optional — see below.
4. Run `npm test && npm run lint && npm run build`. All three must
   pass.
5. Open a PR against `dev`. CI runs lint/build/test on Node 22 and 24.

## Code style

The project is opinionated on style and silent on most other things.

- TypeScript strict mode. No `any` unless you're crossing a parser
  boundary.
- ESM (`"type": "module"` in `package.json`). All imports use `.js`
  extensions even for `.ts` sources.
- Commander for CLI; the program object lives in `src/cli.ts`.
- No external HTTP calls outside `src/llm/provider.ts` and friends.
  Everything else is local.
- Comments explain *why*, not *what*.

There is no `prettier` / `eslint` config. The existing code is the
style guide. If in doubt, run `npm run lint` (which is `tsc
--noEmit`); if it passes and the diff is small, you're fine.

## Testing

The test layout:

- `tests/unit/` — fast, no I/O, no LLM. `npm run test:unit`.
- `tests/e2e/` — uses fixtures in `tests/fixtures/` and the
  in-memory mock LLM. `npm run test:e2e`.
- `tests/e2e/_helpers.ts` — `copyFixture(name)` copies a fixture
  into a fresh tmp dir so tests don't share `.contextforge/`
  state.
- `tests/fixtures/mock-llm.ts` — canned response factory used by
  e2e tests. Add a new `respond(match, result)` if you add a new
  command.
- `tests/e2e/live.test.ts` — gated on `CTX_LIVE=1` plus the
  matching API key. Not part of the default CI run.

### Adding a unit test for a parser

1. Pick a fixture in `tests/fixtures/<stack>/`.
2. Write the expected symbols / imports / routes inline as
   `expect(r.symbols.map(s => s.name)).toContain(...)`.
3. Cover edge cases: empty file, file with only imports, file with
   only decorators, malformed syntax that the regex should still
   handle gracefully.

### Adding a unit test for a heuristic / candidate ranker

1. Build a tiny in-memory `GraphDB` (or use the SQLite DB on a
   tmpdir).
2. Insert a few nodes / edges by hand.
3. Assert the BFS respects the depth limit and the rank order.

### Adding a golden-file e2e test

1. Add a fixture under `tests/fixtures/<name>/` (or reuse an
   existing one).
2. Add a test in `tests/e2e/golden.test.ts` that:
   - calls the command,
   - calls `renderOutput(...)` with the result,
   - compares the rendered string to a committed golden file.
3. On the first run, the golden file is auto-created. Review it
   manually, commit it, and re-run the test to confirm it now
   matches.

### Mock LLM gotchas

`MockProvider.respond()` is **first-match-wins** on the joined
message contents. The most specific match must be registered first.
This matters when both the planner and the writer could match the
same prompt; the planner's `respond` must come before any more
general one in the registration order.

## Adding a command

1. Create `src/commands/<name>.ts` exporting
   `run<Name>(opts, ctx)`. The shape of `CommandResult` is in
   `src/commands/types.ts` — see existing commands for examples.
2. Add the writer prompt template under `src/llm/prompts/<name>.md`.
   Each template should end with "Produce the structured markdown
   now. No preamble." so the writer doesn't add filler.
3. Extend `EXPECTED_SECTIONS` in `src/llm/validate.ts`. **The
   validator must match the prompt exactly.** If you add a section
   to the prompt, add it to the validator. If you remove a section,
   remove it from the validator. There is a test for each command.
4. Wire the command into `src/cli.ts` using commander.
5. If the command produces a `ContextPackage` (e.g. `understand`,
   `trace`, `package`), set `result.contextPackageMd = packageToMarkdown(pkg, true)`.
6. Add a fixture, unit tests, and an e2e test (preferably
   golden-file).

## Adding a parser

1. Create `src/scanner/parsers/<lang>.ts` exporting
   `parse<Lang>(path, src)` that returns a `FileAnalysis`.
2. Add a `detectLanguage` clause in `src/scanner/index.ts`.
3. Add the extensions to the default include-globs in
   `src/scanner/heuristics.ts` so the parser is actually invoked.
4. Add a unit test in `tests/unit/parsers.test.ts`.
5. Add a small fixture under `tests/fixtures/<lang>/` (5-10 files
   is enough).

Parsers are deliberately regex-based. They extract only the
symbols / imports / routes / tests that the heuristics and BFS
ranking need. If you need higher accuracy, file an issue and we'll
discuss a tree-sitter backend behind a feature flag.

## Adding a provider

1. Implement the `LLMProvider` interface (`src/llm/types.ts`) in
   `src/llm/<name>.ts`. The interface is small: `chat(messages,
   tools, opts) → ChatResult`. Use `src/llm/anthropic.ts` or
   `src/llm/openai.ts` as a reference.
2. Use `withRetry` (`src/llm/retry.ts`) for the actual HTTP call so
   you get timeouts, exponential backoff, and 4xx vs 5xx
   discrimination for free.
3. Wire it in `src/llm/provider.ts:getProvider(cfg)`.
4. Add a preset to `PROVIDER_PRESETS` in `src/util/config.ts`
   (planner model, writer model, cost per 1M tokens).
5. Add a live-provider test in `tests/e2e/live.test.ts`. It will
   be skipped in CI but exercised locally when `CTX_LIVE=1`.

## Updating docs

If you change user-facing behavior:

- Update `README.md` (the canonical reference).
- Add an entry to `CHANGELOG.md` under `[Unreleased]`.
- If you added a new command, file, or env var, add a row to the
  relevant table in the README.
- If you changed a CLI flag, update the Global flags table.

The README is the source of truth for users; ARCHITECTURE.md is
the source of truth for contributors.

## Code review checklist

When reviewing a PR, check:

- [ ] Tests cover the new behavior (or the bug fix).
- [ ] No new file is `>300` lines. Split if it is.
- [ ] No new dependency in `dependencies` that could be in
      `devDependencies` (or `optionalDependencies`).
- [ ] The CHANGELOG has an entry.
- [ ] If a public surface changed (CLI flag, env var, file in the
      repo), the README was updated.
- [ ] `npm run lint && npm test && npm run build` are green.
