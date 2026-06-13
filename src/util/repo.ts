import fs from "node:fs";
import path from "node:path";

/**
 * Marker files/commands that identify a project root.
 */
const ROOT_MARKERS = [
  ".git",
  "package.json",
  "composer.json",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "Gemfile",
];

/**
 * Walks up from `start` looking for a project root marker. Returns the
 * directory containing the marker, or `start` if nothing was found within
 * `maxDepth` levels. This is the same heuristic Git itself uses for its
 * "discover repo" walk, capped so we don't escape the user's home tree.
 */
export function findRepoRoot(start: string, maxDepth = 8): string {
  let cur = path.resolve(start);
  for (let i = 0; i <= maxDepth; i++) {
    for (const m of ROOT_MARKERS) {
      if (fs.existsSync(path.join(cur, m))) return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break; // reached filesystem root
    cur = parent;
  }
  return start;
}

/**
 * Detects the VCS root by walking up to a `.git` directory. Returns null
 * when the working tree is not inside a git repo.
 */
export function findGitRoot(start: string, maxDepth = 8): string | null {
  let cur = path.resolve(start);
  for (let i = 0; i <= maxDepth; i++) {
    if (fs.existsSync(path.join(cur, ".git"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}
