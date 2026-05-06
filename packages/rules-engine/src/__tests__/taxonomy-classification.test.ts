import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const taxonomyPath = resolve(__dirname, "../../../..", "taxonomy.yaml");

interface TaxonomyChild {
  title_ru: string;
  patterns?: string[];
  require_patterns?: string[];
  not_keywords?: string[];
}

interface TaxonomyZone {
  canonical_zone: string;
  title_ru: string;
  patterns?: string[];
  require_patterns?: string[];
  not_keywords?: string[];
  children?: Record<string, TaxonomyChild>;
}

const taxonomy: Record<string, TaxonomyZone> = parseYaml(
  readFileSync(taxonomyPath, "utf-8"),
);

function getZone(zoneKey: string, childKey?: string): TaxonomyChild {
  const zone = taxonomy[zoneKey];
  if (!zone) throw new Error(`Zone ${zoneKey} not found`);
  if (!childKey) return zone;
  const child = zone.children?.[childKey];
  if (!child) throw new Error(`Subzone ${zoneKey}.${childKey} not found`);
  return child;
}

// Same adaption as production safeRegex in section-classifier.ts:
//  - JS doesn't support inline (?i) — strip it and use regex flag
//  - JS \b doesn't match Cyrillic word boundaries — replace with Unicode classes
const WORD_CHAR = "[а-яА-ЯёЁa-zA-Z0-9_]";
const WORD_BOUNDARY = `(?:(?<=${WORD_CHAR})(?!${WORD_CHAR})|(?<!${WORD_CHAR})(?=${WORD_CHAR}))`;

function compile(pattern: string): RegExp {
  let flags = "";
  let clean = pattern;
  if (clean.startsWith("(?i)")) {
    flags = "i";
    clean = clean.slice(4);
  }
  clean = clean.replace(/\(\?[imsu]+\)/g, "");
  clean = clean.replace(/\\b/g, WORD_BOUNDARY).replace(/\\w/g, WORD_CHAR);
  return new RegExp(clean, flags || "i");
}

function passesGate(text: string, zone: TaxonomyChild): boolean {
  const requires = zone.require_patterns ?? [];
  if (requires.length === 0) return true;
  return requires.some((p) => compile(p).test(text));
}

function blockedByNotKeywords(text: string, zone: TaxonomyChild): boolean {
  const noKeys = zone.not_keywords ?? [];
  return noKeys.some((p) => compile(p).test(text));
}

describe("taxonomy.yaml — regression tests for Phase 2 require_pattern sharpening", () => {
  describe("ip.preclinical_clinical_data — narrow gate (2026-05-05 fix)", () => {
    const zone = getZone("ip", "preclinical_clinical_data");

    it("MATCHES «Доклинические данные»", () => {
      expect(passesGate("Доклинические данные", zone)).toBe(true);
    });

    it("MATCHES «Результаты значимых доклинических и клинических исследований»", () => {
      expect(passesGate(
        "Результаты значимых доклинических и клинических исследований",
        zone,
      )).toBe(true);
    });

    it("MATCHES «Клинические данные предыдущих исследований»", () => {
      expect(passesGate("Клинические данные предыдущих исследований", zone)).toBe(true);
    });

    it("MATCHES «Toxicology data»", () => {
      expect(passesGate("Toxicology data", zone)).toBe(true);
    });

    it("MATCHES «Preclinical studies»", () => {
      expect(passesGate("Preclinical studies", zone)).toBe(true);
    });

    it("DOES NOT match «Обоснование клинического исследования» (this is overview.rationale)", () => {
      // Pre-fix this matched via «клиническ\\w+\\s+исследован\\w+» require_pattern,
      // pulling overview.rationale sections into preclinical_clinical_data zone.
      expect(passesGate("Обоснование клинического исследования", zone)).toBe(false);
    });

    it("DOES NOT match the protocol title pattern «Протокол клинического исследования NCT...»", () => {
      expect(passesGate("Протокол клинического исследования препарата X", zone)).toBe(false);
    });

    it("DOES NOT match «Цели и задачи клинического исследования» (overview.objectives)", () => {
      expect(passesGate("Цели и задачи клинического исследования", zone)).toBe(false);
    });

    it("not_keywords blocks «обоснование» as a final guard", () => {
      // Even if a future require_pattern would match such a title, not_keywords
      // catches «обоснование» as a strong signal of overview.rationale.
      expect(blockedByNotKeywords("Обоснование выбора препарата", zone)).toBe(true);
    });

    it("not_keywords blocks «цели и задачи»", () => {
      expect(blockedByNotKeywords("Цели и задачи проведения исследования", zone)).toBe(true);
    });
  });
});
