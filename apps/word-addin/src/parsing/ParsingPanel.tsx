import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Add20Regular, ArrowSync20Regular } from "@fluentui/react-icons";
import { trpcCall } from "../api";
import { getSelectionContext, jumpToTextInWord } from "../office-helpers";
import { SectionTree } from "./SectionTree";
import { BulkActionsBar } from "./BulkActionsBar";
import { AddManualSectionDialog, type AddManualSectionInput } from "./AddManualSectionDialog";
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
});

interface Props {
  docVersionId: string;
  goldenSampleId?: string;
}

/**
 * Главная панель режима 'parsing' в Word add-in.
 *
 * Загружает sections через `document.getVersion`, рендерит дерево, обрабатывает
 * клик-навигацию в Word (highlight по textSnippet первого contentBlock или title)
 * и bulk-операции по выделенным секциям. Mutations:
 *  - markSectionFalseHeading — переключить ложный заголовок
 *  - bulkUpdateSectionStructureStatus — bulk validated / requires_rework + comment
 *
 * Refetch после каждой mutation; UI оптимизмом не управляет — для add-in это
 * приемлемо (мало секций, операции редки). При необходимости позже добавим
 * оптимистичные апдейты как в rule-admin.
 */
export function ParsingPanel({ docVersionId, goldenSampleId }: Props) {
  const styles = useStyles();
  const [data, setData] = useState<DocumentVersionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [togglingFalseHeadingId, setTogglingFalseHeadingId] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "warning" | "error"; text: string } | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addPending, setAddPending] = useState(false);
  const [selectionContext, setSelectionContext] = useState<{
    text: string;
    paragraphIndex: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await trpcCall<DocumentVersionResponse>("document.getVersion", {
        versionId: docVersionId,
      });
      setData(res);
    } catch (e) {
      setError((e as Error).message ?? "Ошибка загрузки документа");
    } finally {
      setLoading(false);
    }
  }, [docVersionId]);

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
    // Берём snippet из title или первого contentBlock, чтобы Word.body.search нашёл место.
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
          icon={<Add20Regular />}
          onClick={() => void handleOpenAddDialog()}
          disabled={loading || addPending}
          title="Добавить раздел из выделения"
          aria-label="Добавить раздел"
        >
          Добавить
        </Button>
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

      <div className={styles.body}>
        {loading && !data ? (
          <div className={styles.empty}>
            <Spinner label="Загрузка структуры..." />
          </div>
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
          />
        )}
      </div>

      <BulkActionsBar
        selectedCount={selectedIds.size}
        pending={bulkPending}
        existingReworkComment={existingReworkComment}
        onValidate={() => void handleBulkValidate()}
        onRework={(comment) => void handleBulkRework(comment)}
        onClearSelection={() => setSelectedIds(new Set())}
      />

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
