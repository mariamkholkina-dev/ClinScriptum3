/**
 * Lightweight morphological preprocessing for Russian and English.
 *
 * Used by fact-extractor and downstream modules to compare tokens
 * across inflectional forms (e.g. "исследование" / "исследовании" /
 * "исследования" → one stem). Pure JS, no native dependencies.
 *
 * The Russian implementation is a hand-tuned suffix stripper covering
 * the most common nominal/adjectival/verbal endings encountered in
 * clinical-trial documents. It is intentionally less aggressive than
 * full Snowball — preserves discriminative roots and avoids
 * over-stemming of short words.
 */

/**
 * Russian inflectional endings, ordered roughly by morphological class.
 * Verb past-tense endings ("ал", "ил", "ла", "ло"…) are deliberately
 * omitted — they overlap with noun-stem letters (e.g. "протокола" must
 * not be stripped as if it were "*протоко-ла") and clinical-protocol
 * text is overwhelmingly nominal/adjectival.
 */
const RU_SUFFIXES: readonly string[] = [
  // Adjectival (long form)
  "ующих",
  "ующим",
  "ивший",
  "ившая",
  "ившее",
  "ующий",
  "ующая",
  "ующее",
  // Plural noun cases (4-letter)
  "иями",
  "иям",
  "иях",
  // Neuter -ие nouns (3-letter, instrumental)
  "ием",
  // Plural noun cases (3-letter)
  "ями",
  "ами",
  "ах",
  "ях",
  // Adjectival (3-letter)
  "ого",
  "его",
  "ому",
  "ему",
  "ыми",
  "ими",
  // Plural / genitive plural (2-letter)
  "ов",
  "ев",
  "ии",
  "ям",
  "ам",
  // Neuter -ие nouns (singular cases)
  "ие",
  "ия",
  "ию",
  // Adjectival (2-letter)
  "ая",
  "яя",
  "ое",
  "ее",
  "ой",
  "ей",
  "ый",
  "ий",
  "ом",
  "ем",
  "ых",
  "их",
  "ие",
  "ые",
  "ою",
  "ею",
  "ую",
  "юю",
  // Verbal infinitive
  "ать",
  "ять",
  "еть",
  "ить",
  "оть",
  "уть",
  "ыть",
  "ть",
  "ти",
  // Single-letter case markers
  "а",
  "я",
  "у",
  "ю",
  "е",
  "ы",
  "и",
  "о",
  "ь",
] as const;

// Sort once by length desc to ensure greedy match.
const RU_SUFFIXES_SORTED = [...new Set(RU_SUFFIXES)].sort((a, b) => b.length - a.length);

const EN_SUFFIXES: readonly string[] = [
  // 7+ letters
  "izations",
  "ational",
  "ousness",
  "iveness",
  "fulness",
  // 6 letters
  "ically",
  "ization",
  // 5 letters
  "ation",
  "tions",
  "ators",
  "ables",
  "ibles",
  // 4 letters
  "edly",
  "ions",
  "ings",
  "able",
  "ible",
  "ment",
  "ness",
  "fully",
  "tion",
  "sion",
  "ence",
  "ance",
  "ative",
  // 3 letters
  "ous",
  "ive",
  "ize",
  "ise",
  "ies",
  "ied",
  "ier",
  "ing",
  // 2 letters
  "ed",
  "es",
  "ly",
  // 1 letter
  "s",
  "y",
] as const;

const EN_SUFFIXES_SORTED = [...new Set(EN_SUFFIXES)].sort((a, b) => b.length - a.length);

const MIN_STEM_LEN = 3;

function isCyrillicWord(word: string): boolean {
  return /^[а-яёА-ЯЁ-]+$/.test(word);
}

function isLatinWord(word: string): boolean {
  return /^[a-zA-Z-]+$/.test(word);
}

/**
 * Strip the longest matching suffix from `word`, preserving at least
 * `MIN_STEM_LEN` characters. Returns the stem in lowercase.
 */
function stripSuffix(word: string, suffixes: readonly string[]): string {
  const lower = word.toLowerCase();
  for (const sfx of suffixes) {
    if (lower.length >= sfx.length + MIN_STEM_LEN && lower.endsWith(sfx)) {
      return lower.slice(0, -sfx.length);
    }
  }
  return lower;
}

export type Lang = "ru" | "en" | "auto";

/**
 * Reduce a single token to its stem. Auto-detects script if lang="auto".
 * Non-alphabetic tokens are returned unchanged (lowercased).
 */
export function stem(token: string, lang: Lang = "auto"): string {
  if (!token) return "";
  const trimmed = token.trim();
  if (!trimmed) return "";

  let resolved: Lang = lang;
  if (lang === "auto") {
    if (isCyrillicWord(trimmed)) resolved = "ru";
    else if (isLatinWord(trimmed)) resolved = "en";
    else return trimmed.toLowerCase();
  }

  if (resolved === "ru") return stripSuffix(trimmed, RU_SUFFIXES_SORTED);
  return stripSuffix(trimmed, EN_SUFFIXES_SORTED);
}

/**
 * Split text into word tokens. Preserves Cyrillic, Latin, digits, and hyphens
 * inside words; everything else is a separator.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return text.match(/[а-яёА-ЯЁa-zA-Z0-9][а-яёА-ЯЁa-zA-Z0-9-]*/g) ?? [];
}

/**
 * Stem every token in `text` and rejoin with single spaces.
 * Useful for normalising free-form values before equality comparison.
 */
export function stemPhrase(text: string, lang: Lang = "auto"): string {
  return tokenize(text).map((t) => stem(t, lang)).join(" ");
}

/**
 * Build a regex fragment that matches a Cyrillic stem followed by any
 * inflectional ending (zero or more Russian letters).
 *
 * Example: expandCyrillicEndings("исследовани") → "исследовани[а-яё]*"
 *
 * The result is meant to be embedded inside a larger pattern; it does
 * NOT include word boundaries — callers add those as needed.
 */
export function expandCyrillicEndings(stemForm: string): string {
  return `${stemForm}[а-яё]*`;
}

/**
 * Compare two phrases by their stemmed canonical form. Returns true
 * when both reduce to the same multiset of stems.
 */
export function stemEquals(a: string, b: string, lang: Lang = "auto"): boolean {
  return stemPhrase(a, lang) === stemPhrase(b, lang);
}
