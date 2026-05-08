import React, { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  Option,
  Radio,
  RadioGroup,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { Section } from "./types";

const useStyles = makeStyles({
  fields: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  preview: {
    padding: "8px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
    maxHeight: "80px",
    overflow: "auto",
    whiteSpace: "pre-wrap",
  },
});

export interface AddManualSectionInput {
  title: string;
  level: number;
  paragraphIndex: number;
  textSnippet: string;
  afterSectionId?: string;
}

interface Props {
  open: boolean;
  /** Текст текущего выделения в Word. Если null — пользователь без выделения, разрешён только anchor "after-section". */
  selectionText: string | null;
  /** paragraphIndex выделения (если есть). */
  selectionParagraphIndex: number | null;
  sections: Section[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: AddManualSectionInput) => Promise<void>;
}

/**
 * Диалог добавления секции вручную из Word add-in.
 *
 * Источник якоря — два варианта:
 *  1. «Текущее выделение» (default, если есть selectionText) — paragraphIndex и
 *     textSnippet из Word selection. Title pre-filled первыми 200 chars.
 *  2. «После раздела» — позиционирует новый раздел сразу после выбранного
 *     existing section (paragraphIndex берётся от sourceAnchor.paragraphIndex+1).
 *
 * Соответствует контракту `document.addManualSection` — см.
 * apps/api/src/routers/document.ts.
 */
export function AddManualSectionDialog({
  open,
  selectionText,
  selectionParagraphIndex,
  sections,
  pending,
  onClose,
  onSubmit,
}: Props) {
  const styles = useStyles();
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState(2);
  const [anchorMode, setAnchorMode] = useState<"selection" | "after-section">(
    selectionText ? "selection" : "after-section",
  );
  const [afterSectionId, setAfterSectionId] = useState<string>("");

  // При открытии диалога — pre-fill title из выделения (≤200 chars).
  useEffect(() => {
    if (!open) return;
    if (selectionText) {
      const trimmed = selectionText.trim().slice(0, 200);
      setTitle(trimmed);
      setAnchorMode("selection");
    } else {
      setTitle("");
      setAnchorMode("after-section");
    }
    setLevel(2);
    setAfterSectionId("");
  }, [open, selectionText]);

  const canSubmit =
    title.trim().length > 0 &&
    !pending &&
    (anchorMode === "selection"
      ? selectionText !== null && selectionParagraphIndex !== null
      : afterSectionId.length > 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    let paragraphIndex = 0;
    let textSnippet = title.trim();
    let resolvedAfterSectionId: string | undefined;

    if (anchorMode === "selection" && selectionText && selectionParagraphIndex !== null) {
      paragraphIndex = selectionParagraphIndex;
      textSnippet = selectionText.trim().slice(0, 200);
    } else if (anchorMode === "after-section" && afterSectionId) {
      const after = sections.find((s) => s.id === afterSectionId);
      paragraphIndex = (after?.sourceAnchor?.paragraphIndex ?? 0) + 1;
      const blocks = after?.contentBlocks ?? [];
      const lastBlockText =
        (blocks.length > 0 ? blocks[blocks.length - 1].content : after?.title) ?? title.trim();
      textSnippet = lastBlockText.slice(0, 200) || title.trim();
      resolvedAfterSectionId = afterSectionId;
    }

    await onSubmit({
      title: title.trim(),
      level,
      paragraphIndex,
      textSnippet,
      afterSectionId: resolvedAfterSectionId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Добавить раздел вручную</DialogTitle>
          <DialogContent>
            <div className={styles.fields}>
              <Field label="Название раздела" required>
                <Input
                  value={title}
                  onChange={(_, d) => setTitle(d.value)}
                  placeholder="Например, «Введение» или «Цели исследования»"
                  maxLength={500}
                  disabled={pending}
                />
              </Field>

              <Field label="Уровень заголовка">
                <Dropdown
                  value={`Уровень ${level}`}
                  selectedOptions={[String(level)]}
                  onOptionSelect={(_, d) => {
                    if (d.optionValue) setLevel(Number(d.optionValue));
                  }}
                  disabled={pending}
                >
                  {[1, 2, 3, 4, 5].map((l) => (
                    <Option key={l} value={String(l)} text={`Уровень ${l}`}>
                      {`Уровень ${l}`}
                    </Option>
                  ))}
                </Dropdown>
              </Field>

              <Field label="Привязка к месту в документе">
                <RadioGroup
                  value={anchorMode}
                  onChange={(_, d) =>
                    setAnchorMode(d.value as "selection" | "after-section")
                  }
                  disabled={pending}
                >
                  <Radio
                    value="selection"
                    label={
                      selectionText
                        ? "Текущее выделение в Word"
                        : "Текущее выделение (нет выделения)"
                    }
                    disabled={!selectionText}
                  />
                  <Radio value="after-section" label="После существующего раздела" />
                </RadioGroup>
              </Field>

              {anchorMode === "selection" && selectionText && (
                <Field label="Превью выделения">
                  <div className={styles.preview}>
                    {selectionText.slice(0, 300)}
                    {selectionText.length > 300 ? "…" : ""}
                  </div>
                  <Text className={styles.hint}>
                    Параграф №{selectionParagraphIndex ?? "?"} в документе.
                  </Text>
                </Field>
              )}

              {anchorMode === "after-section" && (
                <Field label="После раздела" required>
                  <Dropdown
                    value={
                      afterSectionId
                        ? sections.find((s) => s.id === afterSectionId)?.title ?? ""
                        : ""
                    }
                    selectedOptions={afterSectionId ? [afterSectionId] : []}
                    onOptionSelect={(_, d) => {
                      if (d.optionValue) setAfterSectionId(d.optionValue);
                    }}
                    placeholder="— выбрать раздел —"
                    disabled={pending}
                  >
                    {sections.map((s) => (
                      <Option
                        key={s.id}
                        value={s.id}
                        text={`L${s.level} ${s.title}`}
                      >
                        {`L${s.level} ${s.title.slice(0, 80)}`}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose} disabled={pending}>
              Отмена
            </Button>
            <Button
              appearance="primary"
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
            >
              {pending ? <Spinner size="tiny" /> : "Добавить"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
