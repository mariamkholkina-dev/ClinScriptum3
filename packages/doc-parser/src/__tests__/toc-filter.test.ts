import { describe, it, expect } from "vitest";
import { filterTocChildren } from "../toc-filter.js";
import type { DetectedHeading } from "../heading-detector.js";

function h(text: string, level: number, paragraphIndex: number): DetectedHeading {
  return { text, level, method: "style", paragraphIndex };
}

describe("filterTocChildren", () => {
  it("drops TOC children when all conditions met", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("1 Синопсис 13", 2, 1),
      h("2 Обоснование 33", 2, 2),
      h("Синопсис", 1, 50),
      h("Обоснование", 1, 100),
    ];
    const result = filterTocChildren(headings);
    expect(result.map((x) => x.text)).toEqual(["Содержание", "Синопсис", "Обоснование"]);
  });

  it("keeps TOC children when at least one has no twin elsewhere", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("1 Синопсис 13", 2, 1),
      h("2 Обоснование 33", 2, 2),
      h("Синопсис", 1, 50),
      // Note: no twin for "Обоснование" — heuristic must NOT apply
    ];
    const result = filterTocChildren(headings);
    expect(result).toEqual(headings);
  });

  it("keeps TOC children when at least one does not end with a digit", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("1 Синопсис 13", 2, 1),
      h("Раздел без номера страницы", 2, 2),
      h("Синопсис", 1, 50),
    ];
    const result = filterTocChildren(headings);
    expect(result).toEqual(headings);
  });

  it("works with «Оглавление» variant", () => {
    const headings: DetectedHeading[] = [
      h("Оглавление", 1, 0),
      h("Введение 5", 2, 1),
      h("Введение", 1, 100),
    ];
    const result = filterTocChildren(headings);
    expect(result.map((x) => x.text)).toEqual(["Оглавление", "Введение"]);
  });

  it("works with English «Table of Contents»", () => {
    const headings: DetectedHeading[] = [
      h("Table of Contents", 1, 0),
      h("Introduction 5", 2, 1),
      h("Introduction", 1, 100),
    ];
    const result = filterTocChildren(headings);
    expect(result.map((x) => x.text)).toEqual(["Table of Contents", "Introduction"]);
  });

  it("returns headings unchanged when no TOC heading present", () => {
    const headings: DetectedHeading[] = [
      h("Введение", 1, 0),
      h("Глава 1", 1, 10),
      h("Глава 2", 1, 20),
    ];
    expect(filterTocChildren(headings)).toEqual(headings);
  });

  it("handles empty input", () => {
    expect(filterTocChildren([])).toEqual([]);
  });

  it("does NOT touch siblings of TOC at same or shallower level", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("1 Синопсис 13", 2, 1),
      h("Синопсис", 1, 50),  // sibling of "Содержание", NOT child
      h("Заключение", 1, 100),
    ];
    const result = filterTocChildren(headings);
    // "1 Синопсис 13" is a TOC child (level 2), and "Синопсис" is its twin
    // → drop the TOC child, keep "Содержание", "Синопсис", "Заключение"
    expect(result.map((x) => x.text)).toEqual(["Содержание", "Синопсис", "Заключение"]);
  });

  it("handles deep nested TOC entries (multiple levels under TOC)", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("1. Введение 5", 2, 1),
      h("1.1. Цель 6", 3, 2),
      h("1.2. Задачи 7", 3, 3),
      h("Введение", 1, 100),
      h("Цель", 2, 110),
      h("Задачи", 2, 120),
    ];
    const result = filterTocChildren(headings);
    expect(result.map((x) => x.text)).toEqual(["Содержание", "Введение", "Цель", "Задачи"]);
  });

  it("handles TOC entries with dot leaders (……)", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("Синопсис………5", 2, 1),
      h("Синопсис", 1, 100),
    ];
    const result = filterTocChildren(headings);
    expect(result.map((x) => x.text)).toEqual(["Содержание", "Синопсис"]);
  });

  it("does not mistake «Приложение А» (letter-tail) for TOC entry", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("Приложение А", 2, 1),  // ends with letter, not digit
      h("Приложение", 1, 100),
    ];
    const result = filterTocChildren(headings);
    expect(result).toEqual(headings);
  });

  it("applies heuristic per TOC block independently (multiple TOCs)", () => {
    const headings: DetectedHeading[] = [
      h("Содержание", 1, 0),
      h("Синопсис 5", 2, 1),
      h("Синопсис", 1, 50),
      h("Оглавление", 1, 100),
      h("Глава 1 200", 2, 101),
      // No twin for "Глава 1" — second TOC block must NOT be filtered
    ];
    const result = filterTocChildren(headings);
    expect(result.map((x) => x.text)).toEqual([
      "Содержание",
      "Синопсис",
      "Оглавление",
      "Глава 1 200",
    ]);
  });
});
