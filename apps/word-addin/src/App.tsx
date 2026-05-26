import React, { useState, useEffect } from "react";
import {
  TabList,
  Tab,
  SelectTabEvent,
  SelectTabData,
  Spinner,
  Text,
  Button,
  Select,
  makeStyles,
  tokens,
  Divider,
} from "@fluentui/react-components";
import {
  DocumentSearch24Regular,
  ArrowUpload24Regular,
  Sparkle24Regular,
  SignOut24Regular,
} from "@fluentui/react-icons";
import { AuthProvider, useAuth, type SessionContext } from "./auth/AuthProvider";
import { useAutoAuth } from "./auth/useAutoAuth";
import { LoginForm } from "./auth/LoginForm";
import { FindingsPanel } from "./findings/FindingsPanel";
import { InterAuditPanel } from "./inter-audit/InterAuditPanel";
import { GenerationPanel } from "./generation/GenerationPanel";
import { UploadPanel } from "./upload/UploadPanel";
import { ParsingPanel } from "./parsing/ParsingPanel";
import { trpcCall } from "./api";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "4px 8px",
    backgroundColor: tokens.colorBrandBackground2,
  },
  content: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  loading: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    gap: "16px",
  },
  selector: {
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  selectItem: {
    padding: "8px 12px",
    cursor: "pointer",
    borderRadius: "4px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    "&:hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
});

export function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

type ActiveTab = "findings" | "upload";

