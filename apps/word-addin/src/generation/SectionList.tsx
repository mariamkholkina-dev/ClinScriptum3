import React from "react";
import {
  Text,
  Badge,
  makeStyles,
  tokens,
  mergeClasses,
} from "@fluentui/react-components";
import {
  DocumentBulletList24Regular,
  Checkmark24Regular,
  Dismiss24Regular,
} from "@fluentui/react-icons";

const STATUS_COLORS: Record<string, "informative" | "success" | "warning" | "danger" | "subtle"> = {
  pending: "subtle",
  generating: "informative",
  qa_checking: "warning",
  completed: "success",
  skipped: "subtle",
  failed: "danger",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Ожидание",
  generating: "Генерация...",
  qa_checking: "QA проверка...",
  completed: "Готов",
  skipped: "Пропущен",
  failed: "Ошибка",
};

const useStyles = makeStyles({
  item: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    cursor: "pointer",
    borderRadius: "4px",
    "&:hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  active: {
    backgroundColor: tokens.colorBrandBackground2,
  },
  title: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
});

export interface GeneratedSection {
  id: string;
  title: string;
  standardSection: string | null;
  order: number;
  content: string;
  status: string;
  qaFindings: any[];
}

interface Props {
  sections: GeneratedSection[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SectionList({ sections, selectedId, onSelect }: Props) {
  const styles = useStyles();

  return (
    <div>
      {sections.map((s) => (
        <div
          key={s.id}
          className={mergeClasses(styles.item, s.id === selectedId && styles.active)}
          onClick={() => onSelect(s.id)}
        >
          <DocumentBulletList24Regular />
          <Text size={200} className={styles.title}>
            {s.title}
          </Text>
          <Badge
            size="small"
            appearance="filled"
            color={STATUS_COLORS[s.status] ?? "subtle"}
          >
            {STATUS_LABELS[s.status] ?? s.status}
          </Badge>
        </div>
      ))}
    </div>
  );
}
