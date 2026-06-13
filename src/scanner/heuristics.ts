import path from "node:path";
import type { ProjectMemory } from "../memory/project.js";

export interface HeuristicFilter {
  /** Returns true if the file should be included. */
  include(rel: string): boolean;
  /** True if the file looks like a test file. */
  isTest(rel: string): boolean;
  /** True if the file looks like a route definition. */
  isRoute(rel: string): boolean;
  /** Returns a coarse "primary" type label. */
  classify(rel: string): "controller" | "model" | "service" | "test" | "route" | "view" | "config" | "other";
}

function matchAny(rel: string, globs: string[]): boolean {
  for (const g of globs) {
    if (globMatch(g, rel)) return true;
  }
  return false;
}

/** Minimal glob matcher supporting `**`, `*`, `?`. */
export function globMatch(pattern: string, value: string): boolean {
  // Normalize
  const norm = (s: string) => s.split(path.sep).join("/");
  pattern = norm(pattern);
  value = norm(value);
  if (pattern === value) return true;
  if (pattern === "**") return true;
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return value === prefix || value.startsWith(prefix + "/");
  }
  // Convert glob to regex. Special-case patterns ending in /** so they
  // can match a top-level directory (e.g. "routes/**" matches "routes").
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    const re2 = new RegExp("^" + prefix.replace(/[.+^${}()|[\]\\]/g, "\\$&") + "(/.*)?$");
    return re2.test(value);
  }
  // Convert glob to regex, supporting the "**" wildcard anywhere.
  // Order matters:
  //   1. escape regex meta chars
  //   2. replace glob metacharacters ("?", "**", "*") with unique
  //      placeholders that do not collide with regex metacharacters
  //   3. expand placeholders into their regex equivalents
  // This avoids the "replacement regex re-interpreting the output"
  // problem that hits naive glob-to-regex converters.
  const PLACE_Q = "Q";
  const PLACE_SS_SLASH = "SSS";
  const PLACE_SS = "SS";
  const PLACE_S = "S";
  const expanded = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\?/g, PLACE_Q)
    .replace(/\*\*\//g, PLACE_SS_SLASH)
    .replace(/\*\*\*/g, PLACE_SS)
    .replace(/\*\*/g, PLACE_SS)
    .replace(/\*/g, PLACE_S);
  const re = new RegExp(
    "^" +
      expanded
        .replace(new RegExp(PLACE_Q, "g"), "[^/]")
        .replace(new RegExp(PLACE_SS_SLASH, "g"), "(?:.*/)?")
        .replace(new RegExp(PLACE_SS, "g"), "(?:.*/)?")
        .replace(new RegExp(PLACE_S, "g"), "[^/]*") +
      "$",
  );
  return re.test(value);
}

export function buildHeuristics(mem: ProjectMemory): HeuristicFilter {
  const includeGlobs = mem.includeGlobs.length > 0
    ? mem.includeGlobs
    : ["**/*.php", "**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.py"];

  return {
    include(rel: string) {
      if (matchAny(rel, mem.ignoreGlobs)) return false;
      if (rel.includes("node_modules/")) return false;
      if (rel.includes("vendor/")) return false;
      return matchAny(rel, includeGlobs);
    },
    isTest(rel: string) {
      if (/Tests?\//.test(rel) || /__tests__\//.test(rel)) return true;
      if (/\.(test|spec)\.[a-z]+$/.test(rel)) return true;
      if (/Test\.php$/.test(rel)) return true;
      if (/test_[A-Za-z0-9_]+\.py$/.test(rel)) return true;
      return matchAny(rel, mem.testPatterns);
    },
    isRoute(rel: string) {
      if (/^routes\//.test(rel)) return true;
      if (/Http\/Controllers\//.test(rel)) return true;
      if (/pages\/api\//.test(rel)) return true;
      return matchAny(rel, mem.routePatterns);
    },
    classify(rel: string) {
      if (/\/Controllers\//.test(rel) || /\/controllers\//.test(rel) || /views?\.(py|ts|js)$/.test(rel) && /views?\//.test(rel)) {
        // views are not the same as controllers; only label controllers as controllers
      }
      if (/\/Controllers\//i.test(rel) || /\/controllers\//i.test(rel)) return "controller";
      if (/\/Models\//i.test(rel) || /\/models\//i.test(rel)) return "model";
      if (/\/Services\//i.test(rel) || /\/services?\//i.test(rel)) return "service";
      if (/Tests?\//.test(rel) || /__tests__\//.test(rel) || /\.(test|spec)\.[a-z]+$/.test(rel) || /Test\.php$/.test(rel) || /test_[A-Za-z0-9_]+\.py$/.test(rel)) return "test";
      if (/^routes\//.test(rel) || /Http\/Controllers\//.test(rel) || /pages\/api\//.test(rel)) return "route";
      if (/views?\.py$/.test(rel) || /\/views?\//.test(rel)) return "view";
      if (/\.config\.(ts|js)$/.test(rel) || /\/config\//.test(rel) || /\.ini$/.test(rel) || /\.env/.test(rel)) return "config";
      return "other";
    },
  };
}
