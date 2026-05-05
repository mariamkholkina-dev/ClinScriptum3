import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LLMConfig, LLMRequest, LLMResponse, LLMProvider } from "./types.js";

export class LLMGateway {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (this.config.provider === "yandexgpt") {
      return this.generateYandex(request);
    }

    if (this.config.baseUrl && this.config.provider !== "anthropic") {
      return this.generateOpenAICompat(request);
    }

    const model = this.resolveModel();

    const result = await generateText({
      model,
      system: request.system,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      maxTokens: request.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature: request.temperature ?? this.config.temperature ?? 0.1,
      ...(request.responseFormat === "json" ? {
        providerOptions: {
          openai: { response_format: { type: "json_object" } },
          anthropic: { response_format: { type: "json_object" } },
        },
      } : {}),
    });

    return {
      content: result.text,
      usage: {
        promptTokens: result.usage?.promptTokens ?? 0,
        completionTokens: result.usage?.completionTokens ?? 0,
        totalTokens: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
      },
      provider: this.config.provider,
      model: this.config.model,
    };
  }

  private async generateOpenAICompat(request: LLMRequest): Promise<LLMResponse> {
    let baseUrl = (this.config.baseUrl ?? "").replace(/\/+$/, "");
    if (!baseUrl.endsWith("/v1")) {
      baseUrl = `${baseUrl}/v1`;
    }
    const url = `${baseUrl}/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) {
      messages.push({ role: "system", content: request.system });
    }
    for (const m of request.messages) {
      messages.push({ role: m.role, content: m.content });
    }

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: request.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature: request.temperature ?? this.config.temperature ?? 0.1,
    };
    if (request.responseFormat === "json") {
      body.response_format = { type: "json_object" };
      body.chat_template_kwargs = { enable_thinking: false };
    } else if (this.config.thinkingEnabled === false) {
      body.chat_template_kwargs = { enable_thinking: false };
    }

    const jsonBody = JSON.stringify(body);

    const MAX_RETRIES = 3;
    const RETRYABLE_STATUSES = new Set([502, 503, 504, 429]);
    let res!: Response;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
            // Disable Yandex Cloud data logging when calling Yandex AI Studio
            // through OpenAI-compatible endpoint. Header is harmless for other
            // OpenAI-compatible providers (they ignore unknown headers).
            "x-data-logging-enabled": "false",
          },
          body: jsonBody,
          signal: AbortSignal.timeout(this.config.timeoutMs ?? 50_000),
        });

        if (res.ok || !RETRYABLE_STATUSES.has(res.status)) break;

        if (attempt === MAX_RETRIES) break;
        const delay = attempt * 5000;
        await new Promise((r) => setTimeout(r, delay));
      } catch (fetchErr: any) {
        const causeMsg = fetchErr?.cause ? `: ${fetchErr.cause.message ?? fetchErr.cause.code ?? fetchErr.cause}` : "";
        if (attempt === MAX_RETRIES) {
          throw new Error(
            `OpenAI-compatible fetch failed after ${MAX_RETRIES} attempts (${url}, body ${Math.round(jsonBody.length / 1024)}KB)${causeMsg}`,
            { cause: fetchErr },
          );
        }
        const delay = attempt * 5000;
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    if (!res.ok && request.responseFormat === "json" && (res.status === 400 || res.status === 422)) {
      delete body.response_format;
      const fallbackBody = JSON.stringify(body);
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          "x-data-logging-enabled": "false",
        },
        body: fallbackBody,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 50_000),
      });
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI-compatible API error ${res.status}: ${text.slice(0, 500)}`);
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      const text = await res.text().catch(() => "<unreadable>");
      throw new Error(`OpenAI-compatible API: invalid JSON response from ${url}: ${text.slice(0, 200)}`);
    }
    const content = data.choices?.[0]?.message?.content ?? "";
    const usage = data.usage ?? {};

    return {
      content,
      usage: {
        promptTokens: Number(usage.prompt_tokens ?? 0),
        completionTokens: Number(usage.completion_tokens ?? 0),
        totalTokens: Number(usage.total_tokens ?? 0),
      },
      provider: this.config.provider,
      model: this.config.model,
    };
  }

  private async generateYandex(request: LLMRequest): Promise<LLMResponse> {
    const isNativeModel = /\/yandexgpt[/-]/.test(this.config.model) || this.config.model.endsWith("/yandexgpt/latest");
    return isNativeModel
      ? this.generateYandexNative(request)
      : this.generateYandexOpenAI(request);
  }

  private async generateYandexNative(request: LLMRequest): Promise<LLMResponse> {
    const baseUrl = (this.config.baseUrl ?? "https://llm.api.cloud.yandex.net").replace(/\/+$/, "");
    const url = `${baseUrl}/foundationModels/v1/completion`;

    const messages: Array<{ role: string; text: string }> = [];
    if (request.system) {
      messages.push({ role: "system", text: request.system });
    }
    for (const m of request.messages) {
      messages.push({ role: m.role, text: m.content });
    }

    const completionOptions: Record<string, unknown> = {
      stream: false,
      temperature: request.temperature ?? this.config.temperature ?? 0.1,
      maxTokens: String(request.maxTokens ?? this.config.maxTokens ?? 4096),
    };
    if (this.config.reasoningMode && this.config.reasoningMode !== "DISABLED") {
      completionOptions.reasoningOptions = { mode: this.config.reasoningMode };
    }

    const body: Record<string, unknown> = {
      modelUri: this.config.model,
      completionOptions,
      messages,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Api-Key ${this.config.apiKey}`,
        // Disable Yandex Cloud data logging — required when sending
        // clinical-trial protocol content through YandexGPT Native API.
        "x-data-logging-enabled": "false",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 50_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`YandexGPT API error ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    const result = data.result ?? {};
    const content = result.alternatives?.[0]?.message?.text ?? "";
    const usage = result.usage ?? {};

    return {
      content,
      usage: {
        promptTokens: Number(usage.inputTextTokens ?? 0),
        completionTokens: Number(usage.completionTokens ?? 0),
        totalTokens: Number(usage.totalTokens ?? 0),
      },
      provider: "yandexgpt",
      model: this.config.model,
    };
  }

  private async generateYandexOpenAI(request: LLMRequest): Promise<LLMResponse> {
    let baseUrl = (this.config.baseUrl ?? "https://llm.api.cloud.yandex.net").replace(/\/+$/, "");
    if (!baseUrl.endsWith("/v1")) {
      baseUrl = `${baseUrl}/v1`;
    }
    const url = `${baseUrl}/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];
    if (request.system) {
      messages.push({ role: "system", content: request.system });
    }
    for (const m of request.messages) {
      messages.push({ role: m.role, content: m.content });
    }

    const wantReasoning = this.config.reasoningMode && this.config.reasoningMode !== "DISABLED";

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages,
      max_tokens: request.maxTokens ?? this.config.maxTokens ?? 4096,
      temperature: request.temperature ?? this.config.temperature ?? 0.1,
    };
    if (request.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    } else if (wantReasoning) {
      body.reasoning_effort = "medium";
    }

    let res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Api-Key ${this.config.apiKey}`,
        // Disable Yandex Cloud data logging — required when sending
        // clinical-trial protocol content through Yandex AI Studio
        // (OpenAI-compatible endpoint).
        "x-data-logging-enabled": "false",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 50_000),
    });

    if (!res.ok && request.responseFormat === "json" && (res.status === 400 || res.status === 422)) {
      delete body.response_format;
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Api-Key ${this.config.apiKey}`,
          "x-data-logging-enabled": "false",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 50_000),
      });
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`YandexGPT API error ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    const msg = data.choices?.[0]?.message;
    const content = msg?.content || msg?.reasoning_content || "";
    const usage = data.usage ?? {};

    return {
      content,
      usage: {
        promptTokens: Number(usage.prompt_tokens ?? 0),
        completionTokens: Number(usage.completion_tokens ?? 0),
        totalTokens: Number(usage.total_tokens ?? 0),
      },
      provider: "yandexgpt",
      model: this.config.model,
    };
  }

  private resolveModel() {
    switch (this.config.provider) {
      case "openai": {
        const openai = createOpenAI({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseUrl || undefined,
        });
        return openai(this.config.model);
      }
      case "azure_openai": {
        const azure = createOpenAI({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseUrl,
        });
        return azure(this.config.model);
      }
      case "qwen": {
        const qwen = createOpenAI({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseUrl ?? "https://integrate.api.nvidia.com/v1",
        });
        return qwen(this.config.model);
      }
      case "anthropic": {
        const anthropic = createAnthropic({ apiKey: this.config.apiKey });
        return anthropic(this.config.model);
      }
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`);
    }
  }
}
