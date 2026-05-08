import React, { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Dropdown,
  Option,
  Text,
  makeStyles,
  tokens,
  mergeClasses,
} from "@fluentui/react-components";
import type { DiffEntry } from "./diffWithExpected";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    flex: 1,
    minHeight: 0,
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    padding: "8px 12px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  group: {
    display: "flex",
    flexDirection: "column",
  },
  groupTitle: {
    padding: "8px 12px 4px 12px",
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground2,
    position: "sticky",
    top: 0,
    zIndex: 1,
  },
  row: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    padding: "8px 10px 8px 12px",
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`,
    cursor: "pointer",
    "&:hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  rowExtra: {
    borderLeft: `3px solid ${tokens.colorPaletteDarkOrangeForeground1}`,
  },
  rowMissing: {
    borderLeft: `3px solid ${tokens.colorPaletteRedForeground1}`,
  },
  rowWrongLevel: {
    borderLeft: `3px solid ${tokens.colorPaletteBlueForeground2}`,
  },
  title: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    marginTop: "4px",
  },
  empty: {
    padding: "32px 16px",
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
});

export interface DiffPanelProps {
  entries: DiffEntry[];
  pending: boolean;
  /** Кликабельность строки extra/wrong_level — прыжок в Word по textSnippet секции. */
  onJumpToSection: (sectionId: string) => void;
  onAcceptExtra: (entry: DiffEntry) => void;
  onMarkFalseHeading: (sectionId: string) => void;
  onRemoveMissing: (entry: DiffEntry) => void;
  onApplyLevel: (entry: DiffEntry, newLevel: number) => void;
}

const TYPE_GROUPS: Array<{ key: DiffEntry["type"]; label: string }> = [
  { key: "missing", label: "Пропущено" },
  { key: "extra", label: "Лишних" },
  { key: "wrong_level", label: "Неверный уровень" },
];

const COUNTER_LABELS: Record<DiffEntry["type"], string> = {
  missing: "пропущено",
  extra: "лишних",
  wrong_level: "уровень",
};

const COUNTER_COLORS: Record<DiffEntry["type"], "danger" | "warning" | "informative"> = {
  missing: "danger",
  extra: "warning",
  wrong_level: "informative",
};

/**
 * Diff overlay для парсинг-панели в Word add-in.
 *
 * Группирует diff entries по типу (missing / extra / wrong_level), показывает
 * счётчики сверху и quick-fix кнопки на каждой строке. Логика правок реализована
 * в родителе (`ParsingPanel`); этот компонент только зовёт колбеки.
 *
 * Click на строку (вне кнопок) — прыжок в Word через `onJumpToSection`
 * (только для extra/wrong_level — у missing нет реальной секции).
 */
export function DiffPanel({
  entries,
  pending,
  onJumpToSection,
  onAcceptExtra,
  onMarkFalseHeading,
  onRemoveMissing,
  onApplyLevel,
}: DiffPanelProps) {
  const styles = useStyles();
  // Локальный draft уровня для каждого `wrong_level` row (ключ = entry index).
  // Заменяется при выборе из Dropdown'а; коммитится по «Применить».
  const [pendingLevels, setPendingLevels] = useState<Map<string, number>>(new Map());

  const counts = useMemo(() => {
    const c: Record<DiffEntry["type"], number> = {
      missing: 0,
      extra: 0,
      wrong_level: 0,
    };
    for (const e of entries) c[e.type]++;
    return c;
  }, [entries]);

  if (entries.length === 0) {
    return (
      <div className={styles.empty}>
        <Text>Расхождений с эталоном не найдено.</Text>
      </div>
    );
  }

  const grouped: Record<DiffEntry["type"], Array<{ entry: DiffEntry; key: string }>> = {
    missing: [],
    extra: [],
    wrong_level: [],
  };
  entries.forEach((e, i) => {
    grouped[e.type].push({ entry: e, key: `${e.type}:${e.actualSectionId ?? "_"}:${e.sectionTitle}:${i}` });
  });

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        {TYPE_GROUPS.map(({ key }) => (
          <Badge
            key={key}
            size="small"
            appearance={counts[key] > 0 ? "filled" : "outline"}
            color={counts[key] > 0 ? COUNTER_COLORS[key] : undefined}
          >
            {counts[key]} {COUNTER_LABELS[key]}
          </Badge>
        ))}
      </div>

      {TYPE_GROUPS.map(({ key, label }) => {
        const items = grouped[key];
        if (items.length === 0) return null;
        return (
          <div key={key} className={styles.group}>
            <div className={styles.groupTitle}>
              {label} ({items.length})
            </div>
            {items.map(({ entry, key: rowKey }) => {
              const rowClass = mergeClasses(
                styles.row,
                entry.type === "extra" && styles.rowExtra,
                entry.type === "missing" && styles.rowMissing,
                entry.type === "wrong_level" && styles.rowWrongLevel,
              );
              const handleRowClick = () => {
                if (entry.actualSectionId) onJumpToSection(entry.actualSectionId);
              };
              const stop = (e: React.MouseEvent) => e.stopPropagation();
              return (
                <div key={rowKey} className={rowClass} onClick={handleRowClick}>
                  <Text className={styles.title} title={entry.sectionTitle}>
                    {entry.sectionTitle || "(без названия)"}
                  </Text>

                  {entry.type === "extra" && entry.actual && (
                    <Text className={styles.meta}>
                      L{entry.actual.level} в документе, нет в эталоне
                    </Text>
                  )}
                  {entry.type === "missing" && entry.expected && (
                    <Text className={styles.meta}>
                      ожидался L{entry.expected.level}, нет в документе
                    </Text>
                  )}
                  {entry.type === "wrong_level" && entry.actual && entry.expected && (
                    <Text className={styles.meta}>
                      эталон: L{entry.expected.level}, документ: L{entry.actual.level}
                    </Text>
                  )}

                  <div className={styles.actions} onClick={stop}>
                    {entry.type === "extra" && entry.actualSectionId && (
                      <>
                        <Button
                          size="small"
                          appearance="primary"
                          disabled={pending}
                          onClick={() => onAcceptExtra(entry)}
                          title="Добавить запись в expected_results"
                        >
                          Принять в эталон
                        </Button>
                        <Button
                          size="small"
                          appearance="secondary"
                          disabled={pending}
                          onClick={() => onMarkFalseHeading(entry.actualSectionId!)}
                          title="Пометить как ложный заголовок (исключить из diff)"
                        >
                          Не заголовок
                        </Button>
                      </>
                    )}
                    {entry.type === "missing" && (
                      <Button
                        size="small"
                        appearance="secondary"
                        disabled={pending}
                        onClick={() => onRemoveMissing(entry)}
                        title="Удалить запись из expected_results"
                      >
                        Удалить из эталона
                      </Button>
                    )}
                    {entry.type === "wrong_level" && entry.actual && (
                      <>
                        <Dropdown
                          size="small"
                          value={`Уровень ${(pendingLevels.get(rowKey) ?? entry.actual.level) + 1}`}
                          selectedOptions={[
                            String(pendingLevels.get(rowKey) ?? entry.actual.level),
                          ]}
                          onOptionSelect={(_, d) => {
                            const v = Number(d.optionValue);
                            if (Number.isNaN(v)) return;
                            setPendingLevels((prev) => {
                              const next = new Map(prev);
                              next.set(rowKey, v);
                              return next;
                            });
                          }}
                          style={{ minWidth: 110 }}
                        >
                          {[0, 1, 2, 3, 4, 5].map((lvl) => (
                            <Option key={lvl} value={String(lvl)}>
                              {`Уровень ${lvl + 1}`}
                            </Option>
                          ))}
                        </Dropdown>
                        <Button
                          size="small"
                          appearance="primary"
                          disabled={pending}
                          onClick={() =>
                            onApplyLevel(
                              entry,
                              pendingLevels.get(rowKey) ?? entry.actual!.level,
                            )
                          }
                          title="Обновить уровень в expected_results"
                        >
                          Применить
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
