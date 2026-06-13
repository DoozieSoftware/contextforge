import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Copies a fixture directory into a fresh tmp directory and returns the
 * resolved tmp path. This keeps e2e tests isolated from each other and
 * from the committed fixture (which would otherwise accumulate
 * .contextforge/ state between runs).
 */
export function copyFixture(name: string): string {
  const src = path.resolve(__dirname, "../fixtures", name);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), `ctx-${name}-`));
  cpSync(src, dest, { recursive: true });
  return dest;
}

function cpSync(src: string, dest: string, opts: { recursive?: boolean } = {}): void {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      cpSync(path.join(src, entry), path.join(dest, entry), opts);
    }
  } else if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(src), dest);
  } else {
    fs.copyFileSync(src, dest);
  }
}
