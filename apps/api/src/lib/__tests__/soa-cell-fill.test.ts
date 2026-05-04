/**
 * Unit tests for the cell-fill extractor used by SoA detection.
 * Sprint 6 commit 6: yellow cell highlighting. Lives in apps/api
 * because @clinscriptum/shared has no vitest setup of its own.
 */
import { describe, it, expect } from "vitest";
import { extractFillFromOpenTag } from "@clinscriptum/shared/soa-detection";

describe("extractFillFromOpenTag", () => {
  it("legacy bgcolor attribute (3-digit hex)", () => {
    expect(extractFillFromOpenTag('<td bgcolor="ff0">')).toBe("#FFFF00");
  });

  it("legacy bgcolor attribute (6-digit hex with #)", () => {
    expect(extractFillFromOpenTag('<td bgcolor="#FFFF00">')).toBe("#FFFF00");
  });

  it("inline style background-color hex", () => {
    expect(
      extractFillFromOpenTag('<td style="background-color:#FFFF00; border:1px">'),
    ).toBe("#FFFF00");
  });

  it("inline style background shorthand with rgb()", () => {
    expect(
      extractFillFromOpenTag('<td style="background: rgb(255, 255, 0)">'),
    ).toBe("#FFFF00");
  });

  it("inline style with named color 'yellow'", () => {
    expect(
      extractFillFromOpenTag('<td style="background-color: yellow">'),
    ).toBe("#FFFF00");
  });

  it("data-shd-fill attribute (Word native passthrough)", () => {
    expect(
      extractFillFromOpenTag('<td data-shd-fill="FFFF00">'),
    ).toBe("#FFFF00");
  });

  it("ignores 'transparent' / 'inherit' / 'none'", () => {
    expect(
      extractFillFromOpenTag('<td style="background-color: transparent">'),
    ).toBeNull();
    expect(
      extractFillFromOpenTag('<td style="background-color: inherit">'),
    ).toBeNull();
    expect(
      extractFillFromOpenTag('<td style="background-color: none">'),
    ).toBeNull();
  });

  it("returns null when no fill attributes are present", () => {
    expect(extractFillFromOpenTag("<td>")).toBeNull();
    expect(extractFillFromOpenTag('<td colspan="2">')).toBeNull();
    expect(
      extractFillFromOpenTag('<td style="border:1px solid #000">'),
    ).toBeNull();
  });

  it("normalises hex case to upper", () => {
    expect(
      extractFillFromOpenTag('<td style="background:#abcdef">'),
    ).toBe("#ABCDEF");
  });

  it("strips alpha channel from 8-digit hex", () => {
    expect(extractFillFromOpenTag('<td bgcolor="ff00007f">')).toBe("#FF0000");
  });
});
