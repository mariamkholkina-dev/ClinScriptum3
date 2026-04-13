import React, { createContext, useContext, useState, useCallback } from "react";
import { setTokens, clearTokens } from "../api";

export interface SessionContext {
  docVersionId?: string;
  mode: string;
  protocolVersionId?: string;
  generatedDocId?: string;
}

interface AuthContextValue {
  isAuthenticated: boolean;
  userId: string | null;
  tenantId: string | null;
  sessionContext: SessionContext | null;
  login: (accessToken: string, refreshToken: string, userId: string, tenantId: string) => void;
  setSessionCtx: (ctx: SessionContext) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>(null!);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [sessionContext, setSessionContext] = useState<SessionContext | null>(null);

  const login = useCallback(
    (accessToken: string, refreshToken: string, uid: string, tid: string) => {
      setTokens(accessToken, refreshToken);
      setUserId(uid);
      setTenantId(tid);
      setIsAuthenticated(true);
    },
    []
  );

  const setSessionCtx = useCallback((ctx: SessionContext) => {
    setSessionContext(ctx);
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    setUserId(null);
    setTenantId(null);
    setIsAuthenticated(false);
    setSessionContext(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ isAuthenticated, userId, tenantId, sessionContext, login, setSessionCtx, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
