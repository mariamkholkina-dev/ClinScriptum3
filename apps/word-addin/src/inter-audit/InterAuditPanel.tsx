import React, { useState, useMemo } from "react";
import {
  Text,
  Spinner,
  CounterBadge,
  Button,
  Divider,
  makeStyles,
  tokens,
  MessageBar,
  MessageBarBody,
} from "@fluentui/react-components";
import { Location24Regular } from "@fluentui/react-icons";
import { useFindings } from "../shared/useFindings";
import { FindingCard } from "../findings/FindingCard";
import { FindingsFilter } from "../findings/FindingsFilter";
import { StatusActions } from "../findings/StatusActions";
import { SeverityBadge } from "../shared/SeverityBadge";
import { StatusBadge } from "../shared/StatusBadge";
import { ProtocolContext } from "./ProtocolContext";
import { navigateToText, applyTextReplacement } from "../office-helpers";
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
    overflowY: "auto",
    padding: "0 8px 8px",
  },
  detail: {
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    flex: 1,
    overflowY: "auto",
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  badges: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap" as const,
  },
  blockquote: {
    borderLeft: `3px solid ${tokens.colorPaletteMarigoldBorder1}`,
    paddingLeft: "12px",
    margin: "4px 0",
    fontStyle: "italic",
    color: tokens.colorNeutralForeground2,
  },
  suggestion: {
    backgroundColor: tokens.colorPaletteGreenBackground1,
    padding: "8px 12px",
    borderRadius: "4px",
    border: `1px solid ${tokens.colorPaletteGreenBorder1}`,
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
  protocolVersionId: string;
}

export function InterAuditPanel({ docVersionId, protocolVersionId }: Props) {
  const styles = useStyles();
  const { findings, loading, error, refetch, updateStatus } = useFindings({
    docVersionId,
    mode: "inter_audit",
    protocolVersionId,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    return findings.filter((f) => {
      if (severityFilter !== "all" && f.severity !== severityFilter) return false;
      if (statusFilter !== "all" && f.status !== statusFilter) return false;
      return true;
    });
  }, [findings, severityFilter, statusFilter]);

  const selected = filtered.find((f) => f.id === selectedId);
  const pendingCount = findings.filter((f) => f.status === "pending").length;

  const handleValidateAll = async (action: "resolve" | "reject") => {
    await trpcCall("audit.validateAllInterAuditFindings", {
      checkedVersionId: docVersionId,
      action,
    }, "mutation");
    refetch();
  };

  if (loading) {
    return (
      <div className={styles.empty}>
        <Spinner label="Загрузка находок..." />
      </div>
    );
  }

  if (selected) {
    const ref = selected.sourceRef as any;
    const extra = selected.extraAttributes as any;

    const handleNavigate = async () => {
      const snippet = ref?.checkedDocQuote || ref?.textSnippet;
      if (snippet) await navigateToText(snippet);
    };

    const handleApplyFix = async () => {
      if (!selected.suggestion) return;
      const snippet = ref?.checkedDocQuote || ref?.textSnippet;
      if (!snippet) return;
      const success = await applyTextReplacement(snippet, selected.suggestion);
      if (success) updateStatus(selected.id, "resolved");
    };

    return (
      <div className={styles.root}>
        <Button
          size="small"
          appearance="subtle"
          onClick={() => setSelectedId(null)}
          style={{ margin: "8px" }}
        >
          ← К списку
        </Button>
        <div className={styles.detail}>
          <div className={styles.badges}>
            <SeverityBadge severity={selected.severity} />
            <StatusBadge status={selected.status} />
          </div>

          <Text weight="semibold" size={300}>
            {selected.description}
          </Text>

          {selected.suggestion && (
            <div className={styles.suggestion}>
              <Text size={200} weight="semibold">
                Рекомендация:
              </Text>
              <Text size={200}> {selected.suggestion}</Text>
            </div>
          )}

          <ProtocolContext
            protocolTitle={extra?.protocolTitle}
            protocolLabel={extra?.protocolLabel}
            protocolQuote={ref?.protocolQuote}
            checkId={extra?.checkId}
          />

          {ref?.checkedDocQuote && (
            <div>
              <Text size={200} weight="semibold">
                Цитата из проверяемого документа
              </Text>
              <div className={styles.blockquote}>
                <Text size={200}>{ref.checkedDocQuote}</Text>
              </div>
            </div>
          )}

          <Button
            size="small"
            icon={<Location24Regular />}
            onClick={handleNavigate}
            disabled={!ref?.checkedDocQuote && !ref?.textSnippet}
          >
            Перейти в документе
          </Button>

          <StatusActions
            status={selected.status}
            hasSuggestion={!!selected.suggestion}
            onUpdateStatus={(status) => updateStatus(selected.id, status)}
            onApplyFix={selected.suggestion ? handleApplyFix : undefined}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Text weight="semibold" size={400}>
            Междокументный аудит
          </Text>
          <CounterBadge count={filtered.length} size="small" color="informative" />
          {pendingCount > 0 && (
            <CounterBadge count={pendingCount} size="small" color="warning" />
          )}
        </div>
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
    </div>
  );
}
