/**
 * Replaces obvious hard-coded secrets in source text with structured
 * placeholders so they never make it into the LLM context package or any
 * rendered output. The replacements are deliberately verbose
 * (`<REDACTED:SECRET>`) so the downstream LLM understands the value is
 * intentionally hidden and won't try to invent it.
 *
 * Heuristics:
 *  - key=value / key: value patterns where the value matches a 16+ char
 *    high-entropy string and the key looks secret-y
 *  - AWS-shaped access keys (AKIA / ASIA prefix)
 *  - GitHub PATs, Slack tokens, JWTs
 *  - URL-embedded basic auth (`https://user:pass@`)
 *
 * False-positive rate is intentionally low — we only redact when the
 * surrounding context is very specific.
 */

const SECRET_KEY_HINTS = /(api[_-]?key|secret|password|passwd|token|access[_-]?key|private[_-]?key|client[_-]?secret|auth)/i;

const HIGH_ENTROPY_QUOTED = /(['"`])([A-Za-z0-9_\-+/=]{20,})\1/g;
const ASSIGNMENT_RE = /(api[_-]?key|secret|password|passwd|token|access[_-]?key|private[_-]?key|client[_-]?secret|auth)\s*[:=]\s*['"`]([^'"`\n]{6,})['"`]/gi;
const AWS_ACCESS_KEY = /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/g;
const GITHUB_PAT = /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g;
const SLACK_TOKEN = /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const URL_BASIC_AUTH = /https?:\/\/([^:\s/]+):([^@\s/]+)@/g;

export function redactSecrets(src: string): string {
  let out = src;

  // 1. Specific token shapes FIRST (so the assignment pattern doesn't catch them as "api_key = ...").
  out = out.replace(URL_BASIC_AUTH, (_m, user) => `https://${user}:<REDACTED:BASIC_AUTH_PASSWORD>@`);
  out = out.replace(AWS_ACCESS_KEY, "<REDACTED:AWS_KEY>");
  out = out.replace(GITHUB_PAT, "<REDACTED:GITHUB_TOKEN>");
  out = out.replace(SLACK_TOKEN, "<REDACTED:SLACK_TOKEN>");
  out = out.replace(JWT, "<REDACTED:JWT>");

  // 2. Targeted assignment patterns: `api_key = "abc123..."`. Skip if the
  // value is already a redaction placeholder (e.g. the GitHub/AWS/JWT
  // patterns ran first).
  out = out.replace(ASSIGNMENT_RE, (m, key, val) => {
    if (typeof val === "string" && val.startsWith("<REDACTED:")) return m;
    return `${key} = "<REDACTED:SECRET>"`;
  });

  // 6. Last-resort: very long quoted strings in a secret-key context
  out = out.replace(HIGH_ENTROPY_QUOTED, (m, q, _val, offset) => {
    if (SECRET_KEY_HINTS.test(out.substring(Math.max(0, (offset ?? 0) - 60), offset ?? 0))) {
      return `${q}<REDACTED:SECRET>${q}`;
    }
    return m;
  });

  return out;
}

/**
 * Heuristic check used by the review command to flag a finding WITHOUT
 * printing the actual secret. Returns the redacted snippet.
 */
export function redactForFinding(snippet: string): string {
  return redactSecrets(snippet);
}
