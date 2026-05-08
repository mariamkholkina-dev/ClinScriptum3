import React from "react";
import {
  Badge,
  Checkbox,
  Spinner,
  Text,
  makeStyles,
  tokens,
  mergeClasses,
} from "@fluentui/react-components";
import type { Section, SectionStatus } from "./types";
import { SectionRowActions } from "./SectionRowActions";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    flex: 1,
    minHeight: 0,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    paddingTop: "4px",
    paddingBottom: "4px",
    paddingRight: "8px",
    cursor: "pointer",
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    "&:hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  rowFalse: {
    opacity: 0.55,
  },
  rowSelected: {
    backgroundColor: tokens.colorBrandBackground2,
  },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: tokens.fontSizeBase200,
  },
  titleFalse: {
    textDecoration: "line-through",
    color: tokens.colorNeutralForeground3,
  },
  levelBadge: {
    minWidth: "26px",
  },
  empty: {
    padding: "16px",
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  loading: {
    display: "flex",
    justifyContent: "center",
    padding: "32px",
  },
  manualMark: {
    color: tokens.colorPaletteBlueForeground2,
    fontSize: tokens.fontSizeBase100,
  },
});

const STATUS_COLOR: Record<SectionStatus, "success" | "subtle" | "danger"> = {
  validated: "success",
  not_validated: "subtle",
  requires_rework: "danger",
};

const STATUS_LABEL: Record<SectionStatus, string> = {
  validated: "Подтв.",
  not_validated: "Не подтв.",
  requires_rework: "Доработка",
};

interface Props {
  sections: Section[];
  loading: boolean;
  selectedIds: Set<string>;
  activeSectionId: string | null;
  onToggleSelect: (id: string) => void;
  onActivateSection: (section: Section) => void;
  onToggleFalseHeading: (section: Section) => void;
  togglingFalseHeadingId: string | null;
  onUpdateComment: (section: Section, newComment: string) => Promise<void>;
  onDeleteManual: (section: Section) => Promise<void>;
}

/**
 * Иерархическое дерево секций. Indent рассчитывается по `level` (умноженному
 * на ~14px), как в rule-admin parsing-viewer. Без collapse/expand — для add-in
 * этого пока достаточно: список секций обычно <200 элементов, scroll работает.
 *
 * При клике на строку:
 *  - вызываем `onActivateSection` (родитель прыгает в Word + подсвечивает)
 *
 * Click на checkbox — отдельно, не активирует секцию.
 */
export function SectionTree({
  sections,
  loading,
  selectedIds,
  activeSectionId,
  onToggleSelect,
  onActivateSection,
  onToggleFalseHeading,
  togglingFalseHeadingId,
  onUpdateComment,
  onDeleteManual,
}: Props) {
  const styles = useStyles();

  if (loading) {
    return (
      <div className={styles.loading}>
        <Spinner label="Загрузка структуры..." />
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className={styles.empty}>
        <Text>Секции не найдены. Документ ещё не разобран.</Text>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      {sections.map((section) => {
        const isFalse = section.isFalseHeading;
        const isSelected = selectedIds.has(section.id);
        const isActive = section.id === activeSectionId;
        return (
          <div
            key={section.id}
            className={mergeClasses(
              styles.row,
              isFalse && styles.rowFalse,
              (isSelected || isActive) && styles.rowSelected,
            )}
            style={{ paddingLeft: `${4 + section.level * 14}px` }}
            onClick={() => onActivateSection(section)}
          >
            <div onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={isSelected}
                onChange={() => onToggleSelect(section.id)}
              />
            </div>

            <Badge
              className={styles.levelBadge}
              size="small"
              shape="rounded"
              appearance="outline"
              title={`Уровень заголовка ${section.level}`}
            >
              L{section.level}
            </Badge>

            <Text
              className={mergeClasses(styles.title, isFalse && styles.titleFalse)}
              title={section.title}
            >
              {section.title || "(без названия)"}
            </Text>

            {section.isManual && (
              <span className={styles.manualMark} title="Раздел добавлен вручную">
                ✱
              </span>
            )}

            <Badge
              size="small"
              appearance="filled"
              color={STATUS_COLOR[section.structureStatus]}
              title="Статус структуры"
            >
              {STATUS_LABEL[section.structureStatus]}
            </Badge>

            <SectionRowActions
              section={section}
              pending={togglingFalseHeadingId === section.id}
              onToggleFalseHeading={() => onToggleFalseHeading(section)}
              onUpdateComment={(newComment) => onUpdateComment(section, newComment)}
              onDeleteManual={
                section.isManual ? () => onDeleteManual(section) : undefined
              }
            />
          </div>
        );
      })}
    </div>
  );
}
