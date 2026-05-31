import { useEffect, useState } from "react";
import { Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { trpcCall } from "../api";

interface ReviewRow {
  id: string;
  docVersionId: string;
  auditType: "intra_audit" | "inter_audit";
  status: string;
  documentTitle: string;
  versionLabel: string;
  studyTitle: string;
  findingsCount: number;
}

const useStyles = makeStyles({
  item: {
    padding: "8px 12px",
    cursor: "pointer",
    borderRadius: "4px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    marginBottom: "6px",
    "&:hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
});

const AUDIT_LABELS: Record<string, string> = {
  intra_audit: "Внутридокументный аудит",
  inter_audit: "Междокументный аудит",
};

/** Список ревью для ревьюера (mode='finding_review' в ручном выборе). */
export function ReviewSelector({ onSelect }: { onSelect: (reviewId: string, docVersionId: string) => void }) {
  const styles = useStyles();
  const [rows, setRows] = useState<ReviewRow[] | null>(null);

  useEffect(() => {
    trpcCall<ReviewRow[]>("findingReview.dashboard", {})
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  if (rows === null) return <Spinner size="small" label="Загрузка ревью..." />;
  if (rows.length === 0) {
    return (
      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
        Нет ревью, ожидающих проверки.
      </Text>
    );
  }

  return (
    <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
      {rows.map((r) => (
        <div key={r.id} className={styles.item} onClick={() => onSelect(r.id, r.docVersionId)}>
          <Text size={200}>{r.documentTitle} — {r.versionLabel}</Text>
          <br />
          <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
            {r.studyTitle} · {AUDIT_LABELS[r.auditType] ?? r.auditType} · находок: {r.findingsCount} · {r.status}
          </Text>
        </div>
      ))}
    </div>
  );
}
