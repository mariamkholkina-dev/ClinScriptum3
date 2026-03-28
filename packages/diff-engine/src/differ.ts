import { diffWords } from "diff";
import type { DiffResult, SectionDiff, TextChange, DiffSummary, FactChange } from "./types.js";

interface SectionInput {
  id: string;
  title: string;
  standardSection: string | null;
  content: string;
}

interface FactInput {
  factKey: string;
  value: string;
}

export function diffSections(
  oldSections: SectionInput[],
  newSections: SectionInput[]
): DiffResult {
  const sectionDiffs: SectionDiff[] = [];
  const matched = new Set<string>();

  for (const oldSec of oldSections) {
    const newSec = newSections.find(
      (n) =>
        (n.standardSection && n.standardSection === oldSec.standardSection) ||
        normalizeTitle(n.title) === normalizeTitle(oldSec.title)
    );

    if (!newSec) {
      sectionDiffs.push({
        standardSection: oldSec.standardSection,
        sectionTitle: oldSec.title,
        changeType: "removed",
        oldContent: oldSec.content,
        textChanges: [{ type: "remove", value: oldSec.content }],
      });
    } else {
      matched.add(newSec.id);
      const textChanges = computeTextDiff(oldSec.content, newSec.content);
      const isModified = textChanges.some((c) => c.type !== "equal");
      sectionDiffs.push({
        standardSection: oldSec.standardSection ?? newSec.standardSection,
        sectionTitle: newSec.title,
        changeType: isModified ? "modified" : "unchanged",
        oldContent: oldSec.content,
        newContent: newSec.content,
        textChanges,
      });
    }
  }

  for (const newSec of newSections) {
    if (!matched.has(newSec.id)) {
      const wasMatched = sectionDiffs.some(
        (d) =>
          d.sectionTitle === newSec.title ||
          (d.standardSection && d.standardSection === newSec.standardSection)
      );
      if (!wasMatched) {
        sectionDiffs.push({
          standardSection: newSec.standardSection,
          sectionTitle: newSec.title,
          changeType: "added",
          newContent: newSec.content,
          textChanges: [{ type: "add", value: newSec.content }],
        });
      }
    }
  }

  const summary: DiffSummary = {
    addedSections: sectionDiffs.filter((d) => d.changeType === "added").length,
    removedSections: sectionDiffs.filter((d) => d.changeType === "removed").length,
    modifiedSections: sectionDiffs.filter((d) => d.changeType === "modified").length,
    unchangedSections: sectionDiffs.filter((d) => d.changeType === "unchanged").length,
    totalChanges:
      sectionDiffs.filter((d) => d.changeType !== "unchanged").length,
  };

  return { summary, sectionDiffs, factChanges: [] };
}

export function diffFacts(oldFacts: FactInput[], newFacts: FactInput[]): FactChange[] {
  const changes: FactChange[] = [];
  const newMap = new Map(newFacts.map((f) => [f.factKey, f.value]));
  const oldMap = new Map(oldFacts.map((f) => [f.factKey, f.value]));

  for (const [key, oldVal] of oldMap) {
    const newVal = newMap.get(key);
    if (newVal === undefined) {
      changes.push({ factKey: key, changeType: "removed", oldValue: oldVal });
    } else if (oldVal !== newVal) {
      changes.push({ factKey: key, changeType: "modified", oldValue: oldVal, newValue: newVal });
    } else {
      changes.push({ factKey: key, changeType: "unchanged", oldValue: oldVal, newValue: newVal });
    }
  }

  for (const [key, newVal] of newMap) {
    if (!oldMap.has(key)) {
      changes.push({ factKey: key, changeType: "added", newValue: newVal });
    }
  }

  return changes;
}

function computeTextDiff(oldText: string, newText: string): TextChange[] {
  const diff = diffWords(oldText, newText);
  return diff.map((part) => ({
    type: part.added ? "add" : part.removed ? "remove" : "equal",
    value: part.value,
  }));
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^\d+(\.\d+)*\s*/, "")
    .trim();
}
