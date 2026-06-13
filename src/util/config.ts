import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export type ProviderName = "anthropic" | "openai" | "openai-compat";

export interface ProviderConfig {
  provider: ProviderName;
  apiKey?: string;
  baseUrl?: string;
  plannerModel: string;
  writerModel: string;
  // estimated $ per 1M tokens (input, output) — soft cost guardrail
  inputCostPer1M: number;
  outputCostPer1M: number;
}

export interface AppConfig {
  provider: ProviderConfig;
  // Soft cap on planner tool-call rounds
  maxPlannerSteps: number;
  // Optional cost guard limits (USD + tokens). Undefined = use defaults.
  costGuard?: {
    maxUsd?: number;
    maxTokens?: number;
    disabled?: boolean;
  };
  // Optional LLM response cache settings.
  cache?: {
    ttlMs?: number;
    disabled?: boolean;
  };
}

/**
 * Resolves the config directory: respects CTX_CONFIG_DIR (for tests / CI),
 * then XDG_CONFIG_HOME, then ~/.config/contextforge. Always re-evaluates the
 * env vars so tests can change them after import time.
 */
export function configDir(): string {
  if (process.env.CTX_CONFIG_DIR) return process.env.CTX_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "contextforge");
}

export function credentialsFile(): string {
  return path.join(configDir(), "credentials.json");
}

const PROVIDER_PRESETS: Record<ProviderName, Omit<ProviderConfig, "apiKey" | "baseUrl">> = {
  anthropic: {
    provider: "anthropic",
    plannerModel: "claude-haiku-4-5",
    writerModel: "claude-sonnet-4-5",
    inputCostPer1M: 1.0,
    outputCostPer1M: 5.0,
  },
  openai: {
    provider: "openai",
    plannerModel: "gpt-4o-mini",
    writerModel: "gpt-4o",
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
  },
  "openai-compat": {
    provider: "openai-compat",
    plannerModel: "llama3.1:8b",
    writerModel: "llama3.1:70b",
    inputCostPer1M: 0,
    outputCostPer1M: 0,
  },
};

export function defaultConfigFor(provider: ProviderName): ProviderConfig {
  return { ...PROVIDER_PRESETS[provider] };
}

/**
 * Build a config by merging: env vars > credentials.json > defaults.
 * Returns null if neither env vars nor credentials.json yield a usable provider
 * (init flow uses this to decide whether to launch).
 */
export function loadConfig(): AppConfig | null {
  const envProvider = (process.env.CTX_PROVIDER as ProviderName | undefined) ?? null;
  const envKey =
    process.env.CTX_ANTHROPIC_API_KEY ||
    process.env.CTX_OPENAI_API_KEY ||
    process.env.CTX_OPENAI_COMPAT_API_KEY ||
    undefined;
  const envBaseUrl = process.env.CTX_OPENAI_COMPAT_BASE_URL;

  const credsFile = credentialsFile();
  let fileProvider: ProviderName | null = null;
  let fileKey: string | undefined;
  let fileBaseUrl: string | undefined;
  try {
    if (fs.existsSync(credsFile)) {
      const data = JSON.parse(fs.readFileSync(credsFile, "utf-8"));
      fileProvider = data.provider ?? null;
      fileKey = data.apiKey;
      fileBaseUrl = data.baseUrl;
    }
  } catch {
    // ignore — treat as missing
  }

  const provider = envProvider ?? fileProvider;
  if (!provider) return null;
  const apiKey = envKey ?? fileKey;
  const baseUrl = envBaseUrl ?? fileBaseUrl;

  const preset = PROVIDER_PRESETS[provider];
  const cfg: ProviderConfig = {
    ...preset,
    provider,
    apiKey,
    baseUrl,
    plannerModel: process.env.CTX_PLANNER_MODEL ?? preset.plannerModel,
    writerModel: process.env.CTX_WRITER_MODEL ?? preset.writerModel,
  };

  const costMaxUsd = process.env.CTX_MAX_COST ? Number(process.env.CTX_MAX_COST) : undefined;
  const costMaxTokens = process.env.CTX_MAX_TOKENS ? Number(process.env.CTX_MAX_TOKENS) : undefined;
  const cacheTtl = process.env.CTX_CACHE_TTL_MS ? Number(process.env.CTX_CACHE_TTL_MS) : undefined;
  const cacheDisabled = process.env.CTX_NO_CACHE === "1" ? true : undefined;

  return {
    provider: cfg,
    maxPlannerSteps: Number(process.env.CTX_MAX_STEPS ?? 8),
    costGuard: {
      maxUsd: costMaxUsd,
      maxTokens: costMaxTokens,
    },
    cache: {
      ttlMs: cacheTtl,
      disabled: cacheDisabled,
    },
  };
}

export function hasUsableConfig(): boolean {
  const c = loadConfig();
  if (!c) return false;
  if (c.provider.provider !== "openai-compat") return !!c.provider.apiKey;
  return !!c.provider.apiKey && !!c.provider.baseUrl;
}
