export type LLMProvider = "openai" | "anthropic" | "azure_openai" | "qwen" | "yandexgpt";

export type ReasoningMode = "DISABLED" | "ENABLED_HIDDEN";

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  thinkingEnabled?: boolean;
  reasoningMode?: ReasoningMode;
  timeoutMs?: number;
}

export interface LLMRequest {
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: "text" | "json";
}

export interface LLMResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  provider: LLMProvider;
  model: string;
}
