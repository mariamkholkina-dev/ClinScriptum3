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
  Spinner,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";

const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    backgroundColor: tokens.colorBrandBackground2,
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  count: {
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  spacer: {
    flex: 1,
  },
});

interface Props {
  selectedCount: number;
  totalCount: number;
  pending: boolean;
  /** Существующий structureComment одной из выделенных секций. Pre-fill в textarea. */
  existingReworkComment?: string;
  onValidate: () => void;
  onRework: (comment?: string) => void;
  onClearSelection: () => void;
  onSelectAll: () => void;
}

/**
 * Bulk-actions bar показывается, когда выбрана хотя бы одна секция.
 * Кнопки:
 *  - «Подтвердить» — bulk перевод в structureStatus=validated
 *  - «На доработку» — открывает диалог с textarea, при подтверждении
 *    переводит в structureStatus=requires_rework + сохраняет комментарий
 */
export function BulkActionsBar({
  selectedCount,
  totalCount,
  pending,
  existingReworkComment,
  onValidate,
  onRework,
  onClearSelection,
  onSelectAll,
}: Props) {
  const styles = useStyles();
  const [reworkOpen, setReworkOpen] = useState(false);
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (reworkOpen) {
      setComment(existingReworkComment ?? "");
    }
  }, [reworkOpen, existingReworkComment]);

  // Bar всегда виден когда totalCount > 0, даже без выделения — чтобы юзер
  // мог быстро «Выбрать всё». Без totalCount (например, до загрузки) скрываем.
  if (totalCount === 0) return null;

  const isAllSelected = selectedCount === totalCount;

  return (
    <>
      <div className={styles.root}>
        <Text className={styles.count}>
          {selectedCount > 0 ? `Выбрано: ${selectedCount}` : `Всего: ${totalCount}`}
        </Text>
        <Button
          size="small"
          appearance="primary"
          disabled={pending || selectedCount === 0}
          onClick={onValidate}
        >
          Подтвердить
        </Button>
        <Button
          size="small"
          disabled={pending || selectedCount === 0}
          onClick={() => setReworkOpen(true)}
        >
          На доработку
        </Button>
        {pending && <Spinner size="tiny" />}
        <div className={styles.spacer} />
        <Button
          size="small"
          appearance="subtle"
          disabled={pending}
          onClick={isAllSelected ? onClearSelection : onSelectAll}
        >
          {isAllSelected ? "Снять" : "Выбрать всё"}
        </Button>
      </div>

      <Dialog open={reworkOpen} onOpenChange={(_, d) => setReworkOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>На доработку</DialogTitle>
            <DialogContent>
              <Text size={200} block style={{ marginBottom: 12 }}>
                {selectedCount}{" "}
                {selectedCount === 1
                  ? "секция будет помечена"
                  : "секций будут помечены"}{" "}
                как требующие доработки.
              </Text>
              <Field label="Комментарий (необязательно)">
                <Textarea
                  value={comment}
                  onChange={(_, d) => setComment(d.value)}
                  rows={4}
                  resize="vertical"
                  placeholder="Опишите, что именно нужно исправить..."
                />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={() => {
                  setReworkOpen(false);
                  setComment("");
                }}
                disabled={pending}
              >
                Отмена
              </Button>
              <Button
                appearance="primary"
                disabled={pending}
                onClick={() => {
                  onRework(comment.trim() || undefined);
                  setReworkOpen(false);
                  setComment("");
                }}
              >
                {pending ? <Spinner size="tiny" /> : "Сохранить"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
