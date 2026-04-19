import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { PrismaClient } from "@prisma/client";
export type * from "@prisma/client";
export { getEffectiveLlmConfig, toConfigSnapshot } from "./llm-config-resolver.js";
export type { LlmTaskConfig, LlmConfigSnapshot } from "./llm-config-resolver.js";
export { loadGenerationPrompts } from "./generation-prompts.js";
export { loadBundleRules, loadRulesForType, snapshotRules } from "./bundle-rule-loader.js";
export type { ResolvedRuleSet } from "./bundle-rule-loader.js";
