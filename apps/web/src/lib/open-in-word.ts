"use client";

import { useAuthStore } from "./auth-store";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc").replace(
  "/trpc",
  ""
);

interface WordSessionParams {
  docVersionId?: string;
  mode: "intra_audit" | "inter_audit" | "generation_review" | "generation_insert";
  protocolVersionId?: string;
  generatedDocId?: string;
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
  window.open(`${API_BASE}/api/word-open/${sessionId}`, "_blank");
}
