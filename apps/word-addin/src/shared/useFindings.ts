import { useState, useCallback, useEffect } from "react";
import { trpcCall } from "../api";

export interface Finding {
  id: string;
  type: string;
  description: string;
  suggestion: string | null;
  sourceRef: Record<string, any>;
  status: string;
  severity: string | null;
  auditCategory: string | null;
  issueType: string | null;
  issueFamily: string | null;
  anchorZone: string | null;
  targetZone: string | null;
  qaVerified: boolean;
  extraAttributes: Record<string, any>;
}

interface UseFindingsOptions {
  docVersionId: string;
  mode: "intra_audit" | "inter_audit";
  protocolVersionId?: string;
}

export function useFindings({ docVersionId, mode, protocolVersionId }: UseFindingsOptions) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFindings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (mode === "inter_audit" && protocolVersionId) {
        const result = await trpcCall<{ findings: Finding[] }>(
          "audit.getInterAuditFindings",
          { protocolVersionId, checkedVersionId: docVersionId }
        );
        setFindings(result.findings);
      } else {
        const result = await trpcCall<{ findings: Finding[] }>(
          "audit.getAuditFindings",
          { docVersionId }
        );
        setFindings(result.findings);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [docVersionId, mode, protocolVersionId]);

  useEffect(() => {
    fetchFindings();
  }, [fetchFindings]);

  const updateStatus = useCallback(
    async (findingId: string, status: string) => {
      try {
        await trpcCall("audit.updateAuditFindingStatus", { findingId, status }, "mutation");
        setFindings((prev) =>
          prev.map((f) => (f.id === findingId ? { ...f, status } : f))
        );
      } catch (e: any) {
        setError(e.message);
      }
    },
    []
  );

  return { findings, loading, error, refetch: fetchFindings, updateStatus };
}
