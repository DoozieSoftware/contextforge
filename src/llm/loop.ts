import fs from "node:fs";
import path from "node:path";
import type { LLMProvider, ChatMessage, ChatOptions, ToolSpec, ToolCall } from "./types.js";
import { plannerTools, executeTool, type ToolContext } from "./tools.js";
import { recordCall, createStats, type LlmStats } from "./stats.js";
import { validatePlannerOutput, validateOutput } from "./validate.js";
import { CostGuard, CostExceededError } from "./cost.js";
import type { AppConfig } from "../util/config.js";
import type { ProjectMemory } from "../memory/project.js";

export interface PlannerInput {
  goal: string;
  systemPrompt: string;
  candidateSummary: string;
  maxSteps?: number;
  root: string;
  memory: ProjectMemory;
  appConfig: AppConfig;
  provider: LLMProvider;
  stats?: LlmStats;
}

export interface PlannerOutput {
  selectedFiles: string[];
  planNotes: string;
  stats: LlmStats;
  transcript: ChatMessage[];
  /** When the planner output failed validation and we fell back, this explains why. */
  fallbackReason?: string;
}

const TOOL_SANITY_RE = /^[A-Za-z0-9_./-]+$/;

/**
 * Runs the planner loop. The planner model is given:
 *   1) the candidate list (pre-scored by the scanner)
 *   2) read_file / list_dir tools (sandboxed to the repo root)
 * and is asked to return a final JSON object with `selectedFiles` and
 * `planNotes`. The loop continues calling tools until the model produces
 * that final object or it hits `maxSteps`.
 */
export async function runPlanner(input: PlannerInput): Promise<PlannerOutput> {
  const stats = input.stats ?? createStats();
  const tools = plannerTools();
  const toolCtx: ToolContext = { root: input.root };
  const messages: ChatMessage[] = [
    { role: "system", content: input.systemPrompt },
    {
      role: "user",
      content: `${input.goal}\n\nProject memory:\n${JSON.stringify(input.memory, null, 2)}\n\nCandidate files (pre-scored by the scanner):\n${input.candidateSummary}\n\nUse read_file or list_dir to inspect further, then return your selection in this exact JSON shape:\n\n\`\`\`json\n{"selectedFiles": ["path/a.ts", "path/b.ts"], "planNotes": "one-paragraph justification"}\n\`\`\``,
    },
  ];

  const opts: ChatOptions = {
    model: input.appConfig.provider.plannerModel,
    maxTokens: 1024,
    temperature: 0.1,
  };
  const maxSteps = input.maxSteps ?? input.appConfig.maxPlannerSteps;
  const guard = new CostGuard(input.appConfig.provider, (input.appConfig as any).costGuard);

  for (let step = 0; step < maxSteps; step++) {
    guard.estimate(messages);
    const result = await input.provider.chat(messages, tools, opts);
    recordCall(
      stats,
      "planner",
      result.model,
      result.tokensIn,
      result.tokensOut,
      result.latencyMs,
      input.appConfig.provider,
      result.toolCalls.length ? result.toolCalls.map((t) => t.name).join(",") : undefined,
    );
    guard.record(result.tokensIn, result.tokensOut);

    if (result.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: result.content });
      const v = validatePlannerOutput(result.content, input.root);
      if (v.ok && v.selectedFiles) {
        return {
          selectedFiles: v.selectedFiles,
          planNotes: v.planNotes ?? "",
          stats,
          transcript: messages,
        };
      }
      // One repair attempt: ask the model to reshape
      messages.push({
        role: "user",
        content: `Your previous reply did not match the required shape. ${v.reason ?? "Output must be a single JSON object"} on a single line (or in a code fence). Please retry now with only the JSON object and nothing else.`,
      });
      guard.estimate(messages);
      const repair = await input.provider.chat(messages, [], opts);
      recordCall(
        stats,
        "planner",
        repair.model,
        repair.tokensIn,
        repair.tokensOut,
        repair.latencyMs,
        input.appConfig.provider,
      );
      guard.record(repair.tokensIn, repair.tokensOut);
      const v2 = validatePlannerOutput(repair.content, input.root);
      if (v2.ok && v2.selectedFiles) {
        return {
          selectedFiles: v2.selectedFiles,
          planNotes: v2.planNotes ?? "",
          stats,
          transcript: messages,
        };
      }
      return {
        selectedFiles: [],
        planNotes: "",
        stats,
        transcript: messages,
        fallbackReason: v2.reason ?? v.reason,
      };
    }

    // Sanity-check tool names + arg shapes before executing
    const safeCalls: ToolCall[] = [];
    for (const c of result.toolCalls) {
      if (c.name !== "read_file" && c.name !== "list_dir") continue;
      const pathArg = String((c.input as any)?.path ?? "");
      if (!TOOL_SANITY_RE.test(pathArg)) continue;
      safeCalls.push({ ...c, input: { path: pathArg } });
    }
    if (safeCalls.length === 0) {
      // Nudge the planner to use the supported tools
      messages.push({
        role: "user",
        content:
          "Reminder: the only tools available are read_file(path) and list_dir(path). paths are relative to the repo root. Try again.",
      });
      continue;
    }
    messages.push({ role: "assistant", content: result.content, tool_calls: safeCalls });
    for (const call of safeCalls) {
      const r = executeTool(call, toolCtx);
      messages.push({ role: "tool", content: r.content, tool_call_id: r.tool_call_id });
    }
  }

  return {
    selectedFiles: [],
    planNotes: "",
    stats,
    transcript: messages,
    fallbackReason: "planner hit step limit",
  };
}

