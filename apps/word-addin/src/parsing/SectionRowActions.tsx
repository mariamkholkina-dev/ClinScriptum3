import React, { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Spinner,
  Text,
  Textarea,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  Comment20Regular,
  CommentEdit20Regular,
  Delete20Regular,
  Eye20Regular,
  EyeOff20Regular,
  TextIndentDecrease20Regular,
  TextIndentIncrease20Regular,
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
  pending: boolean;
  onToggleFalseHeading: () => void;
  /** Сохранить новый structureComment (status оставить тем же). */
  onUpdateComment: (newComment: string) => Promise<void>;
  /** Удалить вручную добавленный раздел (только если section.isManual). */
  onDeleteManual?: () => Promise<void>;
  /** Indent (level +1) — делает секцию подзаголовком предыдущего раздела. */
  onIndent: () => void;
  /** Outdent (level -1) — поднимает уровень секции на ступень выше. */
  onOutdent: () => void;
  canIndent: boolean;
  canOutdent: boolean;
  levelChangePending: boolean;
}

/**
 * Per-section actions: переключить флаг ложного заголовка, посмотреть/редактировать
 * structureComment, удалить вручную добавленный раздел.
 *
 * Comment-flow:
 *  - Если есть structureComment — отображаем popover-просмотр (💬) + кнопку
 *    редактирования (✏ CommentEdit) которая открывает диалог с textarea.
 *  - Если comment отсутствует — показываем только кнопку «✏» для добавления
 *    комментария без перевода в requires_rework через bulk-actions.
 *
 * Delete-flow:
 *  - Кнопка-корзина показывается только при section.isManual=true.
 *  - Confirm через Dialog → onDeleteManual.
 */
export function SectionRowActions({
  section,
  pending,
  onToggleFalseHeading,
  onUpdateComment,
  onDeleteManual,
  onIndent,
  onOutdent,
  canIndent,
  canOutdent,
  levelChangePending,
}: Props) {
  const styles = useStyles();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isFalse = section.isFalseHeading;

  useEffect(() => {
    if (editOpen) setDraft(section.structureComment ?? "");
  }, [editOpen, section.structureComment]);

  const handleSaveComment = async () => {
    setSavingComment(true);
    try {
      await onUpdateComment(draft.trim());
      setEditOpen(false);
    } finally {
      setSavingComment(false);
    }
  };

  const handleDelete = async () => {
    if (!onDeleteManual) return;
    setDeleting(true);
    try {
      await onDeleteManual();
      setConfirmDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  };

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
        content={section.structureComment ? "Редактировать комментарий" : "Добавить комментарий"}
        relationship="label"
      >
        <Button
          size="small"
          appearance="subtle"
          icon={<CommentEdit20Regular />}
          onClick={() => setEditOpen(true)}
          disabled={pending}
          aria-label="Редактировать комментарий"
        />
      </Tooltip>

      <Tooltip content="Поднять уровень выше" relationship="label">
        <Button
          size="small"
          appearance="subtle"
          icon={<TextIndentDecrease20Regular />}
          onClick={onOutdent}
          disabled={!canOutdent || levelChangePending || pending}
          aria-label="Поднять уровень секции"
        />
      </Tooltip>

      <Tooltip content="Сделать подзаголовком" relationship="label">
        <Button
          size="small"
          appearance="subtle"
          icon={<TextIndentIncrease20Regular />}
          onClick={onIndent}
          disabled={!canIndent || levelChangePending || pending}
          aria-label="Сделать секцию подзаголовком"
        />
      </Tooltip>

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

      {section.isManual && onDeleteManual && (
        <Tooltip content="Удалить вручную добавленный раздел" relationship="label">
          <Button
            size="small"
            appearance="subtle"
            icon={<Delete20Regular />}
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={pending}
            aria-label="Удалить раздел"
          />
        </Tooltip>
      )}

      <Dialog open={editOpen} onOpenChange={(_, d) => !d.open && setEditOpen(false)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {section.structureComment ? "Редактировать комментарий" : "Добавить комментарий"}
            </DialogTitle>
            <DialogContent>
              <Field label="Комментарий к разделу">
                <Textarea
                  value={draft}
                  onChange={(_, d) => setDraft(d.value)}
                  rows={5}
                  resize="vertical"
                  placeholder="Опишите, что именно нужно исправить или прокомментировать..."
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() => setEditOpen(false)}
                disabled={savingComment}
              >
                Отмена
              </Button>
              <Button
                appearance="primary"
                onClick={() => void handleSaveComment()}
                disabled={savingComment}
              >
                {savingComment ? <Spinner size="tiny" /> : "Сохранить"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={confirmDeleteOpen}
        onOpenChange={(_, d) => !d.open && setConfirmDeleteOpen(false)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Удалить раздел</DialogTitle>
            <DialogContent>
              <Text>
                Удалить вручную добавленный раздел «{section.title || "(без названия)"}»? Это
                действие нельзя отменить.
              </Text>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={deleting}
              >
                Отмена
              </Button>
              <Button
                appearance="primary"
                onClick={() => void handleDelete()}
                disabled={deleting}
              >
                {deleting ? <Spinner size="tiny" /> : "Удалить"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
