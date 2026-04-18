"use client";

import { create } from "zustand";

interface AuthState {
  accessToken: string | null;
  user: { id: string; email: string; name: string; role: string } | null;
  _hydrated: boolean;
  setAuth: (token: string, user: AuthState["user"]) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  _hydrated: false,
  setAuth: (token, user) => {
    localStorage.setItem("accessToken", token);
    localStorage.setItem("user", JSON.stringify(user));
    set({ accessToken: token, user });
  },
  logout: () => {
    localStorage.removeItem("accessToken");
    localStorage.removeItem("user");
    localStorage.removeItem("refreshToken");
    set({ accessToken: null, user: null });
  },
}));

if (typeof window !== "undefined") {
  const token = localStorage.getItem("accessToken");
  const user = JSON.parse(localStorage.getItem("user") ?? "null");
  useAuthStore.setState({ accessToken: token, user, _hydrated: true });
}
