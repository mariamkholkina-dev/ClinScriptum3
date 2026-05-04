"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";

export type ToastType = "success" | "error" | "info";

interface ToastData {
  id: number;
  type: ToastType;
  message: string;
}

type Listener = (toast: ToastData) => void;

let listeners: Listener[] = [];
let nextId = 0;

export function showToast(type: ToastType, message: string) {
  const toast: ToastData = { id: ++nextId, type, message };
  for (const l of listeners) l(toast);
}

export const toast = {
  success: (message: string) => showToast("success", message),
  error: (message: string) => showToast("error", message),
  info: (message: string) => showToast("info", message),
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  useEffect(() => {
    const listener: Listener = (t) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 5000);
    };
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          toast={t}
          onDismiss={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
        />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  const Icon =
    toast.type === "success" ? CheckCircle2 : toast.type === "error" ? XCircle : AlertCircle;
  const color =
    toast.type === "success"
      ? "bg-green-100 border-green-300 text-green-900"
      : toast.type === "error"
        ? "bg-red-100 border-red-300 text-red-900"
        : "bg-blue-100 border-blue-300 text-blue-900";
  return (
    <div
      role="alert"
      className={`flex items-center gap-2 px-4 py-3 rounded-lg border shadow-md cursor-pointer max-w-md ${color}`}
      onClick={onDismiss}
    >
      <Icon className="w-5 h-5 shrink-0" />
      <span className="text-sm">{toast.message}</span>
    </div>
  );
}
