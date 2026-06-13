/**
 * Strict CLI option parsers. Each returns either a validated positive
 * integer or throws a CommandError that commander can surface to the user
 * as a clean usage message.
 */

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

const INT_RE = /^\d+$/;

export function parsePositiveInteger(raw: string, flag: string): number {
  if (!INT_RE.test(raw)) {
    throw new CommandError(`Invalid value for ${flag}: expected a positive integer, got "${raw}"`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new CommandError(`Invalid value for ${flag}: expected > 0, got ${raw}`);
  }
  return n;
}

export function parseNonNegativeInteger(raw: string, flag: string): number {
  if (!INT_RE.test(raw)) {
    throw new CommandError(`Invalid value for ${flag}: expected a non-negative integer, got "${raw}"`);
  }
  return Number(raw);
}

/**
 * Wraps a commander action so any CommandError thrown by the body becomes
 * a clean error printed to stderr + non-zero exit, instead of a stack
 * trace dump.
 */
export async function safeAction(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof CommandError) {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 2;
    } else {
      throw err;
    }
  }
}
