/**
 * Canonical normalisation of extracted fact values.
 *
 * Different surface forms of the same fact ("30 пациентов",
 * "N=30", "30 patients") should collapse to a single canonical
 * representation so that downstream voting and contradiction
 * detection compare meaning rather than raw strings.
 *
 * Each fact key has a typed canonicaliser. Unknown keys fall back to
 * a generic text canonicaliser (lowercase + stemmed phrase).
 */

import type { ExtractedFact } from "./fact-extractor.js";
import { stemPhrase } from "./morphology.js";

export interface CanonicalValue {
  raw: string;
  canonical: string;
  numeric?: number;
  unit?: string;
}

export interface AggregatedFact {
  factKey: string;
  factClass: ExtractedFact["factClass"];
  /** Best raw value (from the highest-weighted source occurrence). */
  value: string;
  canonical: string;
  /** Confidence after voting; in [0, 0.95]. */
  confidence: number;
  /** Best source, kept for backward compatibility with consumers reading `.source`. */
  source: ExtractedFact["source"];
  /** All source occurrences contributing to this aggregated fact. */
  sources: ExtractedFact["source"][];
  sourceCount: number;
}

const ROMAN_TO_ARABIC: Record<string, string> = {
  i: "1",
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
};

const DURATION_UNIT_MAP: Record<string, string> = {
  // weeks
  week: "weeks",
  weeks: "weeks",
  wk: "weeks",
  wks: "weeks",
  нед: "weeks",
  недел: "weeks",
  недель: "weeks",
  недели: "weeks",
  неделя: "weeks",
  // months
  month: "months",
  months: "months",
  mo: "months",
  mos: "months",
  мес: "months",
  месяц: "months",
  месяца: "months",
  месяцев: "months",
  // days
  day: "days",
  days: "days",
  d: "days",
  день: "days",
  дня: "days",
  дней: "days",
  // years
  year: "years",
  years: "years",
  yr: "years",
  yrs: "years",
  год: "years",
  года: "years",
  лет: "years",
};

function canonicalText(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return stemPhrase(trimmed, "auto");
}

function canonicalProtocolNumber(raw: string): CanonicalValue {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, "");
  return { raw, canonical: cleaned };
}

function canonicalSampleSize(raw: string): CanonicalValue {
  const m = raw.match(/(\d+)/);
  if (!m) return { raw, canonical: canonicalText(raw) };
  const n = Number(m[1]);
  return { raw, canonical: String(n), numeric: n, unit: "subjects" };
}

function canonicalStudyPhase(raw: string): CanonicalValue {
  const trimmed = raw.trim().toLowerCase();
  // "Phase III" or "фаза 3" or just "III" / "3"
  const arabicMatch = trimmed.match(/(\d+)(?:\s*\/\s*(\d+))?/);
  if (arabicMatch) {
    const phase = arabicMatch[2] ? `${arabicMatch[1]}/${arabicMatch[2]}` : arabicMatch[1];
    return { raw, canonical: phase };
  }
  const romanMatch = trimmed.match(/\b(i{1,3}v?|iv|v)(?:\s*\/\s*(i{1,3}v?|iv|v))?\b/);
  if (romanMatch) {
    const a = ROMAN_TO_ARABIC[romanMatch[1]] ?? romanMatch[1];
    if (romanMatch[2]) {
      const b = ROMAN_TO_ARABIC[romanMatch[2]] ?? romanMatch[2];
      return { raw, canonical: `${a}/${b}` };
    }
    return { raw, canonical: a };
  }
  return { raw, canonical: canonicalText(raw) };
}

function canonicalStudyDuration(raw: string): CanonicalValue {
  const m = raw.match(/(\d+)\s*([a-zA-Zа-яА-ЯёЁ.]+)/);
  if (!m) return { raw, canonical: canonicalText(raw) };
  const n = Number(m[1]);
  const unitRaw = m[2].toLowerCase().replace(/\.+$/, "");
  const unit = DURATION_UNIT_MAP[unitRaw] ?? unitRaw;
  return { raw, canonical: `${n} ${unit}`, numeric: n, unit };
}

const TEXT_KEYS = new Set([
  "study_title",
  "sponsor",
  "indication",
  "study_drug",
  "primary_endpoint",
  "secondary_endpoint",
  "inclusion_criteria",
  "exclusion_criteria",
]);

const PROTOCOL_KEYS = new Set(["protocol_number"]);
const SAMPLE_SIZE_KEYS = new Set(["sample_size"]);
const PHASE_KEYS = new Set(["study_phase"]);
const DURATION_KEYS = new Set(["study_duration"]);

