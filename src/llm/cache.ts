import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { projectDir } from "../memory/project.js";
import { ensureDir } from "../util/fs.js";
import { createHash } from "node:crypto";

const CACHE_FILE = "llm-cache.db";

/**
 * SQLite-backed response cache keyed on (model, hash(messages), tools
 * count). Lets the CLI feel instant on repeated runs and makes the
 * planner / writer steps free to re-call without spending tokens.
 *
 * Cached entries expire after `ttlMs` (default 7 days). Pass `ttlMs: 0`
 * to disable TTL (entries live until manually cleared).
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

export class LLMCache {
  private db: Database.Database | null = null;
  private ttlMs: number;
  private disabled: boolean;
  private root: string;

  constructor(root: string, opts: CacheOptions = {}) {
    this.root = root;
    this.ttlMs = opts.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
    this.disabled = !!opts.disabled;
  }

  private ensureOpen(): Database.Database | null {
    if (this.disabled) return null;
    if (this.db) return this.db;
    try {
      const dir = projectDir(this.root);
      ensureDir(dir);
      const file = path.join(dir, CACHE_FILE);
      const db = new Database(file);
      db.pragma("journal_mode = WAL");
      db.exec(`
        CREATE TABLE IF NOT EXISTS cache (
          key TEXT PRIMARY KEY,
          model TEXT NOT NULL,
          content TEXT NOT NULL,
          tool_calls TEXT NOT NULL DEFAULT '[]',
          tokens_in INTEGER NOT NULL DEFAULT 0,
          tokens_out INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
      `);
      this.db = db;
      return db;
    } catch {
      // cache is best-effort
      this.disabled = true;
      return null;
    }
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
    const db = this.ensureOpen();
    if (!db) return null;
    try {
      const row = db.prepare(`SELECT * FROM cache WHERE key = ?`).get(key) as any;
      if (!row) return null;
      if (this.ttlMs > 0 && Date.now() - row.created_at > this.ttlMs) {
        db.prepare(`DELETE FROM cache WHERE key = ?`).run(key);
        return null;
      }
      return {
        content: row.content,
        toolCalls: JSON.parse(row.tool_calls),
        tokensIn: row.tokens_in,
        tokensOut: row.tokens_out,
        model: row.model,
      };
    } catch {
      return null;
    }
  }

  put(
    key: string,
    model: string,
    content: string,
    toolCalls: { id: string; name: string; input: Record<string, unknown> }[],
    tokensIn: number,
    tokensOut: number,
  ): void {
    const db = this.ensureOpen();
    if (!db) return;
    try {
      db.prepare(
        `INSERT OR REPLACE INTO cache (key, model, content, tool_calls, tokens_in, tokens_out, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(key, model, content, JSON.stringify(toolCalls), tokensIn, tokensOut, Date.now());
    } catch {
      // best-effort
    }
  }

  clear(): void {
    const db = this.ensureOpen();
    if (!db) return;
    try {
      db.prepare(`DELETE FROM cache`).run();
    } catch {
      // ignore
    }
  }

  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // ignore
      }
      this.db = null;
    }
  }

  /** Best-effort garbage collection. Called once on construction. */
  gc(): void {
    const db = this.ensureOpen();
    if (!db || this.ttlMs <= 0) return;
    try {
      db.prepare(`DELETE FROM cache WHERE created_at < ?`).run(Date.now() - this.ttlMs);
    } catch {
      // ignore
    }
  }
}
