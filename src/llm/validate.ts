/**
 * Validates LLM output against the section shapes the brief requires.
 * Each command's prompt template documents the expected `## Heading` list.
 */

const EXPECTED_SECTIONS: Record<string, RegExp[]> = {
  understand: [
    /^##\s+Purpose\b/m,
    /^##\s+Dependencies\b/m,
    /^##\s+Data Flow\b/m,
    /^##\s+Risk Areas\b/m,
    /^##\s+Suggested Reading Order\b/m,
  ],
  trace: [
    /^##\s+Probable Root Causes\b/m,
    /^##\s+Affected Files\b/m,
    /^##\s+Confidence Level\b/m,
    /^##\s+Suggested Fixes\b/m,
    /^##\s+Regression Tests\b/m,
  ],
  review: [
    /^##\s+Critical\b/m,
    /^##\s+High\b/m,
    /^##\s+Medium\b/m,
    /^##\s+Low\b/m,
  ],
  breakdown: [
    /^##\s+Epic\b/m,
    /^##\s+Features\b/m,
    /^##\s+Stories\b/m,
    /^##\s+Tasks\b/m,
    /^##\s+Estimates\b/m,
    /^##\s+Dependencies\b/m,
    /^##\s+Risks\b/m,
  ],
  proposal: [
    /^##\s+Scope\b/m,
    /^##\s+Assumptions\b/m,
    /^##\s+Modules\b/m,
    /^##\s+Effort\b/m,
    /^##\s+Risk\b/m,
    /^##\s+Implementation Plan\b/m,
  ],
};

export interface ValidationResult {
  ok: boolean;
  missing: string[];
}

export function validateOutput(command: keyof typeof EXPECTED_SECTIONS, body: string): ValidationResult {
  const expected = EXPECTED_SECTIONS[command];
  if (!expected) return { ok: true, missing: [] };
  const missing: string[] = [];
  for (const re of expected) {
    if (!re.test(body)) missing.push(re.source);
  }
  return { ok: missing.length === 0, missing };
}

export interface PlannerValidation {
  ok: boolean;
  selectedFiles?: string[];
  planNotes?: string;
  reason?: string;
}

/**
 * Validates a planner's tool-call-free final response. The planner is
 * expected to return a JSON object with `selectedFiles` (string[]) and
 * `planNotes` (string). We also do basic shape checks on the file list
 * (no escapes, no duplicates).
 */
export function validatePlannerOutput(raw: string, rootDir: string): PlannerValidation {
  const parsed = tryParseSelection(raw);
  if (!parsed) {
    return { ok: false, reason: "planner output is not a JSON object with selectedFiles" };
  }
  if (!Array.isArray(parsed.selectedFiles)) {
    return { ok: false, reason: "selectedFiles is not an array" };
  }
  if (parsed.selectedFiles.length === 0) {
    return { ok: false, reason: "selectedFiles is empty" };
  }
  // Dedupe + reject escapes
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const p of parsed.selectedFiles) {
    if (typeof p !== "string") continue;
    if (p.includes("..") || path.isAbsolute(p)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    cleaned.push(p);
  }
  if (cleaned.length === 0) {
    return { ok: false, reason: "all selectedFiles were rejected as invalid" };
  }
  return { ok: true, selectedFiles: cleaned, planNotes: String(parsed.planNotes ?? "") };
}

function tryParseSelection(s: string): { selectedFiles?: unknown; planNotes?: unknown } | null {
  if (!s) return null;
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj === "object") return obj as any;
  } catch {
    // fall through
  }
  const m = s.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (m) {
    try {
      const obj = JSON.parse(m[1]!);
      if (obj && typeof obj === "object") return obj as any;
    } catch {
      // ignore
    }
  }
  const m2 = s.match(/\{[\s\S]*?"selectedFiles"[\s\S]*?\}/);
  if (m2) {
    try {
      const obj = JSON.parse(m2[0]!);
      if (obj && typeof obj === "object") return obj as any;
    } catch {
      // ignore
    }
  }
  return null;
}

import path from "node:path";
