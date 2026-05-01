import { describe, it, expect } from "vitest";
import {
  stem,
  tokenize,
  stemPhrase,
  expandCyrillicEndings,
  stemEquals,
} from "../morphology.js";

describe("morphology.stem (Russian)", () => {
  it.each([
    ["исследование", "исследован"],
    ["исследовании", "исследован"],
    ["исследования", "исследован"],
    ["исследованию", "исследован"],
    ["исследованием", "исследован"],
    ["исследований", "исследован"],
  ])("reduces %s → %s", (input, expected) => {
    expect(stem(input, "ru")).toBe(expected);
  });

  it("collapses inflections of 'протокол' to a shared stem", () => {
    const forms = ["протокол", "протокола", "протоколом", "протоколу", "протоколы"];
    const stems = new Set(forms.map((f) => stem(f, "ru")));
    expect(stems.size).toBeLessThanOrEqual(2); // Tolerate slight under-stemming.
  });

  it("preserves short words", () => {
    expect(stem("ИП", "ru").length).toBeGreaterThanOrEqual(2);
    expect(stem("фаза", "ru").length).toBeGreaterThanOrEqual(3);
  });

  it("is case-insensitive", () => {
    expect(stem("ИССЛЕДОВАНИЯ", "ru")).toBe(stem("исследования", "ru"));
  });
});

describe("morphology.stem (English)", () => {
  it.each([
    ["studies", "stud"],
    ["studied", "stud"],
    ["studying", "study"], // -ing stripped, "study" preserved
    ["randomization", "random"],
    ["randomizations", "random"],
  ])("reduces %s → %s", (input, expected) => {
    expect(stem(input, "en")).toBe(expected);
  });

  it("treats inflections of 'patient' uniformly", () => {
    expect(stem("patients", "en")).toBe(stem("patient", "en"));
  });
});

describe("morphology.stem (auto-detect)", () => {
  it("auto-detects Cyrillic", () => {
    expect(stem("протоколы")).toBe(stem("протоколы", "ru"));
  });

  it("auto-detects Latin", () => {
    expect(stem("studies")).toBe(stem("studies", "en"));
  });

  it("returns lowercase for mixed/non-alphabetic tokens", () => {
    expect(stem("ABC-123")).toBe("abc-123");
  });

  it("handles empty string", () => {
    expect(stem("")).toBe("");
    expect(stem("   ")).toBe("");
  });
});

describe("morphology.tokenize", () => {
  it("splits on whitespace and punctuation", () => {
    expect(tokenize("Phase III, randomized study.")).toEqual([
      "Phase",
      "III",
      "randomized",
      "study",
    ]);
  });

  it("preserves hyphenated tokens", () => {
    expect(tokenize("ABC-123-456 protocol")).toEqual(["ABC-123-456", "protocol"]);
  });

  it("handles Cyrillic text", () => {
    expect(tokenize("Номер протокола: ABC-001")).toEqual([
      "Номер",
      "протокола",
      "ABC-001",
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("morphology.stemPhrase", () => {
  it("normalises a sentence to space-separated stems", () => {
    const a = stemPhrase("Критерии включения пациентов", "ru");
    const b = stemPhrase("Критериями включения пациентами", "ru");
    expect(a).toBe(b);
  });

  it("makes English plural/singular phrases equivalent", () => {
    expect(stemPhrase("randomized studies", "en")).toBe(
      stemPhrase("randomized study", "en"),
    );
  });
});

describe("morphology.expandCyrillicEndings", () => {
  it("appends an inflectional alternation", () => {
    expect(expandCyrillicEndings("исследовани")).toBe("исследовани[а-яё]*");
  });

  it("returns a regex fragment that matches all forms", () => {
    const re = new RegExp(expandCyrillicEndings("протокол"), "i");
    expect(re.test("протокол")).toBe(true);
    expect(re.test("протокола")).toBe(true);
    expect(re.test("протоколом")).toBe(true);
  });
});

describe("morphology.stemEquals", () => {
  it("treats inflectional variants as equal", () => {
    expect(stemEquals("протокол", "протокола", "ru")).toBe(true);
    expect(stemEquals("studies", "study", "en")).toBe(true);
  });

  it("rejects unrelated words", () => {
    expect(stemEquals("протокол", "пациент", "ru")).toBe(false);
  });
});
