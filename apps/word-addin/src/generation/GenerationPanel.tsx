import React, { useState, useEffect } from "react";
import {
  Text,
  Spinner,
  Divider,
  Button,
  makeStyles,
  tokens,
  Badge,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";
import { trpcCall } from "../api";
import { SectionList, type GeneratedSection } from "./SectionList";
import { SectionPreview } from "./SectionPreview";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  header: {
    padding: "12px",
  },
  content: {
    flex: 1,
    overflowY: "auto",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px",
    color: tokens.colorNeutralForeground3,
  },
  statusRow: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    marginTop: "8px",
  },
});

interface GeneratedDoc {
  id: string;
  docType: string;
  status: string;
  studyTitle: string;
  protocolTitle: string;
  protocolLabel: string;
  sections: GeneratedSection[];
}

interface Props {
  generatedDocId: string;
  mode: "review" | "insert";
}

export function GenerationPanel({ generatedDocId, mode }: Props) {
  const styles = useStyles();
  const [doc, setDoc] = useState<GeneratedDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);

  const fetchDoc = async () => {
    setLoading(true);
    try {
      const result = await trpcCall<GeneratedDoc>("generation.getGeneratedDoc", {
        generatedDocId,
      });
      setDoc(result);
      if (!selectedSectionId && result.sections.length > 0) {
        setSelectedSectionId(result.sections[0].id);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDoc();
  }, [generatedDocId]);

  useEffect(() => {
    if (!doc) return;
    if (doc.status === "generating" || doc.status === "qa_checking") {
      const timer = setInterval(fetchDoc, 4000);
      return () => clearInterval(timer);
    }
  }, [doc?.status]);

  if (loading) {
    return (
      <div className={styles.empty}>
        <Spinner label="Загрузка документа..." />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className={styles.empty}>
        <Text>Документ не найден</Text>
      </div>
    );
  }

  const selectedSection = doc.sections.find((s) => s.id === selectedSectionId);
  const completedCount = doc.sections.filter((s) => s.status === "completed").length;
  const isGenerating = doc.status === "generating" || doc.status === "qa_checking";

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text weight="semibold" size={400}>
          {doc.docType === "icf" ? "ICF" : "CSR"} — {mode === "review" ? "Ревью" : "Вставка секций"}
        </Text>
        <div className={styles.statusRow}>
          <Badge
            size="small"
            color={isGenerating ? "informative" : doc.status === "completed" ? "success" : "danger"}
          >
            {isGenerating ? "Генерация..." : doc.status === "completed" ? "Завершено" : doc.status}
          </Badge>
          <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
            {completedCount}/{doc.sections.length} разделов
          </Text>
        </div>
      </div>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      <Divider />

      <div className={styles.content}>
        <SectionList
          sections={doc.sections}
          selectedId={selectedSectionId}
          onSelect={setSelectedSectionId}
        />

        {selectedSection && (
          <>
            <Divider />
            <SectionPreview section={selectedSection} mode={mode} />
          </>
        )}
      </div>
    </div>
  );
}
