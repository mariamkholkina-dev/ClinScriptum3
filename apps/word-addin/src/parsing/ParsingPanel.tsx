import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  Spinner,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { SelectTabData, SelectTabEvent } from "@fluentui/react-components";
import { ArrowSync20Regular } from "@fluentui/react-icons";
import { trpcCall } from "../api";
import { jumpToTextInWord } from "../office-helpers";
import { SectionTree } from "./SectionTree";
import { BulkActionsBar } from "./BulkActionsBar";
import { DiffPanel } from "./DiffPanel";
import { diffWithExpected, type DiffEntry } from "./diffWithExpected";
import type { DocumentVersionResponse, Section } from "./types";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
  },
  header: {
    padding: "10px 12px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  title: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  empty: {
    padding: "32px 16px",
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  feedback: {
    padding: "4px 12px",
  },
  tabs: {
    paddingLeft: "8px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

interface Props {
  docVersionId: string;
  goldenSampleId?: string;
}

type ActiveTab = "tree" | "diff";

interface GoldenSampleResponse {
  id: string;
  stageStatuses: Array<{
    stage: string;
    status: "draft" | "in_review" | "approved" | "not_set";
    expectedResults: Record<string, unknown> | null;
  }>;
}

const STAGE_KEY = "parsing";

/**
 * Главная панель режима 'parsing' в Word add-in.
 *
 * Загружает sections через `document.getVersion`, рендерит дерево, обрабатывает
 * клик-навигацию в Word (highlight по textSnippet первого contentBlock или title)
 * и bulk-операции по выделенным секциям.
 *
 * Если передан `goldenSampleId` — также грузит эталон через `goldenDataset.getSample`
 * и показывает таб «Diff с эталоном» с порталом diff и quick-fix actions:
 *  - extra → принять в эталон / пометить ложным заголовком
 *  - missing → удалить из эталона
 *  - wrong_level → применить выбранный уровень в эталон
 *
 * Quick-fix действия мутируют:
 *  - markSectionFalseHeading → флаг на секции
 *  - updateStageStatus → expected_results JSON у golden sample
 */
export function ParsingPanel({ docVersionId, goldenSampleId }: Props) {
  const styles = useStyles();
  const [data, setData] = useState<DocumentVersionResponse | null>(null);
  const [goldenSample, setGoldenSample] = useState<GoldenSampleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [togglingFalseHeadingId, setTogglingFalseHeadingId] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [diffFixPending, setDiffFixPending] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("tree");
  const [feedback, setFeedback] = useState<{ kind: "success" | "warning" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [versionRes, sampleRes] = await Promise.all([
        trpcCall<DocumentVersionResponse>("document.getVersion", {
          versionId: docVersionId,
        }),
        goldenSampleId
          ? trpcCall<GoldenSampleResponse>("goldenDataset.getSample", { id: goldenSampleId }).catch(
              () => null,
            )
          : Promise.resolve(null),
      ]);
      setData(versionRes);
      setGoldenSample(sampleRes);
    } catch (e) {
      setError((e as Error).message ?? "Ошибка загрузки документа");
    } finally {
      setLoading(false);
    }
  }, [docVersionId, goldenSampleId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-clear feedback через 4 секунды.
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  const sections = useMemo<Section[]>(() => data?.sections ?? [], [data]);

  // Existing structureComment у одной из выделенных — pre-fill rework dialog.
  const existingReworkComment = useMemo(() => {
    for (const s of sections) {
      if (selectedIds.has(s.id) && s.structureComment) return s.structureComment;
    }
    return undefined;
  }, [sections, selectedIds]);

  // Достаём expectedResults для парсинг-стадии. Если стадии нет — null
  // (таб «Diff» в этом случае показывает empty-state).
  const parsingStage = useMemo(
    () => goldenSample?.stageStatuses.find((s) => s.stage === STAGE_KEY) ?? null,
    [goldenSample],
  );
  const expectedResults = parsingStage?.expectedResults ?? null;
  const stageStatus = parsingStage?.status ?? "draft";

  const hasExpected = useMemo(() => {
    if (!expectedResults || typeof expectedResults !== "object") return false;
    const arr = (expectedResults as Record<string, unknown>).sections;
    return Array.isArray(arr);
  }, [expectedResults]);

  const diffEntries: DiffEntry[] = useMemo(
    () => (hasExpected ? diffWithExpected(sections, expectedResults) : []),
    [hasExpected, sections, expectedResults],
  );

  // Map sectionId → diff type для подсветки строк в дереве.
  const diffMap = useMemo(() => {
    const m = new Map<string, "extra" | "wrong_level">();
    for (const e of diffEntries) {
      if (!e.actualSectionId) continue;
      if (e.type === "extra" || e.type === "wrong_level") {
        m.set(e.actualSectionId, e.type);
      }
    }
    return m;
  }, [diffEntries]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleActivateSection = useCallback(async (section: Section) => {
    setActiveSectionId(section.id);
    const snippet =
      section.sourceAnchor?.textSnippet ??
      section.contentBlocks[0]?.content ??
      section.title;
    if (!snippet || snippet.trim().length === 0) return;
    try {
      const found = await jumpToTextInWord(snippet);
      if (!found) {
        setFeedback({
          kind: "warning",
          text: "Не удалось найти раздел в документе.",
        });
      }
    } catch {
      // Игнорируем — пользователь мог открыть add-in вне Word (preview-режим).
    }
  }, []);

  const handleToggleFalseHeading = useCallback(
    async (section: Section) => {
      setTogglingFalseHeadingId(section.id);
      try {
        await trpcCall(
          "document.markSectionFalseHeading",
          { sectionId: section.id, isFalseHeading: !section.isFalseHeading },
          "mutation",
        );
        await load();
      } catch (e) {
        setFeedback({ kind: "error", text: (e as Error).message ?? "Не удалось сохранить" });
      } finally {
        setTogglingFalseHeadingId(null);
      }
    },
    [load],
  );

  const handleBulkValidate = useCallback(async () => {
    if (selectedIds.size === 0) return;
    setBulkPending(true);
    try {
      await trpcCall(
        "processing.bulkUpdateSectionStructureStatus",
        {
          sectionIds: Array.from(selectedIds),
          status: "validated",
        },
        "mutation",
      );
      setSelectedIds(new Set());
      await load();
      setFeedback({ kind: "success", text: "Секции подтверждены" });
    } catch (e) {
      setFeedback({ kind: "error", text: (e as Error).message ?? "Не удалось сохранить" });
    } finally {
      setBulkPending(false);
    }
  }, [selectedIds, load]);

  const handleBulkRework = useCallback(
    async (comment?: string) => {
      if (selectedIds.size === 0) return;
      setBulkPending(true);
      try {
        await trpcCall(
          "processing.bulkUpdateSectionStructureStatus",
          {
            sectionIds: Array.from(selectedIds),
            status: "requires_rework",
            ...(comment ? { structureComment: comment } : {}),
          },
          "mutation",
        );
        setSelectedIds(new Set());
        await load();
        setFeedback({ kind: "success", text: "Секции отправлены на доработку" });
      } catch (e) {
        setFeedback({ kind: "error", text: (e as Error).message ?? "Не удалось сохранить" });
      } finally {
        setBulkPending(false);
      }
    },
    [selectedIds, load],
  );

  // Обновить expectedResults через goldenDataset.updateStageStatus.
  // Принимаем заранее посчитанный nextSections, делаем PUT с тем же status
  // (status='not_set' → 'draft', иначе сохраняем текущий).
  const updateExpectedSections = useCallback(
    async (nextSections: Array<Record<string, unknown>>): Promise<void> => {
      if (!goldenSampleId) return;
      const current = (expectedResults as Record<string, unknown> | null) ?? {};
      const safeStatus = stageStatus === "not_set" ? "draft" : stageStatus;
      await trpcCall(
        "goldenDataset.updateStageStatus",
        {
          goldenSampleId,
          stage: STAGE_KEY,
          status: safeStatus,
          expectedResults: { ...current, sections: nextSections },
        },
        "mutation",
      );
    },
    [goldenSampleId, expectedResults, stageStatus],
  );

  // Получить текущий expected.sections в виде массива (с защитой от не-массива).
  const getCurrentExpectedSections = useCallback((): Array<Record<string, unknown>> => {
    const current = (expectedResults as { sections?: unknown } | null) ?? {};
    return Array.isArray(current.sections)
      ? ([...current.sections] as Array<Record<string, unknown>>)
      : [];
  }, [expectedResults]);

  // Найти индекс записи в expected.sections по title (case-insensitive).
  const findExpectedIndex = useCallback(
    (sectionsArr: Array<Record<string, unknown>>, title: string): number => {
      const lower = title.trim().toLowerCase();
      return sectionsArr.findIndex(
        (s) => String(s.title ?? "").trim().toLowerCase() === lower,
      );
    },
    [],
  );

  /* ── Quick-fix actions для diff entries ──
   *
   * Все правят expected_results через updateStageStatus, кроме mark_false_heading
   * (правит флаг на самой секции).
   */

  const handleAcceptExtra = useCallback(
    async (sectionId: string, sectionTitle: string, level: number) => {
      if (!goldenSampleId) {
        setFeedback({ kind: "warning", text: "Эталон не привязан — нельзя править expected_results." });
        return;
      }
      setDiffFixPending(true);
      try {
        const arr = getCurrentExpectedSections();
        const idx = findExpectedIndex(arr, sectionTitle);
        const next =
          idx >= 0
            ? arr.map((s, i) => (i === idx ? { ...s, title: sectionTitle, level } : s))
            : [...arr, { title: sectionTitle, level }];
        await updateExpectedSections(next);
        await load();
        setFeedback({ kind: "success", text: "Запись добавлена в эталон" });
      } catch (e) {
        setFeedback({ kind: "error", text: (e as Error).message ?? "Не удалось обновить эталон" });
      } finally {
        setDiffFixPending(false);
      }
    },
    [goldenSampleId, getCurrentExpectedSections, findExpectedIndex, updateExpectedSections, load],
  );

  const handleMarkFalseHeading = useCallback(
    async (sectionId: string) => {
      setDiffFixPending(true);
      try {
        await trpcCall(
          "document.markSectionFalseHeading",
          { sectionId, isFalseHeading: true },
          "mutation",
        );
        await load();
        setFeedback({ kind: "success", text: "Секция помечена как ложный заголовок" });
      } catch (e) {
        setFeedback({ kind: "error", text: (e as Error).message ?? "Не удалось сохранить" });
      } finally {
        setDiffFixPending(false);
      }
    },
    [load],
  );

  const handleRemoveMissing = useCallback(
    async (sectionTitle: string) => {
      if (!goldenSampleId) {
        setFeedback({ kind: "warning", text: "Эталон не привязан — нельзя править expected_results." });
        return;
      }
      setDiffFixPending(true);
      try {
        const arr = getCurrentExpectedSections();
        const idx = findExpectedIndex(arr, sectionTitle);
        if (idx < 0) {
          setFeedback({ kind: "warning", text: "Запись не найдена в эталоне." });
          return;
        }
        const next = arr.filter((_, i) => i !== idx);
        await updateExpectedSections(next);
        await load();
        setFeedback({ kind: "success", text: "Запись удалена из эталона" });
      } catch (e) {
        setFeedback({ kind: "error", text: (e as Error).message ?? "Не удалось обновить эталон" });
      } finally {
        setDiffFixPending(false);
      }
    },
    [goldenSampleId, getCurrentExpectedSections, findExpectedIndex, updateExpectedSections, load],
  );

  const handleApplyLevel = useCallback(
    async (sectionTitle: string, newLevel: number) => {
      if (!goldenSampleId) {
        setFeedback({ kind: "warning", text: "Эталон не привязан — нельзя править expected_results." });
        return;
      }
      setDiffFixPending(true);
      try {
        const arr = getCurrentExpectedSections();
        const idx = findExpectedIndex(arr, sectionTitle);
        if (idx < 0) {
          setFeedback({ kind: "warning", text: "Запись не найдена в эталоне." });
          return;
        }
        const next = arr.map((s, i) => (i === idx ? { ...s, level: newLevel } : s));
        await updateExpectedSections(next);
        await load();
        setFeedback({ kind: "success", text: "Уровень в эталоне обновлён" });
      } catch (e) {
        setFeedback({ kind: "error", text: (e as Error).message ?? "Не удалось обновить эталон" });
      } finally {
        setDiffFixPending(false);
      }
    },
    [goldenSampleId, getCurrentExpectedSections, findExpectedIndex, updateExpectedSections, load],
  );

  if (error) {
    return (
      <div className={styles.empty}>
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
        <Button style={{ marginTop: 12 }} onClick={() => void load()} icon={<ArrowSync20Regular />}>
          Повторить
        </Button>
      </div>
    );
  }

  // Tab «Diff» доступен только если передан goldenSampleId. Если goldenSample
  // загрузился, но parsing-стадии в нём нет — таб остаётся, но содержимое
  // покажет empty-state «Эталон не задан» (полезнее чем скрывать).
  const showDiffTab = !!goldenSampleId;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.title}>
          <Text weight="semibold" size={300}>
            Парсинг и разметка
          </Text>
          {data && (
            <Text size={200} block style={{ color: tokens.colorNeutralForeground3 }}>
              {data.document.title} —{" "}
              {data.versionLabel ?? `v${data.versionNumber}`}
            </Text>
          )}
        </div>
        <Badge size="small" appearance="outline" title="Всего секций">
          {sections.length}
        </Badge>
        <Button
          size="small"
          appearance="subtle"
          icon={<ArrowSync20Regular />}
          onClick={() => void load()}
          disabled={loading}
          title="Обновить"
          aria-label="Обновить"
        />
      </div>

      {goldenSampleId && (
        <div className={styles.feedback}>
          <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
            Эталон: {goldenSampleId.slice(0, 8)}…
          </Text>
        </div>
      )}

      {feedback && (
        <div className={styles.feedback}>
          <MessageBar
            intent={
              feedback.kind === "error"
                ? "error"
                : feedback.kind === "warning"
                  ? "warning"
                  : "success"
            }
          >
            <MessageBarBody>{feedback.text}</MessageBarBody>
          </MessageBar>
        </div>
      )}

      {showDiffTab && (
        <div className={styles.tabs}>
          <TabList
            size="small"
            selectedValue={activeTab}
            onTabSelect={(_: SelectTabEvent, d: SelectTabData) =>
              setActiveTab(d.value as ActiveTab)
            }
          >
            <Tab value="tree">Дерево</Tab>
            <Tab value="diff">
              Diff с эталоном
              {hasExpected && diffEntries.length > 0 && (
                <Badge
                  size="small"
                  appearance="filled"
                  color="danger"
                  style={{ marginLeft: 6 }}
                >
                  {diffEntries.length}
                </Badge>
              )}
            </Tab>
          </TabList>
        </div>
      )}

      <div className={styles.body}>
        {loading && !data ? (
          <div className={styles.empty}>
            <Spinner label="Загрузка структуры..." />
          </div>
        ) : activeTab === "diff" && showDiffTab ? (
          <DiffPanel
            entries={diffEntries}
            sections={sections}
            hasExpected={hasExpected}
            fixPending={diffFixPending}
            onActivateSection={(s) => void handleActivateSection(s)}
            onAcceptExtra={(id, t, l) => void handleAcceptExtra(id, t, l)}
            onMarkFalseHeading={(id) => void handleMarkFalseHeading(id)}
            onRemoveMissing={(t) => void handleRemoveMissing(t)}
            onApplyLevel={(t, l) => void handleApplyLevel(t, l)}
          />
        ) : (
          <SectionTree
            sections={sections}
            loading={false}
            selectedIds={selectedIds}
            activeSectionId={activeSectionId}
            onToggleSelect={handleToggleSelect}
            onActivateSection={(s) => void handleActivateSection(s)}
            onToggleFalseHeading={(s) => void handleToggleFalseHeading(s)}
            togglingFalseHeadingId={togglingFalseHeadingId}
            diffTypeBySectionId={hasExpected ? diffMap : undefined}
          />
        )}
      </div>

      {/* Bulk-actions показываем только на дереве — на diff табе они нерелевантны. */}
      {activeTab === "tree" && (
        <BulkActionsBar
          selectedCount={selectedIds.size}
          pending={bulkPending}
          existingReworkComment={existingReworkComment}
          onValidate={() => void handleBulkValidate()}
          onRework={(comment) => void handleBulkRework(comment)}
          onClearSelection={() => setSelectedIds(new Set())}
        />
      )}
    </div>
  );
}
