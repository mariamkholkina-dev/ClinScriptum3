import { describe, it, expect } from "vitest";
import { detectHeading } from "../heading-detector.js";

describe("detectHeading", () => {
  describe("style-based detection", () => {
    it("detects 'heading 1' style as level 1", () => {
      const result = detectHeading("Introduction", 0, "heading 1");
      expect(result).not.toBeNull();
      expect(result!.level).toBe(1);
      expect(result!.method).toBe("style");
      expect(result!.text).toBe("Introduction");
    });

    it("detects 'heading 2' style as level 2", () => {
      const result = detectHeading("Study Design", 5, "heading 2");
      expect(result).not.toBeNull();
      expect(result!.level).toBe(2);
      expect(result!.method).toBe("style");
    });

    it("detects 'Heading3' style (no space) as level 3", () => {
      const result = detectHeading("Subsection", 10, "Heading3");
      expect(result).not.toBeNull();
      expect(result!.level).toBe(3);
    });

    it("ignores non-heading styles", () => {
      const result = detectHeading("Normal text", 0, "Normal");
      expect(result).toBeNull();
    });
  });

  describe("outline-level detection", () => {
    it("detects outline level 0 as heading level 1", () => {
      const result = detectHeading("Title", 0, undefined, 0);
      expect(result).not.toBeNull();
      expect(result!.level).toBe(1);
      expect(result!.method).toBe("outline");
    });

    it("detects outline level 2 as heading level 3", () => {
      const result = detectHeading("Sub-subsection", 3, undefined, 2);
      expect(result).not.toBeNull();
      expect(result!.level).toBe(3);
    });

    it("ignores outline level 9 and above", () => {
      const result = detectHeading("Body text", 0, undefined, 9);
      expect(result).toBeNull();
    });

    it("style takes priority over outline level", () => {
      const result = detectHeading("Heading", 0, "heading 1", 3);
      expect(result!.level).toBe(1);
      expect(result!.method).toBe("style");
    });
  });

  describe("visual detection (bold + font size)", () => {
    it("detects large bold text as level 1 (ratio >= 1.6)", () => {
      const result = detectHeading("Big Title", 0, undefined, undefined, true, 20, 12);
      expect(result).not.toBeNull();
      expect(result!.level).toBe(1);
      expect(result!.method).toBe("visual");
    });

    it("detects medium bold text as level 2 (ratio >= 1.3)", () => {
      const result = detectHeading("Medium Title", 0, undefined, undefined, true, 16, 12);
      expect(result).not.toBeNull();
      expect(result!.level).toBe(2);
      expect(result!.method).toBe("visual");
    });

    it("detects slightly larger bold text as level 3", () => {
      const result = detectHeading("Small Title", 0, undefined, undefined, true, 14, 12);
      expect(result).not.toBeNull();
      expect(result!.level).toBe(3);
      expect(result!.method).toBe("visual");
    });

    it("does not detect non-bold text as heading even if large", () => {
      const result = detectHeading("Large normal text", 0, undefined, undefined, false, 20, 12);
      expect(result).toBeNull();
    });

    it("does not detect bold text at base size as heading", () => {
      const result = detectHeading("Bold normal", 0, undefined, undefined, true, 12, 12);
      expect(result).toBeNull();
    });
  });

  describe("numbered section detection", () => {
    it("detects '1 Section' as level 1 when bold", () => {
      const result = detectHeading("1 Section Title", 0, undefined, undefined, true);
      expect(result).not.toBeNull();
      expect(result!.level).toBe(1);
      expect(result!.method).toBe("numbered");
    });

    it("detects '1.2 Subsection' as level 2 when bold", () => {
      const result = detectHeading("1.2 Subsection Title", 5, undefined, undefined, true);
      expect(result).not.toBeNull();
      expect(result!.level).toBe(2);
      expect(result!.method).toBe("numbered");
    });

    it("detects '1.2.3 Deep Section' as level 3 when bold", () => {
      const result = detectHeading("1.2.3 Deep Section", 10, undefined, undefined, true);
      expect(result).not.toBeNull();
      expect(result!.level).toBe(3);
    });

    // Sprint 4.1: numbered headings без bold ТЕПЕРЬ распознаются с эвристиками.
    it("Sprint 4.1: detects '1.2 Subsection' without bold (multi-level)", () => {
      const result = detectHeading("1.2 Study Procedures", 0, undefined, undefined, false);
      expect(result).not.toBeNull();
      expect(result!.level).toBe(2);
      expect(result!.method).toBe("numbered");
    });

    it("Sprint 4.1: detects '1 Title' without bold (short text)", () => {
      const result = detectHeading("1 Введение", 0, undefined, undefined, false);
      expect(result).not.toBeNull();
      expect(result!.method).toBe("numbered");
    });

    it("Sprint 4.1: rejects '1. Apple,' (list item, ends with comma)", () => {
      const result = detectHeading("1. Apple,", 0, undefined, undefined, false);
      expect(result).toBeNull();
    });

    it("Sprint 4.1: rejects '1. Pharmacology:' (ends with colon)", () => {
      const result = detectHeading("1. Pharmacology:", 0, undefined, undefined, false);
      expect(result).toBeNull();
    });

    it("Sprint 4.1: rejects single-level long sentence (>80 chars)", () => {
      const longText = "1 This is a very long sentence that probably is not a heading but rather a list item with detailed description";
      const result = detectHeading(longText, 0, undefined, undefined, false);
      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("returns null for empty text", () => {
      const result = detectHeading("", 0, "heading 1");
      expect(result).toBeNull();
    });

    it("returns null for whitespace-only text", () => {
      const result = detectHeading("   ", 0, "heading 1");
      expect(result).toBeNull();
    });

    it("trims text in result", () => {
      const result = detectHeading("  Padded Heading  ", 0, "heading 1");
      expect(result!.text).toBe("Padded Heading");
    });

    it("preserves paragraphIndex", () => {
      const result = detectHeading("Title", 42, "heading 1");
      expect(result!.paragraphIndex).toBe(42);
    });

    it("returns null when no detection method matches", () => {
      const result = detectHeading("Plain paragraph text", 0);
      expect(result).toBeNull();
    });
  });
});
