/**
 * Seed `fact_anchors` RuleSet — anchor keywords used by BM25 retrieval
 * to point targeted LLM extraction at the most-relevant section per
 * factKey.
 *
 * One Rule per factKey. `Rule.config = { factKey, keywords: { ru, en }, weight }`.
 * Weight is currently informational; planned for future query-term
 * weighting in `Bm25Index`.
 */

import { PrismaClient } from "@prisma/client";

const FACT_ANCHORS: Array<{
  factKey: string;
  ru: string[];
  en: string[];
  weight: number;
}> = [
  {
    factKey: "study_title",
    ru: ["название", "наименование", "тема", "заголовок"],
    en: ["title", "study", "protocol"],
    weight: 1,
  },
  {
    factKey: "protocol_number",
    ru: ["номер", "код", "идентификатор", "протокола", "исследования"],
    en: ["protocol", "number", "id", "code"],
    weight: 1,
  },
  {
    factKey: "sponsor",
    ru: ["спонсор", "организация", "заказчик"],
    en: ["sponsor", "sponsored", "organisation"],
    weight: 1,
  },
  {
    factKey: "study_phase",
    ru: ["фаза", "стадия", "этап"],
    en: ["phase", "stage"],
    weight: 1,
  },
  {
    factKey: "indication",
    ru: ["показание", "терапевтическая", "область", "лечения", "заболевание"],
    en: ["indication", "therapeutic", "area", "disease"],
    weight: 1,
  },
  {
    factKey: "study_drug",
    ru: ["исследуемый", "препарат", "лекарственное", "средство", "иp"],
    en: ["investigational", "product", "imp", "drug", "compound"],
    weight: 1.5,
  },
  {
    factKey: "sample_size",
    ru: ["размер", "выборки", "число", "пациентов", "участников", "объём"],
    en: ["sample", "size", "subjects", "participants", "enrolled", "approximately"],
    weight: 1.2,
  },
  {
    factKey: "study_duration",
    ru: ["продолжительность", "длительность", "срок", "проведения", "недель", "месяцев"],
    en: ["duration", "weeks", "months", "treatment", "study"],
    weight: 1,
  },
  {
    factKey: "primary_endpoint",
    ru: ["первичная", "конечная", "точка", "критерий", "эффективности", "основная"],
    en: ["primary", "endpoint", "outcome", "efficacy"],
    weight: 1.5,
  },
  {
    factKey: "secondary_endpoint",
    ru: ["вторичная", "конечная", "точка", "цель"],
    en: ["secondary", "endpoint", "outcome"],
    weight: 1,
  },
  {
    factKey: "inclusion_criteria",
    ru: ["критерии", "включения"],
    en: ["inclusion", "criteria", "eligibility"],
    weight: 1.2,
  },
  {
    factKey: "exclusion_criteria",
    ru: ["критерии", "исключения", "невключения"],
    en: ["exclusion", "criteria", "ineligibility"],
    weight: 1.2,
  },
];

export async function seedFactAnchors(prisma: PrismaClient) {
  const existing = await prisma.ruleSet.findFirst({
    where: { type: "fact_anchors", tenantId: null },
  });
  let ruleSet = existing;
  if (!ruleSet) {
    ruleSet = await prisma.ruleSet.create({
      data: {
        type: "fact_anchors",
        name: "Default fact-extraction anchors",
      },
    });
  }

  let version = await prisma.ruleSetVersion.findFirst({
    where: { ruleSetId: ruleSet.id, version: 1 },
  });
  if (!version) {
    version = await prisma.ruleSetVersion.create({
      data: {
        ruleSetId: ruleSet.id,
        version: 1,
        description: "Initial anchor keywords",
        isActive: true,
      },
    });
  } else {
    await prisma.rule.deleteMany({ where: { ruleSetVersionId: version.id } });
  }

  for (const a of FACT_ANCHORS) {
    await prisma.rule.create({
      data: {
        ruleSetVersionId: version.id,
        name: `anchor:${a.factKey}`,
        pattern: a.factKey,
        config: {
          factKey: a.factKey,
          keywords: { ru: a.ru, en: a.en },
          weight: a.weight,
        },
      },
    });
  }
}

export const FACT_ANCHORS_SEED = FACT_ANCHORS;
