import React from "react";
import {
  Button,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  EyeOff20Regular,
  Eye20Regular,
  Comment20Regular,
} from "@fluentui/react-icons";
import type { Section } from "./types";

const useStyles = makeStyles({
  actions: {
    display: "flex",
    gap: "2px",
    alignItems: "center",
  },
  commentSurface: {
    maxWidth: "320px",
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
  },
  commentLabel: {
    fontWeight: tokens.fontWeightSemibold,
    marginBottom: "4px",
    display: "block",
  },
});

interface Props {
  section: Section;
  onToggleFalseHeading: () => void;
  pending: boolean;
}

/**
 * Per-section actions: переключить флаг ложного заголовка и просмотреть
 * structureComment в popover'е (если есть). Кнопки — миниатюрные subtle, чтобы
 * вписаться в строку дерева.
 */
export function SectionRowActions({ section, onToggleFalseHeading, pending }: Props) {
  const styles = useStyles();
  const isFalse = section.isFalseHeading;
  return (
    <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
      {section.structureComment && (
        <Popover withArrow>
          <PopoverTrigger>
            <Button
              size="small"
              appearance="subtle"
              icon={<Comment20Regular />}
              title="Комментарий"
              aria-label="Комментарий к доработке"
            />
          </PopoverTrigger>
          <PopoverSurface className={styles.commentSurface}>
            <Text className={styles.commentLabel}>Комментарий к доработке</Text>
            <Text>{section.structureComment}</Text>
          </PopoverSurface>
        </Popover>
      )}

      <Tooltip
        content={isFalse ? "Восстановить как заголовок" : "Пометить как ложный заголовок"}
        relationship="label"
      >
        <Button
          size="small"
          appearance="subtle"
          icon={isFalse ? <Eye20Regular /> : <EyeOff20Regular />}
          onClick={onToggleFalseHeading}
          disabled={pending}
        />
      </Tooltip>
    </div>
  );
}
