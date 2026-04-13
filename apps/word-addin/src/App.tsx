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
import { trpcCall } from "./api";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
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
  const { isAuthenticated, sessionContext, logout, setSessionCtx } = useAuth();
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

      {(mode === "intra_audit" || mode === "inter_audit") && docVersionId && (
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
              <FindingsPanel docVersionId={docVersionId} />
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

interface StudyDoc {
  id: string;
  title: string;
  documents: {
    id: string;
    title: string;
    type: string;
    versions: { id: string; versionNumber: number; versionLabel: string | null; status: string }[];
  }[];
}

function ManualModeSelector({ onSelect }: { onSelect: (ctx: SessionContext) => void }) {
  const styles = useStyles();
  const [studies, setStudies] = useState<StudyDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMode, setSelectedMode] = useState("intra_audit");

  useEffect(() => {
    trpcCall<StudyDoc[]>("wordAddin.getContext", {})
      .then(setStudies)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className={styles.loading}>
        <Spinner label="Загрузка документов..." />
      </div>
    );
  }

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
        onChange={(_, d) => setSelectedMode(d.value)}
        size="small"
      >
        <option value="intra_audit">Внутридокументный аудит</option>
        <option value="inter_audit">Междокументный аудит</option>
      </Select>

      <Divider />

      {studies.map((study) => (
        <div key={study.id} style={{ marginBottom: 12 }}>
          <Text weight="semibold" size={200}>
            {study.title}
          </Text>
          {study.documents.map((doc) =>
            doc.versions.map((v) => (
              <div
                key={v.id}
                className={styles.selectItem}
                onClick={() =>
                  onSelect({
                    docVersionId: v.id,
                    mode: selectedMode as any,
                  })
                }
              >
                <Text size={200}>
                  {doc.title} — {v.versionLabel ?? `v${v.versionNumber}`}
                </Text>
                <br />
                <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                  {doc.type} · {v.status}
                </Text>
              </div>
            ))
          )}
        </div>
      ))}

      {studies.length === 0 && (
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          Нет доступных документов
        </Text>
      )}
    </div>
  );
}
