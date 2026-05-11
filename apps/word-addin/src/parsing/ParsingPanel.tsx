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
import { Add20Regular, ArrowLeft20Regular, ArrowSync20Regular } from "@fluentui/react-icons";
import { trpcCall } from "../api";
import { getSelectionContext, selectSection } from "../office-helpers";
import { SectionTree } from "./SectionTree";
import { BulkActionsBar } from "./BulkActionsBar";
import { AddManualSectionDialog, type AddManualSectionInput } from "./AddManualSectionDialog";
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
    padding: "8px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  headerTopRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  headerBottomRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  docTitle: {
    flex: 1,
    minWidth: 0,
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  tabBar: {
    padding: "0 8px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
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
  tabBadge: {
    marginLeft: "6px",
  },
});

interface Props {
  docVersionId: string;
  goldenSampleId?: string;
  /** Возврат в ManualModeSelector (выбор операции/документа). */
  onBack?: () => void;
}

/** Минимальный shape ответа `goldenDataset.getSample`, нужный для diff overlay.
 *  Полный тип сидит в API, в word-addin мы строго типизируем только те поля,
 *  которые реально читаем (см. также комментарий в ./types.ts). */
interface GoldenSampleResponse {
  id: string;
  stageStatuses: Array<{
    stage: string;
    status: "draft" | "in_review" | "approved" | string;
    expectedResults: unknown;
  }>;
}

const PARSING_STAGE_KEY = "parsing";

type TabKey = "tree" | "diff";

/**
 * Главная панель режима 'parsing' в Word add-in.
 *
 * Загружает sections через `document.getVersion`, рендерит дерево, обрабатывает
 * клик-навигацию в Word (highlight по textSnippet первого contentBlock или title)
 * и bulk-операции по выделенным секциям. Mutations:
 *  - markSectionFalseHeading — переключить ложный заголовок
 *  - bulkUpdateSectionStructureStatus — bulk validated / requires_rework + comment
 *  - addManualSection / deleteManualSection — ручные секции (PR 3)
 *  - goldenDataset.updateStageStatus — quick-fix правки эталона из Diff overlay (PR 4)
 *
 * Refetch после каждой mutation; UI оптимизмом не управляет — для add-in это
 * приемлемо (мало секций, операции редки). При необходимости позже добавим
 * оптимистичные апдейты как в rule-admin.
 *
 * Tab integration (PR 4):
 *  - «Дерево» — существующий SectionTree + BulkActions + кнопка «+ Добавить»
 *  - «Diff с эталоном» — виден только при `goldenSampleId`, рендерит DiffPanel.
 *    BulkActions и кнопка «+ Добавить» скрыты на этом табе.
 */
