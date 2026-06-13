export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  tokensIn: number;
  tokensOut: number;
  model: string;
  latencyMs: number;
}

export interface ChatOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMProvider {
  chat(
    messages: ChatMessage[],
    tools: ToolSpec[],
    opts: ChatOptions,
  ): Promise<ChatResult>;
}
