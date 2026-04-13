import React from "react";
import {
  Text,
  Divider,
  makeStyles,
  tokens,
  Button,
} from "@fluentui/react-components";
import { Location24Regular } from "@fluentui/react-icons";
import { SeverityBadge } from "../shared/SeverityBadge";
import { StatusBadge } from "../shared/StatusBadge";
import { StatusActions } from "./StatusActions";
import { navigateToText, applyTextReplacement } from "../office-helpers";
import type { Finding } from "../shared/useFindings";

const useStyles = makeStyles({
  root: {
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    overflowY: "auto",
  },
  badges: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap" as const,
  },
  blockquote: {
    borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
    paddingLeft: "12px",
    margin: "4px 0",
    fontStyle: "italic",
    color: tokens.colorNeutralForeground2,
  },
  suggestion: {
    backgroundColor: tokens.colorPaletteGreenBackground1,
    padding: "8px 12px",
    borderRadius: "4px",
    border: `1px solid ${tokens.colorPaletteGreenBorder1}`,
  },
});

interface Props {
  finding: Finding;
  onUpdateStatus: (findingId: string, status: string) => void;
}

export function FindingDetail({ finding, onUpdateStatus }: Props) {
  const styles = useStyles();
  const ref = finding.sourceRef as any;

  const handleNavigate = async () => {
    const snippet = ref?.textSnippet || ref?.checkedDocQuote || ref?.anchorQuote;
    if (snippet) await navigateToText(snippet);
  };

  const handleApplyFix = async () => {
    if (!finding.suggestion || !ref?.textSnippet) return;
    const success = await applyTextReplacement(ref.textSnippet, finding.suggestion);
    if (success) {
      onUpdateStatus(finding.id, "resolved");
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.badges}>
        <SeverityBadge severity={finding.severity} />
        <StatusBadge status={finding.status} />
        {finding.auditCategory && (
          <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
            {finding.auditCategory}
          </Text>
        )}
      </div>

      <Text weight="semibold" size={300}>
        {finding.description}
      </Text>

      {finding.suggestion && (
        <div className={styles.suggestion}>
          <Text size={200} weight="semibold">
            Рекомендация:
          </Text>
          <Text size={200}> {finding.suggestion}</Text>
        </div>
      )}

      <Divider />

      {(ref?.textSnippet || ref?.anchorQuote) && (
        <div>
          <Text size={200} weight="semibold">
            Цитата из документа
          </Text>
          <div className={styles.blockquote}>
            <Text size={200}>{ref?.textSnippet || ref?.anchorQuote}</Text>
          </div>
        </div>
      )}

      {ref?.targetQuote && (
        <div>
          <Text size={200} weight="semibold">
            Цитата (целевой фрагмент)
          </Text>
          <div className={styles.blockquote}>
            <Text size={200}>{ref.targetQuote}</Text>
          </div>
        </div>
      )}

      <Button
        size="small"
        icon={<Location24Regular />}
        onClick={handleNavigate}
        disabled={!ref?.textSnippet && !ref?.checkedDocQuote && !ref?.anchorQuote}
      >
        Перейти в документе
      </Button>

      <StatusActions
        status={finding.status}
        hasSuggestion={!!finding.suggestion}
        onUpdateStatus={(status) => onUpdateStatus(finding.id, status)}
        onApplyFix={finding.suggestion ? handleApplyFix : undefined}
      />
    </div>
  );
}
