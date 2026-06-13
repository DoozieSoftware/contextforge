import path from "node:path";
import fs from "node:fs";
import { projectDir } from "../memory/project.js";
import { ensureDir } from "../util/fs.js";
import { createHash } from "node:crypto";

const CACHE_FILE = "llm-cache.json";

/**
 * JSON-file-backed LLM response cache keyed on
 * (model, hash(messages), toolCount). Lets the CLI feel instant on
 * repeated runs and makes the planner / writer steps free to re-call
 * without spending tokens.
 *
 * Cached entries expire after `ttlMs` (default 7 days). Pass `ttlMs: 0`
 * to disable TTL (entries live until manually cleared).
 *
 * Why JSON over SQLite: the cache is a best-effort memoization for a
 * single CLI invocation. SQLite pulled in a native build
 * (better-sqlite3) that breaks the npm install on recent Node versions.
 * JSON is fine here because we don't need transactional writes and
 * stale entries just expire on TTL.
 */
export interface CacheOptions {
  ttlMs?: number;
  disabled?: boolean;
}

export interface CacheHit {
  content: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  tokensIn: number;
  tokensOut: number;
  model: string;
}

interface CacheRow {
  model: string;
  content: string;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[];
  tokensIn: number;
  tokensOut: number;
  createdAt: number;
}

interface CacheSnapshot {
  version: 1;
  rows: Record<string, CacheRow>;
}

const EMPTY: CacheSnapshot = { version: 1, rows: {} };

export class LLMCache {
  private rows: Map<string, CacheRow>;
  private file: string | null;
  private ttlMs: number;
  private disabled: boolean;
  private dirty: boolean;

  constructor(root: string, opts: CacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
    this.disabled = !!opts.disabled;
    this.dirty = false;
    if (this.disabled) {
      this.file = null;
      this.rows = new Map();
      return;
    }
    try {
      const dir = projectDir(root);
      ensureDir(dir);
      this.file = path.join(dir, CACHE_FILE);
    } catch {
      // best-effort
      this.disabled = true;
      this.file = null;
      this.rows = new Map();
      return;
    }
    this.rows = this.readFromDisk();
  }

  static keyFor(model: string, messages: unknown[], toolCount: number): string {
    const h = createHash("sha256");
    h.update(model);
    h.update("\n");
    h.update(String(toolCount));
    h.update("\n");
    h.update(JSON.stringify(messages));
    return h.digest("hex");
  }

  get(key: string): CacheHit | null {
    if (this.disabled) return null;
    const row = this.rows.get(key);
    if (!row) return null;
    if (this.ttlMs > 0 && Date.now() - row.createdAt > this.ttlMs) {
      this.rows.delete(key);
      this.dirty = true;
      return null;
    }
    return {
      content: row.content,
      toolCalls: row.toolCalls,
      tokensIn: row.tokensIn,
      tokensOut: row.tokensOut,
      model: row.model,
    };
  }

  put(
    key: string,
    model: string,
    content: string,
    toolCalls: { id: string; name: string; input: Record<string, unknown> }[],
    tokensIn: number,
    tokensOut: number,
  ): void {
    if (this.disabled) return;
    this.rows.set(key, {
      model,
      content,
      toolCalls,
      tokensIn,
      tokensOut,
      createdAt: Date.now(),
    });
    this.dirty = true;
  }

  clear(): void {
    if (this.disabled) return;
    if (this.rows.size === 0) return;
    this.rows.clear();
    this.dirty = true;
  }

  close(): void {
    if (this.disabled || !this.dirty || !this.file) return;
    try {
      const snapshot: CacheSnapshot = { version: 1, rows: {} };
      for (const [k, v] of this.rows) snapshot.rows[k] = v;
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(snapshot));
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch {
      // best-effort
    }
  }

  /** Best-effort garbage collection. Called once on construction. */
  gc(): void {
    if (this.disabled || this.ttlMs <= 0) return;
    const cutoff = Date.now() - this.ttlMs;
    let removed = 0;
    for (const [k, v] of this.rows) {
      if (v.createdAt < cutoff) {
        this.rows.delete(k);
        removed++;
      }
    }
    if (removed > 0) this.dirty = true;
  }

  private readFromDisk(): Map<string, CacheRow> {
    if (!this.file) return new Map();
    try {
      const text = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(text) as CacheSnapshot;
      if (!parsed || parsed.version !== 1 || !parsed.rows || typeof parsed.rows !== "object") {
        return new Map();
      }
      return new Map(Object.entries(parsed.rows));
    } catch {
      return new Map();
    }
  }
}
