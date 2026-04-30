"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import { useAuthStore } from "@/lib/auth-store";

async function tryRefreshToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem("refreshToken");
  if (!refreshToken) return null;

  try {
    const res = await fetch(
      (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc") + "/auth.refresh",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: { refreshToken } }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.result?.data?.json;
    if (result?.accessToken) {
      useAuthStore.getState().setAuth(result.accessToken, useAuthStore.getState().user);
      localStorage.setItem("refreshToken", result.refreshToken);
      return result.accessToken;
    }
  } catch {
    // refresh failure → fall through and return null
  }
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry(failureCount, error) {
              if (error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED") {
                return false;
              }
              return failureCount < 2;
            },
          },
          mutations: {
            retry: false,
          },
        },
      })
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc",
          transformer: superjson,
          async headers() {
            const token = useAuthStore.getState().accessToken;
            return token ? { authorization: `Bearer ${token}` } : {};
          },
          async fetch(url, options) {
            let res = await globalThis.fetch(url, options);

            if (res.status === 401) {
              const newToken = await tryRefreshToken();
              if (newToken) {
                const newHeaders = new Headers(options?.headers);
                newHeaders.set("authorization", `Bearer ${newToken}`);
                res = await globalThis.fetch(url, { ...options, headers: newHeaders });
              } else {
                useAuthStore.getState().logout();
                if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
                  window.location.href = "/login";
                }
              }
            }

            return res;
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
