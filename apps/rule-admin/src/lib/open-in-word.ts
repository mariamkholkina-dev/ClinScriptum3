"use client";

import { useAuthStore } from "./auth-store";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc").replace(
  "/trpc",
  "",
);

interface WordSessionParams {
  docVersionId?: string;
  mode:
    | "intra_audit"
    | "inter_audit"
    | "generation_review"
    | "generation_insert"
    | "parsing";
  protocolVersionId?: string;
  generatedDocId?: string;
  goldenSampleId?: string;
}

/**
 * Создаёт WordSession через backend и открывает .docx в Word через
 * `/api/word-open/:sessionId` (DOCX с впрыснутым session-tag, который add-in
 * прочитает при загрузке task pane).
 *
 * Дублирует `apps/web/src/lib/open-in-word.ts` — у rule-admin отдельный фронт
 * со своим auth-store, поэтому импорт оттуда невозможен.
 */
export async function openInWord(params: WordSessionParams): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${API_BASE}/api/word-sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to create Word session (HTTP ${res.status})`);
  }

  const { sessionId } = await res.json();
  window.open(`${API_BASE}/api/word-open/${sessionId}`, "_blank");
}
