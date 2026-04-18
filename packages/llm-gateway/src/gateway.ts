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

  private resolveModel() {
    switch (this.config.provider) {
      case "openai": {
        const openai = createOpenAI({ apiKey: this.config.apiKey });
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
        // Qwen3-Next-80B via NVIDIA NIM or other OpenAI-compatible endpoint
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
      case "yandexgpt": {
        const yandex = createOpenAI({
          apiKey: this.config.apiKey,
          baseURL: this.config.baseUrl ?? "https://llm.api.cloud.yandex.net/foundationModels/v1",
        });
        return yandex(this.config.model);
      }
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`);
    }
  }
}
