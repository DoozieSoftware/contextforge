export type Language = "php" | "typescript" | "javascript" | "python";

export interface ImportRef {
  /** The raw specifier (e.g. "../Service", "@/lib/db", "os") */
  raw: string;
  /** Where the import was found */
  line: number;
  /** True if this is a type-only import (TS) or from typing (py) */
  typeOnly?: boolean;
}

export interface SymbolRef {
  kind:
    | "class"
    | "function"
    | "method"
    | "interface"
    | "type"
    | "namespace"
    | "const"
    | "trait"
    | "decorator"
    | "test";
  name: string;
  line: number;
  /** Decorator/attribute name for tests and frameworks */
  annotation?: string;
}

export interface RouteRef {
  /** HTTP method or verb hint */
  method: string;
  /** Path pattern (if available) */
  path?: string;
  /** Handler symbol or expression */
  handler?: string;
  line: number;
}

export interface FileAnalysis {
  path: string;
  language: Language;
  size: number;
  hash: string;
  imports: ImportRef[];
  symbols: SymbolRef[];
  routes: RouteRef[];
  /** Test functions detected in the file */
  tests: SymbolRef[];
  /** Free-form tags for heuristics (e.g. "controller", "model", "service") */
  tags: string[];
}

export interface GraphNode {
  path: string;
  hash: string;
  language: Language;
  size: number;
  symbolCount: number;
  importCount: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** Resolved path when known, else the raw specifier */
  raw: string;
  resolved: boolean;
}

export interface ScanResult {
  files: FileAnalysis[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalFiles: number;
  totalSize: number;
  /** True when the scan was served from a mtime cache and parsing was skipped. */
  cached?: boolean;
}
