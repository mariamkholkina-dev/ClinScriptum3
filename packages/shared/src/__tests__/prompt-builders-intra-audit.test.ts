import { describe, it, expect } from "vitest";
import {
  buildIntraAuditCheckCalls,
  buildFullDocumentText,
  buildZoneTexts,
  resolveCrossCheckPairs,
} from "../prompt-builders/intra-audit.js";
import type { AnchorableSectionInput } from "../prompt-builders/types.js";

function sec(over: Partial<AnchorableSectionInput> & { title: string }): AnchorableSectionInput {
  return {
    title: over.title,
    standardSection: over.standardSection ?? null,
    headingNumber: over.headingNumber ?? null,
    order: over.order ?? 0,
    contentBlocks: over.contentBlocks ?? [{ content: "текст секции" }],
  };
}

const PROMPTS = {
  fullDocSelfCheck: "FD_SELF_SYS",
  fullDocCrossCheck: "FD_CROSS_SYS",
  fullDocEditorial: "FD_EDIT_SYS",
  selfCheck: "SELF_SYS",
  crossCheck: "CROSS_SYS",
  editorial: "EDIT_SYS",
};

describe("buildFullDocumentText", () => {
  it("prefixes each section with anchor [S<path>:<type>]", () => {
    const text = buildFullDocumentText([
      sec({ title: "Синопсис", headingNumber: "1", standardSection: "synopsis" }),
    ]);
    expect(text).toContain("## [S1:synopsis] Синопсис");
    expect(text).toContain("текст секции");
  });
});

describe("buildIntraAuditCheckCalls", () => {
  const sections = [
    sec({ title: "Синопсис", headingNumber: "1", standardSection: "synopsis" }),
    sec({ title: "Статистика", headingNumber: "2", standardSection: "statistics" }),
  ];

  it("Variant 1 (full document, 3 focused calls) when doc fits in budget", () => {
    const plan = buildIntraAuditCheckCalls({
      sections,
      prompts: PROMPTS,
      inputBudget: 1_000_000,
      auditMode: "auto",
    });
    expect(plan.variant).toBe(1);
    expect(plan.calls).toHaveLength(3);
    expect(plan.calls.map((c) => c.label)).toEqual([
      "full_doc_self_check",
      "full_doc_cross_check",
      "full_doc_editorial",
    ]);
    expect(plan.calls[0]!.system).toBe("FD_SELF_SYS");
    expect(plan.calls[1]!.system).toBe("FD_CROSS_SYS");
    expect(plan.calls[2]!.system).toBe("FD_EDIT_SYS");
    expect(plan.calls[0]!.user).toContain("SELF-CHECK аудит следующего клинического протокола");
    expect(plan.calls[0]!.user).toContain("[S1:synopsis]");
    expect(plan.calls[0]!.meta).toMatchObject({ phase: "full_doc_self_check" });
  });

  it("Variant 2 (zone-based) when auditMode=zone_based", () => {
    const plan = buildIntraAuditCheckCalls({
      sections,
      prompts: PROMPTS,
      inputBudget: 1_000_000,
      auditMode: "zone_based",
    });
    expect(plan.variant).toBe(2);
    // self_check + editorial per zone (2 zones) = 4, + cross_check synopsis↔statistics = 1
    const labels = plan.calls.map((c) => c.label);
    expect(labels).toContain("self_check:synopsis");
    expect(labels).toContain("editorial:synopsis");
    expect(labels).toContain("self_check:statistics");
    expect(labels.some((l) => l.startsWith("cross_check:synopsis→statistics"))).toBe(true);
  });

  it("Variant 2 cross_check uses correct system prompt + zone texts", () => {
    const plan = buildIntraAuditCheckCalls({
      sections,
      prompts: PROMPTS,
      inputBudget: 1_000_000,
      auditMode: "zone_based",
    });
    const cross = plan.calls.find((c) => c.label.startsWith("cross_check"));
    expect(cross!.system).toBe("CROSS_SYS");
    expect(cross!.user).toContain("РЕФЕРЕНСНАЯ ЗОНА (synopsis)");
    expect(cross!.user).toContain("ПРОВЕРЯЕМАЯ ЗОНА (statistics)");
    expect(cross!.meta).toEqual({ kind: "cross_check", targetZone: "statistics", anchorZone: "synopsis" });
  });

  it("auto falls back to Variant 2 when doc exceeds budget", () => {
    const big = [sec({ title: "X", headingNumber: "1", standardSection: "synopsis", contentBlocks: [{ content: "a".repeat(5000) }] })];
    const plan = buildIntraAuditCheckCalls({
      sections: big,
      prompts: PROMPTS,
      inputBudget: 1000,
      auditMode: "auto",
    });
    expect(plan.variant).toBe(2);
  });

  it("self_check call carries meta.kind for handler persistence", () => {
    const plan = buildIntraAuditCheckCalls({
      sections,
      prompts: PROMPTS,
      inputBudget: 1_000_000,
      auditMode: "zone_based",
    });
    const self = plan.calls.find((c) => c.label === "self_check:synopsis");
    expect(self!.meta).toMatchObject({ kind: "self_check", targetZone: "synopsis" });
    expect(self!.system).toBe("SELF_SYS");
  });
});

describe("resolveCrossCheckPairs", () => {
  it("uses configured pairs filtered by available zones", () => {
    const avail = new Set(["synopsis", "statistics"]);
    const pairs = resolveCrossCheckPairs([["synopsis", "statistics"], ["synopsis", "ethics"]], avail);
    expect(pairs).toEqual([["synopsis", "statistics"]]);
  });

  it("auto-detects via affinity map when no configured pairs", () => {
    const avail = new Set(["synopsis", "statistics"]);
    const pairs = resolveCrossCheckPairs(null, avail);
    expect(pairs).toContainEqual(["synopsis", "statistics"]);
  });
});

describe("buildZoneTexts", () => {
  it("groups sections by root standardSection", () => {
    const zones = buildZoneTexts([
      sec({ title: "A", standardSection: "synopsis", headingNumber: "1" }),
      sec({ title: "B", standardSection: "synopsis.1", headingNumber: "1.1" }),
      sec({ title: "C", standardSection: "statistics", headingNumber: "2" }),
    ]);
    const zoneNames = zones.map((z) => z.zone).sort();
    expect(zoneNames).toEqual(["statistics", "synopsis"]);
    const synopsis = zones.find((z) => z.zone === "synopsis")!;
    expect(synopsis.titles).toEqual(["A", "B"]);
  });
});
