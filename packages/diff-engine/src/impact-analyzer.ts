import type { SectionDiff, ImpactAssessment, ImpactItem } from "./types.js";

/**
 * URS-052..054: Analyze impact of protocol changes on ICF and IB.
 * Maps protocol section changes to dependent sections in ICF/IB.
 */

const PROTOCOL_TO_ICF_MAP: Record<string, string[]> = {
  study_objectives: ["purpose_of_study"],
  study_design: ["study_procedures", "what_will_happen"],
  study_population: ["who_can_participate", "eligibility"],
  treatments: ["study_drug_description", "study_procedures"],
  efficacy_assessments: ["study_procedures", "visits"],
  safety_assessments: ["risks_side_effects", "safety_monitoring"],
  visit_schedule: ["visits", "study_procedures"],
  statistics: [],
  ethics: ["confidentiality", "voluntary_participation"],
};

const PROTOCOL_TO_IB_MAP: Record<string, string[]> = {
  study_drug: ["pharmacology", "clinical_experience"],
  safety_assessments: ["safety_data", "adverse_events"],
  treatments: ["dosing", "administration"],
};

export function analyzeProtocolImpactOnICF(
  sectionDiffs: SectionDiff[],
  sourceDoc: { id: string; title: string },
  targetDoc: { id: string; title: string }
): ImpactAssessment {
  const impacts = buildImpacts(sectionDiffs, PROTOCOL_TO_ICF_MAP);

  return {
    sourceDocument: { id: sourceDoc.id, type: "protocol", title: sourceDoc.title },
    impactedDocument: { id: targetDoc.id, type: "icf", title: targetDoc.title },
    impacts,
  };
}

export function analyzeProtocolImpactOnIB(
  sectionDiffs: SectionDiff[],
  sourceDoc: { id: string; title: string },
  targetDoc: { id: string; title: string }
): ImpactAssessment {
  const impacts = buildImpacts(sectionDiffs, PROTOCOL_TO_IB_MAP);

  return {
    sourceDocument: { id: sourceDoc.id, type: "protocol", title: sourceDoc.title },
    impactedDocument: { id: targetDoc.id, type: "ib", title: targetDoc.title },
    impacts,
  };
}

function buildImpacts(
  diffs: SectionDiff[],
  mapping: Record<string, string[]>
): ImpactItem[] {
  const impacts: ImpactItem[] = [];

  for (const diff of diffs) {
    if (diff.changeType === "unchanged") continue;

    const stdSection = diff.standardSection;
    if (!stdSection) continue;

    const impactedSections = mapping[stdSection];
    if (!impactedSections || impactedSections.length === 0) continue;

    for (const impactedSection of impactedSections) {
      const severity =
        diff.changeType === "removed"
          ? "high"
          : diff.textChanges.filter((c) => c.type !== "equal").length > 5
            ? "high"
            : "medium";

      impacts.push({
        changedSection: diff.sectionTitle,
        impactedSection,
        severity,
        description: `Protocol section "${diff.sectionTitle}" was ${diff.changeType}. ` +
          `Related section "${impactedSection}" may need updates.`,
        requiresUpdate: severity === "high",
      });
    }
  }

  return impacts;
}
