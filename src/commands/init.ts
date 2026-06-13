import path from "node:path";
import { defaultConfigFor, type ProviderName } from "../util/config.js";
import { writeCredentials, readCredentials, type Credentials } from "../memory/credentials.js";
import {
  detectProjectMemory,
  readProjectMemory,
  writeProjectMemory,
  projectDir,
} from "../memory/project.js";
import { log } from "../util/log.js";

export interface InitOptions {
  /** Force the interactive flow even if env vars are set. */
  force?: boolean;
  /** Skip provider/key collection (use existing env). */
  skipProvider?: boolean;
}

type InquirerPromptFn = (questions: any, answers?: any) => Promise<any>;

export async function runInit(opts: InitOptions = {}): Promise<{
  projectMemory: ReturnType<typeof detectProjectMemory>;
  credentials?: Credentials;
}> {
  const root = process.cwd();

  if (opts.skipProvider) {
    log.info("Skipping provider setup (env vars present).");
  } else {
    const prompt = await loadInquirerPrompt();
    const creds = await collectCredentials(prompt);
    writeCredentials(creds);
    log.info(`Wrote credentials to ${path.relative(root, credsFileSafe())}`);
  }

  // Detect / write project memory
  let mem = readProjectMemory(root);
  if (!mem) {
    mem = detectProjectMemory(root);
    writeProjectMemory(root, mem);
    log.info(`Detected & wrote ${path.relative(root, path.join(projectDir(root), "project.json"))}`);
  } else {
    log.info(`Existing project.json at ${path.relative(root, path.join(projectDir(root), "project.json"))}`);
  }
  const creds = opts.skipProvider ? undefined : readCredentials() ?? undefined;
  return { projectMemory: mem, credentials: creds };
}

async function loadInquirerPrompt(): Promise<InquirerPromptFn> {
  try {
    const mod: any = await import("inquirer");
    // v12 exports default; v11+ also supports a top-level prompt
    const fn = mod.default?.prompt ?? mod.prompt;
    if (typeof fn !== "function") {
      throw new Error("inquirer.prompt is not a function");
    }
    return fn.bind(mod.default ?? mod);
  } catch (err) {
    throw new Error(
      "inquirer is not installed. Run `npm install` in the context-forge project, or set CTX_PROVIDER + key env vars to skip the interactive init.",
    );
  }
}

async function collectCredentials(prompt: InquirerPromptFn): Promise<Credentials> {
  const { provider } = await prompt([
    {
      type: "list",
      name: "provider",
      message: "Which LLM provider?",
      choices: [
        { name: "Anthropic (Claude)", value: "anthropic" },
        { name: "OpenAI (GPT-4o / GPT-4o-mini)", value: "openai" },
        { name: "OpenAI-compatible (Ollama / OpenRouter / vLLM)", value: "openai-compat" },
      ],
    },
  ]);

  const preset = defaultConfigFor(provider);
  const { plannerModel, writerModel } = await prompt([
    { type: "input", name: "plannerModel", message: "Planner model:", default: preset.plannerModel },
    { type: "input", name: "writerModel", message: "Writer model:", default: preset.writerModel },
  ]);

  const { apiKey } = await prompt([
    {
      type: "password",
      name: "apiKey",
      message: `API key for ${provider}:`,
      mask: "*",
      validate: (v: string) => (v && v.length >= 8 ? true : "API key required"),
    },
  ]);

  let baseUrl: string | undefined;
  if (provider === "openai-compat") {
    const r = await prompt([
      {
        type: "input",
        name: "baseUrl",
        message: "Base URL (e.g. http://localhost:11434/v1):",
        validate: (v: string) => (v && /^https?:\/\//.test(v) ? true : "Must be a URL"),
      },
    ]);
    baseUrl = r.baseUrl;
  }

  return {
    provider,
    apiKey,
    baseUrl,
    plannerModel,
    writerModel,
    createdAt: new Date().toISOString(),
  };
}

function credsFileSafe(): string {
  return path.join(process.env.HOME ?? "~", ".config", "contextforge", "credentials.json");
}

export { readCredentials };
