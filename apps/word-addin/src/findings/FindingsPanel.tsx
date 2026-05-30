import React, { useState, useMemo } from "react";
import {
  Text,
  Spinner,
  CounterBadge,
  Button,
  makeStyles,
  tokens,
  Divider,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";
import { useFindings } from "../shared/useFindings";
import { FindingCard } from "./FindingCard";
import { FindingDetail } from "./FindingDetail";
import { FindingsFilter } from "./FindingsFilter";
import { highlightFindingLocations, clearHighlights, bestSnippet } from "../office-helpers";
import { trpcCall } from "../api";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  header: {
    padding: "12px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  list: {
    flex: 1,
    // minHeight:0 обязателен: без него flex-ребёнок не сжимается ниже размера
    // контента, поэтому overflowY:auto не срабатывает и колесо мыши не
    // прокручивает список (контент просто вылезает за пределы панели).
    minHeight: 0,
    overflowY: "auto",
    padding: "0 8px 8px",
  },
  detail: {
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
  },
  detailNav: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "8px",
    padding: "8px",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px",
    color: tokens.colorNeutralForeground3,
  },
  bulkActions: {
    display: "flex",
    gap: "8px",
    padding: "4px 12px",
  },
});

interface Props {
  docVersionId: string;
  /**
   * Фильтр по категории findings (auditCategory):
   * - "section" — только структура / противоречия (intra_audit)
   * - "fact" — только аудит фактов (intra_fact_audit)
   * - undefined / "all" — все findings
   */
  categoryFilter?: "section" | "fact" | "all";
}

export function FindingsPanel({ docVersionId, categoryFilter }: Props) {
  const styles = useStyles();
  const { findings, loading, error, refetch, updateStatus } = useFindings({
    docVersionId,
    mode: "intra_audit",
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    return findings.filter((f) => {
      if (severityFilter !== "all" && f.severity !== severityFilter) return false;
      if (statusFilter !== "all" && f.status !== statusFilter) return false;
      if (categoryFilter && categoryFilter !== "all") {
        // auditCategory может быть "fact" / "section_fact" / "structure" / null.
        // Простая эвристика: содержит "fact" → fact-аудит, иначе — секционный.
        const cat = (f.auditCategory ?? "").toLowerCase();
        const isFact = cat.includes("fact");
        if (categoryFilter === "fact" && !isFact) return false;
        if (categoryFilter === "section" && isFact) return false;
      }
      return true;
    });
  }, [findings, severityFilter, statusFilter, categoryFilter]);

  const selectedIndex = filtered.findIndex((f) => f.id === selectedId);
  const selected = selectedIndex >= 0 ? filtered[selectedIndex] : undefined;
  const pendingCount = findings.filter((f) => f.status === "pending").length;

  const handleHighlightAll = async () => {
    // Берём цитату из любого доступного поля (textSnippet/anchorQuote/...),
    // иначе для части находок подсветка не срабатывала.
    const snippets = findings
      .map((f) => bestSnippet(f.sourceRef))
      .filter((s): s is string => !!s);
    if (snippets.length > 0) {
      await clearHighlights();
      await highlightFindingLocations(snippets);
    }
  };

  const handleValidateAll = async (action: "resolve" | "reject") => {
    await trpcCall("audit.validateAllAuditFindings", { docVersionId, action }, "mutation");
    refetch();
  };

  if (loading) {
    return (
      <div className={styles.empty}>
        <Spinner label="Загрузка находок..." />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Text weight="semibold" size={400}>
            Находки
          </Text>
          {/* overflowCount высокий — показываем точное число, а не «99+». */}
          <CounterBadge count={filtered.length} overflowCount={99999} size="small" color="informative" />
          {pendingCount > 0 && (
            <CounterBadge count={pendingCount} overflowCount={99999} size="small" color="important" />
          )}
        </div>
        <Button size="small" appearance="subtle" onClick={handleHighlightAll}>
          Подсветить все
        </Button>
      </div>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      <FindingsFilter
        severity={severityFilter}
        onSeverityChange={setSeverityFilter}
        status={statusFilter}
        onStatusChange={setStatusFilter}
      />

      {findings.length > 0 && (
        <div className={styles.bulkActions}>
          <Button size="small" appearance="subtle" onClick={() => handleValidateAll("resolve")}>
            Всё исправлено
          </Button>
          <Button size="small" appearance="subtle" onClick={() => handleValidateAll("reject")}>
            Всё игнорировать
          </Button>
        </div>
      )}

      <Divider />

      {selected ? (
        <div className={styles.detail}>
          <div className={styles.detailNav}>
            <Button
              size="small"
              appearance="subtle"
              onClick={() => setSelectedId(null)}
            >
              ← К списку
            </Button>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                {selectedIndex + 1} / {filtered.length}
              </Text>
              <Button
                size="small"
                appearance="subtle"
                disabled={selectedIndex <= 0}
                onClick={() => setSelectedId(filtered[selectedIndex - 1]?.id ?? null)}
              >
                ← Назад
              </Button>
              <Button
                size="small"
                appearance="subtle"
                disabled={selectedIndex >= filtered.length - 1}
                onClick={() => setSelectedId(filtered[selectedIndex + 1]?.id ?? null)}
              >
                Вперёд →
              </Button>
            </div>
          </div>
          <FindingDetail finding={selected} onUpdateStatus={updateStatus} />
        </div>
      ) : (
        <div className={styles.list}>
          {filtered.length === 0 && (
            <div className={styles.empty}>
              <Text>Нет находок</Text>
            </div>
          )}
          {filtered.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              isSelected={f.id === selectedId}
              onSelect={() => setSelectedId(f.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
