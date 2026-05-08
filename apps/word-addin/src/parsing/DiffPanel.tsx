import React, { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Dropdown,
  Option,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  CheckmarkCircle20Regular,
  EyeOff20Regular,
  ArrowRight20Regular,
} from "@fluentui/react-icons";
import type { Section } from "./types";
import type { DiffEntry } from "./diffWithExpected";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "8px 12px",
    gap: "10px",
  },
  empty: {
    padding: "24px 12px",
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  groupHeader: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  row: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderLeftWidth: "3px",
    borderRadius: tokens.borderRadiusMedium,
    padding: "6px 8px",
    cursor: "pointer",
    backgroundColor: tokens.colorNeutralBackground1,
    "&:hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  rowMissing: {
    borderLeftColor: tokens.colorPaletteRedBorder2,
  },
  rowExtra: {
    borderLeftColor: tokens.colorPaletteMarigoldBorder2,
  },
  rowWrongLevel: {
    borderLeftColor: tokens.colorPaletteBlueBorderActive,
  },
  rowHeader: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: tokens.fontSizeBase200,
  },
  detail: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    marginTop: "2px",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "4px",
    marginTop: "6px",
  },
  levelDropdown: {
    minWidth: "100px",
  },
  summary: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
    paddingBottom: "4px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
});

interface Props {
  entries: DiffEntry[];
  sections: Section[];
  hasExpected: boolean;
  fixPending: boolean;
  /** Click на строку diff → перейти к месту в Word (или показать предупреждение если не найдено). */
  onActivateSection: (section: Section) => void;
  /** Quick-fix действия. Каждое — async; компонент сам отображает Spinner через `fixPending`. */
  onAcceptExtra: (sectionId: string, sectionTitle: string, level: number) => void;
  onMarkFalseHeading: (sectionId: string) => void;
  onRemoveMissing: (sectionTitle: string) => void;
  onApplyLevel: (sectionTitle: string, newLevel: number) => void;
}

/**
 * Панель списка diff entries с quick-fix actions. Группировка по типу:
 *  - Пропущено (missing) → «Удалить из эталона»
 *  - Лишних (extra) → «Принять в эталон» / «Не заголовок»
 *  - Неверный уровень (wrong_level) → выбор уровня + «Применить уровень в эталон»
 *
 * Click на строку (вне кнопок) → onActivateSection(real section) — Word скроллит
 * к textSnippet секции. Для missing-entry секции в документе нет, поэтому click
 * не делает ничего (но строка не disabled — пусть annotator видит её).
 */
