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
    | "finding_review"
    | "generation_review"
    | "generation_insert"
    | "parsing";
  protocolVersionId?: string;
  generatedDocId?: string;
  goldenSampleId?: string;
  reviewId?: string;
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
  // .docx суффикс нужен Office Protocol Handler'у для распознавания файла —
  // без него Word отвечает «Office не распознаёт указанную команду».
  const fileUrl = `${API_BASE}/api/word-open/${sessionId}.docx`;

  // Office Protocol Handler: ms-word:ofe|u|<url> — браузер триггерит Word,
  // тот скачивает файл по url и открывает его. Add-in грузится автоматически
  // (manifest в Trusted Catalog), `useAutoAuth` читает sessionId из
  // CustomXMLPart внутри DOCX и делает exchange — без формы логина.
  const officeUrl = `ms-word:ofe|u|${fileUrl}`;
  const a = document.createElement("a");
  a.href = officeUrl;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}
