import fs from "node:fs";
import path from "node:path";

export type Stack = "laravel" | "node" | "python" | "mixed" | "unknown";
export type Database = "mysql" | "postgres" | "sqlite" | "mongodb" | "none" | "unknown";
export type Architecture = "mvc" | "service-layer" | "flat" | "modular" | "unknown";

export interface ProjectMemory {
  projectName: string;
  rootPath: string;
  detectedAt: string;
  stacks: Stack[];
  primaryLanguage: "php" | "javascript" | "typescript" | "python" | "unknown";
  database?: Database;
  architecture?: Architecture;
  ignoreGlobs: string[];
  includeGlobs: string[];
  testPatterns: string[];
  routePatterns: string[];
  pathAliases: Record<string, string>;
  notes: string[];
}

export const PROJECT_DIR = ".contextforge";
export const PROJECT_FILE = "project.json";
export const GRAPH_FILE = "graph.json";

export function projectDir(root: string): string {
  return path.join(root, PROJECT_DIR);
}

export function projectFilePath(root: string): string {
  return path.join(root, PROJECT_DIR, PROJECT_FILE);
}

export function graphFilePath(root: string): string {
  return path.join(root, PROJECT_DIR, GRAPH_FILE);
}

const DEFAULT_IGNORES = [
  "node_modules/**",
  "vendor/**",
  "dist/**",
  "build/**",
  ".next/**",
  "public/**",
  "storage/**",
  "bootstrap/cache/**",
  "**/*.min.js",
  "**/*.lock",
  "**/*.snap",
  ".git/**",
  ".contextforge/**",
  "coverage/**",
  "__pycache__/**",
  "*.pyc",
  ".venv/**",
  "venv/**",
];

const DEFAULT_TEST_PATTERNS = [
  "tests/**",
  "test/**",
  "__tests__/**",
  "**/*.test.{ts,js,tsx,jsx,php,py}",
  "**/*.spec.{ts,js,tsx,jsx,php,py}",
  "**/Tests/**",
  "**/test_*.py",
  "**/*Test.php",
];

const DEFAULT_ROUTE_PATTERNS = [
  "routes/**",
  "router/**",
  "**/routes.ts",
  "**/routes.js",
  "app/Http/Controllers/**",
  "src/pages/api/**",
];

export function defaultProjectMemory(root: string, projectName?: string): ProjectMemory {
  return {
    projectName: projectName ?? path.basename(root) ?? "contextforge-project",
    rootPath: root,
    detectedAt: new Date().toISOString(),
    stacks: ["unknown"],
    primaryLanguage: "unknown",
    database: "unknown",
    architecture: "unknown",
    ignoreGlobs: [...DEFAULT_IGNORES],
    includeGlobs: [],
    testPatterns: [...DEFAULT_TEST_PATTERNS],
    routePatterns: [...DEFAULT_ROUTE_PATTERNS],
    pathAliases: {},
    notes: [],
  };
}

export function readProjectMemory(root: string): ProjectMemory | null {
  const p = projectFilePath(root);
  if (!fs.existsSync(p)) return null;
  try {
    const mem = JSON.parse(fs.readFileSync(p, "utf-8")) as ProjectMemory;
    // Migrate older memories that don't have the new fields
    if (!mem.pathAliases) mem.pathAliases = {};
    if (!mem.notes) mem.notes = [];
    return mem;
  } catch {
    return null;
  }
}

export function writeProjectMemory(root: string, mem: ProjectMemory): string {
  const dir = projectDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = projectFilePath(root);
  fs.writeFileSync(file, JSON.stringify(mem, null, 2), "utf-8");
  return file;
}

/**
 * Heuristically detects stack, language, architecture, and path aliases
 * from the top-level of the repo. Returns a memory object even when
 * detection is inconclusive — the scanner + planner fall back gracefully.
 */
export function detectProjectMemory(root: string): ProjectMemory {
  const mem = defaultProjectMemory(root);
  const has = (p: string): boolean => fs.existsSync(path.join(root, p));
  const read = (p: string): unknown => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, p), "utf-8"));
    } catch {
      return null;
    }
  };

  const stacks: Stack[] = [];
  let primary: ProjectMemory["primaryLanguage"] = "unknown";
  let db: Database = "unknown";
  let arch: Architecture = "unknown";

  if (has("composer.json")) {
    stacks.push("laravel");
    primary = "php";
    if (has("artisan") && (has("app/Http/Controllers") || has("routes/web.php"))) {
      arch = "mvc";
    }
    const composer = read("composer.json") as { require?: Record<string, string> } | null;
    if (composer?.require) {
      const req = composer.require;
      if (req["laravel/framework"]) arch = "mvc";
      if (req["illuminate/database"] || req["doctrine/dbal"]) db = "mysql";
    }
    // PSR-4 autoload mapping
    const psr4 = (read("composer.json") as { "autoload"?: { "psr-4"?: Record<string, string> } } | null)
      ?.autoload?.["psr-4"];
    if (psr4) {
      for (const [alias, target] of Object.entries(psr4)) {
        // App\ → app/
        const aliasPrefix = alias.replace(/\\$/, "");
        const targetDir = target.replace(/\/$/, "");
        mem.pathAliases[aliasPrefix] = targetDir;
      }
    }
  }
  if (has("package.json")) {
    stacks.push("node");
    const pkg = read("package.json") as { dependencies?: Record<string, string> } | null;
    const deps = pkg?.dependencies ?? {};
    if (primary === "unknown") {
      if (deps["next"]) primary = "typescript";
      else if (deps["react"]) primary = "javascript";
      else primary = "javascript";
    }
  }
  if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) {
    stacks.push("python");
    if (primary === "unknown") primary = "python";
    if (has("manage.py") && has("app")) arch = "mvc";
  }

  if (stacks.length === 0) stacks.push("unknown");

  if (has("database/migrations") || has("prisma/schema.prisma") || has("drizzle.config.ts")) {
    if (has("docker-compose.yml") || has("docker-compose.yaml")) {
      db = "postgres";
    } else {
      db = "mysql";
    }
  }

  // TS/JS path aliases from tsconfig.json (Next.js, Vite, custom)
  const tsconfig = read("tsconfig.json") as {
    compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
  } | null;
  if (tsconfig?.compilerOptions?.paths) {
    const baseUrl = tsconfig.compilerOptions.baseUrl ?? ".";
    for (const [alias, targets] of Object.entries(tsconfig.compilerOptions.paths)) {
      // Use the first target. Common shapes: "@/*": ["src/*"], "@/components/*": ["components/*"]
      const t = targets[0];
      if (!t) continue;
      const aliasKey = alias.replace(/\*$/, "");
      const target = path.posix.join(baseUrl, t.replace(/\*$/, ""));
      mem.pathAliases[aliasKey] = target;
    }
  }
  // Next.js convention
  if (!mem.pathAliases["@"]) mem.pathAliases["@"] = ".";

  mem.stacks = Array.from(new Set(stacks));
  mem.primaryLanguage = primary;
  if (db !== "unknown") mem.database = db;
  if (arch !== "unknown") mem.architecture = arch;

  if (mem.stacks.includes("laravel") && !mem.ignoreGlobs.includes("vendor/**")) {
    mem.ignoreGlobs.push("vendor/**");
  }
  if (mem.stacks.includes("node") && !mem.ignoreGlobs.includes("node_modules/**")) {
    mem.ignoreGlobs.push("node_modules/**");
  }
  if (mem.stacks.includes("python") && !mem.ignoreGlobs.includes("__pycache__/**")) {
    mem.ignoreGlobs.push("__pycache__/**");
  }

  return mem;
}
