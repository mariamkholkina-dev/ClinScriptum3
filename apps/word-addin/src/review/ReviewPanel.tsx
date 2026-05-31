import { useMemo, useState } from "react";
import {
  Text,
  Spinner,
  Button,
  Badge,
  Checkbox,
  Select,
  Textarea,
  Switch,
  Divider,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Location24Regular, Star24Regular } from "@fluentui/react-icons";
import { SeverityBadge } from "../shared/SeverityBadge";
import { StatusBadge } from "../shared/StatusBadge";
import { navigateToText, bestSnippet } from "../office-helpers";
import { useReview, effSeverity, type ReviewFinding } from "./useReview";
import { PromoteModal } from "./PromoteModal";

const SEVERITY_OPTIONS = ["critical", "high", "medium", "low", "info"];
const STATUS_OPTIONS = ["pending", "confirmed", "resolved", "rejected", "false_positive"];
const STATUS_LABELS: Record<string, string> = {
  pending: "К валидации",
  confirmed: "Подтверждено",
  resolved: "Исправлено",
  rejected: "Игнорировать",
  false_positive: "Ложное срабатывание",
};

const useStyles = makeStyles({
  // flex:1 + minHeight:0 (как в FindingsPanel) — без этого внутри нефлексового
  // styles.content высота не схлопывается и между фильтрами и списком зияла
  // большая пустая область.
  root: { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 },
  header: {
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  headerTop: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" },
  filters: { display: "flex", gap: "6px", padding: "8px 12px", flexWrap: "wrap" as const },
  bulkBar: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap" as const,
    alignItems: "center",
    padding: "6px 12px",
    backgroundColor: tokens.colorPaletteYellowBackground1,
  },
  list: { flex: 1, minHeight: 0, overflowY: "auto", padding: "0 8px 8px" },
  detailNav: {
    flex: "none",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    padding: "6px 10px",
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  card: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "6px",
    padding: "8px",
    marginTop: "8px",
    cursor: "pointer",
    display: "flex",
    gap: "8px",
  },
  badges: { display: "flex", gap: "6px", flexWrap: "wrap" as const, alignItems: "center" },
  detail: { flex: 1, minHeight: 0, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" },
  blockquote: {
    borderLeft: `3px solid ${tokens.colorBrandStroke1}`,
    paddingLeft: "10px",
    fontStyle: "italic",
    color: tokens.colorNeutralForeground2,
  },
  actionsBox: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: "6px",
    padding: "10px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    backgroundColor: tokens.colorNeutralBackground2,
  },
  empty: { display: "flex", alignItems: "center", justifyContent: "center", padding: "32px", color: tokens.colorNeutralForeground3 },
});

