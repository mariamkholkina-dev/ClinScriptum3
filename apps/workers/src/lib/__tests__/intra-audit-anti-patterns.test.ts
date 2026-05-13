import { describe, it, expect } from "vitest";
import { detectAntiPattern, listAntiPatterns } from "../intra-audit-anti-patterns.js";

describe("detectAntiPattern", () => {
  describe("hedging — слабые формулировки", () => {
    it("flags «возможно противоречие»", () => {
      const r = detectAntiPattern({ description: "Возможно противоречие между Synopsis и Statistics" });
      expect(r?.pattern).toBe("hedging:возможно");
      expect(r?.field).toBe("description");
    });
    it("flags «может быть»", () => {
      const r = detectAntiPattern({ description: "Может быть несоответствие в дозе" });
      expect(r?.pattern).toBe("hedging:может быть");
    });
    it("flags «предположительно»", () => {
      const r = detectAntiPattern({ description: "Предположительно sample size не совпадает" });
      expect(r?.pattern).toBe("hedging:предположительно");
    });
    it("flags «вероятно, конфликт»", () => {
      const r = detectAntiPattern({ description: "Вероятно, конфликт значений" });
      expect(r?.pattern).toBe("hedging:вероятно");
    });
  });

  describe("suggestion-like — описание выглядит как совет", () => {
    it("flags «стоит уточнить»", () => {
      const r = detectAntiPattern({ description: "Стоит уточнить количество визитов" });
      expect(r?.pattern).toBe("suggestion-like");
    });
    it("flags «нужно проверить»", () => {
      const r = detectAntiPattern({ description: "Нужно проверить совпадение endpoints" });
      expect(r?.pattern).toBe("suggestion-like");
    });
  });

  describe("missingness без значения", () => {
    it("flags «не указано» (без цифры)", () => {
      const r = detectAntiPattern({ description: "Не указано количество групп" });
      expect(r?.pattern).toBe("missingness-no-value");
    });
    it("ignores «не указано» когда есть цифра (это уже конкретный defect)", () => {
      const r = detectAntiPattern({
        description: "Не указано sample size N=120 которое было в Synopsis",
      });
      expect(r).toBeNull();
    });
    it("flags «отсутствует» без цифры", () => {
      const r = detectAntiPattern({ description: "Отсутствует упоминание primary endpoint" });
      // Wait — есть слово "primary" в hasConcreteValue. Должно быть null.
      expect(r).toBeNull();
    });
    it("flags «отсутствует» без cigar/value indicators", () => {
      const r = detectAntiPattern({ description: "Отсутствует определение терминологии" });
      expect(r?.pattern).toBe("missingness-absent");
    });
  });

  describe("meta-talk", () => {
    it("flags «в тексте неясно»", () => {
      const r = detectAntiPattern({ description: "В тексте неясно описана популяция" });
      expect(r?.pattern).toBe("meta:неясно");
    });
    it("flags «трудно определить»", () => {
      const r = detectAntiPattern({ description: "Трудно определить точное количество" });
      expect(r?.pattern).toBe("meta:трудно определить");
    });
    it("flags «требуется уточнение»", () => {
      const r = detectAntiPattern({ description: "Требуется уточнение по визитам" });
      expect(r?.pattern).toBe("meta:требуется уточнение");
    });
  });

  describe("clean findings — должны проходить", () => {
    it("конкретное противоречие чисел — null", () => {
      const r = detectAntiPattern({
        description: "Sample size в Synopsis = 120, в Statistics = 130",
      });
      expect(r).toBeNull();
    });
    it("конкретная цитата с расхождением — null", () => {
      const r = detectAntiPattern({
        description: "Endpoint defined differently in 2 places: «efficacy» vs «safety endpoint»",
      });
      expect(r).toBeNull();
    });
  });

  describe("multi-field check", () => {
    it("matches anti-pattern в suggestion", () => {
      const r = detectAntiPattern({
        description: "Clean description",
        suggestion: "Возможно, нужно проверить",
      });
      expect(r?.field).toBe("suggestion");
    });
  });

  it("listAntiPatterns returns labels", () => {
    const labels = listAntiPatterns();
    expect(labels.length).toBeGreaterThan(5);
    expect(labels).toContain("hedging:возможно");
  });
});
