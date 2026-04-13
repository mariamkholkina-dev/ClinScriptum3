const API_BASE = "http://localhost:4000";

let accessToken: string | null = null;
let refreshToken: string | null = null;

export function setTokens(access: string, refresh?: string) {
  accessToken = access;
  if (refresh) refreshToken = refresh;
}

export function getAccessToken() {
  return accessToken;
}

export function clearTokens() {
  accessToken = null;
  refreshToken = null;
}

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/trpc/auth.refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: { refreshToken } }),
    });
    const data = await res.json();
    if (data.result?.data?.json) {
      const { accessToken: newAccess, refreshToken: newRefresh } = data.result.data.json;
      setTokens(newAccess, newRefresh);
      return true;
    }
  } catch {}
  return false;
}

export async function trpcCall<T>(
  path: string,
  input?: unknown,
  type: "query" | "mutation" = "query"
): Promise<T> {
  const isQuery = type === "query";
  const url = isQuery
    ? `${API_BASE}/trpc/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? {} }))}`
    : `${API_BASE}/trpc/${path}`;

  const doFetch = () =>
    fetch(url, {
      method: isQuery ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: isQuery ? undefined : JSON.stringify({ json: input }),
    });

  let res = await doFetch();

  if (res.status === 401 && refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await doFetch();
    }
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error.message ?? "API error");
  return data.result.data.json;
}

export async function restCall<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function exchangeSession(sessionId: string) {
  const res = await fetch(`${API_BASE}/api/word-sessions/${sessionId}/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) return null;
  return res.json() as Promise<{
    accessToken: string;
    refreshToken: string;
    context: {
      docVersionId?: string;
      mode: string;
      protocolVersionId?: string;
      generatedDocId?: string;
    };
    userId: string;
    tenantId: string;
  }>;
}
