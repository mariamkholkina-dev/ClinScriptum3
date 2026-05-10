"use client";

import { useAuthStore } from "./auth-store";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc").replace(
  "/trpc",
  ""
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
  // (manifest зарегистрирован в Trusted Catalog), `useAutoAuth` читает
  // sessionId из CustomXMLPart внутри DOCX и выполняет exchange — без формы
  // логина и без навигации в селекторе режима.
  const officeUrl = `ms-word:ofe|u|${fileUrl}`;
  const a = document.createElement("a");
  a.href = officeUrl;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // На некоторых браузерах элемент должен пожить ещё кадр — потом убираем.
  setTimeout(() => a.remove(), 1000);
}