export function ParsingPanel({ docVersionId, goldenSampleId, onBack }: Props) {
  const styles = useStyles();
  const [data, setData] = useState<DocumentVersionResponse | null>(null);
  const [goldenSample, setGoldenSample] = useState<GoldenSampleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [togglingFalseHeadingId, setTogglingFalseHeadingId] = useState<string | null>(null);
  const [quickValidatingId, setQuickValidatingId] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "warning" | "error"; text: string } | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addPending, setAddPending] = useState(false);
  const [diffFixPending, setDiffFixPending] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("tree");
  const [selectionContext, setSelectionContext] = useState<{
    text: string;
    paragraphIndex: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Параллельная загрузка structure + golden sample (если есть). Если нет
      // golden sample — второй вызов skip'аем, но в любом случае don't fail
      // overall load если golden fetch упадёт (не блокирующая фича).
      const [versionRes, goldenRes] = await Promise.all([
        trpcCall<DocumentVersionResponse>("document.getVersion", { versionId: docVersionId }),
        goldenSampleId
          ? trpcCall<GoldenSampleResponse>("goldenDataset.getSample", { id: goldenSampleId }).catch(
              (e) => {
                // eslint-disable-next-line no-console
                console.warn("[ParsingPanel] goldenDataset.getSample failed", e);
                return null;
              },
            )
          : Promise.resolve(null),
      ]);
      setData(versionRes);
      setGoldenSample(goldenRes);
    } catch (e) {
      setError((e as Error).message ?? "Ошибка загрузки документа");
    } finally {
      setLoading(false);
    }
  }, [docVersionId, goldenSampleId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-clear feedback через 4 секунды — чтобы UI не накапливал устаревшие сообщения.
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  const sections = useMemo<Section[]>(() => data?.sections ?? [], [data]);

  // Stage status для parsing — ищем в stageStatuses[]; если эталон не настроен
  // (status='not_set' / эталон без stageStatuses[parsing]) — будем считать draft.
  const parsingStageStatus = useMemo(() => {
    return goldenSample?.stageStatuses.find((s) => s.stage === PARSING_STAGE_KEY);
  }, [goldenSample]);

  const expectedResults = parsingStageStatus?.expectedResults;

  const diffEntries = useMemo<DiffEntry[]>(
    () => diffWithExpected(sections, expectedResults),
    [sections, expectedResults],
  );

  // Map для подсветки строк в SectionTree, привязанных к diff. Только для extra
  // и wrong_level — у missing нет реальной секции в БД.
  const diffTypeBySectionId = useMemo<Map<string, "extra" | "wrong_level">>(() => {
    const m = new Map<string, "extra" | "wrong_level">();
    for (const e of diffEntries) {
      if ((e.type === "extra" || e.type === "wrong_level") && e.actualSectionId) {
        m.set(e.actualSectionId, e.type);
      }
    }
    return m;
  }, [diffEntries]);

  // Tab «Diff» виден только при наличии goldenSampleId. Если эталон ушёл —
  // активный таб переключаем обратно на дерево.
  useEffect(() => {
    if (!goldenSampleId && activeTab === "diff") setActiveTab("tree");
  }, [goldenSampleId, activeTab]);

  // Существующий structureComment у одной из выделенных — pre-fill rework dialog.
  const existingReworkComment = useMemo(() => {
    for (const s of sections) {
      if (selectedIds.has(s.id) && s.structureComment) return s.structureComment;
    }
    return undefined;
  }, [sections, selectedIds]);

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

    // Все стратегии (сброс прошлой жёлтой подсветки + heading-aware +
    // textSnippet + paragraphIndex + fallback) выполняются в одном
    // Word.run с одним ctx.sync — это сокращает задержку клик→jump
    // примерно в 2 раза против цепочки отдельных Word.run'ов.
    try {
      const ok = await selectSection({
        title: section.title,
        textSnippet: section.sourceAnchor?.textSnippet ?? undefined,
        paragraphIndex: section.sourceAnchor?.paragraphIndex,
        fallbackText: section.contentBlocks[0]?.content ?? section.title,
      });
      if (!ok) {
        setFeedback({
          kind: "warning",
          text: "Не удалось найти раздел в документе.",
        });
      }
    } catch {
      // Игнорируем — пользователь мог открыть add-in вне Word (preview-режим).
    }
  }, []);

  const handleJumpToSectionById = useCallback(
    (sectionId: string) => {
      const section = sections.find((s) => s.id === sectionId);
      if (section) void handleActivateSection(section);
    },
    [sections, handleActivateSection],
  );

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

  const handleQuickValidate = useCallback(
    async (section: Section) => {
      if (section.structureStatus === "validated") return;
      setQuickValidatingId(section.id);
      try {
        await trpcCall(
          "processing.bulkUpdateSectionStructureStatus",
          { sectionIds: [section.id], status: "validated" },
          "mutation",
        );
        await load();

        // После refetch найти следующую неподтверждённую (по order) и активировать.
        // Используем sections, которые загрузились этим load() — но state ещё не
        // обновлён. Поэтому берём из ответа load() через getVersion ещё раз:
        // упростим — на следующем рендере activeSectionId сбросится после
        // useEffect-сравнения; но мы сразу хотим перейти, поэтому выполним поиск
        // прямо в последнем известном `data.sections`. Это не на 100% свежий
        // список, но статус только что подтверждён — следующая not_validated
        // не изменилась.
        const fresh = await trpcCall<DocumentVersionResponse>("document.getVersion", {
          versionId: docVersionId,
        });
        setData(fresh);
        const ordered = [...fresh.sections].sort((a, b) => a.order - b.order);
        const currentIdx = ordered.findIndex((s) => s.id === section.id);
        const next = ordered
          .slice(currentIdx + 1)
          .find((s) => s.structureStatus === "not_validated" && !s.isFalseHeading);
        if (next) {
          await handleActivateSection(next);
        }
      } catch (e) {
        setFeedback({ kind: "error", text: (e as Error).message ?? "Не удалось сохранить" });
      } finally {
        setQuickValidatingId(null);
      }
    },
    [docVersionId, load, handleActivateSection],
  );

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(sections.map((s) => s.id)));
  }, [sections]);

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

  const handleOpenAddDialog = useCallback(async () => {
    // Пробуем взять текущее выделение из Word. Если ничего не выделено —
    // показываем уведомление и не открываем диалог; пользователь всё ещё может
    // открыть его без выделения и выбрать "после раздела X" (но мы предпочитаем
    // быстрый flow «выделил → нажал»).
    try {
      const ctx = await getSelectionContext();
      if (!ctx) {
        setFeedback({
          kind: "warning",
          text: "Выделите текст в документе или откройте диалог из меню.",
        });
        setSelectionContext(null);
        setAddDialogOpen(true);
        return;
      }
      setSelectionContext(ctx);
      setAddDialogOpen(true);
    } catch {
      setSelectionContext(null);
      setAddDialogOpen(true);
    }
  }, []);

  const handleAddManualSubmit = useCallback(
    async (input: AddManualSectionInput) => {
      setAddPending(true);
      try {
        await trpcCall(
          "document.addManualSection",
          { docVersionId, ...input },
          "mutation",
        );
        setAddDialogOpen(false);
        setSelectionContext(null);
        await load();
        setFeedback({ kind: "success", text: "Раздел добавлен" });
      } catch (e) {
        setFeedback({ kind: "error", text: (e as Error).message ?? "Не удалось добавить раздел" });
      } finally {
        setAddPending(false);
      }
    },
    [docVersionId, load],
  );

  const handleDeleteManual = useCallback(
    async (section: Section) => {
      try {
        await trpcCall(
          "document.deleteManualSection",
          { sectionId: section.id },
          "mutation",
        );
        await load();
        setFeedback({ kind: "success", text: "Раздел удалён" });
      } catch (e) {
        setFeedback({ kind: "error", text: (e as Error).message ?? "Не удалось удалить раздел" });
        throw e;
      }
    },
    [load],
  );

  const handleUpdateComment = useCallback(
    async (section: Section, newComment: string) => {
      try {
        await trpcCall(
          "processing.bulkUpdateSectionStructureStatus",
          {
            sectionIds: [section.id],
            status: section.structureStatus,
            structureComment: newComment,
          },
          "mutation",
        );
        await load();
        setFeedback({ kind: "success", text: "Комментарий сохранён" });
      } catch (e) {
        setFeedback({ kind: "error", text: (e as Error).message ?? "Не удалось сохранить комментарий" });
        throw e;
      }
    },
    [load],
  );

  /* ────────── Diff quick-fix handlers ────────── */

  // Помощник: применить функцию-патчер к expected.sections и отправить на сервер
  // через goldenDataset.updateStageStatus. Сохраняет текущий status (или draft
  // если ещё нет stage status). Поведение совпадает с rule-admin.
  const updateExpectedSections = useCallback(
    async (
      patch: (current: Array<Record<string, unknown>>) => Array<Record<string, unknown>>,
    ) => {
      if (!goldenSampleId) return;
      const currentExpected =
        (expectedResults as { sections?: Array<Record<string, unknown>> } | undefined) ?? {};
      const sectionsArr = Array.isArray(currentExpected.sections) ? currentExpected.sections : [];
      const nextSections = patch(sectionsArr);
      const currentStatusRaw = parsingStageStatus?.status ?? "draft";
      const status: "draft" | "in_review" | "approved" =
        currentStatusRaw === "in_review" || currentStatusRaw === "approved"
          ? currentStatusRaw
          : "draft";

      setDiffFixPending(true);
      try {
        await trpcCall(
          "goldenDataset.updateStageStatus",
          {
            goldenSampleId,
            stage: PARSING_STAGE_KEY,
            status,
            expectedResults: { ...currentExpected, sections: nextSections },
          },
          "mutation",
        );
        await load();
      } catch (e) {
        setFeedback({ kind: "error", text: (e as Error).message ?? "Не удалось сохранить эталон" });
      } finally {
        setDiffFixPending(false);
      }
    },
    [goldenSampleId, expectedResults, parsingStageStatus, load],
  );

  const findExpectedIdx = (
    arr: Array<Record<string, unknown>>,
    title: string,
  ) => {
    const lower = title.trim().toLowerCase();
    return arr.findIndex(
      (s) => String(s.title ?? "").trim().toLowerCase() === lower,
    );
  };

  const handleDiffAcceptExtra = useCallback(
    async (entry: DiffEntry) => {
      if (!entry.actual) return;
      const level = entry.actual.level;
      await updateExpectedSections((current) => {
        const idx = findExpectedIdx(current, entry.sectionTitle);
        if (idx >= 0) {
          return current.map((s, i) =>
            i === idx ? { ...s, title: entry.sectionTitle, level } : s,
          );
        }
        return [...current, { title: entry.sectionTitle, level }];
      });
      setFeedback({ kind: "success", text: "Запись добавлена в эталон" });
    },
    [updateExpectedSections],
  );

  const handleDiffMarkFalseHeading = useCallback(
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

  const handleDiffRemoveMissing = useCallback(
    async (entry: DiffEntry) => {
      await updateExpectedSections((current) => {
        const idx = findExpectedIdx(current, entry.sectionTitle);
        if (idx < 0) return current;
        return current.filter((_, i) => i !== idx);
      });
      setFeedback({ kind: "success", text: "Запись удалена из эталона" });
    },
    [updateExpectedSections],
  );

  const handleDiffApplyLevel = useCallback(
    async (entry: DiffEntry, newLevel: number) => {
      await updateExpectedSections((current) => {
        const idx = findExpectedIdx(current, entry.sectionTitle);
        if (idx < 0) return current;
        return current.map((s, i) => (i === idx ? { ...s, level: newLevel } : s));
      });
      setFeedback({ kind: "success", text: "Уровень обновлён в эталоне" });
    },
    [updateExpectedSections],
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

  const showAddButton = activeTab === "tree";
  const showBulkActions = activeTab === "tree";

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTopRow}>
          {onBack && (
            <Button
              size="small"
              appearance="subtle"
              icon={<ArrowLeft20Regular />}
              onClick={onBack}
              title="Вернуться к выбору операций"
              aria-label="Назад"
            />
          )}
          <Text weight="semibold" size={300} className={styles.title}>
            Парсинг и разметка
          </Text>
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
        <div className={styles.headerBottomRow}>
          {data && (
            <Text size={200} className={styles.docTitle} title={data.document.title}>
              {data.document.title} — {data.versionLabel ?? `v${data.versionNumber}`}
            </Text>
          )}
          <Badge size="small" appearance="outline" title="Всего секций">
            {sections.length}
          </Badge>
          {showAddButton && (
            <Button
              size="small"
              appearance="subtle"
              icon={<Add20Regular />}
              onClick={() => void handleOpenAddDialog()}
              disabled={loading || addPending}
              title="Добавить раздел из выделения"
              aria-label="Добавить раздел"
            />
          )}
        </div>
      </div>

      {goldenSampleId && (
        <div className={styles.tabBar}>
          <TabList
            selectedValue={activeTab}
            onTabSelect={(_, d) => setActiveTab(d.value as TabKey)}
            size="small"
          >
            <Tab value="tree">Дерево</Tab>
            <Tab value="diff">
              Diff с эталоном
              {diffEntries.length > 0 && (
                <Badge
                  className={styles.tabBadge}
                  size="small"
                  appearance="filled"
                  color="danger"
                >
                  {diffEntries.length}
                </Badge>
              )}
            </Tab>
          </TabList>
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

      <div className={styles.body}>
        {loading && !data ? (
          <div className={styles.empty}>
            <Spinner label="Загрузка структуры..." />
          </div>
        ) : activeTab === "diff" && goldenSampleId ? (
          <DiffPanel
            entries={diffEntries}
            pending={diffFixPending}
            onJumpToSection={handleJumpToSectionById}
            onAcceptExtra={(e) => void handleDiffAcceptExtra(e)}
            onMarkFalseHeading={(id) => void handleDiffMarkFalseHeading(id)}
            onRemoveMissing={(e) => void handleDiffRemoveMissing(e)}
            onApplyLevel={(e, lvl) => void handleDiffApplyLevel(e, lvl)}
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
            onUpdateComment={handleUpdateComment}
            onDeleteManual={handleDeleteManual}
            onQuickValidate={(s) => void handleQuickValidate(s)}
            quickValidatingId={quickValidatingId}
            diffTypeBySectionId={goldenSampleId ? diffTypeBySectionId : undefined}
          />
        )}
      </div>

      {showBulkActions && (
        <BulkActionsBar
          selectedCount={selectedIds.size}
          totalCount={sections.length}
          pending={bulkPending}
          existingReworkComment={existingReworkComment}
          onValidate={() => void handleBulkValidate()}
          onRework={(comment) => void handleBulkRework(comment)}
          onClearSelection={() => setSelectedIds(new Set())}
          onSelectAll={handleSelectAll}
        />
      )}

      <AddManualSectionDialog
        open={addDialogOpen}
        selectionText={selectionContext?.text ?? null}
        selectionParagraphIndex={selectionContext?.paragraphIndex ?? null}
        sections={sections}
        pending={addPending}
        onClose={() => {
          setAddDialogOpen(false);
          setSelectionContext(null);
        }}
        onSubmit={handleAddManualSubmit}
      />
    </div>
  );
}
