"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { useAuthStore } from "@/lib/auth-store";
import { FlaskConical } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess(data) {
      localStorage.setItem("refreshToken", data.refreshToken);
      setAuth(data.accessToken, data.user);
      router.push("/dashboard");
    },
    onError(err) {
      setError(err.message);
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-6 rounded-xl bg-white p-8 shadow-lg">
        <div className="flex flex-col items-center gap-2">
          <FlaskConical className="h-10 w-10 text-brand-600" />
          <h1 className="text-2xl font-bold text-gray-900">ClinScriptum</h1>
          <p className="text-sm text-gray-500">Войдите в свой аккаунт</p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            loginMutation.mutate({ email, password });
          }}
          className="space-y-4"
        >
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700">Эл. почта</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <button
            type="submit"
            disabled={loginMutation.isPending}
            className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loginMutation.isPending ? "Вход..." : "Войти"}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          Нет аккаунта?{" "}
          <Link href="/register" className="text-brand-600 hover:underline">
            Зарегистрироваться
          </Link>
        </p>

        <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500 space-y-1">
          <p className="font-medium text-gray-600">Демо-аккаунты:</p>
          <p>Администратор: admin@demo.clinscriptum.com</p>
          <p>Мед. писатель: writer@demo.clinscriptum.com</p>
          <p>Пароль: changeme123</p>
        </div>
      </div>
    </div>
  );
}