function AppContent() {
  const styles = useStyles();
  const { isAuthenticated, sessionContext, logout, setSessionCtx, clearSessionCtx } = useAuth();
  const { loading, autoAuthFailed } = useAutoAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>("findings");

  if (loading) {
    return (
      <div className={styles.loading}>
        <Spinner size="large" />
        <Text>Подключение к ClinScriptum...</Text>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  if (!sessionContext) {
    return <ManualModeSelector onSelect={setSessionCtx} />;
  }

  const mode = sessionContext.mode;
  const docVersionId = sessionContext.docVersionId;

  return (
    <div className={styles.root}>
      <div className={styles.topBar}>
        <Text size={200} weight="semibold" style={{ color: tokens.colorBrandForeground1 }}>
          ClinScriptum
        </Text>
        <Button
          size="small"
          appearance="subtle"
          icon={<SignOut24Regular />}
          onClick={logout}
        />
      </div>

      {(mode === "intra_audit" || mode === "intra_fact_audit" || mode === "inter_audit") && docVersionId && (
        <>
          <TabList
            size="small"
            selectedValue={activeTab}
            onTabSelect={(_, d: SelectTabData) => setActiveTab(d.value as ActiveTab)}
          >
            <Tab value="findings" icon={<DocumentSearch24Regular />}>
              Находки
            </Tab>
            <Tab value="upload" icon={<ArrowUpload24Regular />}>
              Загрузить версию
            </Tab>
          </TabList>
          <div className={styles.content}>
            {activeTab === "findings" && mode === "intra_audit" && (
              <FindingsPanel docVersionId={docVersionId} categoryFilter="section" />
            )}
            {activeTab === "findings" && mode === "intra_fact_audit" && (
              <FindingsPanel docVersionId={docVersionId} categoryFilter="fact" />
            )}
            {activeTab === "findings" && mode === "inter_audit" && sessionContext.protocolVersionId && (
              <InterAuditPanel
                docVersionId={docVersionId}
                protocolVersionId={sessionContext.protocolVersionId}
              />
            )}
            {activeTab === "upload" && (
              <UploadPanel docVersionId={docVersionId} />
            )}
          </div>
        </>
      )}

      {mode === "parsing" && docVersionId && (
        <div className={styles.content}>
          <ParsingPanel
            docVersionId={docVersionId}
            goldenSampleId={sessionContext.goldenSampleId}
            onBack={clearSessionCtx}
          />
        </div>
      )}

      {(mode === "generation_review" || mode === "generation_insert") && sessionContext.generatedDocId && (
        <>
          <TabList
            size="small"
            selectedValue={activeTab}
            onTabSelect={(_, d: SelectTabData) => setActiveTab(d.value as ActiveTab)}
          >
            <Tab value="findings" icon={<Sparkle24Regular />}>
              Генерация
            </Tab>
            <Tab value="upload" icon={<ArrowUpload24Regular />}>
              Загрузить версию
            </Tab>
          </TabList>
          <div className={styles.content}>
            {activeTab === "findings" && (
              <GenerationPanel
                generatedDocId={sessionContext.generatedDocId}
                mode={mode === "generation_review" ? "review" : "insert"}
              />
            )}
            {activeTab === "upload" && docVersionId && (
              <UploadPanel docVersionId={docVersionId} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface VersionItem {
  versionId: string;
  versionNumber: number;
  versionLabel: string | null;
  status: string;
  documentId: string;
  documentTitle: string;
  documentType: string;
  studyId: string;
  studyTitle: string;
}

interface VersionsPage {
  items: VersionItem[];
  nextCursor: string | null;
}

interface GeneratedDocSummary {
  id: string;
  docType: string;
  status: string;
  createdAt: string;
  studyTitle: string;
  protocolTitle: string;
  protocolLabel: string;
  totalSections: number;
  completedSections: number;
}

type Mode =
  | "parsing"
  | "intra_audit"
  | "intra_fact_audit"
  | "inter_audit"
  | "generation_review"
  | "generation_insert";

const MODE_LABELS: { value: Mode; label: string }[] = [
  { value: "parsing", label: "Парсинг" },
  { value: "intra_audit", label: "Внутридокументный аудит (секции)" },
  { value: "intra_fact_audit", label: "Внутридокументный аудит фактов" },
  { value: "inter_audit", label: "Междокументный аудит" },
  { value: "generation_review", label: "Генерация — просмотр" },
  { value: "generation_insert", label: "Генерация — вставка" },
];

function isGenerationMode(mode: Mode): boolean {
  return mode === "generation_review" || mode === "generation_insert";
}

function ManualModeSelector({ onSelect }: { onSelect: (ctx: SessionContext) => void }) {
  const styles = useStyles();
  const [selectedMode, setSelectedMode] = useState<Mode>("intra_audit");

  // Для inter_audit — двухшаговый выбор: сначала checked-версия, потом protocol.
  const [pendingCheckedVersionId, setPendingCheckedVersionId] = useState<string | null>(null);

  const [generatedDocs, setGeneratedDocs] = useState<GeneratedDocSummary[]>([]);
  const [loadingGenerated, setLoadingGenerated] = useState(false);

  // На втором шаге inter_audit показываем только версии типа protocol.
  const versionsDocType =
    selectedMode === "inter_audit" && pendingCheckedVersionId ? "protocol" : undefined;

  useEffect(() => {
    if (!isGenerationMode(selectedMode)) return;
    setLoadingGenerated(true);
    trpcCall<GeneratedDocSummary[]>("wordAddin.listGeneratedDocs", {})
      .then(setGeneratedDocs)
      .catch(() => setGeneratedDocs([]))
      .finally(() => setLoadingGenerated(false));
  }, [selectedMode]);

  // Сбрасываем pending выбор при смене режима.
  useEffect(() => {
    setPendingCheckedVersionId(null);
  }, [selectedMode]);

  const handleVersionClick = (versionId: string) => {
    if (selectedMode === "inter_audit") {
      if (!pendingCheckedVersionId) {
        setPendingCheckedVersionId(versionId);
      } else {
        onSelect({
          docVersionId: pendingCheckedVersionId,
          protocolVersionId: versionId,
          mode: selectedMode,
        });
      }
    } else {
      onSelect({ docVersionId: versionId, mode: selectedMode });
    }
  };

  const handleGeneratedClick = (generatedDocId: string) => {
    onSelect({ generatedDocId, mode: selectedMode });
  };

  return (
    <div className={styles.selector}>
      <Text weight="semibold" size={400}>
        Выберите документ и режим
      </Text>
      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
        Документ не был открыт из приложения. Выберите документ вручную.
      </Text>

      <Select
        value={selectedMode}
        onChange={(_, d) => setSelectedMode(d.value as Mode)}
        size="small"
      >
        {MODE_LABELS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </Select>

      {selectedMode === "inter_audit" && (
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {pendingCheckedVersionId
            ? "Шаг 2: выберите версию протокола (эталон)."
            : "Шаг 1: выберите проверяемую версию."}
        </Text>
      )}

      <Divider />

      {isGenerationMode(selectedMode) ? (
        loadingGenerated ? (
          <Spinner label="Загрузка..." size="small" />
        ) : (
          <GeneratedDocsList docs={generatedDocs} onSelect={handleGeneratedClick} />
        )
      ) : (
        <PaginatedVersionsList
          docType={versionsDocType}
          onVersionClick={handleVersionClick}
          highlightVersionId={pendingCheckedVersionId}
        />
      )}
    </div>
  );
}

function PaginatedVersionsList({
  docType,
  onVersionClick,
  highlightVersionId,
}: {
  docType: string | undefined;
  onVersionClick: (versionId: string) => void;
  highlightVersionId: string | null;
}) {
  const styles = useStyles();
  const [items, setItems] = useState<VersionItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  const inFlightRef = React.useRef(false);

  const loadPage = React.useCallback(
    async (currentCursor: string | null) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setLoading(true);
      try {
        const page = await trpcCall<VersionsPage>("wordAddin.listVersions", {
          cursor: currentCursor ?? undefined,
          take: 50,
          docType,
        });
        setItems((prev) => (currentCursor ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
      } catch {
        setHasMore(false);
      } finally {
        setLoading(false);
        setInitialLoad(false);
        inFlightRef.current = false;
      }
    },
    [docType]
  );

  // Сброс при изменении docType (например, на втором шаге inter_audit).
  useEffect(() => {
    setItems([]);
    setCursor(null);
    setHasMore(true);
    setInitialLoad(true);
    loadPage(null);
  }, [docType, loadPage]);

  // IntersectionObserver — догружаем когда sentinel становится видимым.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loading) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadPage(cursor);
        }
      },
      { rootMargin: "120px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [cursor, hasMore, loading, loadPage]);

  if (initialLoad) {
    return <Spinner label="Загрузка..." size="small" />;
  }

  if (items.length === 0) {
    return (
      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
        Нет доступных документов
      </Text>
    );
  }

  // Группируем по study для визуального заголовка между группами.
  const grouped: { studyId: string; studyTitle: string; items: VersionItem[] }[] = [];
  for (const v of items) {
    const last = grouped[grouped.length - 1];
    if (last && last.studyId === v.studyId) {
      last.items.push(v);
    } else {
      grouped.push({ studyId: v.studyId, studyTitle: v.studyTitle, items: [v] });
    }
  }

  return (
    <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
      {grouped.map((g, gi) => (
        <div key={`${g.studyId}-${gi}`} style={{ marginBottom: 12 }}>
          <Text weight="semibold" size={200}>
            {g.studyTitle}
          </Text>
          {g.items.map((v) => {
            const isHighlighted = v.versionId === highlightVersionId;
            return (
              <div
                key={v.versionId}
                className={styles.selectItem}
                style={
                  isHighlighted
                    ? { backgroundColor: tokens.colorBrandBackground2 }
                    : undefined
                }
                onClick={() => onVersionClick(v.versionId)}
              >
                <Text size={200}>
                  {v.documentTitle} — {v.versionLabel ?? `v${v.versionNumber}`}
                </Text>
                <br />
                <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                  {v.documentType} · {v.status}
                  {isHighlighted ? " · ✓ выбрано" : ""}
                </Text>
              </div>
            );
          })}
        </div>
      ))}
      {hasMore && (
        <div ref={sentinelRef} style={{ padding: "12px", textAlign: "center" }}>
          {loading ? (
            <Spinner size="extra-tiny" />
          ) : (
            <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
              Прокрутите для загрузки
            </Text>
          )}
        </div>
      )}
    </div>
  );
}

function GeneratedDocsList({
  docs,
  onSelect,
}: {
  docs: GeneratedDocSummary[];
  onSelect: (id: string) => void;
}) {
  const styles = useStyles();

  if (docs.length === 0) {
    return (
      <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
        Нет сгенерированных документов
      </Text>
    );
  }

  return (
    <>
      {docs.map((d) => (
        <div key={d.id} className={styles.selectItem} onClick={() => onSelect(d.id)}>
          <Text size={200}>
            {d.docType.toUpperCase()} — {d.studyTitle}
          </Text>
          <br />
          <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
            {d.protocolTitle} ({d.protocolLabel}) · {d.status} ·{" "}
            {d.completedSections}/{d.totalSections} разделов
          </Text>
        </div>
      ))}
    </>
  );
}