export function DiffPanel({
  entries,
  sections,
  hasExpected,
  fixPending,
  onActivateSection,
  onAcceptExtra,
  onMarkFalseHeading,
  onRemoveMissing,
  onApplyLevel,
}: Props) {
  const styles = useStyles();

  // Resolve реальной секции по entry: сначала actualSectionId (для дубликатов
  // title), потом fallback по title. Missing-entries секции не имеют.
  const sectionById = useMemo(() => {
    const m = new Map<string, Section>();
    for (const s of sections) m.set(s.id, s);
    return m;
  }, [sections]);
  const titleToSection = useMemo(() => {
    const m = new Map<string, Section>();
    for (const s of sections) m.set(s.title.trim().toLowerCase(), s);
    return m;
  }, [sections]);
  const resolveSection = (e: DiffEntry): Section | undefined => {
    if (e.actualSectionId) {
      const byId = sectionById.get(e.actualSectionId);
      if (byId) return byId;
    }
    return titleToSection.get(e.sectionTitle.trim().toLowerCase());
  };

  // Локальный per-row выбор уровня для wrong_level. Initial = actual.level
  // (т.е. annotator подтверждает: «эталон ошибается, фактический уровень верен»).
  const [pendingLevels, setPendingLevels] = useState<Map<string, number>>(new Map());

  if (!hasExpected) {
    return (
      <div className={styles.empty}>
        <Text>Эталон для этой стадии не задан.</Text>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className={styles.empty}>
        <Text>Структура полностью совпадает с эталоном.</Text>
      </div>
    );
  }

  const missing = entries.filter((e) => e.type === "missing");
  const extra = entries.filter((e) => e.type === "extra");
  const wrongLevel = entries.filter((e) => e.type === "wrong_level");

  const getRowKey = (e: DiffEntry, idx: number) => `${e.type}:${e.sectionTitle}:${idx}`;

  return (
    <div className={styles.root}>
      <div className={styles.summary}>
        <Badge size="small" appearance="tint" color="danger">
          Пропущено: {missing.length}
        </Badge>
        <Badge size="small" appearance="tint" color="warning">
          Лишних: {extra.length}
        </Badge>
        <Badge size="small" appearance="tint" color="informative">
          Неверный уровень: {wrongLevel.length}
        </Badge>
      </div>

      {missing.length > 0 && (
        <div className={styles.group}>
          <Text className={styles.groupHeader} size={200}>
            Пропущено ({missing.length})
          </Text>
          {missing.map((e, i) => (
            <DiffRow
              key={getRowKey(e, i)}
              entry={e}
              rowKey={getRowKey(e, entries.indexOf(e))}
              section={undefined}
              fixPending={fixPending}
              styles={styles}
              pendingLevels={pendingLevels}
              setPendingLevels={setPendingLevels}
              onActivateSection={onActivateSection}
              onAcceptExtra={onAcceptExtra}
              onMarkFalseHeading={onMarkFalseHeading}
              onRemoveMissing={onRemoveMissing}
              onApplyLevel={onApplyLevel}
            />
          ))}
        </div>
      )}

      {extra.length > 0 && (
        <div className={styles.group}>
          <Text className={styles.groupHeader} size={200}>
            Лишних ({extra.length})
          </Text>
          {extra.map((e, i) => (
            <DiffRow
              key={getRowKey(e, i)}
              entry={e}
              rowKey={getRowKey(e, entries.indexOf(e))}
              section={resolveSection(e)}
              fixPending={fixPending}
              styles={styles}
              pendingLevels={pendingLevels}
              setPendingLevels={setPendingLevels}
              onActivateSection={onActivateSection}
              onAcceptExtra={onAcceptExtra}
              onMarkFalseHeading={onMarkFalseHeading}
              onRemoveMissing={onRemoveMissing}
              onApplyLevel={onApplyLevel}
            />
          ))}
        </div>
      )}

      {wrongLevel.length > 0 && (
        <div className={styles.group}>
          <Text className={styles.groupHeader} size={200}>
            Неверный уровень ({wrongLevel.length})
          </Text>
          {wrongLevel.map((e, i) => (
            <DiffRow
              key={getRowKey(e, i)}
              entry={e}
              rowKey={getRowKey(e, entries.indexOf(e))}
              section={resolveSection(e)}
              fixPending={fixPending}
              styles={styles}
              pendingLevels={pendingLevels}
              setPendingLevels={setPendingLevels}
              onActivateSection={onActivateSection}
              onAcceptExtra={onAcceptExtra}
              onMarkFalseHeading={onMarkFalseHeading}
              onRemoveMissing={onRemoveMissing}
              onApplyLevel={onApplyLevel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  entry: DiffEntry;
  rowKey: string;
  section: Section | undefined;
  fixPending: boolean;
  styles: ReturnType<typeof useStyles>;
  pendingLevels: Map<string, number>;
  setPendingLevels: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  onActivateSection: (section: Section) => void;
  onAcceptExtra: (sectionId: string, sectionTitle: string, level: number) => void;
  onMarkFalseHeading: (sectionId: string) => void;
  onRemoveMissing: (sectionTitle: string) => void;
  onApplyLevel: (sectionTitle: string, newLevel: number) => void;
}

function DiffRow({
  entry: e,
  rowKey,
  section,
  fixPending,
  styles,
  pendingLevels,
  setPendingLevels,
  onActivateSection,
  onAcceptExtra,
  onMarkFalseHeading,
  onRemoveMissing,
  onApplyLevel,
}: RowProps) {
  const rowClass =
    e.type === "missing"
      ? styles.rowMissing
      : e.type === "extra"
        ? styles.rowExtra
        : styles.rowWrongLevel;

  const handleRowClick = () => {
    if (section) onActivateSection(section);
  };

  // Stop propagation на кнопках, чтобы клик не ушёл в onActivateSection
  // (иначе Word скроллит на каждом quick-fix действии — раздражает).
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className={`${styles.row} ${rowClass}`} onClick={handleRowClick}>
      <div className={styles.rowHeader}>
        <Text className={styles.rowTitle} title={e.sectionTitle}>
          {e.sectionTitle || "(без названия)"}
        </Text>
      </div>

      {e.type === "wrong_level" && e.expected && e.actual && (
        <div className={styles.detail}>
          ожидался L{e.expected.level}, получен L{e.actual.level}
        </div>
      )}
      {e.type === "extra" && e.actual && (
        <div className={styles.detail}>L{e.actual.level} в документе, нет в эталоне</div>
      )}
      {e.type === "missing" && e.expected && (
        <div className={styles.detail}>
          ожидался L{e.expected.level}, нет в документе
        </div>
      )}

      <div className={styles.actions} onClick={stop}>
        {e.type === "extra" && section && (
          <>
            <Button
              size="small"
              appearance="primary"
              icon={<CheckmarkCircle20Regular />}
              disabled={fixPending}
              onClick={() => onAcceptExtra(section.id, e.sectionTitle, section.level)}
              title="Добавить запись в эталон (expected_results)"
            >
              Принять в эталон
            </Button>
            <Button
              size="small"
              appearance="secondary"
              icon={<EyeOff20Regular />}
              disabled={fixPending}
              onClick={() => onMarkFalseHeading(section.id)}
              title="Пометить секцию как ложный заголовок"
            >
              Не заголовок
            </Button>
          </>
        )}

        {e.type === "missing" && (
          <Button
            size="small"
            appearance="primary"
            disabled={fixPending}
            onClick={() => onRemoveMissing(e.sectionTitle)}
            title="Удалить запись из эталона"
          >
            Удалить из эталона
          </Button>
        )}

        {e.type === "wrong_level" && e.actual && e.expected && (
          <>
            <Dropdown
              size="small"
              className={styles.levelDropdown}
              value={`Уровень ${(pendingLevels.get(rowKey) ?? e.actual.level) + 1}`}
              selectedOptions={[String(pendingLevels.get(rowKey) ?? e.actual.level)]}
              onOptionSelect={(_, d) => {
                const v = Number(d.optionValue);
                if (!Number.isFinite(v)) return;
                setPendingLevels((prev) => {
                  const next = new Map(prev);
                  next.set(rowKey, v);
                  return next;
                });
              }}
            >
              {[0, 1, 2, 3, 4, 5].map((lvl) => (
                <Option key={lvl} value={String(lvl)} text={`Уровень ${lvl + 1}`}>
                  Уровень {lvl + 1}
                </Option>
              ))}
            </Dropdown>
            <Button
              size="small"
              appearance="primary"
              icon={<ArrowRight20Regular />}
              disabled={fixPending}
              onClick={() =>
                onApplyLevel(
                  e.sectionTitle,
                  pendingLevels.get(rowKey) ?? e.actual!.level,
                )
              }
              title="Обновить уровень в эталоне"
            >
              Применить
            </Button>
          </>
        )}

        {fixPending && <Spinner size="tiny" />}
      </div>
    </div>
  );
}