export function ReviewPanel({ reviewId }: { reviewId: string }) {
  const styles = useStyles();
  const r = useReview(reviewId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [promoteTarget, setPromoteTarget] = useState<string[] | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const findings = r.data?.findings ?? [];
  const isPublished = r.data?.review.status === "published";

  const filtered = useMemo(() => {
    return findings.filter((f) => {
      // «Ложное срабатывание» = скрыто ревьюером ИЛИ помечено конвейером/LLM
      // (status=false_positive) — фильтр ловит оба случая.
      const isFalsePositive = f.hiddenByReviewer || f.status === "false_positive";
      if (severityFilter !== "all" && effSeverity(f) !== severityFilter) return false;
      if (statusFilter !== "all" && f.status !== statusFilter) return false;
      if (visibilityFilter === "hidden" && !isFalsePositive) return false;
      if (visibilityFilter === "visible" && isFalsePositive) return false;
      return true;
    });
  }, [findings, severityFilter, statusFilter, visibilityFilter]);

  const selectedIndex = filtered.findIndex((f) => f.id === selectedId);
  const selected = selectedIndex >= 0 ? filtered[selectedIndex] : null;
  const hiddenCount = findings.filter((f) => f.hiddenByReviewer).length;

  const toggleSel = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selArr = Array.from(selectedIds);
  const clearSel = () => setSelectedIds(new Set());

  if (r.loading && !r.data) {
    return <div className={styles.empty}><Spinner label="Загрузка ревью..." /></div>;
  }
  if (!r.data) {
    return (
      <div className={styles.empty}>
        <Text>{r.error ?? "Ревью не найдено"}</Text>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Text weight="semibold" size={300}>{r.data.documentTitle}</Text>
            <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>{r.data.versionLabel}</Text>
          </div>
          {isPublished ? (
            <Badge appearance="tint" color="success">Опубликовано</Badge>
          ) : confirmPublish ? (
            <div style={{ display: "flex", gap: 4 }}>
              <Button size="small" appearance="primary" disabled={r.busy} onClick={() => r.publish()}>
                Да, завершить
              </Button>
              <Button size="small" appearance="subtle" onClick={() => setConfirmPublish(false)}>Отмена</Button>
            </div>
          ) : (
            <Button size="small" appearance="primary" onClick={() => setConfirmPublish(true)}>
              Завершить ревью
            </Button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
            Находок: {findings.length} · скрытых: {hiddenCount}
          </Text>
        </div>
      </div>

      {r.error && (
        <MessageBar intent="error"><MessageBarBody>{r.error}</MessageBarBody></MessageBar>
      )}

      {!selected && (
        <>
          <div className={styles.filters}>
            <Select size="small" value={severityFilter} onChange={(_, d) => setSeverityFilter(d.value)}>
              <option value="all">Все серьёзности</option>
              {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Select size="small" value={statusFilter} onChange={(_, d) => setStatusFilter(d.value)}>
              <option value="all">Все статусы</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </Select>
            <Select size="small" value={visibilityFilter} onChange={(_, d) => setVisibilityFilter(d.value)}>
              <option value="all">Все находки</option>
              <option value="visible">Не ложные</option>
              <option value="hidden">Ложное срабатывание</option>
            </Select>
          </div>

          {!isPublished && selectedIds.size > 0 && (
            <div className={styles.bulkBar}>
              <Text size={200} weight="semibold">Выбрано: {selectedIds.size}</Text>
              <Button size="small" disabled={r.busy} onClick={() => { r.bulkSetHidden(selArr, true); clearSel(); }}>Скрыть</Button>
              <Button size="small" disabled={r.busy} onClick={() => { r.bulkSetHidden(selArr, false); clearSel(); }}>Показать</Button>
              <Select size="small" value="" disabled={r.busy}
                onChange={(_, d) => { if (d.value) { r.bulkChangeSeverity(selArr, d.value); clearSel(); } }}>
                <option value="">Серьёзность…</option>
                {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Button size="small" icon={<Star24Regular />} onClick={() => setPromoteTarget(selArr)}>В эталон</Button>
              <Button size="small" disabled={r.busy} onClick={() => { r.restoreFromFalsePositive(selArr); clearSel(); }}>
                На валидацию
              </Button>
              <Button size="small" appearance="subtle" onClick={clearSel}>Снять</Button>
            </div>
          )}

          <Divider />

          <div className={styles.list}>
            {filtered.length === 0 && <div className={styles.empty}><Text>Нет находок</Text></div>}
            {filtered.map((f) => (
              <ReviewCard
                key={f.id}
                f={f}
                checked={selectedIds.has(f.id)}
                selectable={!isPublished}
                onCheck={() => toggleSel(f.id)}
                onOpen={() => setSelectedId(f.id)}
              />
            ))}
          </div>
        </>
      )}

      {selected && (
        <>
          {/* Навигация по находкам с учётом текущих фильтров */}
          <div className={styles.detailNav}>
            <Button
              size="small"
              appearance="subtle"
              disabled={selectedIndex <= 0}
              onClick={() => setSelectedId(filtered[selectedIndex - 1]?.id ?? null)}
            >
              ← Назад
            </Button>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {selectedIndex + 1} / {filtered.length}
            </Text>
            <Button
              size="small"
              appearance="subtle"
              disabled={selectedIndex >= filtered.length - 1}
              onClick={() => setSelectedId(filtered[selectedIndex + 1]?.id ?? null)}
            >
              Вперёд →
            </Button>
          </div>
          <ReviewDetail
            f={selected}
            isPublished={isPublished}
            busy={r.busy}
            onBack={() => setSelectedId(null)}
            onToggleHidden={() => r.toggleHidden(selected.id)}
            onChangeSeverity={(s) => r.changeSeverity(selected.id, s)}
            onSaveNote={(note) => r.addNote(selected.id, note)}
            onPromote={() => setPromoteTarget([selected.id])}
            onRestore={() => r.restoreFromFalsePositive([selected.id])}
          />
        </>
      )}

      {promoteTarget && (
        <PromoteModal
          findingIds={promoteTarget}
          loadSamples={r.listGoldenSamples}
          promote={r.promoteToGolden}
          onClose={() => { setPromoteTarget(null); r.refetch(); }}
        />
      )}
    </div>
  );
}

function ReviewCard({
  f, checked, selectable, onCheck, onOpen,
}: {
  f: ReviewFinding;
  checked: boolean;
  selectable: boolean;
  onCheck: () => void;
  onOpen: () => void;
}) {
  const styles = useStyles();
  const sev = effSeverity(f);
  return (
    <div className={styles.card} onClick={onOpen}>
      {selectable && (
        <div onClick={(e) => e.stopPropagation()} style={{ paddingTop: 2 }}>
          <Checkbox checked={checked} onChange={onCheck} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={styles.badges}>
          <SeverityBadge severity={sev} />
          <StatusBadge status={f.status} />
          {f.hiddenByReviewer && <Badge appearance="tint" color="danger" size="small">Ложное</Badge>}
        </div>
        <Text size={200} style={{ display: "block", marginTop: 4 }}>{f.description}</Text>
        {f.reviewerNote && (
          <Text size={100} style={{ color: tokens.colorPalettePurpleForeground2 }}>📝 заметка</Text>
        )}
      </div>
    </div>
  );
}

function ReviewDetail({
  f, isPublished, busy, onBack, onToggleHidden, onChangeSeverity, onSaveNote, onPromote, onRestore,
}: {
  f: ReviewFinding;
  isPublished: boolean;
  busy: boolean;
  onBack: () => void;
  onToggleHidden: () => void;
  onChangeSeverity: (s: string) => void;
  onSaveNote: (note: string) => void;
  onPromote: () => void;
  onRestore: () => void;
}) {
  const styles = useStyles();
  const ref = f.sourceRef as any;
  const [note, setNote] = useState(f.reviewerNote ?? "");
  const sev = effSeverity(f);
  const navSnippet = bestSnippet(ref);
  const isFalsePositive = f.status === "false_positive";

  return (
    <div className={styles.detail}>
      <Button size="small" appearance="subtle" onClick={onBack} style={{ alignSelf: "flex-start" }}>
        ← К списку
      </Button>

      <div className={styles.badges}>
        <SeverityBadge severity={sev} />
        <StatusBadge status={f.status} />
        {f.hiddenByReviewer && <Badge appearance="tint" color="danger" size="small">Ложное срабатывание</Badge>}
        {f.originalSeverity && f.originalSeverity !== sev && (
          <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
            Алгоритм: {f.originalSeverity}
          </Text>
        )}
      </div>

      {/* Восстановление ошибочно помеченной ложноположительной находки */}
      {isFalsePositive && (
        <Button size="small" disabled={busy} onClick={onRestore} style={{ alignSelf: "flex-start" }}>
          Вернуть на валидацию
        </Button>
      )}

      <Text weight="semibold" size={300}>{f.description}</Text>

      {f.suggestion && (
        <Text size={200} style={{ color: tokens.colorPaletteGreenForeground1 }}>
          → {f.suggestion}
        </Text>
      )}

      {(ref?.textSnippet || ref?.anchorQuote) && (
        <div className={styles.blockquote}><Text size={200}>{ref?.textSnippet || ref?.anchorQuote}</Text></div>
      )}
      {ref?.targetQuote && (
        <div className={styles.blockquote}><Text size={200}>{ref.targetQuote}</Text></div>
      )}

      <Button
        size="small"
        icon={<Location24Regular />}
        disabled={!navSnippet}
        onClick={() => navSnippet && navigateToText(navSnippet)}
      >
        Перейти в документе
      </Button>

      {/* Действия ревьюера */}
      <div className={styles.actionsBox}>
        <Text weight="semibold" size={200}>Действия ревьюера</Text>

        {!isPublished && (
          <Switch
            checked={f.hiddenByReviewer}
            disabled={busy}
            onChange={onToggleHidden}
            label="Ложное срабатывание (скрыть от писателя)"
          />
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Text size={200}>Серьёзность:</Text>
          <Select
            size="small"
            value={sev}
            disabled={isPublished || busy}
            onChange={(_, d) => onChangeSeverity(d.value)}
          >
            {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text size={200}>Заметка:</Text>
          <Textarea
            value={note}
            disabled={isPublished || busy}
            onChange={(_, d) => setNote(d.value)}
            placeholder="Комментарий к находке..."
            resize="vertical"
          />
          <Button
            size="small"
            disabled={isPublished || busy || note === (f.reviewerNote ?? "")}
            onClick={() => onSaveNote(note)}
            style={{ alignSelf: "flex-end" }}
          >
            Сохранить заметку
          </Button>
        </div>

        <Button size="small" icon={<Star24Regular />} onClick={onPromote} style={{ alignSelf: "flex-start" }}>
          В эталон
        </Button>
      </div>
    </div>
  );
}
