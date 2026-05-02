/**
 * Mapping from canonicalised table-header strings to fact keys.
 *
 * Stored as TS instead of JSON to keep it inside the package
 * resolution graph and avoid runtime fs/JSON-loading on Vite/Next
 * bundlers. Add new aliases as new factKeys / locales appear.
 */

import { stemPhrase } from "../morphology.js";

const RAW_SYNONYMS: Record<string, string[]> = {
  study_title: [
    "study title",
    "название исследования",
    "название протокола",
    "наименование исследования",
    "protocol title",
    "title of the study",
  ],
  protocol_number: [
    "protocol number",
    "protocol no",
    "protocol #",
    "номер протокола",
    "код исследования",
    "идентификатор протокола",
  ],
  sponsor: [
    "sponsor",
    "спонсор",
    "sponsored by",
    "организация спонсор",
  ],
  study_phase: [
    "phase",
    "фаза",
    "фаза исследования",
    "phase of study",
  ],
  indication: [
    "indication",
    "показание",
    "показания",
    "терапевтическая область",
    "therapeutic area",
  ],
  study_drug: [
    "investigational product",
    "investigational medicinal product",
    "imp",
    "study drug",
    "исследуемый препарат",
    "иp",
    "ип",
    "исследуемое лекарственное средство",
  ],
  sample_size: [
    "sample size",
    "размер выборки",
    "объем выборки",
    "число участников",
    "число пациентов",
    "n participants",
    "n patients",
  ],
  study_duration: [
    "study duration",
    "treatment duration",
    "продолжительность исследования",
    "длительность лечения",
    "сроки проведения",
    "продолжительность участия",
  ],
  primary_endpoint: [
    "primary endpoint",
    "primary outcome",
    "первичная конечная точка",
    "основная конечная точка",
    "первичный критерий",
  ],
  secondary_endpoint: [
    "secondary endpoint",
    "secondary outcome",
    "вторичная конечная точка",
    "вторичный критерий",
  ],
  inclusion_criteria: [
    "inclusion criteria",
    "критерии включения",
  ],
  exclusion_criteria: [
    "exclusion criteria",
    "критерии исключения",
    "критерии невключения",
  ],
};

const FACT_KEY_BY_NORMALIZED: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [factKey, aliases] of Object.entries(RAW_SYNONYMS)) {
    for (const alias of aliases) {
      const normalized = normalizeHeader(alias);
      if (!normalized) continue;
      map.set(normalized, factKey);
    }
  }
  return map;
})();

export function normalizeHeader(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/[:.,;()/\\\\-]/g, " ").replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return stemPhrase(trimmed, "auto");
}

/** Look up a fact key for a (loosely-matched) header cell. */
export function factKeyForHeader(header: string): string | null {
  const norm = normalizeHeader(header);
  if (!norm) return null;
  return FACT_KEY_BY_NORMALIZED.get(norm) ?? null;
}

/** Exposed for tests. */
export const _allHeaderSynonyms = RAW_SYNONYMS;
