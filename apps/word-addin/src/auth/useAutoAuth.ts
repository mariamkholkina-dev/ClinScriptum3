import { useEffect, useState } from "react";
import { readCustomXmlPart, removeCustomXmlPart } from "../office-helpers";
import { exchangeSession } from "../api";
import { useAuth } from "./AuthProvider";

export function useAutoAuth() {
  const { login, setSessionCtx, isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [autoAuthFailed, setAutoAuthFailed] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function tryAutoAuth() {
      try {
        const sessionId = await readCustomXmlPart();
        if (!sessionId || cancelled) {
          setAutoAuthFailed(true);
          setLoading(false);
          return;
        }

        const result = await exchangeSession(sessionId);
        if (!result || cancelled) {
          setAutoAuthFailed(true);
          setLoading(false);
          return;
        }

        login(result.accessToken, result.refreshToken, result.userId, result.tenantId);
        setSessionCtx(result.context as any);

        await removeCustomXmlPart().catch(() => {});
      } catch {
        if (!cancelled) setAutoAuthFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    tryAutoAuth();
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  return { loading, autoAuthFailed };
}