export function canonicalize(factKey: string, raw: string): CanonicalValue {
  if (!raw || !raw.trim()) return { raw, canonical: "" };
  if (PROTOCOL_KEYS.has(factKey)) return canonicalProtocolNumber(raw);
  if (SAMPLE_SIZE_KEYS.has(factKey)) return canonicalSampleSize(raw);
  if (PHASE_KEYS.has(factKey)) return canonicalStudyPhase(raw);
  if (DURATION_KEYS.has(factKey)) return canonicalStudyDuration(raw);
  if (TEXT_KEYS.has(factKey)) return { raw, canonical: canonicalText(raw) };
  return { raw, canonical: canonicalText(raw) };
}

function isSynopsisSource(src: ExtractedFact["source"]): boolean {
  const t = (src.sectionTitle ?? "").toLowerCase();
  return t.includes("synopsis") || t.includes("синопсис");
}

const SYNOPSIS_WEIGHT = 2;
const BODY_WEIGHT = 1;
const BASE_CONFIDENCE = 0.6;
const PER_SOURCE_BOOST = 0.1;
const MAX_CONFIDENCE = 0.95;

/**
 * Group raw extracted facts by `(factKey, canonical)` pair, then vote.
 *
 * - Synopsis sources count double; body sources count once.
 * - Confidence = min(0.95, 0.6 + 0.1 * weighted_source_count).
 * - The aggregated `value` is the raw form of the first occurrence —
 *   preserves source order so callers see the synopsis-side wording first.
 * - The aggregated `source` is the highest-weighted occurrence (synopsis
 *   if present, otherwise the first body source).
 */
/**
 * Phase 5: confidence calibration coefficients per factKey × sectionType.
 *
 * `final = sigmoid(α·llm_conf + β·prior(factKey,sectionType) + γ·n_sources)`
 *
 * Calibrated via `scripts/calibrate-confidence.ts` against golden samples.
 * Defaults below are reasonable starting points; tune per-tenant via
 * the `confidence_calibration` RuleSet.
 */
export interface CalibrationCoefficients {
  alpha: number;
  beta: number;
  gamma: number;
  prior?: Partial<Record<string, Partial<Record<string, number>>>>;
}

export const DEFAULT_CALIBRATION: CalibrationCoefficients = {
  alpha: 1.0,
  beta: 0.3,
  gamma: 0.15,
  prior: {},
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function applyCalibration(
  rawConfidence: number,
  factKey: string,
  sectionType: string | null | undefined,
  nSources: number,
  coefs: CalibrationCoefficients = DEFAULT_CALIBRATION,
): number {
  const prior =
    sectionType && coefs.prior?.[factKey]?.[sectionType] !== undefined
      ? coefs.prior[factKey]![sectionType]!
      : 0;
  const x =
    coefs.alpha * (rawConfidence - 0.5) +
    coefs.beta * prior +
    coefs.gamma * Math.log(1 + Math.max(0, nSources - 1));
  return sigmoid(x);
}

/**
 * Brier score of a single prediction: (predicted_prob - actual_outcome)^2.
 * Lower is better; 0 = perfect calibration.
 */
export function brierScore(predicted: number, actual: 0 | 1): number {
  const diff = predicted - actual;
  return diff * diff;
}

export function aggregateByCanonical(facts: ExtractedFact[]): AggregatedFact[] {
  const groups = new Map<string, ExtractedFact[]>();
  const order: string[] = [];

  for (const fact of facts) {
    const { canonical } = canonicalize(fact.factKey, fact.value);
    if (!canonical) continue;
    const key = `${fact.factKey}::${canonical}`;
    const arr = groups.get(key);
    if (arr) {
      arr.push(fact);
    } else {
      groups.set(key, [fact]);
      order.push(key);
    }
  }

  const aggregated: AggregatedFact[] = [];
  for (const key of order) {
    const entries = groups.get(key)!;
    const first = entries[0];
    const { canonical } = canonicalize(first.factKey, first.value);

    let weightedCount = 0;
    let bestSource = first.source;
    let bestSourceWeight = isSynopsisSource(first.source) ? SYNOPSIS_WEIGHT : BODY_WEIGHT;
    for (const e of entries) {
      const isSyn = isSynopsisSource(e.source);
      const w = isSyn ? SYNOPSIS_WEIGHT : BODY_WEIGHT;
      weightedCount += w;
      if (w > bestSourceWeight) {
        bestSource = e.source;
        bestSourceWeight = w;
      }
    }

    const confidence = Math.min(
      MAX_CONFIDENCE,
      BASE_CONFIDENCE + PER_SOURCE_BOOST * weightedCount,
    );

    aggregated.push({
      factKey: first.factKey,
      factClass: first.factClass,
      value: bestSource === first.source ? first.value : (entries.find((e) => e.source === bestSource) ?? first).value,
      canonical,
      confidence,
      source: bestSource,
      sources: entries.map((e) => e.source),
      sourceCount: entries.length,
    });
  }

  return aggregated;
}
