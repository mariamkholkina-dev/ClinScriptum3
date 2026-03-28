const API_BASE = "http://localhost:4000/trpc";

let accessToken: string | null = null;

export function setToken(token: string) {
  accessToken = token;
}

export async function trpcCall<T>(path: string, input?: unknown): Promise<T> {
  const isQuery = !input || (typeof input === "object" && Object.keys(input as any).length === 0);
  const url = isQuery
    ? `${API_BASE}/${path}?input=${encodeURIComponent(JSON.stringify({ json: input ?? {} }))}`
    : `${API_BASE}/${path}`;

  const res = await fetch(url, {
    method: isQuery ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: isQuery ? undefined : JSON.stringify({ json: input }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.result.data.json;
}
