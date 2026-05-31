import { useState, useCallback, useEffect } from "react";
import { trpcCall } from "../api";

export interface ReviewFinding {
  id: string;
  type: string;
  description: string;
  suggestion: string | null;
  sourceRef: Record<string, any>;
  status: string;
  severity: string | null;
  originalSeverity: string | null;
  auditCategory: string | null;
  issueType: string | null;
  issueFamily: string | null;
  anchorZone: string | null;
  targetZone: string | null;
  hiddenByReviewer: boolean;
  reviewerNote: string | null;
  extraAttributes: Record<string, any>;
}

export interface ReviewData {
  review: {
    id: string;
    docVersionId: string;
    auditType: "intra_audit" | "inter_audit";
    status: "pending" | "in_review" | "published";
  };
  findings: ReviewFinding[];
  sections: { id: string; title: string; standardSection: string | null; content: string }[];
  documentTitle: string;
  versionLabel: string;
  studyTitle?: string;
}

export interface GoldenSampleOption {
  id: string;
  name: string;
  sampleType: string;
}

/** Эффективная серьёзность находки: extraAttributes.severity → колонка → info.
 *  То же, что на web (у intra-audit находок колонка severity не заполняется). */
export function effSeverity(f: ReviewFinding): string {
  return (f.extraAttributes?.severity as string) ?? f.severity ?? "info";
}

export function useReview(reviewId: string) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchReview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await trpcCall<ReviewData>("findingReview.getReview", { reviewId });
      setData(result);
      // Авто-перевод pending → in_review при открытии (как на web).
      if (result.review.status === "pending") {
        await trpcCall("findingReview.startReview", { reviewId }, "mutation");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  useEffect(() => {
    fetchReview();
  }, [fetchReview]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await fetchReview();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [fetchReview],
  );

  const toggleHidden = (findingId: string) =>
    run(() => trpcCall("findingReview.toggleHidden", { reviewId, findingId }, "mutation"));

  const changeSeverity = (findingId: string, severity: string) =>
    run(() => trpcCall("findingReview.changeSeverity", { reviewId, findingId, severity }, "mutation"));

  const addNote = (findingId: string, note: string) =>
    run(() => trpcCall("findingReview.addNote", { reviewId, findingId, note }, "mutation"));

  const promoteToGolden = (findingId: string, goldenSampleId: string) =>
    trpcCall("findingReview.promoteFindingToGolden", { reviewId, findingId, goldenSampleId }, "mutation");

  const bulkSetHidden = (findingIds: string[], hidden: boolean) =>
    run(() => trpcCall("findingReview.bulkSetHidden", { reviewId, findingIds, hidden }, "mutation"));

  const bulkChangeSeverity = (findingIds: string[], severity: string) =>
    run(() => trpcCall("findingReview.bulkChangeSeverity", { reviewId, findingIds, severity }, "mutation"));

  const publish = () =>
    run(() => trpcCall("findingReview.publish", { reviewId }, "mutation"));

  const listGoldenSamples = () =>
    trpcCall<GoldenSampleOption[]>("findingReview.listGoldenSamples", {});

  return {
    data,
    loading,
    error,
    busy,
    refetch: fetchReview,
    toggleHidden,
    changeSeverity,
    addNote,
    promoteToGolden,
    bulkSetHidden,
    bulkChangeSeverity,
    publish,
    listGoldenSamples,
  };
}
