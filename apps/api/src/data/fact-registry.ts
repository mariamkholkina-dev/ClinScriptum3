/**
 * Загрузчик реестра фактов из YAML.
 * Формат: категории (protocol_meta, study, ...) → массивы определений фактов.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface FactDefinition {
  factKey: string;
  valueType: string;
  priority: number;
  confidence: string;
  description: string;
  labelsRu: string[];
  labelsEn: string[];
  topics: string[];
}

export interface FactRegistryEntry extends FactDefinition {
  category: string;
}

let _cache: FactRegistryEntry[] | null = null;

function snakeToCamel(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
}

export function loadFactRegistry(): FactRegistryEntry[] {
  if (_cache) return _cache;

  const filePath = path.join(__dirname, "fact-registry.yaml");
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = yaml.load(raw) as Record<string, any[]>;

  const entries: FactRegistryEntry[] = [];

  for (const [category, facts] of Object.entries(data)) {
    if (!Array.isArray(facts)) continue;
    for (const fact of facts) {
      const camel = snakeToCamel(fact) as any;
      entries.push({
        category,
        factKey: camel.factKey,
        valueType: camel.valueType,
        priority: camel.priority,
        confidence: camel.confidence,
        description: camel.description,
        labelsRu: camel.labelsRu ?? [],
        labelsEn: camel.labelsEn ?? [],
        topics: camel.topics ?? [],
      });
    }
  }

  _cache = entries;
  return entries;
}

export function getFactRegistryByCategory(): Record<string, FactRegistryEntry[]> {
  const entries = loadFactRegistry();
  const grouped: Record<string, FactRegistryEntry[]> = {};
  for (const entry of entries) {
    if (!grouped[entry.category]) grouped[entry.category] = [];
    grouped[entry.category].push(entry);
  }
  return grouped;
}

export const FACT_CATEGORY_LABELS: Record<string, string> = {
  protocol_meta: "Метаданные протокола",
  study: "Характеристики исследования",
  study_design: "Дизайн исследования (доп.)",
  population: "Популяция",
  treatment: "Терапия / Препараты",
  intervention: "Вмешательство",
  endpoints: "Конечные точки",
  statistics: "Статистика",
  bioequivalence: "Биоэквивалентность",
};
