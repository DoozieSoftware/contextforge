import { simpleGit, type SimpleGit } from "simple-git";
import path from "node:path";

export interface DiffOptions {
  base?: string; // default: main
  range?: string; // overrides base
  staged?: boolean;
  cwd: string;
}

export interface DiffResult {
  /** The raw diff text. */
  patch: string;
  /** Files changed in the diff. */
  files: string[];
  /** The base ref used. */
  base: string;
  /** The head ref used. */
  head: string;
}

const DEFAULT_BASE = "main";

export async function getRepoDiff(opts: DiffOptions): Promise<DiffResult> {
  const git: SimpleGit = simpleGit({ baseDir: opts.cwd });
  await ensureRepo(git);

  let base = opts.base ?? DEFAULT_BASE;
  let head = "HEAD";
  let patch = "";
  let files: string[] = [];

  if (opts.range) {
    // explicit range like "main...HEAD" or "abc123..def456"
    const r = opts.range;
    const rangeArg = r.includes("...") ? r : `${r.split("..")[0]}..${r.split("..")[1] ?? "HEAD"}`;
    patch = await git.diff([rangeArg]);
    const [b, h] = rangeArg.split(/\.\.|\.{3}/);
    base = b ?? DEFAULT_BASE;
    head = h ?? "HEAD";
    files = await git.diff(["--name-only", rangeArg]).then((s) => splitLines(s));
  } else if (opts.staged) {
    patch = await git.diff(["--staged"]);
    files = await git.diff(["--name-only", "--staged"]).then((s) => splitLines(s));
    base = "staged";
    head = "index";
  } else {
    // Default: main...HEAD (or whatever base is given)
    const rangeArg = `${base}...${head}`;
    try {
      patch = await git.diff([rangeArg]);
      files = await git.diff(["--name-only", rangeArg]).then((s) => splitLines(s));
    } catch {
      // base may not exist; fall back to working tree
      patch = await git.diff([]);
      files = await git.diff(["--name-only"]).then((s) => splitLines(s));
      base = "working";
    }
  }

  return { patch, files, base, head };
}

async function ensureRepo(git: SimpleGit): Promise<void> {
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error("Not a git repository (or any parent up to mount point /)");
  }
}

function splitLines(s: string): string[] {
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function isGitAvailable(cwd: string): Promise<boolean> {
  const git = simpleGit({ baseDir: cwd });
  return git.checkIsRepo();
}

export { DEFAULT_BASE };

/**
 * Parses a unified diff into per-file added-line ranges and the joined
 * added text. Used by the review command to run heuristics against the
 * actual change, not the whole file.
 *
 * Output is a Map keyed by repo-relative file path. Each value is:
 *   { addedLines: number[], addedText: string }
 */
export function parseUnifiedDiff(patch: string): Map<string, { addedLines: number[]; addedText: string }> {
  const out = new Map<string, { addedLines: number[]; addedText: string }>();
  const lines = patch.split("\n");
  let currentFile: string | null = null;
  let currentOldLine = 0;
  let currentNewLine = 0;
  let addedBuffer: string[] = [];
  let addedLineNums: number[] = [];
  function flush() {
    if (currentFile) {
      const prev = out.get(currentFile) ?? { addedLines: [], addedText: "" };
      const joined = prev.addedText ? prev.addedText + "\n" + addedBuffer.join("\n") : addedBuffer.join("\n");
      out.set(currentFile, {
        addedLines: [...prev.addedLines, ...addedLineNums],
        addedText: joined,
      });
    }
    addedBuffer = [];
    addedLineNums = [];
  }
  for (const line of lines) {
    const fileMatch = line.match(/^\+\+\+\s+(?:b\/)?(.+)$/);
    if (fileMatch) {
      flush();
      currentFile = fileMatch[1] ?? null;
      if (currentFile === "/dev/null") currentFile = null;
      continue;
    }
    const hunkMatch = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      currentOldLine = Number(hunkMatch[1] ?? 0);
      currentNewLine = Number(hunkMatch[2] ?? 0);
      continue;
    }
    if (!currentFile) continue;
    if (line.startsWith("+")) {
      addedBuffer.push(line.slice(1));
      addedLineNums.push(currentNewLine);
      currentNewLine++;
    } else if (line.startsWith("-")) {
      currentOldLine++;
    } else if (line.startsWith(" ")) {
      currentNewLine++;
    }
  }
  flush();
  return out;
}
