import { useEffect, useState } from "react";
import {
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  Button,
  Radio,
  RadioGroup,
  Spinner,
  Text,
  tokens,
} from "@fluentui/react-components";
import type { GoldenSampleOption } from "./useReview";

interface Props {
  findingIds: string[];
  loadSamples: () => Promise<GoldenSampleOption[]>;
  promote: (findingId: string, goldenSampleId: string) => Promise<unknown>;
  onClose: () => void;
}

/** Перенос находки(ок) в эталонный набор — Word-аналог web PromoteToGoldenModal. */
export function PromoteModal({ findingIds, loadSamples, promote, onClose }: Props) {
  const [samples, setSamples] = useState<GoldenSampleOption[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadSamples()
      .then(setSamples)
      .catch(() => setSamples([]));
  }, [loadSamples]);

  const handlePromote = async () => {
    if (!selected) return;
    setBusy(true);
    setResult(null);
    let added = 0;
    let skipped = 0;
    let failed = 0;
    for (const findingId of findingIds) {
      try {
        const res: any = await promote(findingId, selected);
        if (res && typeof res === "object" && "promoted" in res) {
          if (res.promoted) added += 1;
          else skipped += 1;
        } else added += 1;
      } catch {
        failed += 1;
      }
    }
    setBusy(false);
    const parts = [`добавлено: ${added}`];
    if (skipped) parts.push(`уже в эталоне: ${skipped}`);
    if (failed) parts.push(`ошибок: ${failed}`);
    setResult(parts.join(" · "));
  };

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>
            {findingIds.length > 1
              ? `Перенести в эталон (${findingIds.length})`
              : "Перенести находку в эталон"}
          </DialogTitle>
          <DialogContent>
            {samples === null ? (
              <Spinner size="tiny" label="Загрузка наборов..." />
            ) : samples.length === 0 ? (
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                Нет доступных эталонных наборов.
              </Text>
            ) : (
              <RadioGroup value={selected ?? ""} onChange={(_, d) => setSelected(d.value)}>
                {samples.map((s) => (
                  <Radio
                    key={s.id}
                    value={s.id}
                    label={`${s.name ?? s.id.slice(0, 8)} · ${s.sampleType}`}
                  />
                ))}
              </RadioGroup>
            )}
            {result && (
              <Text size={200} style={{ display: "block", marginTop: 8, color: tokens.colorPaletteGreenForeground1 }}>
                ✓ {result}
              </Text>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              Закрыть
            </Button>
            <Button
              appearance="primary"
              disabled={!selected || busy}
              onClick={handlePromote}
            >
              {busy ? "..." : "В эталон"}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
