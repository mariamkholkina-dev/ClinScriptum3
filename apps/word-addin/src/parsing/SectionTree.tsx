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
    alignItems: "flex-start",
    gap: "6px",
    paddingTop: "6px",
    paddingBottom: "6px",
    paddingRight: "8px",
    cursor: "pointer",
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    "&:hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
    // Чекбокс по умолчанию скрыт; виден при hover на строку либо
    // когда уже есть выделение (см. .listHasSelection ниже).
    "&:hover [data-section-cb='1']": { opacity: 1 },
  },
  checkboxSlot: {
    opacity: 0,
    transition: "opacity 0.1s",
    flexShrink: 0,
  },
  checkboxAlwaysVisible: {
    opacity: 1,
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
    fontSize: tokens.fontSizeBase200,
    // Word-wrap до 2 строк, чтобы длинные заголовки разделов
    // не обрезались ellipsis'ом из-за badge'a статуса + action-иконок.
    // Полный текст всё равно остаётся в `title=` для hover-tooltip.
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    wordBreak: "break-word",
    lineHeight: 1.3,
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
  rowDiffExtra: {
    borderLeft: `3px solid ${tokens.colorPaletteDarkOrangeForeground1}`,
  },
  rowDiffWrongLevel: {
    borderLeft: `3px solid ${tokens.colorPaletteBlueForeground2}`,
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
  /** Quick-click на статус «Не подтв.» → подтверждение секции + jump
   *  на следующую неподтверждённую. */
  onQuickValidate: (section: Section) => void;
  quickValidatingId: string | null;
  /** Подсветка строк по типу diff (см. DiffPanel). Если не передан — без подсветки.
   *  Только `extra` и `wrong_level` имеют реальную секцию для матчинга. */
  diffTypeBySectionId?: Map<string, "extra" | "wrong_level">;
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
  onQuickValidate,
  quickValidatingId,
  diffTypeBySectionId,
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

  // Когда выделена хотя бы одна секция — показываем чекбоксы у всех строк,
  // иначе они скрыты и появляются только при hover на конкретную строку.
  // Это освобождает место под заголовок раздела в узкой Word task pane.
  const hasAnySelection = selectedIds.size > 0;

  return (
    <div className={styles.root}>
      {sections.map((section) => {
        const isFalse = section.isFalseHeading;
        const isSelected = selectedIds.has(section.id);
        const isActive = section.id === activeSectionId;
        const diffType = diffTypeBySectionId?.get(section.id);
        // Слот чекбокса виден если: выделена сама строка / есть глобальные
        // выделения / hover на строку (CSS правило в `.row:hover`).
        const checkboxVisible = isSelected || hasAnySelection;
        return (
          <div
            key={section.id}
            className={mergeClasses(
              styles.row,
              isFalse && styles.rowFalse,
              (isSelected || isActive) && styles.rowSelected,
              diffType === "extra" && styles.rowDiffExtra,
              diffType === "wrong_level" && styles.rowDiffWrongLevel,
            )}
            style={{ paddingLeft: `${4 + section.level * 14}px` }}
            onClick={() => onActivateSection(section)}
          >
            <div
              data-section-cb="1"
              className={mergeClasses(
                styles.checkboxSlot,
                checkboxVisible && styles.checkboxAlwaysVisible,
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <Checkbox
                checked={isSelected}
                onChange={() => onToggleSelect(section.id)}
              />
            </div>

            <Text
              className={mergeClasses(styles.title, isFalse && styles.titleFalse)}
              title={section.title}
            >
              {section.headingNumber && (
                <span style={{
                  color: tokens.colorNeutralForeground3,
                  marginRight: "4px",
                  fontWeight: tokens.fontWeightSemibold,
                }}>
                  {section.headingNumber}
                </span>
              )}
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
              title={
                section.structureStatus === "not_validated"
                  ? "Кликните, чтобы подтвердить и перейти к следующему"
                  : "Статус структуры"
              }
              style={
                section.structureStatus === "not_validated"
                  ? { cursor: "pointer" }
                  : undefined
              }
              onClick={
                section.structureStatus === "not_validated"
                  ? (e) => {
                      e.stopPropagation();
                      if (quickValidatingId !== section.id) {
                        onQuickValidate(section);
                      }
                    }
                  : undefined
              }
            >
              {quickValidatingId === section.id ? "..." : STATUS_LABEL[section.structureStatus]}
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