export interface WriterInput {
  command: "understand" | "trace" | "review" | "breakdown" | "proposal";
  promptBody: string;
  contextPackage: string;
  userGoal: string;
  appConfig: AppConfig;
  provider: LLMProvider;
  stats: LlmStats;
}

export interface WriterOutput {
  body: string;
  stats: LlmStats;
  /** When the writer needed a repair pass to meet the section shape. */
  repaired: boolean;
  /** When the writer still didn't meet the shape after repair. */
  missingSections: string[];
}

/**
 * Calls the writer, then validates the result against the command's
 * required section shape. If the validation fails, makes ONE repair pass
 * with a targeted message before giving up.
 */
export async function runWriter(input: WriterInput): Promise<WriterOutput> {
  const messages: ChatMessage[] = [
    { role: "system", content: input.promptBody },
    {
      role: "user",
      content: `${input.userGoal}\n\nCONTEXT PACKAGE:\n\n${input.contextPackage}\n\nProduce the structured markdown now. No preamble.`,
    },
  ];
  const opts: ChatOptions = {
    model: input.appConfig.provider.writerModel,
    maxTokens: 4096,
    temperature: 0.2,
  };
  const guard = new CostGuard(input.appConfig.provider, (input.appConfig as any).costGuard);
  guard.estimate(messages);
  const result = await input.provider.chat(messages, [], opts);
  recordCall(
    input.stats,
    "writer",
    result.model,
    result.tokensIn,
    result.tokensOut,
    result.latencyMs,
    input.appConfig.provider,
  );
  guard.record(result.tokensIn, result.tokensOut);

  const v = validateOutput(input.command, result.content);
  if (v.ok) {
    return { body: result.content, stats: input.stats, repaired: false, missingSections: [] };
  }

  // One repair attempt
  messages.push({ role: "assistant", content: result.content });
  messages.push({
    role: "user",
    content: `Your previous reply is missing required sections: ${v.missing.join(", ")}. Rewrite the full output including ALL of these sections. Keep it concise. No preamble.`,
  });
  guard.estimate(messages);
  const repair = await input.provider.chat(messages, [], opts);
  recordCall(
    input.stats,
    "writer",
    repair.model,
    repair.tokensIn,
    repair.tokensOut,
    repair.latencyMs,
    input.appConfig.provider,
  );
  guard.record(repair.tokensIn, repair.tokensOut);
  const v2 = validateOutput(input.command, repair.content);
  return {
    body: repair.content,
    stats: input.stats,
    repaired: !v2.ok,
    missingSections: v2.missing,
  };
}

export function loadPromptTemplate(name: string): string {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const p = path.join(here, "prompts", `${name}.md`);
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
  // Try CWD-relative (when running via tsx)
  const alt = path.join(process.cwd(), "src", "llm", "prompts", `${name}.md`);
  if (fs.existsSync(alt)) return fs.readFileSync(alt, "utf-8");
  throw new Error(`Prompt template not found: ${name}`);
}
