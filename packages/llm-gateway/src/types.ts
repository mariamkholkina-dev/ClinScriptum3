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
  /**
   * Опциональный хук, вызываемый после КАЖДОГО успешного generate().
   * Используется для записи истории «промт → ответ LLM» (см. LlmResponseLog).
   * Ошибки внутри хука не должны прерывать генерацию (gateway их глотает).
   */
  onResponse?: (entry: LlmCallRecord) => void | Promise<void>;
}

/** Запись одного вызова LLM для истории ответов. */
export interface LlmCallRecord {
  label?: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  provider: LLMProvider;
  model: string;
}

export interface LLMRequest {
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: "text" | "json";
  /** Метка вызова для истории (например "full_doc_self_check", "qa:batch1"). */
  label?: string;
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
