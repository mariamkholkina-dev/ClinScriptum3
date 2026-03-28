import React, { useState, useEffect } from "react";
import { setToken, trpcCall } from "./api";
import { navigateToText, applyTextReplacement, getDocumentAsBase64 } from "./office-helpers";

interface Finding {
  id: string;
  type: "editorial" | "semantic";
  description: string;
  suggestion: string | null;
  sourceRef: { textSnippet?: string; sectionTitle?: string };
  status: string;
  extraAttributes: Record<string, unknown>;
}

export function App() {
  const [view, setView] = useState<"login" | "findings" | "upload">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [docVersionId, setDocVersionId] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    try {
      setError("");
      const result = await trpcCall<{ accessToken: string }>("auth.login", {
        email,
        password,
      });
      setToken(result.accessToken);
      setView("findings");
    } catch (e: any) {
      setError(e.message);
    }
  };

  const loadFindings = async () => {
    if (!docVersionId) return;
    setLoading(true);
    try {
      const result = await trpcCall<Finding[]>("processing.listFindings", {
        docVersionId,
      });
      setFindings(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = async (textSnippet: string) => {
    try {
      await navigateToText(textSnippet);
    } catch {
      setError("Could not navigate to text in document");
    }
  };

  const handleApplyFix = async (finding: Finding) => {
    if (!finding.suggestion || !finding.sourceRef.textSnippet) return;
    try {
      const success = await applyTextReplacement(
        finding.sourceRef.textSnippet,
        finding.suggestion
      );
      if (success) {
        await trpcCall("processing.updateFindingStatus", {
          findingId: finding.id,
          status: "resolved",
        });
        await loadFindings();
      }
    } catch {
      setError("Failed to apply fix");
    }
  };

  const handleUploadNewVersion = async () => {
    try {
      setLoading(true);
      const base64 = await getDocumentAsBase64();
      // Upload flow: call API to get upload URL then confirm
      setError("Upload complete (placeholder - connect to document.confirmUpload)");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Login view
  if (view === "login") {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>ClinScriptum</h2>
        <p style={styles.subtitle}>Sign in to review findings</p>

        {error && <div style={styles.error}>{error}</div>}

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={styles.input}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
        />
        <button onClick={handleLogin} style={styles.button}>
          Sign in
        </button>
      </div>
    );
  }

  // Findings view
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Findings</h2>
        <div style={styles.tabs}>
          <button
            onClick={() => setView("findings")}
            style={view === "findings" ? styles.tabActive : styles.tab}
          >
            Findings
          </button>
          <button
            onClick={() => setView("upload")}
            style={view === "upload" ? styles.tabActive : styles.tab}
          >
            Upload
          </button>
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {view === "findings" && (
        <>
          <div style={styles.searchRow}>
            <input
              placeholder="Document Version ID"
              value={docVersionId}
              onChange={(e) => setDocVersionId(e.target.value)}
              style={{ ...styles.input, flex: 1 }}
            />
            <button onClick={loadFindings} style={styles.buttonSmall} disabled={loading}>
              {loading ? "..." : "Load"}
            </button>
          </div>

          <div style={styles.findingsList}>
            {findings.map((f) => (
              <div key={f.id} style={styles.findingCard}>
                <div style={styles.findingHeader}>
                  <span
                    style={{
                      ...styles.badge,
                      background: f.type === "editorial" ? "#dbeafe" : "#ffedd5",
                      color: f.type === "editorial" ? "#1d4ed8" : "#c2410c",
                    }}
                  >
                    {f.type}
                  </span>
                  <span
                    style={{
                      ...styles.badge,
                      background: f.status === "pending" ? "#fef3c7" : "#d1fae5",
                    }}
                  >
                    {f.status}
                  </span>
                </div>

                <p style={styles.findingDesc}>{f.description}</p>

                {f.suggestion && (
                  <p style={styles.suggestion}>Fix: {f.suggestion}</p>
                )}

                <div style={styles.findingActions}>
                  {f.sourceRef.textSnippet && (
                    <button
                      onClick={() => handleNavigate(f.sourceRef.textSnippet!)}
                      style={styles.actionBtn}
                    >
                      Navigate
                    </button>
                  )}
                  {f.suggestion && f.status === "pending" && (
                    <button
                      onClick={() => handleApplyFix(f)}
                      style={{ ...styles.actionBtn, background: "#dcfce7" }}
                    >
                      Apply Fix
                    </button>
                  )}
                </div>
              </div>
            ))}

            {findings.length === 0 && !loading && (
              <p style={styles.empty}>No findings loaded. Enter a version ID and click Load.</p>
            )}
          </div>
        </>
      )}

      {view === "upload" && (
        <div style={{ padding: 16 }}>
          <p style={styles.subtitle}>Upload the current document as a new version.</p>
          <button onClick={handleUploadNewVersion} style={styles.button} disabled={loading}>
            {loading ? "Uploading..." : "Upload New Version"}
          </button>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { fontFamily: "system-ui, sans-serif", padding: 16, maxWidth: 360 },
  title: { fontSize: 18, fontWeight: 700, margin: "0 0 4px" },
  subtitle: { fontSize: 13, color: "#6b7280", margin: "0 0 16px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  tabs: { display: "flex", gap: 4 },
  tab: { padding: "4px 10px", fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 6, background: "#fff", cursor: "pointer" },
  tabActive: { padding: "4px 10px", fontSize: 12, border: "1px solid #4f6df5", borderRadius: 6, background: "#4f6df5", color: "#fff", cursor: "pointer" },
  input: { display: "block", width: "100%", padding: "8px 12px", fontSize: 13, border: "1px solid #d1d5db", borderRadius: 8, marginBottom: 10, boxSizing: "border-box" as const },
  button: { display: "block", width: "100%", padding: "8px 16px", fontSize: 13, fontWeight: 600, background: "#4f6df5", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" },
  buttonSmall: { padding: "8px 16px", fontSize: 13, fontWeight: 600, background: "#4f6df5", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" },
  error: { background: "#fef2f2", color: "#dc2626", padding: 8, borderRadius: 8, fontSize: 12, marginBottom: 10 },
  searchRow: { display: "flex", gap: 8, marginBottom: 12 },
  findingsList: { display: "flex", flexDirection: "column" as const, gap: 10 },
  findingCard: { border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 },
  findingHeader: { display: "flex", gap: 6, marginBottom: 6 },
  badge: { padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 500 },
  findingDesc: { fontSize: 13, color: "#111827", margin: "0 0 6px", lineHeight: 1.4 },
  suggestion: { fontSize: 12, color: "#15803d", background: "#f0fdf4", padding: 6, borderRadius: 6, margin: "0 0 8px" },
  findingActions: { display: "flex", gap: 6 },
  actionBtn: { padding: "4px 10px", fontSize: 11, border: "1px solid #e5e7eb", borderRadius: 6, background: "#f9fafb", cursor: "pointer" },
  empty: { fontSize: 13, color: "#9ca3af", textAlign: "center" as const, padding: 24 },
};
