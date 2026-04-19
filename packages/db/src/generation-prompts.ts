import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function loadGenerationPrompts(
  ruleSetId: string,
): Promise<{ systemPrompt: string | null; sectionPrompts: Map<string, string> }> {
  const version = await prisma.ruleSetVersion.findFirst({
    where: { ruleSetId, isActive: true },
    include: { rules: { where: { isEnabled: true }, orderBy: { order: "asc" } } },
  });

  if (!version) return { systemPrompt: null, sectionPrompts: new Map() };

  let systemPrompt: string | null = null;
  const sectionPrompts = new Map<string, string>();

  for (const rule of version.rules) {
    if (!rule.promptTemplate) continue;
    if (rule.pattern === "system_prompt") {
      systemPrompt = rule.promptTemplate;
    } else {
      sectionPrompts.set(rule.pattern, rule.promptTemplate);
    }
  }

  return { systemPrompt, sectionPrompts };
}
