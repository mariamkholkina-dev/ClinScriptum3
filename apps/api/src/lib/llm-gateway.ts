/**
 * Универсальный LLM Gateway.
 *
 * Поддерживает провайдеры: yandexgpt, openai, anthropic, azure.
 * Конфигурация берётся из config.llm(task) — у каждой задачи свои настройки.
 */

import { config, type LlmTask, type LlmTaskConfig } from "../config.js";

/* ═══════════════════════ Public API ═══════════════════════ */

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  text: string;
}

export interface LlmResponse {
  text: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export async function llmComplete(
  task: LlmTask,
  messages: LlmMessage[],
  overrides?: Partial<LlmTaskConfig>
): Promise<LlmResponse> {
  const cfg = { ...config.llm(task), ...overrides };

  if (!cfg.apiKey || !cfg.baseUrl) {
    throw new Error(`[llm] Missing API key or base URL for task "${task}"`);
  }

  switch (cfg.provider) {
    case "yandexgpt":
      return callYandexGpt(cfg, messages);
    case "openai":
    case "azure":
      return callOpenAiCompatible(cfg, messages);
    case "anthropic":
      return callAnthropic(cfg, messages);
    default:
      throw new Error(`[llm] Unknown provider: ${cfg.provider}`);
  }
}

/**
 * Extract YandexCloud folder ID from model URI.
 * Model format: gpt://<folder_id>/<model_name>
 */
function extractYandexFolderId(modelUri: string): string | null {
  const match = modelUri.match(/^gpt:\/\/([^/]+)\//);
  return match?.[1] ?? null;
}

/**
 * Shorthand: send a single user prompt with optional system prompt.
 */
export async function llmAsk(
  task: LlmTask,
  systemPrompt: string,
  userPrompt: string,
  overrides?: Partial<LlmTaskConfig>
): Promise<string> {
  const messages: LlmMessage[] = [];
  if (systemPrompt) messages.push({ role: "system", text: systemPrompt });
  messages.push({ role: "user", text: userPrompt });
  const res = await llmComplete(task, messages, overrides);
  return res.text;
}

/* ═══════════════════════ YandexGPT (OpenAI-compatible) ═══════════════════════ */

async function callYandexGpt(
  cfg: LlmTaskConfig,
  messages: LlmMessage[]
): Promise<LlmResponse> {
  // Yandex Cloud uses OpenAI-compatible API at /v1/chat/completions
  const baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  const url = baseUrl.includes("/v1")
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;

  const folderId = extractYandexFolderId(cfg.model);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Api-Key ${cfg.apiKey}`,
    "x-data-logging-enabled": "false",
  };
  if (folderId) {
    headers["x-folder-id"] = folderId;
  }

  const body = {
    model: cfg.model,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    messages: messages.map((m) => ({ role: m.role, content: m.text })),
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`[llm:yandexgpt] ${res.status} ${res.statusText}: ${errText}`);
  }

  const data = await res.json();

  return {
    text: data.choices?.[0]?.message?.content ?? "",
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
        }
      : undefined,
  };
}

/* ═══════════════════════ OpenAI-compatible ═══════════════════════ */

async function callOpenAiCompatible(
  cfg: LlmTaskConfig,
  messages: LlmMessage[]
): Promise<LlmResponse> {
  const url = cfg.provider === "azure"
    ? `${cfg.baseUrl}/chat/completions?api-version=2024-02-01`
    : `${cfg.baseUrl}/v1/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cfg.provider === "azure") {
    headers["api-key"] = cfg.apiKey;
  } else {
    headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  }

  const body = {
    model: cfg.model,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    messages: messages.map((m) => ({ role: m.role, content: m.text })),
  };

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`[llm:openai] ${res.status} ${res.statusText}: ${errText}`);
  }

  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
        }
      : undefined,
  };
}

/* ═══════════════════════ Anthropic ═══════════════════════ */

async function callAnthropic(
  cfg: LlmTaskConfig,
  messages: LlmMessage[]
): Promise<LlmResponse> {
  const url = `${cfg.baseUrl}/v1/messages`;

  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const body: any = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    temperature: cfg.temperature,
    messages: nonSystem.map((m) => ({ role: m.role, content: m.text })),
  };
  if (systemMsg) body.system = systemMsg.text;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`[llm:anthropic] ${res.status} ${res.statusText}: ${errText}`);
  }

  const data = await res.json();
  const text = data.content?.map((c: any) => c.text).join("") ?? "";

  return {
    text,
    usage: data.usage
      ? {
          promptTokens: data.usage.input_tokens ?? 0,
          completionTokens: data.usage.output_tokens ?? 0,
        }
      : undefined,
  };
}
