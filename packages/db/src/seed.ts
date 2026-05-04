import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { seedFactAnchors } from "./seed-fact-anchors.js";
import { seedFactSectionPriors } from "./seed-fact-section-priors.js";

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Demo Pharma",
      plan: "extended",
    },
  });

  const adminHash = await hashPassword("changeme123");
  const writerHash = await hashPassword("changeme123");

  await prisma.user.upsert({
    where: { email: "admin@demo.clinscriptum.com" },
    update: { passwordHash: adminHash },
    create: {
      id: randomUUID(),
      tenantId: tenant.id,
      email: "admin@demo.clinscriptum.com",
      passwordHash: await hashPassword("changeme123"),
      name: "Demo Admin",
      role: "tenant_admin",
    },
  });

  await prisma.user.upsert({
    where: { email: "writer@demo.clinscriptum.com" },
    update: { passwordHash: writerHash },
    create: {
      id: randomUUID(),
      tenantId: tenant.id,
      email: "writer@demo.clinscriptum.com",
      passwordHash: await hashPassword("changeme123"),
      name: "Demo Writer",
      role: "writer",
    },
  });

  const reviewerHash = await hashPassword("changeme123");

  await prisma.user.upsert({
    where: { email: "reviewer@demo.clinscriptum.com" },
    update: { passwordHash: reviewerHash },
    create: {
      id: randomUUID(),
      tenantId: tenant.id,
      email: "reviewer@demo.clinscriptum.com",
      passwordHash: reviewerHash,
      name: "Demo Reviewer",
      role: "findings_reviewer",
    },
  });

  const ruleAdminHash = await hashPassword("changeme123");
  await prisma.user.upsert({
    where: { email: "ruleadmin@demo.clinscriptum.com" },
    update: { passwordHash: ruleAdminHash },
    create: {
      id: randomUUID(),
      tenantId: tenant.id,
      email: "ruleadmin@demo.clinscriptum.com",
      passwordHash: ruleAdminHash,
      name: "Demo Rule Admin",
      role: "rule_admin",
    },
  });

  const ruleApproverHash = await hashPassword("changeme123");
  await prisma.user.upsert({
    where: { email: "ruleapprover@demo.clinscriptum.com" },
    update: { passwordHash: ruleApproverHash },
    create: {
      id: randomUUID(),
      tenantId: tenant.id,
      email: "ruleapprover@demo.clinscriptum.com",
      passwordHash: ruleApproverHash,
      name: "Demo Rule Approver",
      role: "rule_approver",
    },
  });

  // ── Golden Set tenant ──
  const goldenTenant = await prisma.tenant.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Golden Set",
      plan: "extended",
    },
  });

  const gsHash = await hashPassword("changeme123");

  await prisma.user.upsert({
    where: { email: "writer@golden.clinscriptum.com" },
    update: { passwordHash: gsHash },
    create: {
      id: randomUUID(),
      tenantId: goldenTenant.id,
      email: "writer@golden.clinscriptum.com",
      passwordHash: gsHash,
      name: "Golden Writer",
      role: "writer",
    },
  });

  await prisma.user.upsert({
    where: { email: "ruleadmin@golden.clinscriptum.com" },
    update: { passwordHash: gsHash },
    create: {
      id: randomUUID(),
      tenantId: goldenTenant.id,
      email: "ruleadmin@golden.clinscriptum.com",
      passwordHash: gsHash,
      name: "Golden Rule Admin",
      role: "rule_admin",
    },
  });

  await prisma.user.upsert({
    where: { email: "ruleapprover@golden.clinscriptum.com" },
    update: { passwordHash: gsHash },
    create: {
      id: randomUUID(),
      tenantId: goldenTenant.id,
      email: "ruleapprover@golden.clinscriptum.com",
      passwordHash: gsHash,
      name: "Golden Rule Approver",
      role: "rule_approver",
    },
  });

  // ── LLM Configs ──────────────────────────────────────────────
  console.log("Clearing existing LLM configs...");
  await prisma.llmConfig.deleteMany({});

  const LLM_API_KEY = "AQVNyu7w4xEJlCoRIpBLnZRszROoAwedCML01tnY";
  const LLM_BASE_URL = "https://llm.api.cloud.yandex.net";
  const LLM_TIMEOUT_MS = 120_000;
  const FOLDER_ID = "b1g1ua1ecl42sbksj2pk";
  const model = (name: string) => `gpt://${FOLDER_ID}/${name}/latest`;

  type RM = "DISABLED" | "ENABLED_HIDDEN";
  const D: RM = "DISABLED";
  const R: RM = "ENABLED_HIDDEN";

  const llmConfigs: Array<{
    name: string;
    taskId: string;
    model: string;
    temperature?: number;
    maxOutputTokens: number;
    maxInputTokens: number;
    contextStrategy: "chunk" | "multi_chunk" | "full_document" | "multi_document";
    reasoningMode: RM;
    isDefault: boolean;
  }> = [
    // ── section_classify ──
    { name: "Классификация секций — YandexGPT 5.1 Pro", taskId: "section_classify", model: model("yandexgpt"), maxOutputTokens: 4096, maxInputTokens: 60000, contextStrategy: "chunk", reasoningMode: D, isDefault: true },
    { name: "Классификация секций — Qwen3-235B", taskId: "section_classify", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 4096, maxInputTokens: 60000, contextStrategy: "chunk", reasoningMode: D, isDefault: false },

    // ── section_classify_qa ──
    { name: "Классификация секций QA — DeepSeek-V32", taskId: "section_classify_qa", model: model("deepseek-v32"), maxOutputTokens: 4096, maxInputTokens: 30000, contextStrategy: "chunk", reasoningMode: R, isDefault: true },
    { name: "Классификация секций QA — Qwen3-235B", taskId: "section_classify_qa", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 4096, maxInputTokens: 30000, contextStrategy: "chunk", reasoningMode: R, isDefault: false },

    // ── fact_extraction ──
    { name: "Извлечение фактов — YandexGPT 5.1 Pro", taskId: "fact_extraction", model: model("yandexgpt"), maxOutputTokens: 16384, maxInputTokens: 60000, contextStrategy: "multi_chunk", reasoningMode: D, isDefault: true },
    { name: "Извлечение фактов — DeepSeek-V32", taskId: "fact_extraction", model: model("deepseek-v32"), maxOutputTokens: 16384, maxInputTokens: 60000, contextStrategy: "multi_chunk", reasoningMode: D, isDefault: false },

    // ── fact_extraction_qa ──
    { name: "Извлечение фактов QA — DeepSeek-V32", taskId: "fact_extraction_qa", model: model("deepseek-v32"), maxOutputTokens: 4096, maxInputTokens: 30000, contextStrategy: "chunk", reasoningMode: R, isDefault: true },
    { name: "Извлечение фактов QA — Qwen3-235B", taskId: "fact_extraction_qa", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 4096, maxInputTokens: 30000, contextStrategy: "chunk", reasoningMode: R, isDefault: false },

    // ── soa_detection ──
    { name: "Обнаружение SOA — YandexGPT 5.1 Pro", taskId: "soa_detection", model: model("yandexgpt"), maxOutputTokens: 8192, maxInputTokens: 30000, contextStrategy: "chunk", reasoningMode: D, isDefault: true },
    { name: "Обнаружение SOA — Qwen3-235B", taskId: "soa_detection", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 8192, maxInputTokens: 30000, contextStrategy: "chunk", reasoningMode: D, isDefault: false },

    // ── soa_detection_qa ──
    { name: "Обнаружение SOA QA — DeepSeek-V32", taskId: "soa_detection_qa", model: model("deepseek-v32"), maxOutputTokens: 4096, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: R, isDefault: true },
    { name: "Обнаружение SOA QA — Qwen3-235B", taskId: "soa_detection_qa", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 4096, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: R, isDefault: false },

    // ── intra_audit ──
    { name: "Внутридокументный аудит — DeepSeek-V32", taskId: "intra_audit", model: model("deepseek-v32"), maxOutputTokens: 4096, maxInputTokens: 60000, contextStrategy: "full_document", reasoningMode: R, isDefault: true },
    { name: "Внутридокументный аудит — Qwen3-235B", taskId: "intra_audit", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 4096, maxInputTokens: 60000, contextStrategy: "full_document", reasoningMode: D, isDefault: false },

    // ── intra_audit_qa ──
    { name: "Внутридокументный аудит QA — DeepSeek-V32", taskId: "intra_audit_qa", model: model("deepseek-v32"), maxOutputTokens: 2048, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: R, isDefault: true },
    { name: "Внутридокументный аудит QA — Qwen3-235B", taskId: "intra_audit_qa", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 2048, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: D, isDefault: false },

    // ── inter_audit ──
    { name: "Междокументный аудит — DeepSeek-V32", taskId: "inter_audit", model: model("deepseek-v32"), maxOutputTokens: 8192, maxInputTokens: 60000, contextStrategy: "multi_document", reasoningMode: R, isDefault: true },
    { name: "Междокументный аудит — Qwen3-235B", taskId: "inter_audit", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 8192, maxInputTokens: 60000, contextStrategy: "multi_document", reasoningMode: D, isDefault: false },

    // ── inter_audit_qa ──
    { name: "Междокументный аудит QA — DeepSeek-V32", taskId: "inter_audit_qa", model: model("deepseek-v32"), maxOutputTokens: 4096, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: R, isDefault: true },
    { name: "Междокументный аудит QA — Qwen3-235B", taskId: "inter_audit_qa", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 4096, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: D, isDefault: false },

    // ── fact_audit_intra ──
    { name: "Аудит фактов (внутри) — YandexGPT 5.1 Pro", taskId: "fact_audit_intra", model: model("yandexgpt"), maxOutputTokens: 4096, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: D, isDefault: true },
    { name: "Аудит фактов (внутри) — DeepSeek-V32", taskId: "fact_audit_intra", model: model("deepseek-v32"), maxOutputTokens: 4096, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: D, isDefault: false },

    // ── fact_audit_intra_qa ──
    { name: "Аудит фактов (внутри) QA — DeepSeek-V32", taskId: "fact_audit_intra_qa", model: model("deepseek-v32"), maxOutputTokens: 2048, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: R, isDefault: true },
    { name: "Аудит фактов (внутри) QA — Qwen3-235B", taskId: "fact_audit_intra_qa", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 2048, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: D, isDefault: false },

    // ── fact_audit_inter ──
    { name: "Аудит фактов (между) — DeepSeek-V32", taskId: "fact_audit_inter", model: model("deepseek-v32"), maxOutputTokens: 4096, maxInputTokens: 16000, contextStrategy: "multi_document", reasoningMode: R, isDefault: true },
    { name: "Аудит фактов (между) — Qwen3-235B", taskId: "fact_audit_inter", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 4096, maxInputTokens: 16000, contextStrategy: "multi_document", reasoningMode: D, isDefault: false },

    // ── fact_audit_inter_qa ──
    { name: "Аудит фактов (между) QA — DeepSeek-V32", taskId: "fact_audit_inter_qa", model: model("deepseek-v32"), maxOutputTokens: 2048, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: R, isDefault: true },
    { name: "Аудит фактов (между) QA — Qwen3-235B", taskId: "fact_audit_inter_qa", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 2048, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: D, isDefault: false },

    // ── generation ──
    { name: "Генерация документов — AliceAI LLM", taskId: "generation", model: model("aliceai-llm"), maxOutputTokens: 8192, maxInputTokens: 30000, contextStrategy: "chunk", reasoningMode: D, isDefault: true },
    { name: "Генерация документов — YandexGPT 5.1 Pro", taskId: "generation", model: model("yandexgpt"), maxOutputTokens: 8192, maxInputTokens: 30000, contextStrategy: "chunk", reasoningMode: D, isDefault: false },

    // ── generation_qa ──
    { name: "Генерация документов QA — DeepSeek-V32", taskId: "generation_qa", model: model("deepseek-v32"), maxOutputTokens: 4096, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: R, isDefault: true },
    { name: "Генерация документов QA — Qwen3-235B", taskId: "generation_qa", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 4096, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: D, isDefault: false },

    // ── impact_analysis ──
    { name: "Анализ влияния — DeepSeek-V32", taskId: "impact_analysis", model: model("deepseek-v32"), maxOutputTokens: 8192, maxInputTokens: 60000, contextStrategy: "multi_document", reasoningMode: R, isDefault: true },
    { name: "Анализ влияния — Qwen3-235B", taskId: "impact_analysis", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 8192, maxInputTokens: 60000, contextStrategy: "multi_document", reasoningMode: D, isDefault: false },

    // ── impact_analysis_qa ──
    { name: "Анализ влияния QA — DeepSeek-V32", taskId: "impact_analysis_qa", model: model("deepseek-v32"), maxOutputTokens: 4096, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: R, isDefault: true },
    { name: "Анализ влияния QA — Qwen3-235B", taskId: "impact_analysis_qa", model: model("qwen3-235b-a22b-fp8"), maxOutputTokens: 4096, maxInputTokens: 16000, contextStrategy: "chunk", reasoningMode: D, isDefault: false },

    // ── comparison ──
    { name: "Сравнение версий — DeepSeek-V32", taskId: "comparison", model: model("deepseek-v32"), maxOutputTokens: 4096, maxInputTokens: 30000, contextStrategy: "multi_document", reasoningMode: R, isDefault: true },
    { name: "Сравнение версий — YandexGPT 5.1 Pro", taskId: "comparison", model: model("yandexgpt"), maxOutputTokens: 4096, maxInputTokens: 30000, contextStrategy: "multi_document", reasoningMode: D, isDefault: false },

    // ── summarization ──
    { name: "Суммаризация — AliceAI LLM", taskId: "summarization", model: model("aliceai-llm"), maxOutputTokens: 4096, maxInputTokens: 30000, contextStrategy: "full_document", reasoningMode: D, isDefault: true },
    { name: "Суммаризация — YandexGPT 5.1 Pro", taskId: "summarization", model: model("yandexgpt"), maxOutputTokens: 4096, maxInputTokens: 30000, contextStrategy: "full_document", reasoningMode: D, isDefault: false },

    // ── translation ──
    { name: "Перевод — AliceAI LLM", taskId: "translation", model: model("aliceai-llm"), maxOutputTokens: 8192, maxInputTokens: 30000, contextStrategy: "chunk", reasoningMode: D, isDefault: true },
    { name: "Перевод — YandexGPT 5.1 Pro", taskId: "translation", model: model("yandexgpt"), maxOutputTokens: 8192, maxInputTokens: 30000, contextStrategy: "chunk", reasoningMode: D, isDefault: false },
  ];

  console.log(`Seeding ${llmConfigs.length} LLM configs...`);
  for (const cfg of llmConfigs) {
    await prisma.llmConfig.create({
      data: {
        id: randomUUID(),
        tenantId: goldenTenant.id,
        provider: "yandexgpt",
        baseUrl: LLM_BASE_URL,
        apiKey: LLM_API_KEY,
        timeoutMs: LLM_TIMEOUT_MS,
        temperature: cfg.temperature ?? 0.1,
        isActive: true,
        name: cfg.name,
        taskId: cfg.taskId,
        model: cfg.model,
        maxOutputTokens: cfg.maxOutputTokens,
        maxInputTokens: cfg.maxInputTokens,
        contextStrategy: cfg.contextStrategy,
        reasoningMode: cfg.reasoningMode,
        isDefault: cfg.isDefault,
      },
    });
  }

  console.log("Seeding fact_anchors RuleSet...");
  await seedFactAnchors(prisma);

  console.log("Seeding fact_section_priors RuleSet...");
  await seedFactSectionPriors(prisma);

  console.log("Seed completed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
