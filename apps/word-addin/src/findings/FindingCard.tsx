import React from "react";
import {
  Card,
  CardHeader,
  Text,
  makeStyles,
  tokens,
  mergeClasses,
} from "@fluentui/react-components";
import { StatusBadge } from "../shared/StatusBadge";
import { SeverityBadge } from "../shared/SeverityBadge";
import type { Finding } from "../shared/useFindings";

const SEVERITY_BORDER: Record<string, string> = {
  critical: "#d13438",
  high: "#da3b01",
  medium: "#fde300",
  low: "#0078d4",
  info: "#c8c6c4",
};

const useStyles = makeStyles({
  card: {
    cursor: "pointer",
    marginBottom: "6px",
    borderLeftWidth: "4px",
    borderLeftStyle: "solid",
    transition: "box-shadow 0.15s",
    "&:hover": { boxShadow: tokens.shadow4 },
  },
  selected: {
    boxShadow: tokens.shadow8,
    outline: `2px solid ${tokens.colorBrandStroke1}`,
  },
  badges: {
    display: "flex",
    gap: "4px",
    alignItems: "center",
    flexWrap: "wrap" as const,
  },
  desc: {
    marginTop: "4px",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as const,
    overflow: "hidden",
  },
  category: {
    marginTop: "2px",
    color: tokens.colorNeutralForeground3,
  },
});

interface Props {
  finding: Finding;
  isSelected: boolean;
  onSelect: () => void;
}

export function FindingCard({ finding, isSelected, onSelect }: Props) {
  const styles = useStyles();
  const borderColor = SEVERITY_BORDER[finding.severity ?? "info"] ?? SEVERITY_BORDER.info;

  return (
    <Card
      className={mergeClasses(styles.card, isSelected && styles.selected)}
      style={{ borderLeftColor: borderColor }}
      onClick={onSelect}
      size="small"
    >
      <CardHeader
        header={
          <div className={styles.badges}>
            <SeverityBadge severity={finding.severity} />
            <StatusBadge status={finding.status} />
          </div>
        }
      />
      <Text size={200} className={styles.desc}>
        {finding.description}
      </Text>
      {finding.auditCategory && (
        <Text size={100} className={styles.category}>
          {finding.auditCategory}
          {finding.issueType ? ` · ${finding.issueType}` : ""}
        </Text>
      )}
    </Card>
  );
}
