#!/usr/bin/env node
// Re-applies +x to dist/cli.js after npm install. We use a node script
// (not a shell command) because npm 11.x's lifecycle-runner sometimes
// spawns install scripts in a sanitized environment where /bin/sh is
// not on PATH, breaking `chmod +x`. Node is always available.
import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "cli.js");

if (!existsSync(cli)) {
  // postinstall ran before the package was extracted (rare) or the
  // package is being installed in a non-standard layout. Silently
  // skip; the bin entry will fail loudly on its own.
  process.exit(0);
}

try {
  chmodSync(cli, 0o755);
} catch (err) {
  // Best-effort. Log to stderr and continue; failing postinstall
  // is worse than a non-executable bin.
  process.stderr.write(`[postinstall] chmod +x ${cli} failed: ${err.message}\n`);
  process.exit(0);
}
